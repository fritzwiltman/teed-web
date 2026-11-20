-- Admin tests (pgTAP): the organizer's whole setup path through RLS, phone numbers, replacing a
-- player and spectator codes.

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

insert into auth.users (id)
select tests.id('user:' || n) from unnest(array['organizer', 'stranger', 'phone-ben', 'phone-cal', 'phone-new', 'watcher']) as n;
insert into public.app_admins (user_id) values (tests.id('user:organizer'));

-- ── The organizer sets up a trip from nothing ───────────────────────────────

select tests.as_user('organizer');

select lives_ok(
  $$ insert into public.trips (id, name, slug, start_date, end_date) values (tests.id('vero'), 'Vero Beach 2027', 'VERO', '2027-01-11', '2027-01-15') $$,
  'the organizer creates a draft trip');
select lives_ok(
  $$ insert into public.players (id, trip_id, name, initials, sort_order) values
       (tests.id('fritz'), tests.id('vero'), 'Fritz', 'FW', 1), (tests.id('ben'), tests.id('vero'), 'Ben', 'BK', 2),
       (tests.id('cal'), tests.id('vero'), 'Cal', 'CM', 3), (tests.id('dom'), tests.id('vero'), 'Dom', 'DR', 4) $$,
  'adds four players');
select matches(public.regenerate_player_code(tests.id('fritz')), '^[A-HJ-NP-Z2-9]{6}$', 'issues a code for a new player');
select lives_ok(
  $$ select public.regenerate_player_code(p.id) from public.players p where p.trip_id = tests.id('vero') and p.name <> 'Fritz' $$,
  'and for the rest');
select results_eq(
  $$ select count(*) from public.player_codes c join public.players p on p.id = c.player_id where p.trip_id = tests.id('vero') $$,
  'select 4::bigint', 'every player has a code the organizer can read');

select lives_ok(
  $$ insert into public.player_contacts (player_id, phone) values (tests.id('ben'), '+17725550101') $$,
  'saves a phone number');
select throws_ok(
  $$ insert into public.player_contacts (player_id, phone) values (tests.id('cal'), 'call me') $$,
  '23514', null, 'a phone number has to look like one');
select lives_ok(
  $$ update public.trips set handicap_allowance = 0.85, strokes_off_low = false, handicap_lock_date = '2027-01-08', theme = 'scorecard'
     where id = tests.id('vero') $$,
  'edits the house rules');
select lives_ok($$ update public.players set role = 'co_admin' where id = tests.id('cal') $$, 'makes a player co-admin');
select lives_ok($$ update public.trips set owner_player_id = tests.id('fritz') where id = tests.id('vero') $$, 'marks which player is the owner');

select matches(public.issue_spectator_code(tests.id('vero')), '^[A-HJ-NP-Z2-9]{6}$', 'creates the spectator code');
select lives_ok($$ update public.spectator_codes set enabled = false where trip_id = tests.id('vero') $$, 'turns the spectator code off');
select lives_ok($$ update public.spectator_codes set enabled = true where trip_id = tests.id('vero') $$, 'and on again');

-- Codes don't log in until the trip is live.
select tests.as_postgres();
select is(
  public.redeem_code((select code from public.player_codes where player_id = tests.id('ben')), tests.id('user:phone-ben'), null) ->> 'status',
  'trip_not_live', 'before the trip is live, a code is refused');

select tests.as_user('organizer');
with u as (update public.trips set status = 'live' where id = tests.id('vero') returning 1)
select is((select count(*) from u), 1::bigint, 'the organizer sets the trip live');

select tests.as_postgres();
select is(
  public.redeem_code((select code from public.player_codes where player_id = tests.id('ben')), tests.id('user:phone-ben'), null) ->> 'status',
  'ok', 'now the code logs in');
select is(
  public.redeem_code((select code from public.player_codes where player_id = tests.id('cal')), tests.id('user:phone-cal'), null) ->> 'status',
  'ok', 'the co-admin logs in too');
select is(
  public.redeem_code((select code from public.spectator_codes where trip_id = tests.id('vero')), tests.id('user:watcher'), null) ->> 'role',
  'spectator', 'and a spectator');

-- ── Who can't ───────────────────────────────────────────────────────────────

select tests.as_user('stranger');   -- signed in by email, not in app_admins
select is_empty('select * from public.trips', 'someone who signs in by email but is not an organizer sees no trips');
select is_empty('select * from public.app_admins', '...and is not told who the organizers are');
select throws_ok(
  $$ insert into public.trips (name, slug, start_date, end_date) values ('Mine', 'MINE', '2027-02-01', '2027-02-02') $$,
  '42501', null, '...and cannot create a trip');

select tests.as_user('phone-cal');  -- co-admin, logged in with a code
select is_empty('select * from public.player_contacts', 'a co-admin cannot read phone numbers');
select throws_ok(
  $$ select public.replace_player(tests.id('dom'), 'Eli', 'EP') $$, '42501', null, 'a co-admin cannot replace a player');
select throws_ok(
  $$ select public.issue_spectator_code(tests.id('vero')) $$, '42501', null, 'a co-admin cannot issue a spectator code');

select tests.as_user('phone-ben');  -- a player
select is_empty('select * from public.player_contacts', 'a player cannot read phone numbers, not even their own');

-- ── Replacing a player ──────────────────────────────────────────────────────

select tests.as_postgres();
update public.players set handicap_index = 9.4, index_entered_at = now() where id = tests.id('ben');
insert into public.player_ghin (player_id, ghin_number) values (tests.id('ben'), '1234567');
create temp table old_code as select code from public.player_codes where player_id = tests.id('ben');
grant select on old_code to public;

select tests.as_user('organizer');
select matches(public.replace_player(tests.id('ben'), ' Eli ', 'ep'), '^[A-HJ-NP-Z2-9]{6}$', 'replacing a player returns a code for the new person');
select results_eq(
  $$ select name, initials, handicap_index, index_entered_at, sort_order from public.players where id = tests.id('ben') $$,
  $$ values ('Eli', 'EP', null::numeric, null::timestamptz, 2::smallint) $$,
  'the slot has the new name, no handicap, and its place in the roster');
select is_empty($$ select * from public.player_contacts where player_id = tests.id('ben') $$, 'the old phone number is gone');
select is_empty($$ select * from public.player_ghin where player_id = tests.id('ben') $$, 'and the old GHIN number');

select tests.as_postgres();
select is_empty($$ select * from public.trip_sessions where player_id = tests.id('ben') $$, 'the old player''s phone is signed out');
select is(
  public.redeem_code((select code from old_code), tests.id('user:phone-new'), null) ->> 'status',
  'invalid_code', 'the old code no longer works');
select is(
  public.redeem_code((select code from public.player_codes where player_id = tests.id('ben')), tests.id('user:phone-new'), null) -> 'player' ->> 'name',
  'Eli', 'the new code logs in as the new person');

-- ── Regenerating the spectator code ─────────────────────────────────────────

select tests.as_user('organizer');
select lives_ok($$ select public.issue_spectator_code(tests.id('vero')) $$, 'issuing the spectator code again replaces it');
select results_eq(
  $$ select count(*) from public.spectator_codes where trip_id = tests.id('vero') $$, 'select 1::bigint', 'there is still one spectator code');
select tests.as_user('watcher');
select is_empty('select * from public.trips', 'whoever was watching with the old one is signed out');

select * from finish();
rollback;
