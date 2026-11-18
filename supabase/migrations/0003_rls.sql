-- M1 row-level security.
--
-- Who is who
--   app admin   listed in app_admins: creates trips, owns the course library, can administer any trip
--   trip admin  the trip's owner, an app admin, or a player on the trip with role 'co_admin'
--   player      a user whose trip_sessions row points at a player (trip must be live or final)
--   spectator   a user whose trip_sessions row points at an enabled spectator code (same)
--   anon        not signed in: no access to any table
--
-- The helper functions are SECURITY DEFINER so policies can look across tables without
-- recursing into those tables' own policies. They sit in `private`, which the API doesn't expose.

-- ── Helper functions ────────────────────────────────────────────────────────

create function private.is_app_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid());
$$;

create function private.is_trip_admin(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.trips t where t.id = p_trip_id and t.owner_id = auth.uid())
      or exists (select 1 from public.app_admins a where a.user_id = auth.uid())
      or exists (
        select 1
        from public.trip_sessions s
        join public.players p on p.id = s.player_id
        where s.user_id = auth.uid() and s.trip_id = p_trip_id and p.role = 'co_admin');
$$;

-- The caller's player on this trip, if they are logged in as one and the trip is open to players.
create function private.my_player_id(p_trip_id uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select s.player_id
  from public.trip_sessions s
  join public.trips t on t.id = s.trip_id
  where s.user_id = auth.uid() and s.trip_id = p_trip_id
    and s.player_id is not null and t.status in ('live', 'final');
$$;

create function private.is_trip_player(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.my_player_id(p_trip_id) is not null;
$$;

create function private.is_trip_spectator(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.trip_sessions s
    join public.trips t on t.id = s.trip_id
    join public.spectator_codes c on c.id = s.spectator_code_id
    where s.user_id = auth.uid() and s.trip_id = p_trip_id
      and c.enabled and t.status in ('live', 'final'));
$$;

-- Anything a spectator may see.
create function private.can_read_trip(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_trip_admin(p_trip_id) or private.is_trip_player(p_trip_id) or private.is_trip_spectator(p_trip_id);
$$;

-- Players and admins only: checklist, GHIN numbers.
create function private.can_read_trip_private(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_trip_admin(p_trip_id) or private.is_trip_player(p_trip_id);
$$;

create function private.can_see_money(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_read_trip_private(p_trip_id)
      or (private.is_trip_spectator(p_trip_id)
          and (select t.spectators_see_money from public.trips t where t.id = p_trip_id));
$$;

create function private.round_trip_id(p_round_id uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select r.trip_id from public.rounds r where r.id = p_round_id;
$$;

create function private.player_trip_id(p_player_id uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select p.trip_id from public.players p where p.id = p_player_id;
$$;

create function private.can_read_round(p_round_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_read_trip(private.round_trip_id(p_round_id));
$$;

create function private.is_round_admin(p_round_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_trip_admin(private.round_trip_id(p_round_id));
$$;

-- Is the caller a player in this group, while scoring is open (trip live, round not final)?
create function private.is_scoring_in_group(p_group_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.groups g
    join public.rounds r on r.id = g.round_id
    join public.trips t on t.id = r.trip_id
    join public.group_players me on me.group_id = g.id
    join public.trip_sessions s on s.player_id = me.player_id and s.trip_id = t.id
    where g.id = p_group_id
      and s.user_id = auth.uid()
      and t.status = 'live' and r.status <> 'final');
$$;

-- May the caller write this player's scores in this round? Trip admins always; players only for
-- someone in their own group while scoring is open.
create function private.can_score(p_round_id uuid, p_player_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_round_admin(p_round_id)
      or exists (
        select 1
        from public.group_players them
        where them.round_id = p_round_id and them.player_id = p_player_id
          and private.is_scoring_in_group(them.group_id));
$$;

create function private.can_press(p_group_id uuid, p_round_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_round_admin(p_round_id) or private.is_scoring_in_group(p_group_id);
$$;

-- Only the owner or an app admin may hand a trip to someone else (co-admins can edit the rest).
create function private.trips_guard_owner() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.owner_id is distinct from old.owner_id
     and auth.uid() is not null
     and old.owner_id is distinct from auth.uid()
     and not private.is_app_admin() then
    raise exception 'Only the trip owner can transfer a trip' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trips_guard_owner before update on public.trips
  for each row execute function private.trips_guard_owner();

-- ── Handicap check-in ───────────────────────────────────────────────────────
-- Players can't update `players` directly (that would let them change their name or role), so
-- check-in goes through this function. It closes at the start of the trip's handicap lock date.

create function public.submit_handicap(p_trip_id uuid, p_handicap_index numeric, p_ghin_number text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_player_id uuid := private.my_player_id(p_trip_id);
  v_status text;
  v_lock date;
begin
  if v_player_id is null then
    raise exception 'You are not a player on this trip' using errcode = '42501';
  end if;

  select t.status, t.handicap_lock_date into v_status, v_lock from public.trips t where t.id = p_trip_id;
  if v_status <> 'live'
     or (v_lock is not null and current_date >= v_lock)
     or exists (select 1 from public.players p where p.id = v_player_id and p.index_locked_at is not null) then
    raise exception 'Handicaps are locked for this trip' using errcode = '42501';
  end if;

  update public.players
     set handicap_index = p_handicap_index, index_entered_at = now()
   where id = v_player_id;

  if p_ghin_number is not null then
    insert into public.player_ghin (player_id, ghin_number) values (v_player_id, p_ghin_number)
    on conflict (player_id) do update set ghin_number = excluded.ghin_number, updated_at = now();
  end if;
end;
$$;

-- ── Privileges ──────────────────────────────────────────────────────────────
-- Explicit, so behaviour doesn't depend on the project's default grants. RLS then narrows each one.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema private from public;
revoke all on function public.submit_handicap(uuid, numeric, text) from public, anon;

grant usage on schema private to authenticated, service_role;
grant execute on all functions in schema private to authenticated, service_role;
grant execute on function public.submit_handicap(uuid, numeric, text) to authenticated, service_role;

grant all on all tables in schema public to service_role;

grant select                         on public.app_admins, public.score_history to authenticated;
grant select, delete                 on public.trip_sessions to authenticated;
grant select, insert, delete         on public.presses to authenticated;
grant select, insert, update, delete on
  public.trips, public.players, public.player_codes, public.player_ghin, public.spectator_codes,
  public.courses, public.tees, public.rounds, public.round_formats, public.groups, public.group_players,
  public.scores, public.itinerary_items, public.tasks, public.task_status, public.itinerary_proposals,
  public.push_subscriptions
  to authenticated;

-- ── Policies ────────────────────────────────────────────────────────────────

alter table public.app_admins          enable row level security;
alter table public.trips               enable row level security;
alter table public.players             enable row level security;
alter table public.player_codes        enable row level security;
alter table public.player_ghin         enable row level security;
alter table public.spectator_codes     enable row level security;
alter table public.trip_sessions       enable row level security;
alter table public.courses             enable row level security;
alter table public.tees                enable row level security;
alter table public.rounds              enable row level security;
alter table public.round_formats       enable row level security;
alter table public.groups              enable row level security;
alter table public.group_players       enable row level security;
alter table public.scores              enable row level security;
alter table public.score_history       enable row level security;
alter table public.presses             enable row level security;
alter table public.itinerary_items     enable row level security;
alter table public.tasks               enable row level security;
alter table public.task_status         enable row level security;
alter table public.itinerary_proposals enable row level security;
alter table public.push_subscriptions  enable row level security;

-- app_admins: you can see whether you are one. Rows are managed in the SQL editor.
create policy app_admins_select_own on public.app_admins for select to authenticated
  using (user_id = auth.uid());

-- trips
create policy trips_select on public.trips for select to authenticated
  using (private.can_read_trip(id));
create policy trips_insert on public.trips for insert to authenticated
  with check (private.is_app_admin() and owner_id = auth.uid());
create policy trips_update on public.trips for update to authenticated
  using (private.is_trip_admin(id)) with check (private.is_trip_admin(id));
create policy trips_delete on public.trips for delete to authenticated
  using (owner_id = auth.uid() or private.is_app_admin());

-- players: the roster (no codes, no GHIN numbers in this table)
create policy players_select on public.players for select to authenticated
  using (private.can_read_trip(trip_id));
create policy players_insert on public.players for insert to authenticated
  with check (private.is_trip_admin(trip_id));
create policy players_update on public.players for update to authenticated
  using (private.is_trip_admin(trip_id)) with check (private.is_trip_admin(trip_id));
create policy players_delete on public.players for delete to authenticated
  using (private.is_trip_admin(trip_id));

-- player_codes: trip admins only
create policy player_codes_admin on public.player_codes for all to authenticated
  using (private.is_trip_admin(private.player_trip_id(player_id)))
  with check (private.is_trip_admin(private.player_trip_id(player_id)));

-- player_ghin: players and admins read; admins write (players go through submit_handicap)
create policy player_ghin_select on public.player_ghin for select to authenticated
  using (private.can_read_trip_private(private.player_trip_id(player_id)));
create policy player_ghin_insert on public.player_ghin for insert to authenticated
  with check (private.is_trip_admin(private.player_trip_id(player_id)));
create policy player_ghin_update on public.player_ghin for update to authenticated
  using (private.is_trip_admin(private.player_trip_id(player_id)))
  with check (private.is_trip_admin(private.player_trip_id(player_id)));
create policy player_ghin_delete on public.player_ghin for delete to authenticated
  using (private.is_trip_admin(private.player_trip_id(player_id)));

-- spectator_codes: trip admins only
create policy spectator_codes_admin on public.spectator_codes for all to authenticated
  using (private.is_trip_admin(trip_id)) with check (private.is_trip_admin(trip_id));

-- trip_sessions: created by redeem-code (service role). You see and can end your own;
-- trip admins see and can revoke the trip's.
create policy trip_sessions_select on public.trip_sessions for select to authenticated
  using (user_id = auth.uid() or private.is_trip_admin(trip_id));
create policy trip_sessions_delete on public.trip_sessions for delete to authenticated
  using (user_id = auth.uid() or private.is_trip_admin(trip_id));

-- course library: any signed-in user reads, app admins write
create policy courses_select on public.courses for select to authenticated using (true);
create policy courses_insert on public.courses for insert to authenticated with check (private.is_app_admin());
create policy courses_update on public.courses for update to authenticated
  using (private.is_app_admin()) with check (private.is_app_admin());
create policy courses_delete on public.courses for delete to authenticated using (private.is_app_admin());

create policy tees_select on public.tees for select to authenticated using (true);
create policy tees_insert on public.tees for insert to authenticated with check (private.is_app_admin());
create policy tees_update on public.tees for update to authenticated
  using (private.is_app_admin()) with check (private.is_app_admin());
create policy tees_delete on public.tees for delete to authenticated using (private.is_app_admin());

-- rounds
create policy rounds_select on public.rounds for select to authenticated
  using (private.can_read_trip(trip_id));
create policy rounds_insert on public.rounds for insert to authenticated
  with check (private.is_trip_admin(trip_id));
create policy rounds_update on public.rounds for update to authenticated
  using (private.is_trip_admin(trip_id)) with check (private.is_trip_admin(trip_id));
create policy rounds_delete on public.rounds for delete to authenticated
  using (private.is_trip_admin(trip_id));

-- round_formats, groups, group_players: readable with the round, set up by trip admins
create policy round_formats_select on public.round_formats for select to authenticated
  using (private.can_read_round(round_id));
create policy round_formats_insert on public.round_formats for insert to authenticated
  with check (private.is_round_admin(round_id));
create policy round_formats_update on public.round_formats for update to authenticated
  using (private.is_round_admin(round_id)) with check (private.is_round_admin(round_id));
create policy round_formats_delete on public.round_formats for delete to authenticated
  using (private.is_round_admin(round_id));

create policy groups_select on public.groups for select to authenticated
  using (private.can_read_round(round_id));
create policy groups_insert on public.groups for insert to authenticated
  with check (private.is_round_admin(round_id));
create policy groups_update on public.groups for update to authenticated
  using (private.is_round_admin(round_id)) with check (private.is_round_admin(round_id));
create policy groups_delete on public.groups for delete to authenticated
  using (private.is_round_admin(round_id));

create policy group_players_select on public.group_players for select to authenticated
  using (private.can_read_round(round_id));
create policy group_players_insert on public.group_players for insert to authenticated
  with check (private.is_round_admin(round_id));
create policy group_players_update on public.group_players for update to authenticated
  using (private.is_round_admin(round_id)) with check (private.is_round_admin(round_id));
create policy group_players_delete on public.group_players for delete to authenticated
  using (private.is_round_admin(round_id));

-- scores: everyone on the trip reads; you write only for your own group (admins for anyone)
create policy scores_select on public.scores for select to authenticated
  using (private.can_read_round(round_id));
create policy scores_insert on public.scores for insert to authenticated
  with check (private.can_score(round_id, player_id));
create policy scores_update on public.scores for update to authenticated
  using (private.can_score(round_id, player_id)) with check (private.can_score(round_id, player_id));
create policy scores_delete on public.scores for delete to authenticated
  using (private.can_score(round_id, player_id));

-- score_history: read-only; written by the trigger on scores
create policy score_history_select on public.score_history for select to authenticated
  using (private.can_read_round(round_id));

-- presses: same rule as scores, for your own group
create policy presses_select on public.presses for select to authenticated
  using (private.can_read_round(round_id));
create policy presses_insert on public.presses for insert to authenticated
  with check (private.can_press(group_id, round_id));
create policy presses_delete on public.presses for delete to authenticated
  using (private.can_press(group_id, round_id));

-- itinerary: cost lines are hidden from spectators unless the trip allows it
create policy itinerary_items_select on public.itinerary_items for select to authenticated
  using (private.can_read_trip(trip_id) and (type <> 'cost' or private.can_see_money(trip_id)));
create policy itinerary_items_insert on public.itinerary_items for insert to authenticated
  with check (private.is_trip_admin(trip_id));
create policy itinerary_items_update on public.itinerary_items for update to authenticated
  using (private.is_trip_admin(trip_id)) with check (private.is_trip_admin(trip_id));
create policy itinerary_items_delete on public.itinerary_items for delete to authenticated
  using (private.is_trip_admin(trip_id));

-- checklist: players and admins only
create policy tasks_select on public.tasks for select to authenticated
  using (private.can_read_trip_private(trip_id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (private.is_trip_admin(trip_id));
create policy tasks_update on public.tasks for update to authenticated
  using (private.is_trip_admin(trip_id)) with check (private.is_trip_admin(trip_id));
create policy tasks_delete on public.tasks for delete to authenticated
  using (private.is_trip_admin(trip_id));

create policy task_status_select on public.task_status for select to authenticated
  using (private.can_read_trip_private(trip_id));
create policy task_status_delete on public.task_status for delete to authenticated
  using (private.is_trip_admin(trip_id));
-- Admins set anyone's status; a player sets their own on tasks marked player_can_complete.
create policy task_status_insert on public.task_status for insert to authenticated
  with check (
    private.is_trip_admin(trip_id)
    or (player_id = private.my_player_id(trip_id)
        and exists (select 1 from public.tasks t where t.id = task_id and t.player_can_complete)));
create policy task_status_update on public.task_status for update to authenticated
  using (
    private.is_trip_admin(trip_id)
    or (player_id = private.my_player_id(trip_id)
        and exists (select 1 from public.tasks t where t.id = task_id and t.player_can_complete)))
  with check (
    private.is_trip_admin(trip_id)
    or (player_id = private.my_player_id(trip_id)
        and exists (select 1 from public.tasks t where t.id = task_id and t.player_can_complete)));

-- proposals: trip admins only (the itinerary-propose function inserts with the service role)
create policy itinerary_proposals_admin on public.itinerary_proposals for all to authenticated
  using (private.is_trip_admin(trip_id)) with check (private.is_trip_admin(trip_id));

-- push subscriptions: your own, for a trip you can read
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid() and private.can_read_trip(trip_id));
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and private.can_read_trip(trip_id));
create policy push_subscriptions_delete on public.push_subscriptions for delete to authenticated
  using (user_id = auth.uid());
