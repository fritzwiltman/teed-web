-- M3.5 tests (pgTAP): six-character codes, the owner playing on their organizer account, and
-- what a co-admin is and isn't allowed.

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

-- ── Fixture ─────────────────────────────────────────────────────────────────
-- Trip VERO (live), owned by `owner`, whose player is Fritz ("This is me").
--   group 1 = Fritz, Ben · group 2 = Cal (co-admin), Dom
-- Trip DRAFT and trip PLAIN (live, no "This is me") belong to the same owner.
-- `helper` is an app admin who owns none of them.

insert into auth.users (id)
select tests.id('user:' || n) from unnest(array['owner', 'helper', 'phone-cal', 'phone-ben', 'phone-new']) as n;
insert into public.app_admins (user_id) values (tests.id('user:owner')), (tests.id('user:helper'));

insert into public.courses (id, name) values (tests.id('course'), 'Test Links');
insert into public.tees (id, course_id, name, par, stroke_index)
values (tests.id('tee'), tests.id('course'), 'White',
        '{4,4,3,5,4,4,3,5,4,4,4,3,5,4,4,3,5,4}', '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18}');

insert into public.trips (id, owner_id, name, slug, start_date, end_date, status) values
  (tests.id('vero'),  tests.id('user:owner'), 'Vero Beach 2027', 'VERO',  '2027-01-11', '2027-01-15', 'live'),
  (tests.id('draft'), tests.id('user:owner'), 'Not Yet',         'DRAFT', '2027-03-01', '2027-03-03', 'draft'),
  (tests.id('plain'), tests.id('user:owner'), 'Plain',           'PLAIN', '2027-04-01', '2027-04-03', 'live');

insert into public.players (id, trip_id, name, initials, role) values
  (tests.id('fritz'), tests.id('vero'),  'Fritz', 'FW', 'player'),
  (tests.id('ben'),   tests.id('vero'),  'Ben',   'BK', 'player'),
  (tests.id('cal'),   tests.id('vero'),  'Cal',   'CM', 'co_admin'),
  (tests.id('dom'),   tests.id('vero'),  'Dom',   'DR', 'player'),
  (tests.id('early'), tests.id('draft'), 'Early', 'E',  'player'),
  (tests.id('pat'),   tests.id('plain'), 'Pat',   'P',  'player');

update public.trips set owner_player_id = tests.id('fritz') where id = tests.id('vero');
update public.trips set owner_player_id = tests.id('early') where id = tests.id('draft');

insert into public.player_codes (player_id, code) values
  (tests.id('ben'), 'VERO-BK27-Q2X7'),      -- issued before this change
  (tests.id('cal'), 'VERO-CM27-K4M9');
insert into public.player_contacts (player_id, phone) values (tests.id('ben'), '+17725550101');
insert into public.trip_sessions (user_id, trip_id, player_id) values
  (tests.id('user:phone-cal'), tests.id('vero'), tests.id('cal')),
  (tests.id('user:phone-ben'), tests.id('vero'), tests.id('ben'));

insert into public.rounds (id, trip_id, round_number, course_id, tee_id, play_date, status) values
  (tests.id('round'), tests.id('vero'), 1, tests.id('course'), tests.id('tee'), '2027-01-12', 'live');
insert into public.groups (id, round_id, group_number) values
  (tests.id('group:1'), tests.id('round'), 1), (tests.id('group:2'), tests.id('round'), 2);
insert into public.group_players (round_id, player_id, group_id, position) values
  (tests.id('round'), tests.id('fritz'), tests.id('group:1'), 1),
  (tests.id('round'), tests.id('ben'),   tests.id('group:1'), 2),
  (tests.id('round'), tests.id('cal'),   tests.id('group:2'), 1),
  (tests.id('round'), tests.id('dom'),   tests.id('group:2'), 2);
insert into public.tasks (id, trip_id, title, player_can_complete) values
  (tests.id('task'), tests.id('vero'), 'Pay the deposit', true);

-- ── Six-character codes ─────────────────────────────────────────────────────

