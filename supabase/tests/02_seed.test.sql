-- Checks that the Southern Pines 2026 seed loaded completely (pgTAP).
-- Gross totals are the Out/In/Tot the old site's scripts/scores.js prints for each card.

begin;
select * from no_plan();

select results_eq(
  $$ select name, status, handicap_allowance, strokes_off_low, pickup_net_double from public.trips where slug = 'PINES' $$,
  $$ values ('Southern Pines 2026', 'final', 0.90::numeric(3,2), true, true) $$,
  'the trip is there with its house rules (90%, off the low man, net double bogey)');

select results_eq(
  $$ select p.name, p.handicap_index from public.players p join public.trips t on t.id = p.trip_id where t.slug = 'PINES' order by p.sort_order $$,
  $$ values ('Fritz', 18.6::numeric(3,1)), ('Von', 8.1), ('Matt', 28.7), ('Charlie', 19.1) $$,
  'four players with their GHIN indexes');

select results_eq(
  $$ select b.name from public.trips t join public.players b on b.id = t.banker_player_id where t.slug = 'PINES' $$,
  $$ values ('Fritz') $$, 'Fritz is the banker');

select results_eq(
  $$ select count(*) from public.player_codes c join public.players p on p.id = c.player_id join public.trips t on t.id = p.trip_id
     where t.slug = 'PINES' and c.code ~ ('^PINES-' || p.initials || '26-[A-Z2-9]{2}$') $$,
  'select 4::bigint', 'every player has a generated login code');

select results_eq(
  $$ select c.short_name, t.name, t.yards, t.rating, t.slope, (select sum(x) from unnest(t.par) x)
     from public.tees t join public.courses c on c.id = t.course_id
     where c.short_name in ('Tot Hill', 'S. Pines', 'Mid Pines', 'Pine Needles', 'Talamore') order by t.yards $$,
  $$ values ('S. Pines',     'White',  6106, 70.3::numeric(3,1), 135::smallint, 71::bigint),
            ('Tot Hill',     'Silver', 6180, 70.6, 135, 72),
            ('Talamore',     'Blue',   6268, 70.9, 134, 71),
            ('Pine Needles', 'Ross',   6400, 71.9, 138, 71),
            ('Mid Pines',    'Ross',   6404, 72.3, 138, 72) $$,
  'five courses (four played, Talamore the backup) with tees, yards, rating, slope and par');

select results_eq(
  $$ select r.round_number, c.short_name, r.play_date, r.tee_time, f.format_key, r.status
     from public.rounds r join public.trips t on t.id = r.trip_id join public.courses c on c.id = r.course_id
     join public.round_formats f on f.round_id = r.id
     where t.slug = 'PINES' order by r.round_number $$,
  $$ values (1::smallint, 'Tot Hill',     date '2026-10-09', time '10:50', 'sixes',      'final'),
            (2,           'S. Pines',     '2026-10-10',      '07:33',      'nassau',     'final'),
            (3,           'Mid Pines',    '2026-10-11',      '08:05',      'stableford', 'final'),
            (4,           'Pine Needles', '2026-10-12',      '08:00',      'stroke',     'final') $$,
  'four rounds with course, date, tee time and format');

select results_eq(
  $$ select r.round_number, p.name, gp.course_handicap, gp.playing_handicap, gp.team
     from public.group_players gp join public.rounds r on r.id = gp.round_id join public.trips t on t.id = r.trip_id
     join public.players p on p.id = gp.player_id
     where t.slug = 'PINES' order by r.round_number, gp.position $$,
  $$ values (1::smallint, 'Fritz', 22::smallint, 19::smallint, null), (1, 'Von',  9,  8, null), (1, 'Matt', 34, 30, null), (1, 'Charlie', 22, 20, null),
            (2,           'Fritz', 22,           19,           'B'),  (2, 'Von',  9,  8, 'A'),  (2, 'Matt', 34, 30, 'A'),  (2, 'Charlie', 22, 20, 'B'),
            (3,           'Fritz', 23,           21,           null), (3, 'Von', 10,  9, null), (3, 'Matt', 35, 32, null), (3, 'Charlie', 24, 21, null),
            (4,           'Fritz', 24,           21,           null), (4, 'Von', 11, 10, null), (4, 'Matt', 36, 32, null), (4, 'Charlie', 24, 22, null) $$,
  'GHIN course and playing handicaps for every round, and Saturday''s teams');

select results_eq(
  $$ select r.round_number, pr.bet, pr.after_hole
     from public.presses pr join public.rounds r on r.id = pr.round_id join public.trips t on t.id = r.trip_id where t.slug = 'PINES' $$,
  $$ values (1::smallint, 'm1', 5::smallint) $$, 'Friday''s press on match 1 after hole 5');

select results_eq(
  $$ select count(*) from public.scores s join public.rounds r on r.id = s.round_id join public.trips t on t.id = r.trip_id where t.slug = 'PINES' $$,
  'select 288::bigint', '288 gross scores (4 players x 4 rounds x 18 holes)');

select results_eq(
  $$ select r.round_number, p.name,
            sum(s.strokes) filter (where s.hole <= 9), sum(s.strokes) filter (where s.hole > 9), sum(s.strokes)
     from public.scores s join public.rounds r on r.id = s.round_id join public.trips t on t.id = r.trip_id
     join public.players p on p.id = s.player_id
     where t.slug = 'PINES' group by r.round_number, p.name, p.sort_order order by r.round_number, p.sort_order $$,
  $$ values (1::smallint, 'Fritz', 43::bigint, 51::bigint, 94::bigint), (1, 'Von', 45, 40, 85), (1, 'Matt', 62, 54, 116), (1, 'Charlie', 52, 47,  99),
            (2,           'Fritz', 51,         48,         99),         (2, 'Von', 44, 46, 90), (2, 'Matt', 54, 53, 107), (2, 'Charlie', 52, 50, 102),
            (3,           'Fritz', 53,         46,         99),         (3, 'Von', 46, 47, 93), (3, 'Matt', 56, 53, 109), (3, 'Charlie', 55, 53, 108),
            (4,           'Fritz', 46,         52,         98),         (4, 'Von', 39, 43, 82), (4, 'Matt', 55, 57, 112), (4, 'Charlie', 54, 51, 105) $$,
  'out / in / total for every card match the old site');

select * from finish();
rollback;
