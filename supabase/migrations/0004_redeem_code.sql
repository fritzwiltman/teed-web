-- M2: code login.
--
--   * Codes get four random characters (PINES-FW26-K4M9); every existing code is regenerated.
--   * redeem_code() does the whole login in one transaction. Only the redeem-code edge function
--     (service role) can call it.
--   * Failed attempts are rate limited per device and, more loosely, per IP.
--   * Changing or deleting a code ends the sessions that were opened with it.

-- ── Code generation ─────────────────────────────────────────────────────────

-- Four characters from an alphabet without look-alikes (no I, O, 0, 1): about a million
-- combinations. Uses gen_random_uuid() for randomness, which is cryptographically strong.
create function private.random_code_suffix() returns text
language sql volatile set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + get_byte(r.b, i) % 32, 1), '')
  from (select uuid_send(gen_random_uuid()) as b) as r, generate_series(0, 3) as i;
$$;

-- Regenerate every existing code with the longer suffix. The old ones were never handed out.
update public.player_codes
   set code = regexp_replace(code, '-[A-Z0-9]+$', '') || '-' || private.random_code_suffix(),
       issued_at = now();
update public.spectator_codes
   set code = regexp_replace(code, '-[A-Z0-9]+$', '') || '-' || private.random_code_suffix();

-- Codes are matched without their dashes, so no two may differ only by where the dashes are.
create unique index player_codes_normalized_idx on public.player_codes (replace(code, '-', ''));
create unique index spectator_codes_normalized_idx on public.spectator_codes (replace(code, '-', ''));

-- ── Revoking ────────────────────────────────────────────────────────────────

create function private.player_codes_end_sessions() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.trip_sessions s where s.player_id = old.player_id;
  return null;
end;
$$;

create trigger player_codes_end_sessions
  after delete or update of code on public.player_codes
  for each row execute function private.player_codes_end_sessions();

create function private.spectator_codes_end_sessions() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.trip_sessions s where s.spectator_code_id = old.id;
  return null;
end;
$$;

-- (A deleted spectator code takes its sessions with it through the foreign key; a disabled
-- one is already blocked by RLS and comes back if it is re-enabled.)
create trigger spectator_codes_end_sessions
  after update of code on public.spectator_codes
  for each row execute function private.spectator_codes_end_sessions();

