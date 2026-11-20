-- Accounts, invites, the single organizer, the handicap lock, the trip lifecycle, score history
-- and what a spectator link shows (pgTAP). Who may do what, role by role, is in
-- 03_permissions.test.sql. Builds its own fixture inside a transaction and rolls it back.

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

create function tests.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end;
$$;

create function tests.as_postgres() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- A person signs in for the first time: Supabase Auth adds the user, then confirms the email
-- when the code is verified.
create function tests.sign_up(name text, confirmed boolean default true) returns void language sql as $$
  insert into auth.users (id, email, email_confirmed_at)
  values (tests.id('user:' || name), initcap(name) || '@Test.Teed', case when confirmed then now() end);
$$;

select * from no_plan();

-- ── Fixture ─────────────────────────────────────────────────────────────────

select tests.sign_up(n) from unnest(array['fritz', 'olive', 'cal', 'alice']) as n;
update public.profiles set is_admin = true where id = tests.id('user:fritz');
update public.profiles set display_name = 'Fritz' where id = tests.id('user:fritz');
update public.profiles set handicap_index = 14.0 where id = tests.id('user:alice');

insert into public.courses (id, name, location) values (tests.id('course'), 'Test Links', 'Nowhere, NC');
insert into public.tees (id, course_id, name, par, stroke_index)
values (tests.id('tee'), tests.id('course'), 'White',
        '{4,4,3,5,4,4,3,5,4,4,4,3,5,4,4,3,5,4}', '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18}');

-- Trip ONE: published, starts in 30 days, so its handicaps lock in 23.
insert into public.trips (id, name, slug, start_date, end_date, status, buy_in_amount)
values (tests.id('one'), 'Trip One', 'TONE', current_date + 30, current_date + 33, 'live', 30);
insert into public.trip_members (id, trip_id, name, initials, role, profile_id, claimed_at, handicap_index) values
  (tests.id('olive'), tests.id('one'), 'Olive', 'O', 'organizer',    tests.id('user:olive'), now(), 10.0),
  (tests.id('cal'),   tests.id('one'), 'Cal',   'C', 'co_organizer', tests.id('user:cal'),   now(), 12.0),
  (tests.id('alice'), tests.id('one'), 'Alice', 'A', 'player',       tests.id('user:alice'), now(), 14.0);
insert into public.rounds (id, trip_id, round_number, course_id, tee_id, play_date, status)
values (tests.id('r1'), tests.id('one'), 1, tests.id('course'), tests.id('tee'), current_date + 30, 'scheduled');
insert into public.round_formats (id, round_id, format_key, settings)
values (tests.id('f1'), tests.id('r1'), 'nassau', '{"bet_value": 10, "press_value": 10, "presses": "manual", "buy_in": 30, "pot_split": [0.75, 0.25]}');
insert into public.groups (id, round_id, group_number) values (tests.id('g1'), tests.id('r1'), 1);
insert into public.group_players (round_id, player_id, group_id, position, playing_handicap) values
  (tests.id('r1'), tests.id('olive'), tests.id('g1'), 1, 9), (tests.id('r1'), tests.id('alice'), tests.id('g1'), 2, 13);
insert into public.itinerary_items (trip_id, day, type, title) values (tests.id('one'), current_date + 30, 'lodging', 'The house');

-- ── Profiles ────────────────────────────────────────────────────────────────

select results_eq(
  $$ select email, is_admin, display_name from public.profiles where id = tests.id('user:olive') $$,
  $$ values ('olive@test.teed', false, '') $$,
  'a verified sign-in makes a profile: lower-case email, not an admin');

select tests.sign_up('pending', false);
select is((select count(*) from public.profiles where id = tests.id('user:pending')), 0::bigint,
          'an email that has not been verified yet has no profile');

