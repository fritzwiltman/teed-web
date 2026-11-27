-- Rounds that finish on their own only after a night's sleep, reopening a final round, and Nassau.
--
--   • A complete round becomes Final from 3 AM, where the trip is played, on the day after the
--     latest of: its date, its last score change, and its last reopening. So a round set up
--     with a date already past is not made final the moment its last score lands, and a card
--     corrected late at night is still open until the morning. Nothing on `scores` finalizes
--     anything: it happens when someone next opens the trip, as before.
--   • reopen_round(): the organizer or a co-organizer sets a final round back to live. Who did it
--     and when goes in round_events, a new table. A reopened round finalizes again by the rule
--     above, or by hand. Reopening a round of a final trip reopens the trip.
--   • Nassau is a round_formats row: format_key 'nassau', settings
--       {"stake_front_cents": 500, "stake_back_cents": 500, "stake_overall_cents": 500,
--        "auto_press": false, "press_at": "closed" | "dormie"}
--     for exactly two players. (Spectators only get the stakes when the trip shows them winnings:
--     private.without_money drops keys with "stake" in them.) auto_press and press_at can't change
--     once the round has a score.
--   • A press made by hand is a row in presses (there since 0002, with RLS for the group):
--     bet is the bet being pressed ('front', 'back', 'overall', and 'front_p1' for the front's
--     first press), after_hole the hole just finished. The engine decides whether it was allowed.
--     presses joins the Realtime publication so the other phone sees it.
--
-- Results are never stored: the bets, presses that start by themselves, and the settle-up are
-- worked out from the raw strokes by the scoring engine in the app (src/app/scoring/nassau.ts).

-- ── What happened to a round ────────────────────────────────────────────────

create table public.round_events (
  id         bigint generated always as identity primary key,
  round_id   uuid not null references public.rounds (id) on delete cascade,
  kind       text not null check (kind in ('reopened')),
  created_by uuid references auth.users (id) on delete set null,
  -- The trip member who did it; null for the app admin acting on a trip they are not on.
  member_id  uuid references public.trip_members (id) on delete set null,
  created_at timestamptz not null default now()
);
create index round_events_round_id_idx on public.round_events (round_id);
create index round_events_member_id_idx on public.round_events (member_id) where member_id is not null;

alter table public.round_events enable row level security;
grant select on public.round_events to authenticated;
grant all on public.round_events to service_role;

-- Read with the round; written only by reopen_round().
create policy round_events_select on public.round_events for select to authenticated
  using (private.can_read_round(round_id));

-- ── Complete and Final ──────────────────────────────────────────────────────

drop function private.finalize_due_rounds(uuid);

-- p_now is only ever passed by the tests.
create function private.finalize_due_rounds(p_trip_id uuid default null, p_now timestamptz default now())
returns void
language sql volatile security definer set search_path = ''
as $$
  update public.rounds r
     set status = 'final'
    from public.trips t
   where t.id = r.trip_id
     and (p_trip_id is null or t.id = p_trip_id)
     and t.status = 'live'
     and r.status <> 'final'
     and private.round_is_complete(r.id)
     and p_now >= ((greatest(
           r.play_date,
           (select (max(s.updated_at) at time zone t.timezone)::date
              from public.scores s where s.round_id = r.id),
           (select (max(e.created_at) at time zone t.timezone)::date
              from public.round_events e where e.round_id = r.id and e.kind = 'reopened')
         ) + 1)::timestamp + interval '3 hours') at time zone t.timezone;
$$;

revoke all on function private.finalize_due_rounds(uuid, timestamptz) from public;
grant execute on function private.finalize_due_rounds(uuid, timestamptz) to authenticated, service_role;

-- Sets a final round back to live, so its scores can be corrected. Trip admins only.
create function public.reopen_round(p_round_id uuid) returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_trip   uuid;
  v_status text;
begin
  select r.trip_id, r.status into v_trip, v_status
    from public.rounds r where r.id = p_round_id for update;
  if v_trip is null or not private.is_trip_admin(v_trip) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_status <> 'final' then
    raise exception 'That round is not final' using errcode = '23514';
  end if;
  -- Scoring is only open on a live trip.
  update public.trips t set status = 'live' where t.id = v_trip and t.status = 'final';
  update public.rounds r set status = 'live' where r.id = p_round_id;
  insert into public.round_events (round_id, kind, created_by, member_id)
  values (p_round_id, 'reopened', auth.uid(),
          (select m.id from public.trip_members m where m.trip_id = v_trip and m.profile_id = auth.uid()));