select matches(private.new_login_code(), '^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$', 'a new code is six characters with no I, O, 0 or 1, stored with a dash in the middle');
select is(
  (select count(*) filter (where c ~ '^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$') from (select private.new_login_code() as c from generate_series(1, 2000)) as s),
  2000::bigint, 'so are 2,000 of them');
select cmp_ok(
  (select count(distinct c) from (select private.new_login_code() as c from generate_series(1, 2000)) as s),
  '>=', 1999::bigint, '2,000 codes in a row do not repeat');
select cmp_ok(
  (select count(distinct substr(c, n, 1)) from (select replace(private.new_login_code(), '-', '') as c from generate_series(1, 2000)) as s, generate_series(1, 6) as n),
  '=', 32::bigint, 'every character of the alphabet turns up');

select tests.as_user('owner');
select matches(public.regenerate_player_code(tests.id('fritz')), '^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$', 'a player''s new code is six characters');
select matches(public.issue_spectator_code(tests.id('vero')), '^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$', 'so is the spectator code');
select tests.as_postgres();

select is(
  public.redeem_code(lower(replace((select code from public.player_codes where player_id = tests.id('fritz')), '-', '')), tests.id('user:phone-new'), '10.0.0.1') ->> 'status',
  'ok', 'the six characters log in with no dash, in any case');
select is(
  public.redeem_code((select code from public.player_codes where player_id = tests.id('fritz')), tests.id('user:phone-new'), '10.0.0.1') ->> 'status',
  'ok', '...and with the dash');
select is(
  public.redeem_code('VERO-BK27-Q2X7', tests.id('user:phone-new'), '10.0.0.1') -> 'player' ->> 'name',
  'Ben', 'a long code issued earlier still logs in');
select is(
  public.redeem_code((select code from public.spectator_codes where trip_id = tests.id('vero')), tests.id('user:phone-new'), '10.0.0.1') ->> 'role',
  'spectator', 'a six-character spectator code logs in');
delete from public.trip_sessions where user_id = tests.id('user:phone-new');

-- A code is never issued twice, in either table.
select is_empty(
  $$ select 1 from public.player_codes p join public.spectator_codes s on replace(s.code, '-', '') = replace(p.code, '-', '') $$,
  'no spectator code is also a player code');

-- ── The owner plays on their organizer account ──────────────────────────────

select tests.as_user('owner');
select is_empty(
  $$ select * from public.trip_sessions where user_id = tests.id('user:owner') $$,
  'the owner has no code session');
select is(private.my_player_id(tests.id('vero')), tests.id('fritz'), 'signed in by email, the owner is the player marked "This is me"');
select is(private.is_trip_player(tests.id('vero')), true, '...and counts as a player on the trip');
select is(private.is_scoring_in_group(tests.id('group:1')), true, 'the owner scores in their own group');
select is(private.is_scoring_in_group(tests.id('group:2')), false, '...and is not a member of the other group');

select lives_ok(
  $$ insert into public.scores (round_id, player_id, hole, strokes) values
       (tests.id('round'), tests.id('fritz'), 1, 5), (tests.id('round'), tests.id('ben'), 1, 4) $$,
  'the owner enters scores for their group');
select results_eq(
  $$ select distinct entered_by_player_id from public.scores where round_id = tests.id('round') and hole = 1 $$,
  $$ values (tests.id('fritz')) $$, 'the scores are recorded as entered by the owner''s player');
select lives_ok(
  $$ select public.submit_handicap(tests.id('vero'), 17.2) $$,
  'the owner checks in their handicap like any player');
select results_eq(
  $$ select handicap_index from public.players where id = tests.id('fritz') $$,
  $$ values (17.2::numeric(3,1)) $$, '...on their own player row');
select lives_ok(
  $$ insert into public.task_status (task_id, trip_id, player_id, done) values (tests.id('task'), tests.id('vero'), tests.id('fritz'), true) $$,
  'the owner ticks their own checklist item');
select isnt_empty($$ select * from public.rounds where trip_id = tests.id('vero') $$, 'the owner reads the trip''s rounds');

select is(private.my_player_id(tests.id('draft')), null::uuid, 'a draft trip has no players yet, the owner included');
select is(private.my_player_id(tests.id('plain')), null::uuid, 'without "This is me" the owner is not a player');
select throws_ok(
  $$ select public.submit_handicap(tests.id('plain'), 10.0) $$,
  '42501', null, '...so has no handicap to check in');

