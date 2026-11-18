-- RLS tests (pgTAP). Run with `supabase test db`, or `npm run test:db` without Docker.
-- Builds its own fixture inside a transaction and rolls it back.
--
-- Trip ONE (live):  group 1 = alice, bob · group 2 = cara, dan (co-admin) · a spectator · owner
-- Trip TWO (live):  bea, a different owner. Nobody from ONE may see it.
-- Trip DRAFT:       dave has a session but the trip isn't live yet.

begin;

create schema tests;
grant usage on schema tests to public;

-- Stable ids from names, so the tests read as tests.id('alice').
create function tests.id(name text) returns uuid language sql immutable as $$ select md5(name)::uuid $$;

-- Act as a signed-in user, the way a request through the API would.
create function tests.as_user(name text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', tests.id('user:' || name), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end;
$$;

-- Back to the migration role (bypasses RLS) for fixture changes and checks.
create function tests.as_postgres() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

select * from no_plan();

-- ── Fixture ─────────────────────────────────────────────────────────────────

insert into auth.users (id)
select tests.id('user:' || n)
from unnest(array['appadmin', 'owner', 'owner2', 'alice', 'bob', 'cara', 'dan', 'spectator', 'exspectator',
                  'bea', 'dave', 'nobody']) as n;

insert into public.app_admins (user_id) values (tests.id('user:appadmin'));

insert into public.courses (id, name, location) values (tests.id('course'), 'Test Links', 'Nowhere, NC');
insert into public.tees (id, course_id, name, par, stroke_index)
values (tests.id('tee'), tests.id('course'), 'White',
        '{4,4,3,5,4,4,3,5,4,4,4,3,5,4,4,3,5,4}', '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18}');

insert into public.trips (id, owner_id, name, slug, start_date, end_date, status) values
  (tests.id('trip:one'),   tests.id('user:owner'),  'Trip One',   'TONE',   '2027-01-11', '2027-01-15', 'live'),
  (tests.id('trip:two'),   tests.id('user:owner2'), 'Trip Two',   'TTWO',   '2027-02-01', '2027-02-03', 'live'),
  (tests.id('trip:draft'), tests.id('user:owner'),  'Trip Draft', 'TDRAFT', '2027-03-01', '2027-03-03', 'draft');

insert into public.players (id, trip_id, name, initials, role) values
  (tests.id('alice'), tests.id('trip:one'),   'Alice', 'A',  'player'),
  (tests.id('bob'),   tests.id('trip:one'),   'Bob',   'B',  'player'),
  (tests.id('cara'),  tests.id('trip:one'),   'Cara',  'C',  'player'),
  (tests.id('dan'),   tests.id('trip:one'),   'Dan',   'D',  'co_admin'),
  (tests.id('bea'),   tests.id('trip:two'),   'Bea',   'BE', 'player'),
  (tests.id('dave'),  tests.id('trip:draft'), 'Dave',  'DA', 'player');

insert into public.player_codes (player_id, code) values
  (tests.id('alice'), 'TONE-A27-K4'), (tests.id('bob'), 'TONE-B27-M9'),
  (tests.id('cara'), 'TONE-C27-Q2'), (tests.id('dan'), 'TONE-D27-X7'), (tests.id('bea'), 'TTWO-BE27-R3');
insert into public.player_ghin (player_id, ghin_number) values (tests.id('bob'), '1234567'), (tests.id('bea'), '7654321');

insert into public.spectator_codes (id, trip_id, code, enabled) values
  (tests.id('spec:on'),  tests.id('trip:one'), 'TONE-WATCH-7Q', true),
  (tests.id('spec:off'), tests.id('trip:one'), 'TONE-WATCH-8Z', false);

insert into public.trip_sessions (user_id, trip_id, player_id, spectator_code_id) values
  (tests.id('user:alice'),       tests.id('trip:one'),   tests.id('alice'), null),
  (tests.id('user:bob'),         tests.id('trip:one'),   tests.id('bob'),   null),
  (tests.id('user:cara'),        tests.id('trip:one'),   tests.id('cara'),  null),
  (tests.id('user:dan'),         tests.id('trip:one'),   tests.id('dan'),   null),
  (tests.id('user:spectator'),   tests.id('trip:one'),   null, tests.id('spec:on')),
  (tests.id('user:exspectator'), tests.id('trip:one'),   null, tests.id('spec:off')),
  (tests.id('user:bea'),         tests.id('trip:two'),   tests.id('bea'),   null),
  (tests.id('user:dave'),        tests.id('trip:draft'), tests.id('dave'),  null);

insert into public.rounds (id, trip_id, round_number, course_id, tee_id, play_date, status) values
  (tests.id('round:one'),       tests.id('trip:one'), 1, tests.id('course'), tests.id('tee'), '2027-01-12', 'live'),
  (tests.id('round:one-final'), tests.id('trip:one'), 2, tests.id('course'), tests.id('tee'), '2027-01-11', 'final'),
  (tests.id('round:two'),       tests.id('trip:two'), 1, tests.id('course'), tests.id('tee'), '2027-02-01', 'live');

insert into public.round_formats (id, round_id, format_key) values
  (tests.id('format:one'), tests.id('round:one'), 'nassau');

insert into public.groups (id, round_id, group_number) values
  (tests.id('group:1'),     tests.id('round:one'), 1),
  (tests.id('group:2'),     tests.id('round:one'), 2),
  (tests.id('group:final'), tests.id('round:one-final'), 1),
  (tests.id('group:two'),   tests.id('round:two'), 1);

insert into public.group_players (round_id, player_id, group_id, position) values
  (tests.id('round:one'),       tests.id('alice'), tests.id('group:1'), 1),
  (tests.id('round:one'),       tests.id('bob'),   tests.id('group:1'), 2),
  (tests.id('round:one'),       tests.id('cara'),  tests.id('group:2'), 1),
  (tests.id('round:one'),       tests.id('dan'),   tests.id('group:2'), 2),
  (tests.id('round:one-final'), tests.id('alice'), tests.id('group:final'), 1),
  (tests.id('round:two'),       tests.id('bea'),   tests.id('group:two'), 1);

insert into public.scores (round_id, player_id, hole, strokes) values
  (tests.id('round:one'), tests.id('cara'), 1, 5),
  (tests.id('round:two'), tests.id('bea'),  1, 4);

insert into public.itinerary_items (trip_id, day, type, title) values
  (tests.id('trip:one'), '2027-01-11', 'meal', 'Dinner'),
  (tests.id('trip:one'), '2027-01-11', 'cost', 'Greens fee'),
  (tests.id('trip:two'), '2027-02-01', 'meal', 'Lunch');

insert into public.tasks (id, trip_id, title, player_can_complete) values
  (tests.id('task:install'), tests.id('trip:one'), 'Install the app', true),
  (tests.id('task:buyin'),   tests.id('trip:one'), 'Buy-in paid', false);

insert into public.itinerary_proposals (trip_id, payload) values (tests.id('trip:one'), '{"title": "Tee time moved"}');

-- ── Structure ───────────────────────────────────────────────────────────────

select is_empty(
  $$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity $$,
  'every table in public has row-level security on');

select is_empty(
  $$ select table_name from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' $$,
  'anon has no privileges on any table');

-- ── Not signed in ───────────────────────────────────────────────────────────

select tests.as_anon();
select throws_ok('select * from public.trips', '42501', null, 'anon cannot read trips');
select throws_ok('select * from public.scores', '42501', null, 'anon cannot read scores');
select throws_ok('select * from public.courses', '42501', null, 'anon cannot read the course library');
select throws_ok($$ select public.submit_handicap(tests.id('trip:one'), 10.0) $$, '42501', null, 'anon cannot call submit_handicap');
select lives_ok('select public.ping()', 'anon can still call ping (keep-alive)');

-- ── Signed in, no trip ──────────────────────────────────────────────────────

select tests.as_user('nobody');
select is_empty('select * from public.trips', 'a user with no code sees no trips');
select is_empty('select * from public.players', 'a user with no code sees no players');
select is_empty('select * from public.scores', 'a user with no code sees no scores');
select isnt_empty('select * from public.courses', 'any signed-in user can read the course library');
select throws_ok($$ insert into public.courses (name) values ('Sneaky GC') $$, '42501', null, 'a regular user cannot add a course');
select throws_ok(
  $$ insert into public.trips (name, slug, start_date, end_date) values ('Mine', 'MINE', '2027-05-01', '2027-05-02') $$,
  '42501', null, 'a regular user cannot create a trip');
select throws_ok(
  $$ insert into public.trip_sessions (user_id, trip_id, player_id) values (tests.id('user:nobody'), tests.id('trip:one'), tests.id('alice')) $$,
  '42501', null, 'a user cannot link themselves to a player (only redeem-code can)');
select throws_ok($$ insert into public.app_admins (user_id) values (tests.id('user:nobody')) $$, '42501', null, 'a user cannot make themselves an app admin');

-- ── Player: reading ─────────────────────────────────────────────────────────

select tests.as_user('alice');
select results_eq('select name from public.trips', $$ values ('Trip One') $$, 'a player sees only their own trip');
select results_eq('select count(*) from public.players', 'select 4::bigint', 'a player sees their trip''s roster and nobody else''s');
select is_empty('select * from public.player_codes', 'a player cannot read login codes, even their own trip''s');
select is_empty('select * from public.spectator_codes', 'a player cannot read spectator codes');
select results_eq('select ghin_number from public.player_ghin', $$ values ('1234567') $$, 'a player sees GHIN numbers for their trip only');
select results_eq('select count(*) from public.rounds', 'select 2::bigint', 'a player sees their trip''s rounds only');
select results_eq('select count(*) from public.groups', 'select 3::bigint', 'a player sees their trip''s groups only');
select results_eq('select count(*) from public.scores', 'select 1::bigint', 'a player sees scores from every group on their trip, none from other trips');
select results_eq('select count(*) from public.itinerary_items', 'select 2::bigint', 'a player sees the itinerary, including costs');
select results_eq('select count(*) from public.tasks', 'select 2::bigint', 'a player sees the checklist');
select is_empty('select * from public.itinerary_proposals', 'a player cannot read proposed changes');
select results_eq('select count(*) from public.trip_sessions', 'select 1::bigint', 'a player sees only their own session');

-- ── Player: scoring ─────────────────────────────────────────────────────────

select lives_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('round:one'), tests.id('alice'), 1, 4) $$,
  'a player can enter their own score');
