-- The permissions matrix (docs/plan.md, "Who can do what"), one check per capability and role.
-- pgTAP: `supabase test db`, or `npm run test:db` without Docker. Builds its own fixture inside a
-- transaction and rolls it back; every attempt is undone before the next, so each role meets the
-- same data. Users are made up here: nothing touches a real account.
--
-- Trip ONE (published, in progress): Olive organizer and Cal co-organizer, Alice and Bob players.
--   Round 1: group 1 = Olive, Alice · group 2 = Cal, Bob.
-- Trip DRAFT: the same four, same roles, not published yet.
-- Trip TWO: someone else's. The app admin is on none of these, and on trip ADM as a player.
--
-- The spectator column: a spectator has no account, so every row is also tried signed out
-- (always refused); what the link itself shows is tested in 01_accounts.test.sql. Signing in
-- with an email code is Supabase Auth, covered by the edge function tests.

begin;

create schema tests;
grant usage on schema tests to public;

create function tests.id(name text) returns uuid language sql immutable as $$ select md5(name)::uuid $$;

-- Tries a statement as someone ('anon' = signed out) and undoes it. True when it went through
-- and touched or returned at least one row; false when it was refused or reached nothing.
create function tests.try(who text, q text) returns boolean language plpgsql as $$
declare
  n bigint;
begin
  begin
    if who = 'anon' then
      perform set_config('request.jwt.claims', '', true);
      set local role anon;
    else
      perform set_config('request.jwt.claims',
        json_build_object('sub', tests.id('user:' || who), 'role', 'authenticated')::text, true);
      set local role authenticated;
    end if;
    execute q;
    get diagnostics n = row_count;
    set constraints all immediate;   -- end-of-transaction checks (one organizer per trip) run now
    raise exception using errcode = 'TR0LL', message = n::text;
  exception
    when sqlstate 'TR0LL' then
      reset role;
      return sqlerrm::bigint > 0;
    when others then
      reset role;
      return false;
  end;
end;
$$;

-- One matrix row: the same statement as the app admin, organizer, co-organizer and a player,
-- and signed out.
create function tests.matrix(capability text, q text, admin boolean, organizer boolean, co boolean, player boolean)
returns setof text language sql as $$
  select is(tests.try(v.who, q), v.allowed,
            capability || ': ' || v.label || case when v.allowed then ' can' else ' cannot' end)
  from (values ('admin', 'app admin', admin), ('olive', 'organizer', organizer), ('cal', 'co-organizer', co),
               ('alice', 'player', player), ('anon', 'signed out', false)) as v (who, label, allowed);
$$;

select * from no_plan();

-- ── Fixture ─────────────────────────────────────────────────────────────────

insert into auth.users (id, email, email_confirmed_at)
select tests.id('user:' || n), n || '@test.teed', now()
from unnest(array['admin', 'olive', 'cal', 'alice', 'bob', 'brendan', 'zed']) as n;
update public.profiles set is_admin = true where id = tests.id('user:admin');
insert into public.trip_creators (name, profile_id, claimed_at) values ('Brendan', tests.id('user:brendan'), now());

insert into public.courses (id, name, location) values (tests.id('course'), 'Test Links', 'Nowhere, NC');
insert into public.tees (id, course_id, name, par, stroke_index)
values (tests.id('tee'), tests.id('course'), 'White',
        '{4,4,3,5,4,4,3,5,4,4,4,3,5,4,4,3,5,4}', '{1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18}');

insert into public.trips (id, name, slug, start_date, end_date, status, buy_in_amount) values
  (tests.id('one'),   'Trip One',   'TONE',   current_date - 1, current_date + 3, 'live', 30),
  (tests.id('draft'), 'Trip Draft', 'TDRAFT', current_date + 60, current_date + 63, 'draft', null),
  (tests.id('two'),   'Trip Two',   'TTWO',   current_date + 30, current_date + 33, 'live', null),
  (tests.id('adm'),   'Trip Adm',   'TADM',   current_date + 30, current_date + 33, 'live', null);