select tests.as_user('olive');
select is(public.me() ->> 'is_admin', 'false', 'me(): an ordinary person is not an admin');
select is(public.me() ->> 'is_trip_creator', 'false', '… and not a trip creator');
select tests.as_user('fritz');
select is((public.me() ->> 'is_admin') || (public.me() ->> 'is_trip_creator'), 'truetrue',
          'me(): the app admin is an admin and may create trips');
select tests.as_postgres();

-- ── Trip creators: the Brendan flow ─────────────────────────────────────────

select tests.as_user('fritz');
create temp table creator_invite as select public.add_trip_creator('Brendan', '+14125550148') as r;
select tests.as_postgres();
grant select on creator_invite to public;

select is(public.invite_preview((select r ->> 'token' from creator_invite)),
          '{"kind": "creator", "inviter": "Fritz", "name": "Brendan"}'::jsonb,
          'a trip-creator invite previews as "Fritz invited you to plan golf trips"');
select is((select count(*) from public.trip_creators where invite_token_hash = (select r ->> 'token' from creator_invite)),
          0::bigint, 'the token itself is not stored, only its hash');

select tests.sign_up('brendan');
select tests.as_user('brendan');
select throws_ok($$ select public.create_trip('Bandon 2027', 'BANDON', 'Bandon, OR', '2027-06-10', '2027-06-13') $$,
                 '42501', null, 'before claiming the invite, Brendan cannot create a trip');
select is(public.claim_invite((select r ->> 'token' from creator_invite)), '{"status": "ok", "kind": "creator"}'::jsonb,
          'signing in from the link makes Brendan a trip creator');
select is(public.me() ->> 'is_trip_creator', 'true', 'me() says so');
select is(public.me() ->> 'display_name', 'Brendan', 'and he is named as the admin entered him');
select is(public.claim_invite((select r ->> 'token' from creator_invite)) ->> 'status', 'invalid',
          'the link works once');

create temp table bandon as
select public.create_trip('Bandon 2027', 'BANDON', 'Bandon, OR', '2027-06-10', '2027-06-13') as id;
grant select on bandon to public;
select results_eq(
  $$ select name, role, handicap_index from public.trip_members where trip_id = (select id from bandon) $$,
  $$ values ('Brendan', 'organizer', null::numeric(3,1)) $$,
  'creating a trip makes the creator its organizer');
select is((select status from public.trips where id = (select id from bandon)), 'draft', 'a new trip is a draft');

-- Brendan adds Fritz, who already has an account, as co-organizer: by email, no link needed.
select is(public.add_member((select id from bandon), 'Fritz', ' Fritz@Test.Teed ', 'co_organizer') - 'id',
          '{"token": null, "claimed": true}'::jsonb,
          'adding someone whose email already has an account puts them on the trip at once');
-- And Cal, as a co-organizer who is not the app admin.
select public.add_member((select id from bandon), 'Cal', 'cal@test.teed', 'co_organizer');

select tests.as_user('fritz');
select is(public.trip_role((select id from bandon)), 'co_organizer', 'Fritz is a co-organizer of Brendan''s draft');
select lives_ok($$ update public.trips set location = 'Bandon Dunes, OR' where id = (select id from bandon) $$,
                'he can edit the trip');
select tests.as_user('cal');
update public.trips set location = 'Cal was here' where id = (select id from bandon);
delete from public.trips where id = (select id from bandon);
select tests.as_postgres();
select is((select location from public.trips where id = (select id from bandon)), 'Cal was here',
          'a co-organizer can edit the trip but not delete it');

-- ── Player invites ──────────────────────────────────────────────────────────

select tests.as_user('cal');
create temp table invites as
select public.add_member(tests.id('one'), 'Von', null, 'player', 8.1) as von,
       public.add_member(tests.id('one'), 'Matt', 'matt@test.teed', 'player', 28.7) as matt,
       public.add_member(tests.id('one'), 'Charlie', 'charlie@test.teed') as charlie;
select tests.as_postgres();
grant select on invites to public;

