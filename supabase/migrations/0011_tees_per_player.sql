-- Tees per player, and a missing handicap index blocks scoring rather than setup.
--
--   • group_players.tee_id: the tees this player plays in this round. Null means the round's tees.
--     The engine works each player's course handicap out from their own tees' rating, slope and
--     par, and adds the par difference when pars differ within the group (Rules of Handicapping
--     6.2b). Nothing is stored.
--   • save_round() takes each player's tees, and no longer refuses a player with no handicap
--     index: a round can be set up before everyone's index is in.
--   • The first score needs them: a score can't be entered while anyone in the group has no
--     handicap index ("Add Dad's handicap index").
--   • The spectator view carries each player's tees.

alter table public.group_players
  add column tee_id uuid references public.tees (id);
create index group_players_tee_id_idx on public.group_players (tee_id) where tee_id is not null;

-- ── Scoring needs every handicap index ──────────────────────────────────────

create function private.scores_need_indexes() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  select m.name into v_name
  from public.group_players me
  join public.group_players gp on gp.group_id = me.group_id
  join public.trip_members m on m.id = gp.player_id
  where me.round_id = new.round_id and me.player_id = new.player_id
    and m.handicap_index is null and gp.playing_handicap is null
  order by gp.position
  limit 1;
  if v_name is not null then
    raise exception 'Add %''s handicap index', v_name using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger scores_need_indexes before insert on public.scores
  for each row execute function private.scores_need_indexes();

revoke all on function private.scores_need_indexes() from public;
grant execute on function private.scores_need_indexes() to authenticated, service_role;

-- ── Round setup ─────────────────────────────────────────────────────────────

drop function public.save_round(uuid, uuid, uuid, uuid, text, date, time, uuid[], boolean, integer);

-- As in 0010, plus p_player_tee_ids: one entry per player in the same order, null (or the
-- round's tees) for anyone playing the round's tees. Players need not have a handicap index yet.
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
  p_player_tee_ids uuid[] default null
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

  return v_round;
end;
$$;

revoke all on function public.save_round(uuid, uuid, uuid, uuid, text, date, time, uuid[], boolean, integer, uuid[])
  from public, anon;
grant execute on function public.save_round(uuid, uuid, uuid, uuid, text, date, time, uuid[], boolean, integer, uuid[])
  to authenticated, service_role;

-- ── Spectators ──────────────────────────────────────────────────────────────
-- As in 0010, plus each player's own tees (null when they play the round's).
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
                              'course_handicap', gp.course_handicap, 'playing_handicap', gp.playing_handicap,
                              'tee', (select jsonb_build_object('name', pt.name, 'yards', pt.yards, 'rating', pt.rating,
                                                                'slope', pt.slope, 'par', pt.par, 'stroke_index', pt.stroke_index)
                                        from public.tees pt where pt.id = gp.tee_id))
                            order by gp.position)
                     from public.group_players gp
                     join public.trip_members m on m.id = gp.player_id
                     where gp.group_id = g.id), '[]'::jsonb))
                 order by g.group_number)
          from public.groups g where g.round_id = r.id), '[]'::jsonb),
        'scores', coalesce((
          select jsonb_agg(jsonb_build_object('player_id', s.player_id, 'hole', s.hole, 'strokes', s.strokes,
                                              'picked_up', s.picked_up)
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