insert into public.trip_members (id, trip_id, name, initials, role, profile_id, handicap_index) values
  (tests.id('olive'), tests.id('one'), 'Olive', 'O', 'organizer',    tests.id('user:olive'), 10.0),
  (tests.id('cal'),   tests.id('one'), 'Cal',   'C', 'co_organizer', tests.id('user:cal'),   12.0),
  (tests.id('alice'), tests.id('one'), 'Alice', 'A', 'player',       tests.id('user:alice'), 14.0),
  (tests.id('bob'),   tests.id('one'), 'Bob',   'B', 'player',       tests.id('user:bob'),   16.0),
  (tests.id('dan'),   tests.id('one'), 'Dan',   'D', 'player',       null,                   null),
  (tests.id('d:olive'), tests.id('draft'), 'Olive', 'O', 'organizer',    tests.id('user:olive'), null),
  (tests.id('d:cal'),   tests.id('draft'), 'Cal',   'C', 'co_organizer', tests.id('user:cal'),   null),
  (tests.id('d:alice'), tests.id('draft'), 'Alice', 'A', 'player',       tests.id('user:alice'), null),
  (tests.id('zed'),     tests.id('two'),   'Zed',   'Z', 'organizer',    tests.id('user:zed'),   null),
  (tests.id('a:zed'),   tests.id('adm'),   'Zed',   'Z', 'organizer',    tests.id('user:zed'),   null),
  (tests.id('a:admin'), tests.id('adm'),   'Admin', 'AD', 'player',      tests.id('user:admin'), null);

insert into public.rounds (id, trip_id, round_number, course_id, tee_id, play_date, status) values
  (tests.id('r1'), tests.id('one'), 1, tests.id('course'), tests.id('tee'), current_date, 'live'),
  (tests.id('r2'), tests.id('one'), 2, tests.id('course'), tests.id('tee'), current_date + 1, 'scheduled');
insert into public.round_formats (id, round_id, format_key, settings)
values (tests.id('f1'), tests.id('r1'), 'stroke', '{"buy_in": 30}');
insert into public.groups (id, round_id, group_number) values
  (tests.id('g1'), tests.id('r1'), 1), (tests.id('g2'), tests.id('r1'), 2);
insert into public.group_players (round_id, player_id, group_id, position) values
  (tests.id('r1'), tests.id('olive'), tests.id('g1'), 1), (tests.id('r1'), tests.id('alice'), tests.id('g1'), 2),
  (tests.id('r1'), tests.id('cal'),   tests.id('g2'), 1), (tests.id('r1'), tests.id('bob'),   tests.id('g2'), 2);
insert into public.scores (round_id, player_id, hole, strokes) values
  (tests.id('r1'), tests.id('alice'), 1, 5), (tests.id('r1'), tests.id('bob'), 1, 4);

insert into public.itinerary_items (id, trip_id, day, type, title)
values (tests.id('dinner'), tests.id('one'), current_date, 'meal', 'Dinner');
insert into public.itinerary_proposals (id, trip_id, payload, proposed_by)
values (tests.id('idea'), tests.id('one'), '{"title": "Later tee time"}', tests.id('bob'));

-- ── The matrix ──────────────────────────────────────────────────────────────
--                                                                          admin  org    co     player

select tests.matrix('edit own name and handicap index',
  $$ update public.profiles set display_name = 'New Name', handicap_index = 9.9 where id = auth.uid() $$,
                                                                            true,  true,  true,  true);

select tests.matrix('create a trip (none of these three is a trip creator)',
  $$ select public.create_trip('New Trip', 'NEWT', null, '2028-01-01', '2028-01-03') $$,
                                                                            true,  false, false, false);
select is(tests.try('brendan', $$ select public.create_trip('Bandon', 'BANDON', null, '2028-06-10', '2028-06-13') $$),
          true, 'create a trip: a trip creator can');

select tests.matrix('manage the Trip creators list: add',
  $$ select public.add_trip_creator('Sean', '+14125550148') $$,            true,  false, false, false);
select tests.matrix('manage the Trip creators list: read',
  $$ select id from public.trip_creators $$,                               true,  false, false, false);
select tests.matrix('manage the Trip creators list: remove',
  $$ delete from public.trip_creators $$,                                  true,  false, false, false);

select tests.matrix('open a trip they are not on',
  format($$ select id from public.trips where id = %L $$, tests.id('two')),
                                                                            true,  false, false, false);

select tests.matrix('see trip details',
  format($$ select id from public.trips where id = %L $$, tests.id('one')),
                                                                            true,  true,  true,  true);
select tests.matrix('see the itinerary',
  format($$ select id from public.itinerary_items where trip_id = %L $$, tests.id('one')),
                                                                            true,  true,  true,  true);
select tests.matrix('see the people',
  format($$ select public.trip_roster(%L) $$, tests.id('one')),            true,  true,  true,  true);