select lives_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('round:one'), tests.id('bob'), 1, 6) $$,
  'a player can enter a score for someone in their group');
select results_eq(
  $$ select entered_by, entered_by_player_id from public.scores where player_id = tests.id('bob') $$,
  $$ values (tests.id('user:alice'), tests.id('alice')) $$,
  'the score records whose phone entered it');
select lives_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes, entered_by) values (tests.id('round:one'), tests.id('alice'), 2, 5, tests.id('user:bob')) $$,
  'a score with a forged entered_by is accepted...');
select results_eq(
  $$ select entered_by from public.scores where player_id = tests.id('alice') and hole = 2 $$,
  $$ values (tests.id('user:alice')) $$,
  '...but stamped with the real user');

select throws_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('round:one'), tests.id('cara'), 2, 3) $$,
  '42501', null, 'a player cannot enter a score for another group');
with u as (update public.scores set strokes = 1 where player_id = tests.id('cara') returning 1)
select is((select count(*) from u), 0::bigint, 'a player cannot change another group''s score');
with d as (delete from public.scores where player_id = tests.id('cara') returning 1)
select is((select count(*) from d), 0::bigint, 'a player cannot delete another group''s score');
select throws_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('round:two'), tests.id('bea'), 2, 3) $$,
  '42501', null, 'a player cannot enter a score on another trip');
