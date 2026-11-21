-- Round setup, 9-hole rounds, and rounds that finish on their own.
--
--   • rounds.holes: 18, the front nine or the back nine.
--   • trips.timezone: where the trip is played, so "the day is over" means midnight there.
--   • save_round() / delete_round(): the organizer's round setup, in one transaction.
--   • A round is Complete when every player in it has a score on every hole in play. A Complete
--     round becomes Final on its own once its day is over; an unfinished one waits for the
--     organizer. No cron: it happens when someone next opens the trip.
--   • The 9-point game is a round_formats row: format_key 'nine_point',
--     settings {"point_value_cents": 50}. (Spectators only get that key when the trip shows
--     them winnings: private.without_money already drops keys with "value" in them.)
--
-- Results are never stored: boards, points and settle-up are worked out from the raw strokes by
-- the scoring engine in the app (src/app/scoring).

-- ── Columns ─────────────────────────────────────────────────────────────────

alter table public.rounds
  add column holes text not null default '18' check (holes in ('18', 'front', 'back'));

alter table public.trips
  add column timezone text not null default 'America/New_York';

create function private.trips_timezone_known() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.timezone) then
    raise exception 'Unknown time zone %', new.timezone using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger trips_timezone_known before insert or update of timezone on public.trips
  for each row execute function private.trips_timezone_known();

-- ── Complete and Final ──────────────────────────────────────────────────────

-- Every player in the round has a score on every hole in play.
create function private.round_is_complete(p_round_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.group_players gp where gp.round_id = p_round_id)
     and not exists (
       select 1
       from public.rounds r
       join public.tees t on t.id = r.tee_id
       join public.group_players gp on gp.round_id = r.id
       cross join lateral generate_series(
         case when r.holes = 'back' then 10 else 1 end,
         case when r.holes = 'front' then 9 else cardinality(t.par) end) as h (hole)
       where r.id = p_round_id
         and not exists (select 1 from public.scores s
                         where s.round_id = r.id and s.player_id = gp.player_id and s.hole = h.hole));
$$;

-- Complete rounds whose day has ended where the trip is played become Final.
create function private.finalize_due_rounds(p_trip_id uuid default null) returns void
language sql volatile security definer set search_path = ''
as $$
  update public.rounds r
     set status = 'final'
    from public.trips t
   where t.id = r.trip_id
     and (p_trip_id is null or t.id = p_trip_id)
     and t.status = 'live'
     and r.status <> 'final'
     and (now() at time zone t.timezone)::date > r.play_date
     and private.round_is_complete(r.id);
$$;

-- A published trip becomes final on its own once every round is final and its last day has
-- passed (from noon UTC the day after: early morning in the US). Due rounds are finalized first.
create or replace function private.finalize_due_trips(p_trip_id uuid default null) returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform private.finalize_due_rounds(p_trip_id);
  update public.trips t
     set status = 'final'
   where t.status = 'live'
     and t.reopened_at is null
     and (p_trip_id is null or t.id = p_trip_id)
     and now() >= (t.end_date + 1)::timestamp at time zone 'UTC' + interval '12 hours'
     and exists (select 1 from public.rounds r where r.trip_id = t.id)
     and not exists (select 1 from public.rounds r where r.trip_id = t.id and r.status <> 'final');
end;
$$;

-- What the app calls when it opens a trip: finalize what is due.
create function public.finalize_due_rounds(p_trip_id uuid) returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  if not private.can_read_trip(p_trip_id) then
    raise exception 'Not on this trip' using errcode = '42501';
  end if;
  perform private.finalize_due_trips(p_trip_id);
end;
$$;

-- ── Round setup ─────────────────────────────────────────────────────────────

-- Creates a round (p_round_id null) or changes one: course, tees, holes, day and tee time, its
-- one group of players in the order given, and its games. Net stroke play is always on; the
-- 9-point game needs exactly three players and a point value in cents. Runs as the caller, so
-- RLS decides who may (the organizer, a co-organizer, the app admin). Returns the round's id.
--
-- Every player needs a handicap index: strokes are worked out from it, never guessed.
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
  p_point_value_cents integer default null
) returns uuid
language plpgsql volatile set search_path = ''
as $$
declare
  v_round uuid := p_round_id;
  v_group uuid;
  v_name  text;
  v_count integer := coalesce(cardinality(p_player_ids), 0);
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

  select m.name into v_name
  from unnest(p_player_ids) with ordinality as x (id, n)
  join public.trip_members m on m.id = x.id
  where m.handicap_index is null
  order by x.n limit 1;
  if v_name is not null then
    raise exception 'Add %''s handicap index', v_name using errcode = '23514';
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

  insert into public.group_players (round_id, player_id, group_id, position)
  select v_round, x.id, v_group, x.n
  from unnest(p_player_ids) with ordinality as x (id, n)
  on conflict (round_id, player_id) do update set group_id = excluded.group_id, position = excluded.position;

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

  return v_round;
