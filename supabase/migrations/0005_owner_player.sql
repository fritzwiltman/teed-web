-- Owner display, and owner-only powers.
--
--   * trips.owner_player_id says which player on the roster is the trip's owner. It is for display
--     only ("Owner" on trip home): it grants nothing. Owner rights stay with the email sign-in
--     (trips.owner_id / app_admins); logging in with the owner's player code gives player rights.
--   * Co-admins keep pairings, score fixes and trip info. Login codes, and deleting players or
--     rounds, are now owner-only.

alter table public.trips add column owner_player_id uuid;
alter table public.trips
  add constraint trips_owner_player_fkey foreign key (owner_player_id, id)
  references public.players (id, trip_id) on delete set null (owner_player_id);

-- Southern Pines: Fritz is the owner, and plays with ordinary player rights.
update public.trips t
   set owner_player_id = p.id
  from public.players p
 where t.slug = 'PINES' and p.trip_id = t.id and p.name = 'Fritz';
update public.players p
   set role = 'player'
  from public.trips t
 where t.slug = 'PINES' and p.id = t.owner_player_id;

-- The trip's owner by email sign-in, or an app admin. Not co-admins.
create function private.is_trip_owner(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.trips t where t.id = p_trip_id and t.owner_id = auth.uid())
      or exists (select 1 from public.app_admins a where a.user_id = auth.uid());
$$;

revoke all on function private.is_trip_owner(uuid) from public;
grant execute on function private.is_trip_owner(uuid) to authenticated, service_role;

-- Login codes: owner only.
drop policy player_codes_admin on public.player_codes;
create policy player_codes_owner on public.player_codes for all to authenticated
  using (private.is_trip_owner(private.player_trip_id(player_id)))
  with check (private.is_trip_owner(private.player_trip_id(player_id)));

drop policy spectator_codes_admin on public.spectator_codes;
create policy spectator_codes_owner on public.spectator_codes for all to authenticated
  using (private.is_trip_owner(trip_id)) with check (private.is_trip_owner(trip_id));

-- Deleting players or rounds: owner only. (Deleting the trip already was.)
drop policy players_delete on public.players;
create policy players_delete on public.players for delete to authenticated
  using (private.is_trip_owner(trip_id));

drop policy rounds_delete on public.rounds;
create policy rounds_delete on public.rounds for delete to authenticated
  using (private.is_trip_owner(trip_id));

-- Same as in 0004, but for the trip owner rather than any trip admin.
create or replace function public.regenerate_player_code(p_player_id uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_prefix text;
  v_code text;
begin
  if not private.is_trip_owner(private.player_trip_id(p_player_id)) then
    raise exception 'Only the trip owner can issue codes' using errcode = '42501';
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

-- Same as in 0004, with owner_player_id added to the trip it returns.
create or replace function public.redeem_code(p_code text, p_user_id uuid, p_ip text default null) returns jsonb
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
      'location', v_trip.location, 'start_date', v_trip.start_date, 'end_date', v_trip.end_date,
      'owner_player_id', v_trip.owner_player_id),
    'player', case when v_player.id is not null then jsonb_build_object(
      'id', v_player.id, 'name', v_player.name, 'initials', v_player.initials, 'role', v_player.role) end);
end;
$$;