select tests.matrix('edit trip details, house rules and handicap defaults',
  format($$ update public.trips set location = 'Elsewhere', handicap_allowance = 0.85, handicap_lock_date = current_date + 1
            where id = %L $$, tests.id('one')),                            true,  true,  true,  false);

select tests.matrix('publish the trip',
  format($$ update public.trips set status = 'live' where id = %L $$, tests.id('draft')),
                                                                            true,  true,  true,  false);

select tests.matrix('delete the trip',
  format($$ delete from public.trips where id = %L $$, tests.id('one')),   true,  true,  false, false);

select tests.matrix('hand the trip to a new organizer',
  format($$ select public.hand_off_trip(%L, %L) $$, tests.id('one'), tests.id('bob')),
                                                                            true,  true,  false, false);

select tests.matrix('add a co-organizer: promote a player',
  format($$ select public.set_member_role(%L, 'co_organizer') $$, tests.id('bob')),
                                                                            true,  true,  false, false);
select tests.matrix('add a co-organizer: invite one',
  format($$ select public.add_member(%L, 'Erin', 'erin@test.teed', 'co_organizer') $$, tests.id('one')),
                                                                            true,  true,  false, false);
select tests.matrix('remove a co-organizer: back to player',
  format($$ select public.set_member_role(%L, 'player') $$, tests.id('cal')),
                                                                            true,  true,  false, false);
select tests.matrix('remove a co-organizer: off the trip',
  format($$ delete from public.trip_members where id = %L $$, tests.id('cal')),
                                                                            true,  true,  false, false);

select tests.matrix('add a player',
  format($$ select public.add_member(%L, 'Erin', 'erin@test.teed') $$, tests.id('one')),
                                                                            true,  true,  true,  false);
select tests.matrix('remove a player',
  format($$ delete from public.trip_members where id = %L $$, tests.id('bob')),
                                                                            true,  true,  true,  false);
select tests.matrix('send or resend an invite',
  format($$ select public.invite_member(%L) $$, tests.id('dan')),          true,  true,  true,  false);
select tests.matrix('edit a member''s name and email',
  format($$ update public.trip_members set name = 'Daniel', email = 'dan@test.teed' where id = %L $$, tests.id('dan')),
                                                                            true,  true,  true,  false);

select tests.matrix('change a member''s trip handicap',
  format($$ select public.set_member_index(%L, 11.1) $$, tests.id('bob')), true,  true,  true,  false);

-- The spectator link is made, reset and handed out by the spectator-link edge function, which
-- asks trip_role() who is calling: anyone on the trip may share it, these three may reset it.
select tests.matrix('create or reset the spectator link',
  format($$ select 1 where public.trip_role(%L) in ('admin', 'organizer', 'co_organizer') $$, tests.id('one')),
                                                                            true,  true,  true,  false);
select tests.matrix('share the spectator link',
  format($$ select 1 where public.trip_role(%L) is not null $$, tests.id('one')),
                                                                            true,  true,  true,  true);
select tests.matrix('read the spectator link table directly',
  $$ select trip_id from public.spectator_links $$,                        false, false, false, false);

select tests.matrix('edit the itinerary: add',
  format($$ insert into public.itinerary_items (trip_id, day, type, title) values (%L, current_date, 'meal', 'Lunch') $$,
         tests.id('one')),                                                  true,  true,  true,  false);
select tests.matrix('edit the itinerary: change',
  format($$ update public.itinerary_items set title = 'Late dinner' where id = %L $$, tests.id('dinner')),
                                                                            true,  true,  true,  false);
select tests.matrix('edit the itinerary: remove',
  format($$ delete from public.itinerary_items where id = %L $$, tests.id('dinner')),
                                                                            true,  true,  true,  false);

select tests.matrix('suggest an itinerary change',
  format($$ insert into public.itinerary_proposals (trip_id, payload, proposed_by)
            values (%L, '{"title": "Move dinner"}', private.my_player_id(%L)) $$, tests.id('one'), tests.id('one')),
                                                                            false, false, false, true);

select tests.matrix('approve or reject suggestions',
  format($$ update public.itinerary_proposals set status = 'approved' where id = %L $$, tests.id('idea')),
                                                                            true,  true,  true,  false);

select tests.matrix('create a round',
  format($$ insert into public.rounds (trip_id, round_number, course_id, tee_id, play_date)
            values (%L, 3, %L, %L, current_date + 2) $$, tests.id('one'), tests.id('course'), tests.id('tee')),
                                                                            true,  true,  true,  false);