select is(public.invite_preview((select von ->> 'token' from invites)),
          jsonb_build_object('kind', 'trip', 'inviter', 'Cal', 'name', 'Von', 'email', null,
            'trip', jsonb_build_object('name', 'Trip One', 'start_date', current_date + 30, 'end_date', current_date + 33, 'players', 6)),
          'an invite previews who sent it, the trip and its player count');
select is(public.invite_preview((select matt ->> 'token' from invites)) ->> 'email', 'matt@test.teed',
          'with the email prefilled when the organizer entered one');
select is(public.invite_preview('not-a-token'), null, 'an unknown link previews nothing');
select is((select count(*) from public.trip_members m, invites i
            where m.invite_token_hash in (i.von ->> 'token', i.matt ->> 'token')), 0::bigint,
          'invite tokens are stored only as hashes');

-- Von: no email on file, joins by the token with whatever email he signs in with.
select tests.sign_up('von');
select tests.as_user('von');
select is(public.trip_role(tests.id('one')), null, 'before claiming, Von is not on the trip');
select is(public.claim_invite((select von ->> 'token' from invites)),
          jsonb_build_object('status', 'ok', 'kind', 'trip', 'trip_id', tests.id('one')),
          'Von signs in from his link and is on the trip');
select is(public.trip_role(tests.id('one')), 'player', 'as a player');
select is(public.claim_invite((select von ->> 'token' from invites)) ->> 'status', 'invalid', 'the link works once');
select tests.as_postgres();
select results_eq(
  $$ select m.email, m.invite_token_hash, p.display_name, p.handicap_index
     from public.trip_members m join public.profiles p on p.id = m.profile_id where m.trip_id = tests.id('one') and m.name = 'Von' $$,
  $$ values ('von@test.teed', null::text, 'Von', 8.1::numeric(3,1)) $$,
  'his membership takes his sign-in email; his new profile takes the name and index the organizer entered');

-- Matt: the organizer entered his email, so verifying it is enough, link or no link.
select tests.sign_up('matt', false);
select is((select profile_id from public.trip_members where trip_id = tests.id('one') and name = 'Matt'), null,
          'typing an invited email into Sign in claims nothing until the code is verified');
update auth.users set email_confirmed_at = now() where id = tests.id('user:matt');
select is((select profile_id from public.trip_members where trip_id = tests.id('one') and name = 'Matt'), tests.id('user:matt'),
          'once verified, a matching email claims the membership');
select tests.as_user('matt');
select is(public.claim_invite((select matt ->> 'token' from invites)) ->> 'status', 'invalid',
          'and the texted link is spent with it');

-- Alice is already on the trip: Charlie's link can't put her on it twice.
select tests.as_user('alice');
select is(public.claim_invite((select charlie ->> 'token' from invites)) ->> 'status', 'already_on_trip',
          'one person, one membership per trip');
select tests.as_postgres();
select is((select profile_id from public.trip_members where trip_id = tests.id('one') and name = 'Charlie'), null, 'Charlie''s spot is still his');

-- Resending makes a new link and kills the old one.
select tests.as_user('olive');
create temp table resend as select public.invite_member((select m.id from public.trip_members m where m.trip_id = tests.id('one') and m.name = 'Charlie')) as token;
select tests.as_postgres();
grant select on resend to public;
select is(public.invite_preview((select charlie ->> 'token' from invites)), null, 'a resent invite stops the old link');
select is(public.invite_preview((select token from resend)) ->> 'name', 'Charlie', 'and the new one works');
select tests.as_user('olive');
select throws_ok($$ select public.invite_member(tests.id('alice')) $$, '23514', null,
                 'there is no invite to resend to someone who has joined');
select throws_ok($$ update public.trip_members set email = 'elsewhere@test.teed' where id = tests.id('alice') $$, '23514', null,
                 'an organizer cannot change the email of someone who has signed in');
select tests.as_postgres();

