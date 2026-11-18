-- Southern Pines 2026 (Oct 8–12, 2026): the trip from the old GitHub Pages site
-- (github.com/fritzwiltman/2026-southern-pines), used as Teed's test trip.
--
-- Everything is copied from that site's index.html: courses, tees, ratings, par and stroke index,
-- GHIN handicaps, formats, Friday's press and all 288 gross scores. What the scoring engine must
-- reproduce from this data is in southern-pines-2026.expected.json.
--
-- Safe to run more than once: courses are skipped if they exist, and the trip part does nothing
-- once the trip is there. Login codes are generated here at random, never committed (public repo).

-- ── Course library ──────────────────────────────────────────────────────────

insert into public.courses (name, short_name, location, architect, year_opened, description, website_url, scorecard_url)
values
  ('Tot Hill Farm Golf Club', 'Tot Hill', 'Asheboro, NC', 'Mike Strantz', 2000,
   'A wild Mike Strantz design sharing the same bold DNA as Tobacco Road. Dramatic elevation changes, multi-tiered greens protected by rocks and streams, and blind approach shots make this one of the most adventurous rounds in the Carolinas. Recently restored by new ownership and playing better than ever.',
   'https://www.tothillfarm.com', 'https://tothillfarm.com/scorecard/'),
  ('Southern Pines Golf Club', 'S. Pines', 'Southern Pines, NC', 'Donald Ross (restored by Kyle Franz, 2021)', 1906,
   'One of the oldest Ross designs in the Sandhills, recently restored to its full glory by Kyle Franz. Short by modern standards but demands precise shot-making with a variety of approaches to each hole. The rugged Sandhills terrain and classic Ross greens make this a must-play.',
   'https://www.southernpinesgolfclub.com', 'https://southernpinesgolfclub.com/wp-content/uploads/sites/4/2026/05/scorecard-with-lost-hole.pdf'),
  ('Mid Pines Inn & Golf Club', 'Mid Pines', 'Southern Pines, NC', 'Donald Ross', 1921,
   'Widely considered the best of the three Pines courses, this Donald Ross parkland layout sits atop a knoll at the historic Mid Pines Inn. Fast, sloping greens, classic bunkering, and subtle elevation changes demand precision on every approach.',
   'https://www.midpinesinn.com', 'https://midpinesinn.com/wp-content/uploads/sites/3/2026/05/MP-Scorecard-1.pdf'),
  ('Pine Needles Lodge & Golf Club', 'Pine Needles', 'Southern Pines, NC', 'Donald Ross', 1927,
   'The flagship of the Pines trio. Home to four U.S. Women''s Open Championships and ranked among the best courses in America. Wide fairways with classic Ross greens that punish anything short or right. Full resort with locker rooms and showers.',
   'https://www.pineneedleslodge.com', 'https://pineneedleslodge.com/wp-content/uploads/sites/2/2026/05/PN-Scorecard-1.pdf'),
  ('Talamore Golf Club', 'Talamore', 'Southern Pines, NC', 'Rees Jones', null,
   'Recently remastered Rees Jones design featuring restored greens, opened fairways, and 12 old-world sod wall bunkers, the only course in the Southern Pines area with that feature. Monday''s backup course; not played.',
   'https://talamoregolfresort.com/talamore-golf-club/', 'https://talamoregolfresort.com/wp-content/uploads/2025/08/TGR-Scorecard-2025-Final-2.jpg')
on conflict do nothing;