-- Only the trip's own owner. Another app admin can run the trip but is not that player.
select tests.as_user('helper');
select is(private.my_player_id(tests.id('vero')), null::uuid, 'another organizer is not the owner''s player');
select throws_ok(
  $$ select public.submit_handicap(tests.id('vero'), 3.0) $$,
  '42501', null, '...and cannot check in as them');

-- The players on the trip gain nothing from the link.
select tests.as_user('phone-ben');
select is(private.my_player_id(tests.id('vero')), tests.id('ben'), 'a player with a code is still just themselves');
select is_empty('select * from public.player_codes', 'and still sees no codes');

-- ── A co-admin: allowed ─────────────────────────────────────────────────────

select tests.as_user('phone-cal');
select lives_ok($$ update public.trips set location = 'Vero Beach, FL' where id = tests.id('vero') $$, 'a co-admin edits trip info');
select results_eq(
  $$ select location from public.trips where id = tests.id('vero') $$,
  $$ values ('Vero Beach, FL') $$, '...and it saves');
select lives_ok(
  $$ update public.group_players set group_id = tests.id('group:2'), position = 3 where round_id = tests.id('round') and player_id = tests.id('ben') $$,
  'a co-admin changes the pairings');
select lives_ok(
  $$ update public.scores set strokes = 6 where round_id = tests.id('round') and player_id = tests.id('fritz') and hole = 1 $$,
  'a co-admin fixes a score in another group');
select results_eq(
  $$ select strokes::int from public.scores where round_id = tests.id('round') and player_id = tests.id('fritz') and hole = 1 $$,
  'select 6', '...and it saves');
select lives_ok(
  $$ insert into public.itinerary_items (trip_id, day, type, title) values (tests.id('vero'), '2027-01-12', 'meal', 'Dinner') $$,
  'a co-admin adds to the itinerary');

-- ── A co-admin: denied ──────────────────────────────────────────────────────

select is_empty('select * from public.player_codes', 'a co-admin sees no login codes');
select is_empty('select * from public.spectator_codes', '...nor the spectator code');
select is_empty('select * from public.player_contacts', '...nor phone numbers');
select throws_ok(
  $$ select public.regenerate_player_code(tests.id('dom')) $$,
  '42501', null, 'a co-admin cannot issue a player code');
select throws_ok(
  $$ select public.issue_spectator_code(tests.id('vero')) $$,
  '42501', null, '...or a spectator code');
select throws_ok(
  $$ insert into public.player_codes (player_id, code) values (tests.id('dom'), 'ABC-234') $$,
  '42501', null, '...or write one in by hand');
select throws_ok(
  $$ select public.replace_player(tests.id('dom'), 'Eli', 'EP') $$,
  '42501', null, 'a co-admin cannot replace a player');

delete from public.players where id = tests.id('dom');
delete from public.rounds where id = tests.id('round');
select tests.as_postgres();
select isnt_empty($$ select * from public.players where id = tests.id('dom') $$, 'a co-admin cannot delete a player');
select isnt_empty($$ select * from public.rounds where id = tests.id('round') $$, '...or a round');

select tests.as_user('phone-cal');
select throws_ok(
  $$ update public.trips set owner_player_id = tests.id('cal') where id = tests.id('vero') $$,
  '42501', null, 'a co-admin cannot change which player the owner is');
select throws_ok(
  $$ update public.trips set owner_id = tests.id('user:phone-cal') where id = tests.id('vero') $$,
  '42501', null, '...or take the trip over');

-- ── The owner keeps both ────────────────────────────────────────────────────

select tests.as_user('owner');
select lives_ok(
  $$ update public.trips set owner_player_id = tests.id('ben') where id = tests.id('vero') $$,
  'the owner can change which player they are');
select is(private.my_player_id(tests.id('vero')), tests.id('ben'), '...and is then that player');
with gone as (delete from public.players where id = tests.id('dom') returning 1)
select is((select count(*) from gone), 1::bigint, 'the owner deletes a player');

select * from finish();
rollback;