select tests.matrix('edit a round',
  format($$ update public.rounds set tee_time = '08:10' where id = %L $$, tests.id('r2')),
                                                                            true,  true,  true,  false);
select tests.matrix('delete a round',
  format($$ delete from public.rounds where id = %L $$, tests.id('r2')),   true,  true,  true,  false);
select tests.matrix('set a round''s format',
  format($$ insert into public.round_formats (round_id, format_key) values (%L, 'skins') $$, tests.id('r1')),
                                                                            true,  true,  true,  false);
select tests.matrix('edit a format',
  format($$ update public.round_formats set settings = '{"buy_in": 20}' where id = %L $$, tests.id('f1')),
                                                                            true,  true,  true,  false);
select tests.matrix('create a group',
  format($$ insert into public.groups (round_id, group_number) values (%L, 3) $$, tests.id('r1')),
                                                                            true,  true,  true,  false);
select tests.matrix('set teams',
  format($$ update public.group_players set team = 'A' where round_id = %L and player_id = %L $$,
         tests.id('r1'), tests.id('alice')),                                true,  true,  true,  false);
select tests.matrix('delete a group',
  format($$ delete from public.groups where id = %L $$, tests.id('g2')),   true,  true,  true,  false);

-- Their own group: Olive and Alice are in group 1, Cal in group 2.
select is(tests.try(v.who, format($$ insert into public.scores (round_id, player_id, hole, strokes) values (%L, %L, 2, 4) $$,
                                  tests.id('r1'), tests.id(v.target))), true,
          'enter scores for their own group: ' || v.label || ' can')
from (values ('admin', 'alice', 'app admin'), ('olive', 'alice', 'organizer'), ('cal', 'bob', 'co-organizer'),
             ('alice', 'olive', 'player')) as v (who, target, label);
select is(tests.try('anon', format($$ insert into public.scores (round_id, player_id, hole, strokes) values (%L, %L, 2, 4) $$,
                                   tests.id('r1'), tests.id('alice'))), false,
          'enter scores for their own group: signed out cannot');

-- Any group: Bob is in group 2, which is neither Olive's nor Alice's; Alice is not in Cal's.
select is(tests.try(v.who, format($$ update public.scores set strokes = 6 where round_id = %L and player_id = %L and hole = 1 $$,
                                  tests.id('r1'), tests.id(v.target))), v.allowed,
          'fix scores for any group: ' || v.label || case when v.allowed then ' can' else ' cannot' end)
from (values ('admin', 'bob', 'app admin', true), ('olive', 'bob', 'organizer', true), ('cal', 'alice', 'co-organizer', true),
             ('alice', 'bob', 'player', false), ('anon', 'bob', 'signed out', false)) as v (who, target, label, allowed);
select tests.matrix('enter a score for another group',
  format($$ insert into public.scores (round_id, player_id, hole, strokes) values (%L, %L, 3, 4) $$,
         tests.id('r1'), tests.id('bob')),                                  true,  true,  true,  false);
select tests.matrix('delete a score in another group',
  format($$ delete from public.scores where round_id = %L and player_id = %L $$, tests.id('r1'), tests.id('bob')),
                                                                            true,  true,  true,  false);

select tests.matrix('finalize a round',
  format($$ update public.rounds set status = 'final' where id = %L $$, tests.id('r1')),
                                                                            true,  true,  true,  false);
update public.rounds set status = 'final' where id = tests.id('r2');
select tests.matrix('reopen a round',
  format($$ update public.rounds set status = 'live' where id = %L $$, tests.id('r2')),
                                                                            true,  true,  true,  false);
update public.rounds set status = 'scheduled' where id = tests.id('r2');

select tests.matrix('see scores and scorecards',
  format($$ select strokes from public.scores where round_id = %L $$, tests.id('r1')),
                                                                            true,  true,  true,  true);
select tests.matrix('see score history',
  format($$ select id from public.score_history where round_id = %L $$, tests.id('r1')),
                                                                            true,  true,  true,  true);

select tests.matrix('set the buy-in amount',
  format($$ update public.trips set buy_in_amount = 40 where id = %L $$, tests.id('one')),
                                                                            true,  true,  true,  false);
select tests.matrix('mark a buy-in paid',
  format($$ update public.trip_members set buy_in_paid = true where id = %L $$, tests.id('alice')),
                                                                            true,  true,  true,  false);