end;
$$;

revoke all on function public.reopen_round(uuid) from public, anon;
grant execute on function public.reopen_round(uuid) to authenticated, service_role;

-- ── Round setup ─────────────────────────────────────────────────────────────

drop function public.save_round(uuid, uuid, uuid, uuid, text, date, time, uuid[], boolean, integer, uuid[]);

-- As in 0011, plus p_nassau: the Nassau's settings (see the top of this file), or null for no
-- Nassau. A call without it, from a phone still on the last build, saves a round as before.
create function public.save_round(
  p_trip_id uuid,
  p_round_id uuid,
  p_course_id uuid,
  p_tee_id uuid,
  p_holes text,
  p_play_date date,
  p_tee_time time,
  p_player_ids uuid[],
  p_nine_point boolean default false,
  p_point_value_cents integer default null,
  p_player_tee_ids uuid[] default null,
  p_nassau jsonb default null
) returns uuid
language plpgsql volatile set search_path = ''
as $$
declare
  v_round uuid := p_round_id;
  v_group uuid;
  v_name  text;
  v_count integer := coalesce(cardinality(p_player_ids), 0);
  v_nassau jsonb;
  v_old    jsonb;
begin
  if not private.is_trip_admin(p_trip_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_count < 1 or v_count > 6 then
    raise exception 'Pick the players in the group' using errcode = '23514';
  end if;
  if (select count(distinct x) from unnest(p_player_ids) as x) <> v_count
     or exists (select 1 from unnest(p_player_ids) as x
                where not exists (select 1 from public.trip_members m where m.id = x and m.trip_id = p_trip_id)) then
    raise exception 'Those players are not all on this trip' using errcode = '23514';
  end if;

  -- Each player's own tees, when they differ from the round's: same course, rated, same holes.
  if p_player_tee_ids is not null then
    if cardinality(p_player_tee_ids) <> v_count then
      raise exception 'Give tees for every player, or for none' using errcode = '23514';
    end if;
    if exists (select 1 from unnest(p_player_tee_ids) as x
               where x is not null
                 and not exists (select 1 from public.tees t
                                 where t.id = x and t.course_id = p_course_id
                                   and t.rating is not null and t.slope is not null
                                   and cardinality(t.par) = (select cardinality(r.par) from public.tees r where r.id = p_tee_id))) then
      raise exception 'Those tees need a rating and slope' using errcode = '23514';
    end if;
  end if;

  if not exists (select 1 from public.tees t
                 where t.id = p_tee_id and t.course_id = p_course_id
                   and t.rating is not null and t.slope is not null) then
    raise exception 'Those tees need a rating and slope' using errcode = '23514';
  end if;
  if p_holes <> '18' and (select cardinality(t.par) from public.tees t where t.id = p_tee_id) < 18 then
    raise exception 'That course has no second nine' using errcode = '23514';
  end if;
  if p_nine_point and (v_count <> 3 or coalesce(p_point_value_cents, 0) <= 0) then
    raise exception 'The 9-point game needs three players and a point value' using errcode = '23514';
  end if;

  if p_nassau is not null then
    if v_count <> 2 then
      raise exception 'Nassau is for exactly two players' using errcode = '23514';
    end if;
    if p_nine_point then
      raise exception 'Pick one game' using errcode = '23514';
    end if;
    if exists (select 1 from unnest(array['stake_front_cents', 'stake_back_cents', 'stake_overall_cents']) as k
               where p_nassau ? k
                 and (jsonb_typeof(p_nassau -> k) <> 'number'
                      or (p_nassau ->> k)::numeric < 0
                      or (p_nassau ->> k)::numeric <> trunc((p_nassau ->> k)::numeric)))
       or (p_nassau ? 'auto_press' and jsonb_typeof(p_nassau -> 'auto_press') <> 'boolean')
       or coalesce(p_nassau ->> 'press_at', 'closed') not in ('closed', 'dormie') then
      raise exception 'Those Nassau settings are not right' using errcode = '23514';
    end if;
    v_nassau := jsonb_build_object(
      'stake_front_cents',   coalesce((p_nassau ->> 'stake_front_cents')::integer, 0),
      'stake_back_cents',    coalesce((p_nassau ->> 'stake_back_cents')::integer, 0),
      'stake_overall_cents', coalesce((p_nassau ->> 'stake_overall_cents')::integer, 0),
      'auto_press',          coalesce((p_nassau ->> 'auto_press')::boolean, false),
      'press_at',            coalesce(p_nassau ->> 'press_at', 'closed'));
    -- Auto press is chosen before the round: once a score is in, it stays as it is.
    if v_round is not null then
      select f.settings into v_old from public.round_formats f
       where f.round_id = v_round and f.format_key = 'nassau';
      if v_old is not null
         and (v_old -> 'auto_press' is distinct from v_nassau -> 'auto_press'
              or v_old -> 'press_at' is distinct from v_nassau -> 'press_at')
         and exists (select 1 from public.scores s where s.round_id = v_round) then
        raise exception 'Auto press can''t change once the round has started' using errcode = '23514';
      end if;
    end if;
  end if;

  set constraints all deferred;   -- players can trade places in the group

  if v_round is null then
    insert into public.rounds (trip_id, round_number, course_id, tee_id, holes, play_date, tee_time, pairings_tbd)
    values (p_trip_id,
            (select coalesce(max(r.round_number), 0) + 1 from public.rounds r where r.trip_id = p_trip_id),
            p_course_id, p_tee_id, p_holes, p_play_date, p_tee_time, false)
    returning id into v_round;
  else
    update public.rounds r
       set course_id = p_course_id, tee_id = p_tee_id, holes = p_holes,
           play_date = p_play_date, tee_time = p_tee_time, pairings_tbd = false
     where r.id = v_round and r.trip_id = p_trip_id;
    if not found then
      raise exception 'No such round' using errcode = '42501';
    end if;
  end if;

  select g.id into v_group from public.groups g where g.round_id = v_round order by g.group_number limit 1;
  if v_group is null then
    insert into public.groups (round_id, group_number, tee_time) values (v_round, 1, p_tee_time)
    returning id into v_group;
  else
    update public.groups g set tee_time = p_tee_time where g.id = v_group;
  end if;

  -- Taking someone out of the group would take their scores with them: say so instead.
  select m.name into v_name
  from public.group_players gp
  join public.trip_members m on m.id = gp.player_id
  where gp.round_id = v_round and gp.player_id <> all (p_player_ids)
    and exists (select 1 from public.scores s where s.round_id = v_round and s.player_id = gp.player_id)
  limit 1;
  if v_name is not null then
    raise exception '% has scores in this round', v_name using errcode = '23514';
  end if;
  delete from public.group_players gp where gp.round_id = v_round and gp.player_id <> all (p_player_ids);

  -- tee_id stays null for anyone on the round's tees.
  insert into public.group_players (round_id, player_id, group_id, position, tee_id)
  select v_round, x.id, v_group, x.n, nullif(p_player_tee_ids[x.n], p_tee_id)
  from unnest(p_player_ids) with ordinality as x (id, n)
  on conflict (round_id, player_id) do update
    set group_id = excluded.group_id, position = excluded.position, tee_id = excluded.tee_id;

  insert into public.round_formats (round_id, format_key, sort_order) values (v_round, 'stroke', 0)
  on conflict (round_id, format_key) do nothing;
  if p_nine_point then
    insert into public.round_formats (round_id, format_key, settings, sort_order)
    values (v_round, 'nine_point', jsonb_build_object('point_value_cents', p_point_value_cents), 1)
    on conflict (round_id, format_key) do update
      set settings = public.round_formats.settings || excluded.settings;
  else
    delete from public.round_formats f where f.round_id = v_round and f.format_key = 'nine_point';
  end if;

  -- Taking the Nassau off takes its presses with it.
  if v_nassau is not null then
    insert into public.round_formats (round_id, format_key, settings, sort_order)
    values (v_round, 'nassau', v_nassau, 1)
    on conflict (round_id, format_key) do update set settings = excluded.settings;
  else
    delete from public.round_formats f where f.round_id = v_round and f.format_key = 'nassau';
  end if;

  return v_round;
end;
$$;

revoke all on function public.save_round(uuid, uuid, uuid, uuid, text, date, time, uuid[], boolean, integer, uuid[], jsonb)
  from public, anon;
grant execute on function public.save_round(uuid, uuid, uuid, uuid, text, date, time, uuid[], boolean, integer, uuid[], jsonb)
  to authenticated, service_role;

-- ── Realtime ────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'presses') then
    alter publication supabase_realtime add table public.presses;
  end if;
end;
$$;
