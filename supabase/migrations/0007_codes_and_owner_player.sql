-- M3.5: six-character codes, and the owner playing on their organizer account.
-- No changes to any table.
--
--   * New login codes are six random characters (K4M9QT), unique across every trip and across
--     player and spectator codes. Codes already issued (PINES-FW26-K4M9) keep working.
--   * "This is me" (trips.owner_player_id) now links the owner's player to their organizer
--     account: signed in by email, the owner is that player for everything a player can do, so
--     one sign-in serves both the player and the organizer screens. Only the trip's own owner
--     (trips.owner_id) gets this, only they can set the link, and it gives nobody else anything.

-- ── Code generation ─────────────────────────────────────────────────────────

-- Six characters from the alphabet without look-alikes (no I, O, 0, 1): about a billion
-- combinations. Checked against both code tables, so a code is unique everywhere.
create function private.new_login_code() returns text
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_code text;
begin
  for attempt in 1..20 loop
    select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + get_byte(r.b, i) % 32, 1), '')
      into v_code
      from (select uuid_send(gen_random_uuid()) as b) as r, generate_series(0, 5) as i;
    if not exists (select 1 from public.player_codes c where replace(c.code, '-', '') = v_code)
       and not exists (select 1 from public.spectator_codes c where replace(c.code, '-', '') = v_code) then
      return v_code;
    end if;
  end loop;
  raise exception 'Could not generate a unique code';
end;
$$;

-- Issues a new code for a player and returns it. The old code stops working and every phone
-- logged in with it is signed out of the trip. Trip owner only.
create or replace function public.regenerate_player_code(p_player_id uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_code text;
begin
  if not private.is_trip_owner(private.player_trip_id(p_player_id)) then
    raise exception 'Only the trip owner can issue codes' using errcode = '42501';
  end if;

  for attempt in 1..5 loop
    v_code := private.new_login_code();
    begin
      insert into public.player_codes (player_id, code) values (p_player_id, v_code)
      on conflict (player_id) do update set code = excluded.code, issued_at = now();
      return v_code;
    exception when unique_violation then
      null;   -- someone else was issued the same code this instant: try again
    end;
  end loop;
  raise exception 'Could not generate a unique code';
end;
$$;

-- The trip's spectator code. Creates it the first time; after that, issues a new one, which
-- signs out everyone watching with the old one. Trip owner only.
create or replace function public.issue_spectator_code(p_trip_id uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_code text;
  v_id uuid;
begin
  if not private.is_trip_owner(p_trip_id) then
    raise exception 'Only the trip owner can issue codes' using errcode = '42501';
  end if;
  select c.id into v_id from public.spectator_codes c where c.trip_id = p_trip_id order by c.created_at limit 1;

  for attempt in 1..5 loop
    v_code := private.new_login_code();
    begin
      if v_id is null then
        insert into public.spectator_codes (trip_id, code) values (p_trip_id, v_code);
      else
        update public.spectator_codes set code = v_code where id = v_id;
      end if;
      return v_code;
    exception when unique_violation then
      null;   -- try another
    end;
  end loop;
  raise exception 'Could not generate a unique code';
end;
$$;

-- ── The owner as a player ───────────────────────────────────────────────────

-- The caller's player on this trip, while the trip is open to players: the player their code
-- logged them in as, or, for the trip's owner signed in by email, the player marked "This is me".
create or replace function private.my_player_id(p_trip_id uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select t.owner_player_id
       from public.trips t
      where t.id = p_trip_id and t.owner_id = auth.uid() and t.status in ('live', 'final')),
    (select s.player_id
       from public.trip_sessions s
       join public.trips t on t.id = s.trip_id
      where s.user_id = auth.uid() and s.trip_id = p_trip_id
        and s.player_id is not null and t.status in ('live', 'final')));
$$;

-- Is the caller a player in this group, while scoring is open (trip live, round not final)?
create or replace function private.is_scoring_in_group(p_group_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.groups g
    join public.rounds r on r.id = g.round_id
    join public.trips t on t.id = r.trip_id
    join public.group_players me on me.group_id = g.id
    where g.id = p_group_id
      and me.player_id = private.my_player_id(t.id)
      and t.status = 'live' and r.status <> 'final');
$$;

-- Same as in 0002, but "which player entered this" also knows the owner's player.
create or replace function private.scores_stamp() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    if new.strokes = old.strokes then
      -- Keep the attribution, except when it is being cleared (the enterer was deleted: on delete set null).
      if new.entered_by is not null then new.entered_by := old.entered_by; end if;
      if new.entered_by_player_id is not null then new.entered_by_player_id := old.entered_by_player_id; end if;
      new.updated_at := old.updated_at;
      return new;
    end if;
  end if;
  new.updated_at := now();
  if uid is not null then
    new.entered_by := uid;
    new.entered_by_player_id := private.my_player_id(private.round_trip_id(new.round_id));
  end if;
  return new;
end;
$$;

-- Only the owner (or an app admin) may hand the trip to someone else or say which player they
-- are. Co-admins can edit the rest of the trip.
create or replace function private.trips_guard_owner() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null
     and old.owner_id is distinct from auth.uid()
     and not private.is_app_admin() then
    if new.owner_id is distinct from old.owner_id then
      raise exception 'Only the trip owner can transfer a trip' using errcode = '42501';
    end if;
    if new.owner_player_id is distinct from old.owner_player_id then
      raise exception 'Only the trip owner can say which player they are' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- ── Privileges ──────────────────────────────────────────────────────────────

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;
revoke all on function public.regenerate_player_code(uuid) from public, anon;
revoke all on function public.issue_spectator_code(uuid) from public, anon;
grant execute on function public.regenerate_player_code(uuid) to authenticated, service_role;
grant execute on function public.issue_spectator_code(uuid) to authenticated, service_role;