select throws_ok(
  $$ insert into public.trip_members (trip_id, name, initials, email) values (tests.id('one'), 'Matt Two', 'MT', 'matt@test.teed') $$,
  '23505', null, 'an email is on a trip once');

-- ── One organizer per trip ──────────────────────────────────────────────────

select throws_ok(
  $$ insert into public.trip_members (trip_id, name, initials, role) values (tests.id('one'), 'Second', 'S', 'organizer') $$,
  '23505', null, 'a trip cannot have two organizers');

savepoint organizer;
set constraints all immediate;
select throws_ok($$ delete from public.trip_members where id = tests.id('olive') $$, '23514', null,
                 'the organizer cannot be removed, even past the policies');
select throws_ok($$ update public.trip_members set role = 'player' where id = tests.id('olive') $$, '23514', null,
                 'or demoted');
select throws_ok($$ insert into public.trips (name, slug, start_date, end_date) values ('Nobody''s', 'NOBODY', current_date, current_date) $$,
                 '23514', null, 'and a trip cannot exist without one');
select lives_ok($$ delete from public.trips where id = tests.id('one') $$, 'deleting the trip itself takes its organizer with it');
rollback to savepoint organizer;
set constraints all deferred;

select tests.as_user('olive');
select throws_ok($$ select public.set_member_role(tests.id('olive'), 'co_organizer') $$, '23514', null,
                 'the organizer cannot step down through the role function');
select throws_ok($$ select public.hand_off_trip(tests.id('one'), (select m.id from public.trip_members m where m.trip_id = tests.id('one') and m.name = 'Charlie')) $$,
                 '23514', null, 'the trip cannot be handed to someone who has not signed in');
select lives_ok($$ select public.hand_off_trip(tests.id('one'), tests.id('cal')) $$, 'Olive hands the trip to Cal');
select tests.as_postgres();
set constraints all immediate;
set constraints all deferred;
select results_eq(
  $$ select name, role from public.trip_members where id in (tests.id('olive'), tests.id('cal')) order by name $$,
  $$ values ('Cal', 'organizer'), ('Olive', 'co_organizer') $$,
  'Cal is the organizer and Olive stays on as a co-organizer');
select tests.as_user('olive');
select throws_ok($$ select public.hand_off_trip(tests.id('one'), tests.id('olive')) $$, '42501', null,
                 'having handed it off, Olive cannot take it back');
select tests.as_user('cal');
select lives_ok($$ select public.hand_off_trip(tests.id('one'), tests.id('olive')) $$, 'Cal can hand it back');
select tests.as_postgres();

-- ── Handicap index: live on the profile, locked per trip ────────────────────

select is(private.handicap_lock_date(tests.id('one')), current_date + 23,
          'with no lock date set, handicaps lock 7 days before the first round');

select tests.as_user('alice');
update public.profiles set handicap_index = 13.2 where id = auth.uid();
select tests.as_postgres();
select is((select handicap_index from public.trip_members where id = tests.id('alice')), 13.2::numeric(3,1),
          'before the lock, a player''s new index reaches the trip');

select tests.as_user('cal');
select public.set_member_index(tests.id('alice'), 12.9);
select tests.as_postgres();
select is((select handicap_index from public.profiles where id = tests.id('user:alice')), 12.9::numeric(3,1),
          'before the lock, an organizer editing a member''s index edits their profile');

-- The lock date arrives. Nothing runs at that moment: the next profile change must still leave the trip alone.
update public.trips set handicap_lock_date = current_date where id = tests.id('one');
select is((select index_locked_at from public.trip_members where id = tests.id('alice')), null,
          '(nothing has marked the membership locked yet)');
select tests.as_user('alice');
update public.profiles set handicap_index = 9.0 where id = auth.uid();
select tests.as_postgres();
select results_eq(
  $$ select handicap_index, index_locked_at is not null from public.trip_members where id = tests.id('alice') $$,
  $$ values (12.9::numeric(3,1), true) $$,
  'after the lock date, changing the profile does not change the trip''s copy');