-- Par and stroke index are the men's rows from each official scorecard. Southern Pines holes
-- 4, 6 and 12 are listed "4/5"; men's par 4 is used (par 71) and the Lost Hole is left out.
insert into public.tees (course_id, name, yards, rating, slope, par, stroke_index)
select c.id, v.tee, v.yards, v.rating, v.slope, v.par, v.si
from (values
  ('Tot Hill Farm Golf Club', 'Silver', 6180, 70.6, 135,
   '{4,4,3,5,5,3,4,5,4, 4,3,4,3,4,3,5,4,5}'::smallint[], '{8,2,18,10,6,14,16,12,4, 15,13,5,9,7,17,3,1,11}'::smallint[]),
  ('Southern Pines Golf Club', 'White', 6106, 70.3, 135,
   '{4,5,3,4,5,4,3,4,3, 4,4,4,4,3,5,4,4,4}', '{11,7,13,3,5,1,17,9,15, 10,14,2,8,18,6,16,4,12}'),
  ('Mid Pines Inn & Golf Club', 'Ross', 6404, 72.3, 138,
   '{4,3,4,4,5,5,4,3,4, 5,3,4,3,4,5,4,4,4}', '{5,15,7,13,9,1,3,17,11, 2,18,8,10,16,12,6,14,4}'),
  ('Pine Needles Lodge & Golf Club', 'Ross', 6400, 71.9, 138,
   '{5,4,3,4,3,4,4,4,4, 5,4,4,3,4,5,3,4,4}', '{11,5,17,9,7,1,3,15,13, 4,12,14,16,2,6,18,8,10}'),
  ('Talamore Golf Club', 'Blue', 6268, 70.9, 134,
   '{5,3,4,5,3,4,4,4,4, 4,5,4,3,4,3,4,4,4}', '{4,16,6,14,18,12,2,8,10, 7,15,5,17,9,13,1,11,3}')
) as v (course, tee, yards, rating, slope, par, si)
join public.courses c on c.name = v.course
on conflict do nothing;

-- ── The trip ────────────────────────────────────────────────────────────────

do $seed$
declare
  v_trip constant uuid := '5e2026a0-0000-4000-8000-000000000001';