-- Issues a new code for a player (slug-initialsYY-XXXX) and returns it. The old code stops
-- working and every phone logged in with it is signed out of the trip. Trip admins only.
create function public.regenerate_player_code(p_player_id uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_prefix text;
  v_code text;
begin
  if not private.is_trip_admin(private.player_trip_id(p_player_id)) then
    raise exception 'Only a trip admin can issue codes' using errcode = '42501';
  end if;

  select t.slug || '-' || p.initials || to_char(t.start_date, 'YY')
    into v_prefix
    from public.players p join public.trips t on t.id = p.trip_id
   where p.id = p_player_id;

  for attempt in 1..5 loop
    v_code := v_prefix || '-' || private.random_code_suffix();
    begin
      insert into public.player_codes (player_id, code) values (p_player_id, v_code)
      on conflict (player_id) do update set code = excluded.code, issued_at = now();
      return v_code;
    exception when unique_violation then
      null;   -- collided with another player's code: try again
    end;
  end loop;
  raise exception 'Could not generate a unique code';
end;
$$;

-- ── Rate limiting ───────────────────────────────────────────────────────────
-- In `private`, so not reachable through the API at all.

create table private.redeem_attempts (
  id           bigint generated always as identity primary key,
  key          text not null,            -- 'u:<user id>' or 'ip:<address>'
  attempted_at timestamptz not null default now()
);
create index redeem_attempts_key_idx on private.redeem_attempts (key, attempted_at);

create table private.redeem_lockouts (
  key          text primary key,
  locked_until timestamptz not null
);

-- Records one failed attempt against a key. Returns true if that reaches the limit for the last
-- minute, in which case the key is locked out for five minutes.
create function private.redeem_fail(p_key text, p_limit int) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.redeem_attempts (key) values (p_key);
  if (select count(*) from private.redeem_attempts a
       where a.key = p_key and a.attempted_at > now() - interval '1 minute') >= p_limit then
    insert into private.redeem_lockouts (key, locked_until) values (p_key, now() + interval '5 minutes')
    on conflict (key) do update set locked_until = excluded.locked_until;
    delete from private.redeem_attempts a where a.key = p_key;
    return true;
  end if;
  return false;
end;
$$;

-- ── Redeeming a code ────────────────────────────────────────────────────────
--
-- Links p_user_id (the phone's Supabase user, already verified by the edge function) to the
-- player or spectator code. Returns jsonb with a status:
--   ok            { role: 'player' | 'spectator', trip: {...}, player: {...} | null }
--   invalid_code  no such code (wrong, revoked, regenerated, or a disabled spectator code)
--   trip_not_live { trip_status: 'draft' | 'final' }
--   rate_limited  { retry_after: seconds }
--
-- Limits, on failed attempts only: 5 a minute per device, 30 a minute per IP (looser, because a
-- whole group shares one address on the rental house or clubhouse Wi-Fi). Either one locks that
-- device or address out for 5 minutes.
create function public.redeem_code(p_code text, p_user_id uuid, p_ip text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_norm       text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_device_key text := 'u:' || p_user_id;
  v_ip_key     text := 'ip:' || nullif(btrim(p_ip), '');
  v_until      timestamptz;
  v_trip       public.trips;
  v_player     public.players;
  v_spectator  uuid;
  v_locked     boolean;
  v_ip_locked  boolean := false;
begin
  if p_user_id is null then
    raise exception 'redeem_code needs a user';
  end if;

  delete from private.redeem_attempts a where a.attempted_at < now() - interval '1 hour';

  select max(l.locked_until) into v_until
    from private.redeem_lockouts l
   where l.key in (v_device_key, v_ip_key) and l.locked_until > now();
  if v_until is not null then
    return jsonb_build_object('status', 'rate_limited', 'retry_after', ceil(extract(epoch from v_until - now()))::int);
  end if;

  select p.* into v_player
    from public.player_codes c join public.players p on p.id = c.player_id
   where replace(c.code, '-', '') = v_norm;

  if v_player.id is not null then
    select t.* into v_trip from public.trips t where t.id = v_player.trip_id;
  else
    select c.id into v_spectator
      from public.spectator_codes c
     where replace(c.code, '-', '') = v_norm and c.enabled;
    if v_spectator is not null then
      select t.* into v_trip
        from public.trips t join public.spectator_codes c on c.trip_id = t.id
       where c.id = v_spectator;
    end if;
  end if;

  if v_trip.id is null then
    v_locked := private.redeem_fail(v_device_key, 5);
    if v_ip_key is not null then
      v_ip_locked := private.redeem_fail(v_ip_key, 30);
    end if;
    if v_locked or v_ip_locked then
      return jsonb_build_object('status', 'rate_limited', 'retry_after', 300);
    end if;
    return jsonb_build_object('status', 'invalid_code');
  end if;

  if v_trip.status <> 'live' then
    return jsonb_build_object('status', 'trip_not_live', 'trip_status', v_trip.status);
  end if;

  insert into public.trip_sessions (user_id, trip_id, player_id, spectator_code_id)
  values (p_user_id, v_trip.id, v_player.id, v_spectator)
  on conflict (user_id, trip_id) do update
    set player_id = excluded.player_id, spectator_code_id = excluded.spectator_code_id, created_at = now();

  delete from private.redeem_attempts a where a.key = v_device_key;

  return jsonb_build_object(
    'status', 'ok',
    'role', case when v_player.id is not null then 'player' else 'spectator' end,
    'trip', jsonb_build_object(
      'id', v_trip.id, 'name', v_trip.name, 'slug', v_trip.slug, 'status', v_trip.status,
      'location', v_trip.location, 'start_date', v_trip.start_date, 'end_date', v_trip.end_date),
    'player', case when v_player.id is not null then jsonb_build_object(
      'id', v_player.id, 'name', v_player.name, 'initials', v_player.initials, 'role', v_player.role) end);
end;
$$;

-- ── Privileges ──────────────────────────────────────────────────────────────

revoke all on function public.redeem_code(text, uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_code(text, uuid, text) to service_role;

revoke all on function public.regenerate_player_code(uuid) from public, anon;
grant execute on function public.regenerate_player_code(uuid) to authenticated, service_role;

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;