select throws_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('round:one-final'), tests.id('alice'), 1, 4) $$,
  '42501', null, 'a player cannot enter a score once the round is final');

-- Offline replay: sending the same score again changes nothing; a new value updates in place.
select lives_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('round:one'), tests.id('alice'), 1, 4)
     on conflict (round_id, player_id, hole) do update set strokes = excluded.strokes $$,
  'the same score can be sent twice');
select lives_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('round:one'), tests.id('alice'), 1, 5)
     on conflict (round_id, player_id, hole) do update set strokes = excluded.strokes $$,
  'a corrected score updates the existing row');
select results_eq(
  $$ select count(*), max(strokes) from public.scores where player_id = tests.id('alice') and hole = 1 $$,
  $$ values (1::bigint, 5::smallint) $$, 'there is still one row for that hole, with the corrected score');
select results_eq(
  $$ select op, strokes, previous_strokes from public.score_history where player_id = tests.id('alice') and hole = 1 order by id $$,
  $$ values ('insert', 4::smallint, null::smallint), ('update', 5::smallint, 4::smallint) $$,
  'history has the original and the correction, and nothing for the replay');
select throws_ok(
  $$ insert into public.score_history (round_id, player_id, hole, op, strokes) values (tests.id('round:one'), tests.id('alice'), 1, 'insert', 2) $$,
  '42501', null, 'score history cannot be written directly');