select tests.as_user('cal');
select public.set_member_index(tests.id('alice'), 11.5);
select tests.as_postgres();
select results_eq(
  $$ select m.handicap_index, p.handicap_index from public.trip_members m join public.profiles p on p.id = m.profile_id
     where m.id = tests.id('alice') $$,
  $$ values (11.5::numeric(3,1), 9.0::numeric(3,1)) $$,
  'after the lock an organizer still edits the trip''s copy, and the profile is left alone');

-- Joining after the lock copies the current index, locked.
select tests.sign_up('charlie');
select results_eq(
  $$ select profile_id is not null, index_locked_at is not null from public.trip_members where trip_id = tests.id('one') and name = 'Charlie' $$,
  $$ values (true, true) $$, 'someone who joins after the lock is locked on joining');
select tests.sign_up('dana');
update public.profiles set handicap_index = 21.3 where id = tests.id('user:dana');
select tests.as_user('cal');
select public.add_member(tests.id('one'), 'Dana', 'dana@test.teed');
select tests.as_postgres();
select results_eq(
  $$ select handicap_index, index_locked_at is not null from public.trip_members where trip_id = tests.id('one') and name = 'Dana' $$,
  $$ values (21.3::numeric(3,1), true) $$, 'with their current index copied onto the trip');

-- A final trip stays as it was, whatever its dates say.
update public.trips set handicap_lock_date = current_date + 10 where id = tests.id('one');
select is((select index_locked_at from public.trip_members where id = tests.id('alice')), null,
          'moving the lock date back into the future reopens the lock');
select is((select handicap_index from public.trip_members where id = tests.id('alice')), 9.0::numeric(3,1),
          'and members follow their profiles again');
update public.trips set status = 'final' where id = tests.id('one');
update public.profiles set handicap_index = 3.3 where id = tests.id('user:alice');
select is((select handicap_index from public.trip_members where id = tests.id('alice')), 9.0::numeric(3,1),
          'a final trip never follows a profile');
update public.trips set status = 'live', handicap_lock_date = null where id = tests.id('one');

-- ── Trip lifecycle ──────────────────────────────────────────────────────────

update public.trips set start_date = current_date - 5, end_date = current_date - 2 where id = tests.id('one');
update public.rounds set play_date = current_date - 5 where id = tests.id('r1');
update public.trips set reopened_at = null where id = tests.id('one');
select tests.as_user('alice');
select public.my_trips();
select tests.as_postgres();
select is((select status from public.trips where id = tests.id('one')), 'live',
          'a trip past its last day is not final while a round is still open');

update public.rounds set status = 'final' where id = tests.id('r1');
select is((select status from public.trips where id = tests.id('one')), 'final',
          'it becomes final on its own when its last round is finalized');

select tests.as_user('olive');
update public.trips set status = 'live' where id = tests.id('one');
select public.my_trips();
select tests.as_postgres();
select is((select status from public.trips where id = tests.id('one')), 'live',
          'a co-organizer can reopen it, and it stays open');

update public.rounds set status = 'live' where id = tests.id('r1');
update public.rounds set status = 'final' where id = tests.id('r1');
select is((select status from public.trips where id = tests.id('one')), 'final', 'until a round is finalized again');

-- The other way in: every round final before the last day; the day passes; the next person to open the app tips it.
update public.trips set status = 'live' where id = tests.id('one');
update public.trips set reopened_at = null, end_date = current_date + 1 where id = tests.id('one');
select tests.as_user('alice');
select public.my_trips();
select tests.as_postgres();
select is((select status from public.trips where id = tests.id('one')), 'live', 'not before its last day has passed');
update public.trips set end_date = current_date - 2 where id = tests.id('one');
select tests.as_user('alice');
select is((public.my_trips() -> 0) ->> 'stage', 'final', 'then it is final the next time anyone on it opens the app');
select tests.as_postgres();
update public.trips set status = 'live', start_date = current_date - 1, end_date = current_date + 2 where id = tests.id('one');
update public.rounds set status = 'live', play_date = current_date where id = tests.id('r1');