begin
  if exists (select 1 from public.trips where id = v_trip or slug = 'PINES') then
    raise notice 'Southern Pines 2026 is already seeded; nothing to do.';
    return;
  end if;

  -- Owned by the first app admin if there is one yet (see README.md in this folder).
  -- Final: the trip is over, so it is readable but scores are closed. Set status to 'live' to test scoring.
  insert into public.trips (id, owner_id, name, slug, location, start_date, end_date, status,
                            handicap_allowance, strokes_off_low, pickup_net_double, handicap_lock_date)
  values (v_trip, (select user_id from public.app_admins order by created_at limit 1),
          'Southern Pines 2026', 'PINES', 'Southern Pines, NC', '2026-10-08', '2026-10-12', 'final',
          0.90, true, true, '2026-10-01');

  -- Indexes from GHIN as pulled for the trip. Initials other than Fritz's are placeholders.
  insert into public.players (trip_id, name, initials, role, handicap_index, index_entered_at, index_locked_at, sort_order)
  values
    (v_trip, 'Fritz',   'FW', 'co_admin', 18.6, '2026-10-01', '2026-10-01', 1),
    (v_trip, 'Von',     'V',  'player',    8.1, '2026-10-01', '2026-10-01', 2),
    (v_trip, 'Matt',    'M',  'player',   28.7, '2026-10-01', '2026-10-01', 3),
    (v_trip, 'Charlie', 'C',  'player',   19.1, '2026-10-01', '2026-10-01', 4);

  update public.trips
     set banker_player_id = (select id from public.players where trip_id = v_trip and name = 'Fritz')
   where id = v_trip;

  -- Random login codes: PINES-<initials>26-<2 characters>.
  insert into public.player_codes (player_id, code)
  select p.id,
         'PINES-' || p.initials || '26-'
           || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1)
           || substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1)
  from public.players p
  where p.trip_id = v_trip;

  -- Rounds
  insert into public.rounds (trip_id, round_number, course_id, tee_id, play_date, tee_time, status, pairings_tbd, drive_note)
  select v_trip, v.n, c.id, t.id, v.play_date, v.tee_time, 'final', false, v.drive_note
  from (values
    (1, 'Tot Hill Farm Golf Club',        'Silver', date '2026-10-09', time '10:50', '~1 hr from the house'),
    (2, 'Southern Pines Golf Club',       'White',  date '2026-10-10', time '07:33', '8 min from the house'),
    (3, 'Mid Pines Inn & Golf Club',      'Ross',   date '2026-10-11', time '08:05', '3 min from the house'),
    (4, 'Pine Needles Lodge & Golf Club', 'Ross',   date '2026-10-12', time '08:00', '3 min from the house')
  ) as v (n, course, tee, play_date, tee_time, drive_note)
  join public.courses c on c.name = v.course
  join public.tees t on t.course_id = c.id and t.name = v.tee;

  -- Formats. Every round: 90% allowance, strokes off the low man (trip house rules).
  -- $30 a round from everyone: three $10 bets in the match formats, a $120 pot in the others.
  insert into public.round_formats (round_id, format_key, settings)
  select r.id, v.format_key, v.settings::jsonb
  from (values
    -- Sixes: partners rotate every six holes, by position in the group (1 Fritz, 2 Von, 3 Matt, 4 Charlie).
    (1, 'sixes', '{"bet_value": 10, "press_value": 10, "presses": "manual", "press_rule": "closed_out",
                   "rotation": [[[1, 2], [3, 4]], [[1, 4], [2, 3]], [[1, 3], [2, 4]]]}'),
    -- Nassau: 2-man best ball, front / back / overall. Teams came from Friday's finish (1st & 4th v 2nd & 3rd).
    (2, 'nassau', '{"bet_value": 10, "press_value": 10, "presses": "manual", "press_rule": "closed_out",
                    "tied_hole": "push", "teams_from": "Round 1 finish: 1st & 4th v 2nd & 3rd"}'),
    (3, 'stableford', '{"buy_in": 30, "pot_split": [0.75, 0.25]}'),
    (4, 'stroke',     '{"buy_in": 30, "pot_split": [0.75, 0.25]}')
  ) as v (n, format_key, settings)
  join public.rounds r on r.trip_id = v_trip and r.round_number = v.n;

  -- One foursome per round.
  insert into public.groups (round_id, group_number, tee_time)
  select r.id, 1, r.tee_time from public.rounds r where r.trip_id = v_trip;

  -- Course handicap and playing handicap (the 90% allowance) are read off GHIN, not calculated.
  -- Saturday's teams: A = Von & Matt, B = Charlie & Fritz.
  insert into public.group_players (round_id, player_id, group_id, position, team, course_handicap, playing_handicap)
  select r.id, p.id, g.id, p.sort_order, v.team, v.course_handicap, v.playing_handicap
  from (values
    (1, 'Fritz', null, 22, 19), (1, 'Von', null,  9,  8), (1, 'Matt', null, 34, 30), (1, 'Charlie', null, 22, 20),
    (2, 'Fritz', 'B',  22, 19), (2, 'Von', 'A',   9,  8), (2, 'Matt', 'A',  34, 30), (2, 'Charlie', 'B',  22, 20),
    (3, 'Fritz', null, 23, 21), (3, 'Von', null, 10,  9), (3, 'Matt', null, 35, 32), (3, 'Charlie', null, 24, 21),
    (4, 'Fritz', null, 24, 21), (4, 'Von', null, 11, 10), (4, 'Matt', null, 36, 32), (4, 'Charlie', null, 24, 22)
  ) as v (n, player, team, course_handicap, playing_handicap)
  join public.rounds r on r.trip_id = v_trip and r.round_number = v.n
  join public.groups g on g.round_id = r.id and g.group_number = 1
  join public.players p on p.trip_id = v_trip and p.name = v.player;

  -- Friday: Matt & Charlie pressed match 1 after hole 5.
  insert into public.presses (round_id, round_format_id, group_id, bet, after_hole, created_by)
  select r.id, f.id, g.id, 'm1', 5, null
  from public.rounds r
  join public.round_formats f on f.round_id = r.id and f.format_key = 'sixes'
  join public.groups g on g.round_id = r.id and g.group_number = 1
  where r.trip_id = v_trip and r.round_number = 1;

  -- Gross scores, holes 1–18.
  insert into public.scores (round_id, player_id, hole, strokes)
  select r.id, p.id, h.hole, h.strokes
  from (values
    (1, 'Fritz',   '{5,4,3,5,7,5,5,4,5, 5,5,7,5,5,5,7,6,6}'::smallint[]),
    (1, 'Von',     '{4,5,4,7,8,3,5,4,5, 5,3,5,3,4,5,5,4,6}'),
    (1, 'Matt',    '{8,6,4,8,9,5,6,8,8, 5,6,8,4,8,6,4,7,6}'),
    (1, 'Charlie', '{5,7,4,6,9,2,5,5,9, 3,5,7,5,5,5,6,6,5}'),
    (2, 'Fritz',   '{5,7,6,7,8,5,4,6,3, 7,4,6,5,3,7,6,6,4}'),
    (2, 'Von',     '{4,5,4,6,5,5,5,6,4, 6,5,7,4,4,4,5,5,6}'),
    (2, 'Matt',    '{7,6,6,6,7,6,5,7,4, 7,6,6,6,3,7,4,7,7}'),
    (2, 'Charlie', '{5,6,6,6,5,7,7,7,3, 4,6,5,7,5,5,6,5,7}'),
    (3, 'Fritz',   '{6,6,5,7,8,6,5,4,6, 6,5,4,6,5,5,4,6,5}'),
    (3, 'Von',     '{6,4,7,5,5,6,6,3,4, 7,4,7,3,4,6,6,6,4}'),
    (3, 'Matt',    '{8,4,6,5,7,9,6,5,6, 9,4,6,5,4,8,5,6,6}'),
    (3, 'Charlie', '{7,6,8,4,7,7,7,3,6, 6,5,6,3,6,8,6,6,7}'),
    (4, 'Fritz',   '{6,5,3,5,5,5,6,6,5, 7,5,6,4,6,7,4,7,6}'),
    (4, 'Von',     '{6,5,4,4,4,4,4,4,4, 4,6,5,3,5,5,4,6,5}'),
    (4, 'Matt',    '{7,5,6,6,6,6,5,7,7, 7,8,6,3,8,9,4,6,6}'),
    (4, 'Charlie', '{8,5,5,5,5,7,6,6,7, 8,8,5,3,5,7,3,6,6}')
  ) as v (n, player, strokes)
  cross join lateral unnest(v.strokes) with ordinality as h (strokes, hole)
  join public.rounds r on r.trip_id = v_trip and r.round_number = v.n
  join public.players p on p.trip_id = v_trip and p.name = v.player;

  -- A short itinerary: lodging, dinners, departures, and the per-person costs.
  insert into public.itinerary_items (trip_id, day, start_time, type, title, details, sort_order)
  values
    (v_trip, '2026-10-08', '16:00', 'lodging', 'Serene South Henley',
     '{"provider": "VRBO", "check_out": "2026-10-12", "nights": 4, "url": "https://www.vrbo.com/4388553"}', 1),
    (v_trip, '2026-10-08', '18:45', 'meal', 'Elliotts on Linden',
     '{"reservation": true, "url": "https://www.elliottsonlinden.com/our-menu/"}', 2),
    (v_trip, '2026-10-09', '08:40', 'travel', 'Leave for Tot Hill Farm', '{"note": "~1 hr from the house"}', 1),
    (v_trip, '2026-10-09', null,    'meal', 'Grill out at home', '{}', 2),
    (v_trip, '2026-10-10', null,    'meal', 'Pinehurst Brewing Co.',
     '{"reservation": false, "url": "https://www.pinehurstbrewing.com/home"}', 1),
    (v_trip, '2026-10-11', '18:00', 'meal', 'Ashten''s', '{"reservation": true, "url": "https://ashtens.com/ashtens"}', 1),
    (v_trip, '2026-10-12', null,    'note', 'Shower at Pine Needles after the round',
     '{"note": "Pack a toiletry bag and a change of clothes; leave them in the car."}', 1),
    (v_trip, '2026-10-12', '14:30', 'travel', 'Leave for the airport', '{}', 2),
    (v_trip, '2026-10-09', null, 'cost', 'Tot Hill Farm greens fee',  '{"per_person": 180}', 10),
    (v_trip, '2026-10-10', null, 'cost', 'Southern Pines greens fee', '{"per_person": 245}', 10),
    (v_trip, '2026-10-11', null, 'cost', 'Mid Pines greens fee',      '{"per_person": 305}', 10),
    (v_trip, '2026-10-12', null, 'cost', 'Pine Needles greens fee',   '{"per_person": 315}', 10),
    (v_trip, '2026-10-08', null, 'cost', 'Lodging, 4 nights',         '{"per_person": 346, "total": 1385}', 10),
    (v_trip, '2026-10-09', null, 'cost', 'Games, $30 a round',        '{"per_person": 120}', 11);
end;
$seed$;