-- Presses follow the same rule as scores.
select lives_ok(
  $$ insert into public.presses (round_id, round_format_id, group_id, bet, after_hole) values (tests.id('round:one'), tests.id('format:one'), tests.id('group:1'), 'front', 7) $$,
  'a player can record a press in their own group');
select throws_ok(
  $$ insert into public.presses (round_id, round_format_id, group_id, bet, after_hole) values (tests.id('round:one'), tests.id('format:one'), tests.id('group:2'), 'front', 7) $$,
  '42501', null, 'a player cannot record a press in another group');

-- ── Player: everything else is read-only ────────────────────────────────────

with u as (update public.players set role = 'co_admin' where id = tests.id('alice') returning 1)
select is((select count(*) from u), 0::bigint, 'a player cannot make themselves a co-admin');
with u as (update public.players set handicap_index = 1.0 where id = tests.id('alice') returning 1)
select is((select count(*) from u), 0::bigint, 'a player cannot edit the roster directly');
with u as (update public.trips set status = 'final' returning 1)
select is((select count(*) from u), 0::bigint, 'a player cannot change the trip');
with u as (update public.group_players set group_id = tests.id('group:1') where player_id = tests.id('cara') returning 1)
select is((select count(*) from u), 0::bigint, 'a player cannot change the pairings');
with u as (update public.round_formats set settings = '{"bet_value": 1000}' returning 1)
select is((select count(*) from u), 0::bigint, 'a player cannot change the format settings');
select throws_ok(
  $$ insert into public.rounds (trip_id, round_number, course_id, tee_id, play_date) values (tests.id('trip:one'), 9, tests.id('course'), tests.id('tee'), '2027-01-13') $$,
  '42501', null, 'a player cannot add a round');
select throws_ok(
  $$ insert into public.itinerary_items (trip_id, day, type, title) values (tests.id('trip:one'), '2027-01-12', 'note', 'Hi') $$,
  '42501', null, 'a player cannot add an itinerary item');
select throws_ok(
  $$ insert into public.player_ghin (player_id, ghin_number) values (tests.id('alice'), '5555555') $$,
  '42501', null, 'a player cannot write GHIN numbers directly');

-- Handicap check-in goes through the function.
select lives_ok($$ select public.submit_handicap(tests.id('trip:one'), 12.4, '2223334') $$, 'a player can check in their handicap');
select results_eq(
  $$ select p.handicap_index, g.ghin_number from public.players p join public.player_ghin g on g.player_id = p.id where p.id = tests.id('alice') $$,
  $$ values (12.4::numeric(3,1), '2223334') $$, 'check-in saved the index and GHIN number on their own row');