-- ── My trips ────────────────────────────────────────────────────────────────

insert into public.trips (id, name, slug, start_date, end_date, status) values
  (tests.id('soon'),  'Trip Soon',  'TSOON',  current_date + 20, current_date + 23, 'live'),
  (tests.id('later'), 'Trip Later', 'TLATER', current_date + 90, current_date + 93, 'draft'),
  (tests.id('past'),  'Trip Past',  'TPAST',  current_date - 90, current_date - 87, 'final');
insert into public.trip_members (trip_id, name, initials, role, profile_id)
select t.id, v.name, left(v.name, 1), v.role, tests.id('user:' || lower(v.name))
from (values ('soon'), ('later'), ('past')) as x (trip)
join public.trips t on t.id = tests.id(x.trip)
cross join (values ('Olive', 'organizer'), ('Alice', 'player')) as v (name, role);

select tests.as_user('alice');
select results_eq(
  $$ select t ->> 'name', t ->> 'stage', t ->> 'bucket', t ->> 'role', (t ->> 'player_count')::int, t ->> 'finish', t ->> 'winnings'
     from jsonb_array_elements(public.my_trips()) t $$,
  $$ values ('Trip One',  'in_progress', 'next',     'player', 7, null, null),
            ('Trip Soon', 'upcoming',    'upcoming', 'player', 2, null, null),
            ('Trip Past', 'final',       'past',     'player', 2, null, null) $$,
  'my trips: the one in progress is next, then upcoming, then past; a player does not get drafts');
select tests.as_user('olive');
select results_eq(
  $$ select t ->> 'name', t ->> 'stage', t ->> 'bucket' from jsonb_array_elements(public.my_trips()) t $$,
  $$ values ('Trip One', 'in_progress', 'next'), ('Trip Soon', 'upcoming', 'upcoming'),
            ('Trip Later', 'draft', 'upcoming'), ('Trip Past', 'final', 'past') $$,
  'an organizer gets their drafts too');
select tests.as_user('fritz');
select is(jsonb_array_length(public.my_trips()), 1, 'the app admin''s own list is only the trips they are on');
select tests.as_postgres();

-- ── Score history ───────────────────────────────────────────────────────────

select tests.as_user('alice');
insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('r1'), tests.id('olive'), 1, 5);
select tests.as_user('cal');
update public.scores set strokes = 4 where round_id = tests.id('r1') and player_id = tests.id('olive') and hole = 1;
delete from public.scores where round_id = tests.id('r1') and player_id = tests.id('olive') and hole = 1;
select tests.as_postgres();
select results_eq(
  $$ select op, strokes::int, previous_strokes::int, changed_by, changed_by_player_id
     from public.score_history where round_id = tests.id('r1') order by id $$,
  $$ values ('insert', 5,         null::int, tests.id('user:alice'), tests.id('alice')),
            ('update', 4,         5,         tests.id('user:cal'),   tests.id('cal')),
            ('delete', null::int, 4,         tests.id('user:cal'),   tests.id('cal')) $$,
  'every score insert, update and delete is kept: who, old and new value');
select tests.as_user('cal');
select throws_ok($$ delete from public.score_history $$, '42501', null, 'history cannot be edited');
select tests.as_postgres();

-- ── Removing a player ───────────────────────────────────────────────────────

select tests.as_user('alice');
insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('r1'), tests.id('olive'), 2, 6);
select tests.as_user('olive');
delete from public.trip_members where id = tests.id('alice');
select tests.as_postgres();
select is((select count(*) from public.group_players where player_id = tests.id('alice')), 0::bigint,
          'a removed player comes out of every group');