end;
$$;

-- Deletes a round, its groups and its scores, and closes the gap in the numbering.
create function public.delete_round(p_round_id uuid) returns void
language plpgsql volatile set search_path = ''
as $$
declare
  v_trip   uuid;
  v_number smallint;
begin
  select r.trip_id, r.round_number into v_trip, v_number from public.rounds r where r.id = p_round_id;
  if v_trip is null or not private.is_trip_admin(v_trip) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  delete from public.rounds r where r.id = p_round_id;
  update public.rounds r set round_number = r.round_number + 1000
   where r.trip_id = v_trip and r.round_number > v_number;
  update public.rounds r set round_number = r.round_number - 1001
   where r.trip_id = v_trip and r.round_number > 1000;
end;
$$;

revoke all on function
  public.finalize_due_rounds(uuid),
  public.save_round(uuid, uuid, uuid, uuid, text, date, time, uuid[], boolean, integer),
  public.delete_round(uuid)
  from public, anon;
grant execute on function
  public.finalize_due_rounds(uuid),
  public.save_round(uuid, uuid, uuid, uuid, text, date, time, uuid[], boolean, integer),
  public.delete_round(uuid)
  to authenticated, service_role;
revoke all on function private.trips_timezone_known(), private.round_is_complete(uuid),
  private.finalize_due_rounds(uuid) from public;
grant execute on function private.trips_timezone_known(), private.round_is_complete(uuid),
  private.finalize_due_rounds(uuid) to authenticated, service_role;

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Scores are already published (0002). Rounds join them so "Final" reaches every phone.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rounds') then
    alter publication supabase_realtime add table public.rounds;
  end if;
end;
$$;

-- ── Spectators ──────────────────────────────────────────────────────────────
-- As in 0008, plus each round's holes in play, so the spectator boards use the same engine.
create or replace function public.spectator_view(p_token_hash text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'trip', jsonb_build_object(
      'name', t.name, 'location', t.location, 'start_date', t.start_date, 'end_date', t.end_date,
      'status', t.status, 'handicap_allowance', t.handicap_allowance, 'strokes_off_low', t.strokes_off_low,
      'pickup_net_double', t.pickup_net_double, 'shows_winnings', t.spectators_see_money),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'round_number', r.round_number, 'play_date', r.play_date, 'tee_time', r.tee_time,
        'status', r.status, 'holes', r.holes,
        'course', (select jsonb_build_object('name', c.name, 'short_name', c.short_name, 'photo_path', c.photo_path)
                     from public.courses c where c.id = r.course_id),
        'tee', (select jsonb_build_object('name', x.name, 'yards', x.yards, 'rating', x.rating, 'slope', x.slope,
                                          'par', x.par, 'stroke_index', x.stroke_index)
                  from public.tees x where x.id = r.tee_id),
        'formats', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', f.id, 'format_key', f.format_key,
                   'settings', case when t.spectators_see_money then f.settings else private.without_money(f.settings) end)
                 order by f.sort_order, f.format_key)
          from public.round_formats f where f.round_id = r.id), '[]'::jsonb),
        'groups', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', g.id, 'group_number', g.group_number, 'tee_time', g.tee_time,
                   'players', coalesce((
                     select jsonb_agg(jsonb_build_object(
                              'id', m.id, 'name', m.name, 'initials', m.initials, 'position', gp.position,
                              'team', gp.team, 'handicap_index', m.handicap_index,
                              'course_handicap', gp.course_handicap, 'playing_handicap', gp.playing_handicap)
                            order by gp.position)
                     from public.group_players gp
                     join public.trip_members m on m.id = gp.player_id
                     where gp.group_id = g.id), '[]'::jsonb))
                 order by g.group_number)
          from public.groups g where g.round_id = r.id), '[]'::jsonb),
        'scores', coalesce((
          select jsonb_agg(jsonb_build_object('player_id', s.player_id, 'hole', s.hole, 'strokes', s.strokes)
                           order by s.player_id, s.hole)
          from public.scores s where s.round_id = r.id), '[]'::jsonb),
        'presses', coalesce((
          select jsonb_agg(jsonb_build_object('round_format_id', p.round_format_id, 'group_id', p.group_id,
                                              'bet', p.bet, 'after_hole', p.after_hole)
                           order by p.after_hole)
          from public.presses p where p.round_id = r.id), '[]'::jsonb))
        order by r.round_number)
      from public.rounds r where r.trip_id = t.id), '[]'::jsonb))
  from public.spectator_links l
  join public.trips t on t.id = l.trip_id
  where l.token_hash = p_token_hash and t.status in ('live', 'final');
$$;