select throws_ok($$ select public.submit_handicap(tests.id('trip:two'), 3.0) $$, '42501', null, 'check-in is refused on a trip you are not playing in');

-- Checklist: only self-service tasks, only your own status.
select lives_ok(
  $$ insert into public.task_status (task_id, player_id, trip_id, done) values (tests.id('task:install'), tests.id('alice'), tests.id('trip:one'), true) $$,
  'a player can tick a self-service task for themselves');
select throws_ok(
  $$ insert into public.task_status (task_id, player_id, trip_id, done) values (tests.id('task:install'), tests.id('bob'), tests.id('trip:one'), true) $$,
  '42501', null, 'a player cannot tick a task for someone else');
select throws_ok(
  $$ insert into public.task_status (task_id, player_id, trip_id, done) values (tests.id('task:buyin'), tests.id('alice'), tests.id('trip:one'), true) $$,
  '42501', null, 'a player cannot tick an admin-only task (buy-in paid)');

-- Push subscriptions are per user.
select lives_ok(
  $$ insert into public.push_subscriptions (trip_id, endpoint, p256dh, auth_key) values (tests.id('trip:one'), 'https://push.example/alice', 'k', 'a') $$,
  'a player can subscribe to alerts for their trip');
select throws_ok(
  $$ insert into public.push_subscriptions (trip_id, endpoint, p256dh, auth_key) values (tests.id('trip:two'), 'https://push.example/alice2', 'k', 'a') $$,
  '42501', null, 'a player cannot subscribe to another trip');
select tests.as_user('bob');
select is_empty('select * from public.push_subscriptions', 'a player cannot see another user''s push subscription');

-- ── Handicap lock ───────────────────────────────────────────────────────────

select tests.as_postgres();
update public.trips set handicap_lock_date = current_date where id = tests.id('trip:one');
select tests.as_user('alice');
select throws_ok($$ select public.submit_handicap(tests.id('trip:one'), 2.0) $$, '42501', null, 'check-in is refused from the lock date on');

-- ── Spectator ───────────────────────────────────────────────────────────────

select tests.as_user('spectator');
select results_eq('select name from public.trips', $$ values ('Trip One') $$, 'a spectator sees the trip');
select results_eq('select count(*) from public.players', 'select 4::bigint', 'a spectator sees the roster');
select isnt_empty('select * from public.scores', 'a spectator sees scores');
select is_empty('select * from public.player_ghin', 'a spectator never sees GHIN numbers');
select is_empty('select * from public.player_codes', 'a spectator never sees login codes');
select is_empty('select * from public.tasks', 'a spectator never sees the checklist');
select is_empty('select * from public.task_status', 'a spectator never sees checklist status');
select results_eq('select type from public.itinerary_items', $$ values ('meal') $$, 'a spectator sees the itinerary without the costs');
select throws_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('round:one'), tests.id('alice'), 9, 4) $$,
  '42501', null, 'a spectator cannot enter a score');
with u as (update public.scores set strokes = 1 returning 1)
select is((select count(*) from u), 0::bigint, 'a spectator cannot change a score');
select throws_ok(
  $$ insert into public.presses (round_id, round_format_id, group_id, bet, after_hole) values (tests.id('round:one'), tests.id('format:one'), tests.id('group:1'), 'back', 12) $$,
  '42501', null, 'a spectator cannot record a press');
select throws_ok($$ select public.submit_handicap(tests.id('trip:one'), 5.0) $$, '42501', null, 'a spectator cannot check in a handicap');

select tests.as_postgres();
update public.trips set spectators_see_money = true where id = tests.id('trip:one');
select tests.as_user('spectator');
select results_eq('select count(*) from public.itinerary_items', 'select 2::bigint', 'a spectator sees costs when the trip turns that on');

select tests.as_user('exspectator');
select is_empty('select * from public.trips', 'a disabled spectator code sees nothing');
select is_empty('select * from public.scores', 'a disabled spectator code sees no scores');

