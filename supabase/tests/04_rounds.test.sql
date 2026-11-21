-- Round setup, 9-hole rounds, Complete and Final (pgTAP). Who may enter scores, role by role,
-- is in 03_permissions.test.sql. Builds its own fixture inside a transaction and rolls it back.

begin;

create schema tests;
grant usage on schema tests to public;

create function tests.id(name text) returns uuid language sql immutable as $$ select md5(name)::uuid $$;

create function tests.as_user(name text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.id('user:' || name), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create function tests.as_postgres() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

select * from no_plan();

-- ── Fixture: Fritz organizes; Dad and Brother play; Sam is on the trip with no index ────────

insert into auth.users (id, email, email_confirmed_at)
select tests.id('user:' || n), n || '@test.teed', now() from unnest(array['fritz', 'dad', 'brother', 'zed']) as n;

insert into public.courses (id, name, location) values (tests.id('palmer'), 'Test Palmer', 'Nowhere, FL');
insert into public.tees (id, course_id, name, rating, slope, par, stroke_index) values
  (tests.id('white'), tests.id('palmer'), 'White', 70.5, 130,
   '{4,4,3,5,4,4,3,5,4,4,4,3,5,4,4,3,5,4}', '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18}'),
  (tests.id('unrated'), tests.id('palmer'), 'Unrated', null, null,
   '{4,4,3,5,4,4,3,5,4,4,4,3,5,4,4,3,5,4}', '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18}');
insert into public.courses (id, name, location) values (tests.id('short'), 'Nine Holer', 'Nowhere, FL');
insert into public.tees (id, course_id, name, rating, slope, par, stroke_index)
values (tests.id('nine'), tests.id('short'), 'Red', 33.0, 110, '{4,4,3,5,4,4,3,5,4}', '{1,2,3,4,5,6,7,8,9}');

insert into public.trips (id, name, slug, start_date, end_date, status, timezone) values
  (tests.id('trip'),  'PGA National', 'PGA', current_date - 2, current_date + 2, 'live', 'America/New_York'),
  (tests.id('other'), 'Other', 'OTHER', current_date, current_date + 1, 'live', 'America/New_York');
insert into public.trip_members (id, trip_id, name, initials, role, profile_id, handicap_index) values
  (tests.id('fritz'),   tests.id('trip'), 'Fritz',   'F', 'organizer', tests.id('user:fritz'),   18.6),
  (tests.id('dad'),     tests.id('trip'), 'Dad',     'D', 'player',    tests.id('user:dad'),     22.0),
  (tests.id('brother'), tests.id('trip'), 'Brother', 'B', 'player',    tests.id('user:brother'), 9.4),
  (tests.id('sam'),     tests.id('trip'), 'Sam',     'S', 'player',    null,                     null),
  (tests.id('zed'),     tests.id('other'), 'Zed',    'Z', 'organizer', tests.id('user:zed'),     5.0);

create function tests.save(who text, players text[], holes text default '18', nine boolean default true,
                           cents integer default 50, round uuid default null, tee text default 'white',
                           day date default current_date)
returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.as_user(who);
  v := public.save_round(tests.id('trip'), round,
         case when tee = 'nine' then tests.id('short') else tests.id('palmer') end, tests.id(tee),
         holes, day, '08:10', (select array_agg(tests.id(p)) from unnest(players) as p), nine, cents);
  perform tests.as_postgres();
  return v;
end;
$$;

-- ── Round setup ─────────────────────────────────────────────────────────────

select is((select holes from public.rounds limit 0), null, 'rounds have a holes column');
select throws_ok($$ select tests.save('dad', '{fritz,dad,brother}') $$, '42501', null, 'a player cannot set up a round');
select tests.as_postgres();
select throws_ok($$ select tests.save('zed', '{fritz,dad,brother}') $$, '42501', null, 'nor can another trip''s organizer');
select tests.as_postgres();
select throws_ok($$ select tests.save('fritz', '{fritz,dad}') $$, '23514', null, 'the 9-point game needs exactly three players');
select tests.as_postgres();
select throws_ok($$ select tests.save('fritz', '{fritz,dad,brother}', cents => 0) $$, '23514', null, 'and a point value');
select tests.as_postgres();
select throws_ok($$ select tests.save('fritz', '{fritz,dad,brother}', tee => 'unrated') $$, '23514', null,
                 'tees with no rating and slope cannot be played');
select tests.as_postgres();
select throws_ok($$ select tests.save('fritz', '{fritz,dad,brother}', holes => 'back', tee => 'nine') $$, '23514', null,
                 'a nine-hole course has no back nine');
select tests.as_postgres();
select throws_ok($$ select tests.save('fritz', '{fritz,dad,zed}') $$, '23514', null, 'players must be on this trip');
select tests.as_postgres();
select is((select count(*) from public.rounds where trip_id = tests.id('trip')), 0::bigint, 'nothing was left behind by the refusals');

create temp table made as select tests.save('fritz', '{fritz,dad,brother}') as r1;
grant select on made to public;

select results_eq(
  $$ select r.round_number::int, r.holes, r.tee_time::text, r.pairings_tbd from public.rounds r where r.id = (select r1 from made) $$,
  $$ values (1, '18', '08:10:00', false) $$, 'the organizer sets up round 1');
select results_eq(
  $$ select m.name, gp.position::int, gp.course_handicap, gp.playing_handicap
     from public.group_players gp join public.trip_members m on m.id = gp.player_id
     where gp.round_id = (select r1 from made) order by gp.position $$,
  $$ values ('Fritz', 1, null::smallint, null::smallint), ('Dad', 2, null, null), ('Brother', 3, null, null) $$,
  'with one group in the order picked, and no handicap stored: it is always worked out from the index');
select results_eq(
  $$ select f.format_key, f.settings from public.round_formats f where f.round_id = (select r1 from made) order by f.sort_order $$,
  $$ values ('stroke', '{}'::jsonb), ('nine_point', '{"point_value_cents": 50}'::jsonb) $$,
  'net stroke play is always on; the 9-point game carries its point value in cents');
select is(private.without_money('{"point_value_cents": 50}'::jsonb), '{}'::jsonb, 'spectators do not get the point value');

-- Editing: new order, a dollar a point, the back nine.
select is(tests.save('fritz', '{brother,fritz,dad}', holes => 'back', cents => 100, round => (select r1 from made)),
          (select r1 from made), 'saving an existing round changes it in place');
select results_eq(
  $$ select m.name from public.group_players gp join public.trip_members m on m.id = gp.player_id
     where gp.round_id = (select r1 from made) order by gp.position $$,
  $$ values ('Brother'), ('Fritz'), ('Dad') $$, 'players can trade places');
select is((select f.settings from public.round_formats f where f.round_id = (select r1 from made) and f.format_key = 'nine_point'),
          '{"point_value_cents": 100}'::jsonb, 'the point value changes');
select is((select holes from public.rounds where id = (select r1 from made)), 'back', 'and the holes in play');
select tests.save('fritz', '{fritz,dad}', nine => false, round => (select r1 from made));
select is((select count(*) from public.round_formats f where f.round_id = (select r1 from made)), 1::bigint,
          'turning the 9-point game off leaves net stroke play');
select tests.save('fritz', '{fritz,dad,brother}', round => (select r1 from made));

-- ── A missing handicap index blocks scoring, not setup ──────────────────────

create temp table early as select tests.save('fritz', '{fritz,dad,sam}') as r;
grant select on early to public;
select isnt((select r from early), null, 'a round can be set up before everyone has a handicap index');
select tests.as_user('dad');
select throws_ok($$ insert into public.scores (round_id, player_id, hole, strokes) values ((select r from early), tests.id('dad'), 1, 5) $$,
                 '23514', 'Add Sam''s handicap index', 'but its first score needs them all, and says whose is missing');
select tests.as_user('fritz');
select throws_ok($$ insert into public.scores (round_id, player_id, hole, strokes) values ((select r from early), tests.id('fritz'), 1, 5) $$,
                 '23514', 'Add Sam''s handicap index', 'for the organizer too');
select public.set_member_index(tests.id('sam'), 12.0);
insert into public.scores (round_id, player_id, hole, strokes) values ((select r from early), tests.id('fritz'), 1, 5);
select tests.as_postgres();
select is((select count(*) from public.scores where round_id = (select r from early)), 1::bigint,
          'once the index is in, scoring starts');
update public.trip_members set handicap_index = null where id = tests.id('sam');
select tests.as_user('fritz');
select public.delete_round((select r from early));
select tests.as_postgres();

-- ── Tees per player ─────────────────────────────────────────────────────────

insert into public.tees (id, course_id, name, rating, slope, par, stroke_index) values
  (tests.id('gold'), tests.id('palmer'), 'Gold', 68.1, 121,
   '{4,4,3,5,4,4,3,5,4,4,4,3,5,4,4,3,4,4}', '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18}');

create function tests.save_tees(tees text[], round uuid default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.as_user('fritz');
  v := public.save_round(tests.id('trip'), round, tests.id('palmer'), tests.id('white'), '18', current_date, '08:10',
         array[tests.id('fritz'), tests.id('dad'), tests.id('brother')], true, 50,
         (select array_agg(case when t is null then null else tests.id(t) end order by n) from unnest(tees) with ordinality as x (t, n)));
  perform tests.as_postgres();
  return v;
end;
$$;

create temp table mixed as select tests.save_tees(array[null, 'gold', 'white']) as r;
grant select on mixed to public;
select results_eq(
  $$ select m.name, gp.tee_id from public.group_players gp join public.trip_members m on m.id = gp.player_id
     where gp.round_id = (select r from mixed) order by gp.position $$,
  $$ values ('Fritz', null::uuid), ('Dad', tests.id('gold')), ('Brother', null::uuid) $$,
  'each player has their own tees; null (and the round''s own tees) means the round''s');
select tests.save_tees(array[null, null, null]::text[], (select r from mixed));
select is((select count(*) from public.group_players where round_id = (select r from mixed) and tee_id is not null), 0::bigint,
          'saving again can put everyone back on the round''s tees');
select throws_ok($$ select tests.save_tees(array[null, 'unrated', null], (select r from mixed)) $$, '23514', null,
                 'a player''s tees need a rating and slope too');
select tests.as_postgres();
select throws_ok($$ select tests.save_tees(array[null, 'nine', null], (select r from mixed)) $$, '23514', null,
                 'and must be on the round''s course');
select tests.as_postgres();
select throws_ok($$ select tests.save_tees(array[null, 'gold'], (select r from mixed)) $$, '23514', null,
                 'tees are given for every player or for none');
select tests.as_postgres();
select tests.save_tees(array['gold', null, null], (select r from mixed));
insert into public.spectator_links (trip_id, nonce, token_hash) values (tests.id('trip'), 'm', 'mixed-hash');
select is(public.spectator_view('mixed-hash') #>> '{rounds,1,groups,0,players,0,tee,name}', 'Gold',
          'the spectator view carries a player''s own tees');
select is(public.spectator_view('mixed-hash') #> '{rounds,1,groups,0,players,1,tee}', 'null'::jsonb,
          'and nothing for someone on the round''s tees');
delete from public.spectator_links where trip_id = tests.id('trip');
select tests.as_user('fritz');
select public.delete_round((select r from mixed));
select tests.as_postgres();

-- ── Scoring, Complete, Final ────────────────────────────────────────────────

select tests.as_user('dad');
insert into public.scores (round_id, player_id, hole, strokes) values ((select r1 from made), tests.id('brother'), 1, 5);
select is((select count(*) from public.scores where round_id = (select r1 from made)), 1::bigint,
          'anyone in the group enters a score for anyone in the group');
insert into public.scores (round_id, player_id, hole, strokes) values ((select r1 from made), tests.id('brother'), 1, 4)
on conflict (round_id, player_id, hole) do update set strokes = excluded.strokes;
insert into public.scores (round_id, player_id, hole, strokes) values ((select r1 from made), tests.id('brother'), 1, 4)
on conflict (round_id, player_id, hole) do update set strokes = excluded.strokes;
select results_eq($$ select count(*), max(strokes)::int from public.scores where round_id = (select r1 from made) $$,
                  $$ values (1::bigint, 4) $$, 'sending the same hole again changes it and never adds a second score');
select is((select picked_up from public.scores where round_id = (select r1 from made) and player_id = tests.id('brother') and hole = 1),
          false, 'a score is not a pickup unless it says so');
insert into public.scores (round_id, player_id, hole, strokes, picked_up) values ((select r1 from made), tests.id('brother'), 1, 6, true)
on conflict (round_id, player_id, hole) do update set strokes = excluded.strokes, picked_up = excluded.picked_up;
select results_eq($$ select strokes::int, picked_up from public.scores where round_id = (select r1 from made) and player_id = tests.id('brother') and hole = 1 $$,
                  $$ values (6, true) $$, 'picking up saves the strokes and marks the hole');
insert into public.scores (round_id, player_id, hole, strokes, picked_up) values ((select r1 from made), tests.id('brother'), 1, 5, false)
on conflict (round_id, player_id, hole) do update set strokes = excluded.strokes, picked_up = excluded.picked_up;
select results_eq($$ select strokes::int, picked_up from public.scores where round_id = (select r1 from made) and player_id = tests.id('brother') and hole = 1 $$,
                  $$ values (5, false) $$, 'changing the score afterwards clears it');
select tests.as_postgres();

select throws_ok($$ select tests.save('fritz', '{fritz,dad}', nine => false, round => (select r1 from made)) $$, '23514',
                 'Brother has scores in this round', 'someone with scores cannot be dropped from the group');
select tests.as_postgres();

select is(private.round_is_complete((select r1 from made)), false, 'one score in: not complete');
insert into public.scores (round_id, player_id, hole, strokes)
select (select r1 from made), p, h, 4
from unnest(array[tests.id('fritz'), tests.id('dad'), tests.id('brother')]) as p, generate_series(1, 18) as h
where not (h = 18 and p = tests.id('dad'))
on conflict do nothing;
select is(private.round_is_complete((select r1 from made)), false, 'one hole missing for one player: not complete');

-- Yesterday's unfinished round stays open; opening the trip does not lock a half-entered card.
update public.rounds set play_date = current_date - 1 where id = (select r1 from made);
select tests.as_user('dad');
select public.finalize_due_rounds(tests.id('trip'));
select tests.as_postgres();
select is((select status from public.rounds where id = (select r1 from made)), 'scheduled',
          'an unfinished round is not finalized at midnight');

insert into public.scores (round_id, player_id, hole, strokes) values ((select r1 from made), tests.id('dad'), 18, 6);
select is(private.round_is_complete((select r1 from made)), true, 'every player, every hole: complete');

-- Complete, but its day is not over where the trip is played.
update public.rounds set play_date = (now() at time zone 'America/New_York')::date where id = (select r1 from made);
select tests.as_user('dad');
select public.finalize_due_rounds(tests.id('trip'));
select tests.as_postgres();
select is((select status from public.rounds where id = (select r1 from made)), 'scheduled', 'a complete round waits for midnight');

update public.rounds set play_date = (now() at time zone 'America/New_York')::date - 1 where id = (select r1 from made);
select tests.as_user('zed');
select throws_ok($$ select public.finalize_due_rounds(tests.id('trip')) $$, '42501', null, 'someone not on the trip cannot ask');
select tests.as_user('dad');
select public.finalize_due_rounds(tests.id('trip'));
select tests.as_postgres();
select is((select status from public.rounds where id = (select r1 from made)), 'final',
          'after midnight there, a complete round is final the next time anyone opens the trip');

select tests.as_user('dad');
update public.scores set strokes = 3 where round_id = (select r1 from made) and player_id = tests.id('dad') and hole = 18;
select tests.as_postgres();
select is((select strokes::int from public.scores where round_id = (select r1 from made) and player_id = tests.id('dad') and hole = 18),
          6, 'a final round''s scores are closed to players');
select tests.as_user('fritz');
update public.scores set strokes = 5 where round_id = (select r1 from made) and player_id = tests.id('dad') and hole = 18;
select tests.as_postgres();
select is((select strokes::int from public.scores where round_id = (select r1 from made) and player_id = tests.id('dad') and hole = 18),
          5, 'the organizer can still fix one');

-- A front nine is complete with nine holes.
create temp table made2 as select tests.save('fritz', '{fritz,dad,brother}', holes => 'front') as r2;
grant select on made2 to public;
insert into public.scores (round_id, player_id, hole, strokes)
select (select r2 from made2), p, h, 4
from unnest(array[tests.id('fritz'), tests.id('dad'), tests.id('brother')]) as p, generate_series(1, 9) as h;
select is(private.round_is_complete((select r2 from made2)), true, 'a front nine is complete with holes 1 to 9');
update public.rounds set holes = 'back' where id = (select r2 from made2);
select is(private.round_is_complete((select r2 from made2)), false, 'and a back nine needs 10 to 18');

-- The organizer finalizes by hand; a player cannot.
select tests.as_user('dad');
update public.rounds set status = 'final' where id = (select r2 from made2);
select tests.as_postgres();
select is((select status from public.rounds where id = (select r2 from made2)), 'scheduled', 'a player cannot finalize a round');
select tests.as_user('fritz');
update public.rounds set status = 'final' where id = (select r2 from made2);
select tests.as_postgres();
select is((select status from public.rounds where id = (select r2 from made2)), 'final', 'the organizer can');

-- ── Deleting and numbering ──────────────────────────────────────────────────

create temp table made3 as select tests.save('fritz', '{fritz,dad,brother}') as r3;
grant select on made3 to public;
select is((select round_number::int from public.rounds where id = (select r3 from made3)), 3, 'a third round is round 3');
select tests.as_user('dad');
select throws_ok($$ select public.delete_round((select r1 from made)) $$, '42501', null, 'a player cannot delete a round');
select tests.as_user('fritz');
select public.delete_round((select r1 from made));
select tests.as_postgres();
select results_eq($$ select round_number::int from public.rounds where trip_id = tests.id('trip') order by round_number $$,
                  $$ values (1), (2) $$, 'deleting round 1 renumbers the rest');
select is((select count(*) from public.scores where round_id = (select r1 from made)), 0::bigint, 'and takes its scores with it');

-- ── Realtime ────────────────────────────────────────────────────────────────

select is(
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename in ('scores', 'rounds')),
  2::bigint, 'scores and rounds are published to Realtime');

-- ── Time zone and the spectator view ────────────────────────────────────────

select throws_ok($$ update public.trips set timezone = 'Mars/Olympus' where id = tests.id('trip') $$, '22023', null,
                 'a trip''s time zone must be a real one');
select lives_ok($$ update public.trips set timezone = 'America/Los_Angeles' where id = tests.id('trip') $$, 'a real one is fine');

insert into public.spectator_links (trip_id, nonce, token_hash) values (tests.id('trip'), 'n', 'hash');
select is(public.spectator_view('hash') -> 'rounds' -> 0 ->> 'holes', 'back', 'the spectator view says which holes are in play');
select is(public.spectator_view('hash') -> 'rounds' -> 1 -> 'formats' -> 1 -> 'settings', '{}'::jsonb,
          'and leaves the point value out');
update public.trips set spectators_see_money = true where id = tests.id('trip');
select is(public.spectator_view('hash') -> 'rounds' -> 1 -> 'formats' -> 1 -> 'settings', '{"point_value_cents": 50}'::jsonb,
          'unless the trip shows spectators winnings');

select * from finish();
rollback;