select tests.matrix('see buy-ins and paid status',
  format($$ select t.buy_in_amount, m.buy_in_paid from public.trips t join public.trip_members m on m.trip_id = t.id
            where t.id = %L $$, tests.id('one')),                           true,  true,  true,  true);
select tests.matrix('see what the games are played for (winnings)',
  format($$ select settings from public.round_formats where id = %L $$, tests.id('f1')),
                                                                            true,  true,  true,  true);

select tests.matrix('send an alert',
  format($$ insert into public.alerts (trip_id, level, body) values (%L, 'urgent', 'Lightning: come in now.') $$,
         tests.id('one')),                                                  true,  true,  true,  false);

select tests.matrix('get push notifications for this trip (the app admin is not on it)',
  format($$ insert into public.push_subscriptions (trip_id, endpoint, p256dh, auth_key)
            values (%L, 'https://push.test/' || auth.uid(), 'k', 'a') $$, tests.id('one')),
                                                                            false, true,  true,  true);
select is(tests.try('admin', format($$ insert into public.push_subscriptions (trip_id, endpoint, p256dh, auth_key)
                                       values (%L, 'https://push.test/adm', 'k', 'a') $$, tests.id('adm'))),
          true, 'get push notifications: the app admin can, for a trip they are on');

select tests.matrix('see the organizer "!" flags on People',
  format($$ select 1 where (public.trip_roster(%L) -> 0) ? 'flags' $$, tests.id('one')),
                                                                            true,  true,  true,  false);
select tests.matrix('read emails and invite state straight from the table',
  format($$ select email, profile_id, claimed_at from public.trip_members where trip_id = %L $$, tests.id('one')),
                                                                            false, false, false, false);

-- ── The edges of the matrix ─────────────────────────────────────────────────

select is(tests.try('alice', format($$ select id from public.trips where id = %L $$, tests.id('draft'))), false,
          'a player does not see a trip until it is published');
select is(tests.try('cal', format($$ select id from public.trips where id = %L $$, tests.id('draft'))), true,
          'a co-organizer sees it while it is a draft');
select is(tests.try('bob', format($$ select id from public.trips where id = %L $$, tests.id('two'))), false,
          'nobody from one trip sees another');
select is(tests.try('zed', format($$ select public.trip_roster(%L) $$, tests.id('one'))), false,
          'an organizer of another trip cannot read this one''s people');

select is(tests.try('alice', $$ update public.profiles set is_admin = true where id = auth.uid() $$), false,
          'nobody can make themselves an app admin');
select is(tests.try('alice', $$ update public.profiles set email = 'other@test.teed' where id = auth.uid() $$), false,
          'the profile email only follows the verified sign-in email');
select is(tests.try('olive', format($$ update public.profiles set handicap_index = 1.0 where id = %L $$, tests.id('user:alice'))),
          false, 'an organizer cannot write another person''s profile directly');
select is(tests.try('alice', format($$ select id from public.profiles where id = %L $$, tests.id('user:bob'))), false,
          'a player cannot read another person''s profile');

select is(tests.try('cal', format($$ insert into public.trip_members (trip_id, name, initials, role) values (%L, 'Eve', 'E', 'organizer') $$,
                                  tests.id('one'))), false, 'nobody inserts members straight into the table');
select is(tests.try('olive', format($$ update public.trip_members set role = 'player' where id = %L $$, tests.id('cal'))), false,
          'roles change only through the role functions');
select is(tests.try('olive', format($$ insert into public.trips (name, slug, start_date, end_date) values ('X', 'XX', current_date, current_date) $$)),
          false, 'trips are created only through create_trip()');
select is(tests.try('alice', format($$ insert into public.itinerary_proposals (trip_id, payload, proposed_by, status)
                                       values (%L, '{}', %L, 'approved') $$, tests.id('one'), tests.id('alice'))), false,
          'a player cannot suggest something already approved');
select is(tests.try('alice', format($$ insert into public.itinerary_proposals (trip_id, payload, proposed_by)
                                       values (%L, '{}', %L) $$, tests.id('one'), tests.id('bob'))), false,
          'or suggest in someone else''s name');
select is(tests.try('alice', format($$ select id from public.itinerary_proposals where id = %L $$, tests.id('idea'))), false,
          'a player sees only their own suggestions');
select is(tests.try('bob', format($$ select id from public.itinerary_proposals where id = %L $$, tests.id('idea'))), true,
          'including the one they made');

select * from finish();
rollback;