-- ── Draft and final trips ───────────────────────────────────────────────────

select tests.as_user('dave');
select is_empty('select * from public.trips', 'a player sees nothing while the trip is a draft');
select is_empty('select * from public.players', 'a player sees no roster while the trip is a draft');
select tests.as_postgres();
update public.trips set status = 'live' where id = tests.id('trip:draft');
select tests.as_user('dave');
select results_eq('select name from public.trips', $$ values ('Trip Draft') $$, 'the trip appears once it is live');

-- ── Co-admin ────────────────────────────────────────────────────────────────

select tests.as_user('dan');
select results_eq('select count(*) from public.player_codes', 'select 4::bigint', 'a co-admin sees their trip''s login codes and no other trip''s');
select results_eq('select count(*) from public.trips', 'select 1::bigint', 'a co-admin still sees only their own trip');
select isnt_empty('select * from public.itinerary_proposals', 'a co-admin sees proposed changes');
select lives_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('round:one'), tests.id('alice'), 3, 4) $$,
  'a co-admin can enter a score for any group');
select lives_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('round:one-final'), tests.id('alice'), 1, 4) $$,
  'a co-admin can fix a score after the round is final');
with u as (update public.players set name = 'Robert' where id = tests.id('bob') returning 1)
select is((select count(*) from u), 1::bigint, 'a co-admin can edit the roster');
-- One statement swaps two players between groups (the "tap two names to swap" action).
with u as (
  update public.group_players
     set group_id = case player_id when tests.id('bob') then tests.id('group:2') else tests.id('group:1') end
   where round_id = tests.id('round:one') and player_id in (tests.id('bob'), tests.id('dan'))
  returning 1)
select is((select count(*) from u), 2::bigint, 'a co-admin can swap two players between groups');
select lives_ok(
  $$ insert into public.rounds (trip_id, round_number, course_id, tee_id, play_date) values (tests.id('trip:one'), 3, tests.id('course'), tests.id('tee'), '2027-01-13') $$,
  'a co-admin can add a round');
select throws_ok(
  $$ insert into public.rounds (trip_id, round_number, course_id, tee_id, play_date) values (tests.id('trip:two'), 3, tests.id('course'), tests.id('tee'), '2027-02-02') $$,
  '42501', null, 'a co-admin cannot add a round to another trip');
select throws_ok(
  $$ update public.trips set owner_id = tests.id('user:dan') where id = tests.id('trip:one') $$,
  '42501', null, 'a co-admin cannot take over the trip');
with d as (delete from public.trips where id = tests.id('trip:one') returning 1)
select is((select count(*) from d), 0::bigint, 'a co-admin cannot delete the trip');
select throws_ok($$ insert into public.courses (name) values ('Dan''s Muni') $$, '42501', null, 'a co-admin cannot edit the course library');

-- The swap above moved bob out of alice's group.
select tests.as_user('alice');
select throws_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('round:one'), tests.id('bob'), 4, 4) $$,
  '42501', null, 'after a swap, a player can no longer score for the player who left their group');

-- ── Owner ───────────────────────────────────────────────────────────────────

select tests.as_user('owner');
select results_eq('select name from public.trips order by name', $$ values ('Trip Draft'), ('Trip One') $$, 'an owner sees their trips, drafts included, and not other owners''');
select is_empty($$ select * from public.players where trip_id = tests.id('trip:two') $$, 'an owner cannot see another owner''s roster');
select lives_ok(
  $$ insert into public.spectator_codes (trip_id, code) values (tests.id('trip:one'), 'TONE-WATCH-2B') $$,
  'an owner can create a spectator code');
with u as (update public.trips set status = 'final' where id = tests.id('trip:one') returning 1)
select is((select count(*) from u), 1::bigint, 'an owner can change the trip status');
with u as (update public.trips set status = 'final' where id = tests.id('trip:two') returning 1)
select is((select count(*) from u), 0::bigint, 'an owner cannot change another owner''s trip');
select throws_ok(
  $$ insert into public.trips (name, slug, start_date, end_date) values ('Another', 'ANOTHER', '2027-06-01', '2027-06-02') $$,
  '42501', null, 'owning a trip does not let you create more (app admins only)');