select is((select strokes::int from public.scores where round_id = tests.id('r1') and player_id = tests.id('olive') and hole = 2),
          6, 'scores they entered for others stay');
select tests.as_user('alice');
select is(public.trip_role(tests.id('one')), null, 'and they no longer see the trip');
select tests.as_postgres();

-- ── The spectator link ──────────────────────────────────────────────────────

insert into public.spectator_links (trip_id, nonce, token_hash) values (tests.id('one'), 'n1', 'hash-one');
insert into public.scores (round_id, player_id, hole, strokes) values (tests.id('r1'), tests.id('olive'), 3, 4);

select is((select array_agg(k order by k) from jsonb_object_keys(public.spectator_view('hash-one')) k),
          array['rounds', 'trip'], 'a spectator link shows the trip header and its rounds, nothing else');
select is((select array_agg(k order by k) from jsonb_object_keys(public.spectator_view('hash-one') -> 'trip') k),
          array['end_date', 'handicap_allowance', 'location', 'name', 'pickup_net_double', 'shows_winnings',
                'start_date', 'status', 'strokes_off_low'],
          'the trip header has no buy-in, lock date or anything about the people');
select is((select array_agg(k order by k) from jsonb_object_keys(public.spectator_view('hash-one') #> '{rounds,0}') k),
          array['course', 'formats', 'groups', 'id', 'play_date', 'presses', 'round_number', 'scores', 'status', 'tee', 'tee_time'],
          'a round has its course, tee, formats, groups, scores and presses');
select is((select array_agg(k order by k) from jsonb_object_keys(public.spectator_view('hash-one') #> '{rounds,0,groups,0,players,0}') k),
          array['course_handicap', 'handicap_index', 'id', 'initials', 'name', 'playing_handicap', 'position', 'team'],
          'a player in a group is a name and handicaps: no email, role, account or paid status');
select is(jsonb_array_length(public.spectator_view('hash-one') #> '{rounds,0,scores}'), 2, 'the scores are there');
select is(public.spectator_view('hash-one') #> '{rounds,0,formats,0,settings}', '{"presses": "manual"}'::jsonb,
          'the money is left out of the game settings');
select unalike(public.spectator_view('hash-one')::text, '%The house%', 'the itinerary is not in it');
select unalike(public.spectator_view('hash-one')::text, '%@test.teed%', 'nor anyone''s email');

update public.trips set spectators_see_money = true where id = tests.id('one');
select is(public.spectator_view('hash-one') #>> '{rounds,0,formats,0,settings,bet_value}', '10',
          'with "Spectators see winnings" on, the stakes are included');
select is(public.spectator_view('hash-one') #> '{trip}' ? 'buy_in_amount', false, 'but still not the buy-ins');

update public.spectator_links set nonce = 'n2', token_hash = 'hash-two' where trip_id = tests.id('one');
select is(public.spectator_view('hash-one'), null, 'a reset link stops working');
select isnt(public.spectator_view('hash-two'), null, 'and the new one works');
update public.trips set status = 'draft' where id = tests.id('one');
select is(public.spectator_view('hash-two'), null, 'a trip that is not published shows nothing');
update public.trips set status = 'live' where id = tests.id('one');

select tests.as_user('olive');
select throws_ok($$ select public.spectator_view('hash-two') $$, '42501', null,
                 'the view is for the spectate function alone, not for signed-in users');
select throws_ok($$ select public.invite_preview('x') $$, '42501', null, 'likewise the invite preview');
select tests.as_anon();
select throws_ok($$ select public.spectator_view('hash-two') $$, '42501', null, 'and not for the signed-out');
select throws_ok($$ select * from public.trips $$, '42501', null, 'signed out, no table can be read');
select throws_ok($$ select public.my_trips() $$, '42501', null, 'and no function called');
select tests.as_postgres();

select * from finish();
rollback;