-- Trip One is now final: still readable, closed for scoring.
select tests.as_user('alice');
select isnt_empty('select * from public.scores', 'a player can still read scores when the trip is final');
select throws_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('round:one'), tests.id('alice'), 10, 4) $$,
  '42501', null, 'a player cannot enter scores when the trip is final');

-- ── App admin ───────────────────────────────────────────────────────────────

select tests.as_user('appadmin');
select lives_ok($$ insert into public.courses (name, location) values ('New Course', 'Vero Beach, FL') $$, 'an app admin can add a course');
select lives_ok(
  $$ insert into public.trips (name, slug, start_date, end_date) values ('Vero Beach 2027', 'VERO', '2027-01-11', '2027-01-15') $$,
  'an app admin can create a trip');
select results_eq(
  $$ select owner_id, status from public.trips where slug = 'VERO' $$,
  $$ values (tests.id('user:appadmin'), 'draft') $$, 'a new trip belongs to its creator and starts as a draft');
select throws_ok(
  $$ insert into public.trips (owner_id, name, slug, start_date, end_date) values (tests.id('user:nobody'), 'Not mine', 'NOTMINE', '2027-01-11', '2027-01-15') $$,
  '42501', null, 'a trip cannot be created in someone else''s name');

-- ── Data integrity ──────────────────────────────────────────────────────────

select tests.as_postgres();
select throws_ok(
  $$ insert into public.group_players (round_id, player_id, group_id, position) values (tests.id('round:one'), tests.id('bea'), tests.id('group:1'), 4) $$,
  '23514', null, 'a player cannot be grouped into another trip''s round');
select throws_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('round:two'), tests.id('alice'), 1, 4) $$,
  '23503', null, 'a score needs the player to be in that round');
select throws_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('round:two'), tests.id('bea'), 19, 4) $$,
  '23514', null, 'there is no hole 19');
select throws_ok(
  $$ insert into public.tees (course_id, name, par, stroke_index) values (tests.id('course'), 'Bad', '{4,4,4}', '{1,1,3}') $$,
  '23514', null, 'a stroke index row must use each number once');
select throws_ok(
  $$ insert into public.rounds (trip_id, round_number, course_id, tee_id, play_date)
     values (tests.id('trip:two'), 5, (select id from public.courses where name = 'New Course'), tests.id('tee'), '2027-02-02') $$,
  '23503', null, 'a round''s tee must belong to its course');
select throws_ok(
  $$ update public.trips set banker_player_id = tests.id('bea') where id = tests.id('trip:one') $$,
  '23503', null, 'the banker must be a player on the trip');
select throws_ok(
  $$ insert into public.trip_sessions (user_id, trip_id, player_id) values (tests.id('user:nobody'), tests.id('trip:two'), tests.id('alice')) $$,
  '23503', null, 'a session cannot link a trip to another trip''s player');

select lives_ok($$ delete from public.scores where round_id = tests.id('round:one') and player_id = tests.id('alice') and hole = 2 $$, 'a score can be cleared');
select results_eq(
  $$ select op, previous_strokes from public.score_history where player_id = tests.id('alice') and hole = 2 order by id desc limit 1 $$,
  $$ values ('delete', 5::smallint) $$, 'clearing a score is kept in history');
select lives_ok($$ delete from public.trips where id = tests.id('trip:one') $$, 'deleting a trip removes everything under it');
select is_empty($$ select * from public.scores where round_id = tests.id('round:one') $$, 'its scores are gone');
select is_empty($$ select * from public.score_history where round_id = tests.id('round:one') $$, 'and so is their history');
select isnt_empty($$ select * from public.scores where round_id = tests.id('round:two') $$, 'other trips are untouched');

select * from finish();
rollback;
