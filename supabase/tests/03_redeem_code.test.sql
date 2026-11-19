-- Code login tests (pgTAP): redeem_code(), rate limits, revoking and regenerating codes.
-- redeem_code is called here the way the edge function calls it (as the service role).

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
-- Shorthand: redeem as the named phone from an address, return one field of the answer.
create function tests.redeem(code text, phone text, ip text, field text default 'status') returns text
language sql as $$ select public.redeem_code(code, tests.id('user:' || phone), ip) ->> field $$;

select * from no_plan();

-- ── Fixture ─────────────────────────────────────────────────────────────────

insert into auth.users (id)
select tests.id('user:' || n)
from unnest(array['owner', 'phone1', 'phone2', 'phone3', 'phone4', 'phone5', 'watcher', 'clumsy', 'housemate']) as n;

insert into public.trips (id, owner_id, name, slug, start_date, end_date, status) values
  (tests.id('trip:live'),  tests.id('user:owner'), 'Vero Beach 2027', 'VERO',  '2027-01-11', '2027-01-15', 'live'),
  (tests.id('trip:draft'), tests.id('user:owner'), 'Not Yet',         'DRAFT', '2027-03-01', '2027-03-03', 'draft'),
  (tests.id('trip:final'), tests.id('user:owner'), 'All Done',        'DONE',  '2026-03-01', '2026-03-03', 'final');

insert into public.players (id, trip_id, name, initials, role) values
  (tests.id('fritz'), tests.id('trip:live'),  'Fritz', 'FW', 'co_admin'),
  (tests.id('ben'),   tests.id('trip:live'),  'Ben',   'BK', 'player'),
  (tests.id('early'), tests.id('trip:draft'), 'Early', 'E',  'player'),
  (tests.id('late'),  tests.id('trip:final'), 'Late',  'L',  'player');

update public.trips set owner_player_id = tests.id('ben') where id = tests.id('trip:live');

insert into public.player_codes (player_id, code) values
  (tests.id('fritz'), 'VERO-FW27-K4M9'),
  (tests.id('ben'),   'VERO-BK27-Q2X7'),
  (tests.id('early'), 'DRAFT-E27-AAAA'),
  (tests.id('late'),  'DONE-L26-BBBB');

insert into public.spectator_codes (id, trip_id, code, enabled) values
  (tests.id('spec:on'),  tests.id('trip:live'), 'VERO-WATCH-7Q3D', true),
  (tests.id('spec:off'), tests.id('trip:live'), 'VERO-WATCH-8Z5F', false);

-- ── Who may call it ─────────────────────────────────────────────────────────

select tests.as_user('phone1');
select throws_ok(
  $$ select public.redeem_code('VERO-FW27-K4M9', tests.id('user:phone1'), '10.0.0.1') $$,
  '42501', null, 'a signed-in user cannot call redeem_code directly (only the edge function can)');
select tests.as_postgres();
set local role anon;
select throws_ok(
  $$ select public.redeem_code('VERO-FW27-K4M9', tests.id('user:phone1'), '10.0.0.1') $$,
  '42501', null, 'neither can anon');
select tests.as_postgres();

-- ── A valid player code ─────────────────────────────────────────────────────

select is(
  public.redeem_code('VERO-FW27-K4M9', tests.id('user:phone1'), '10.0.0.1'),
  jsonb_build_object(
    'status', 'ok', 'role', 'player',
    'trip', jsonb_build_object('id', tests.id('trip:live'), 'name', 'Vero Beach 2027', 'slug', 'VERO', 'status', 'live',
                               'location', null, 'start_date', '2027-01-11', 'end_date', '2027-01-15',
                               'owner_player_id', tests.id('ben')),
    'player', jsonb_build_object('id', tests.id('fritz'), 'name', 'Fritz', 'initials', 'FW', 'role', 'co_admin')),
  'a valid code returns the trip and the player');
select results_eq(
  $$ select player_id from public.trip_sessions where user_id = tests.id('user:phone1') $$,
  $$ values (tests.id('fritz')) $$, 'and links the phone to that player');

select tests.as_user('phone1');
select results_eq('select name from public.trips', $$ values ('Vero Beach 2027') $$, 'the phone can now read its trip');
select tests.as_postgres();

select is(tests.redeem('vero-fw27-k4m9', 'phone2', '10.0.0.1'), 'ok', 'lowercase works');
select is(tests.redeem(' verofw27 k4m9 ', 'phone2', '10.0.0.1'), 'ok', 'missing dashes and stray spaces work');
select results_eq(
  $$ select count(*) from public.trip_sessions where player_id = tests.id('fritz') $$,
  'select 2::bigint', 'two phones can be the same player (Safari and the home-screen app)');

select is(tests.redeem('VERO-BK27-Q2X7', 'phone2', '10.0.0.1', 'player'), '{"id": "' || tests.id('ben') || '", "name": "Ben", "role": "player", "initials": "BK"}',
  'a phone can switch to another player''s code');
select results_eq(
  $$ select player_id from public.trip_sessions where user_id = tests.id('user:phone2') $$,
  $$ values (tests.id('ben')) $$, 'which replaces its session rather than adding one');

-- ── Wrong code, draft and finished trips ────────────────────────────────────

select is(tests.redeem('VERO-FW27-XXXX', 'phone3', '10.0.0.3'), 'invalid_code', 'a wrong code is refused');
select is(tests.redeem('', 'phone3', '10.0.0.3'), 'invalid_code', 'an empty code is refused');
select is(tests.redeem('DRAFT-E27-AAAA', 'phone3', '10.0.0.3'), 'trip_not_live', 'a code for a draft trip is refused');
select is(tests.redeem('DRAFT-E27-AAAA', 'phone3', '10.0.0.3', 'trip_status'), 'draft', '...saying the trip is still a draft');
select is(tests.redeem('DONE-L26-BBBB', 'phone3', '10.0.0.3', 'trip_status'), 'final', 'a code for a finished trip is refused as final');
select is_empty($$ select * from public.trip_sessions where user_id = tests.id('user:phone3') $$, 'none of those created a session');

-- ── Spectators ──────────────────────────────────────────────────────────────

select is(tests.redeem('VERO-WATCH-7Q3D', 'watcher', '10.0.0.4', 'role'), 'spectator', 'a spectator code logs in as a spectator');
select is(tests.redeem('VERO-WATCH-7Q3D', 'watcher', '10.0.0.4', 'player'), null, '...with no player');
select results_eq(
  $$ select spectator_code_id, player_id from public.trip_sessions where user_id = tests.id('user:watcher') $$,
  $$ values (tests.id('spec:on'), null::uuid) $$, 'the session is a spectator session');
select tests.as_user('watcher');
select isnt_empty('select * from public.players', 'the spectator can read the roster');
select throws_ok(
  $$ update public.trip_sessions set player_id = tests.id('fritz'), spectator_code_id = null $$,
  '42501', null, 'a spectator cannot promote their own session to a player');
select tests.as_postgres();
select is(tests.redeem('VERO-WATCH-8Z5F', 'phone3', '10.0.0.3'), 'invalid_code', 'a disabled spectator code is refused');

-- ── Revoked and regenerated codes ───────────────────────────────────────────

select tests.as_user('phone2');   -- Ben, a plain player
select throws_ok(
  $$ select public.regenerate_player_code(tests.id('ben')) $$,
  '42501', null, 'a player cannot issue codes, not even their own');

select tests.as_user('phone1');   -- Fritz, co-admin
select throws_ok(
  $$ select public.regenerate_player_code(tests.id('ben')) $$,
  '42501', null, 'nor can a co-admin');

-- Ben is the trip's owner_player_id, which is for display only.
select tests.as_user('phone2');
select is_empty('select * from public.player_codes', 'being the owner''s player gives no access to codes');
with u as (update public.trips set name = 'Mine now' returning 1)
select is((select count(*) from u), 0::bigint, '...and no admin rights');

select tests.as_user('owner');    -- the owner, signed in by email
select matches(public.regenerate_player_code(tests.id('ben')), '^VERO-BK27-[A-HJ-NP-Z2-9]{4}$', 'the owner gets a new code in the standard format');
select tests.as_postgres();

select is_empty($$ select * from public.trip_sessions where player_id = tests.id('ben') $$, 'regenerating a code signs out the phones that used the old one');
select is(tests.redeem('VERO-BK27-Q2X7', 'phone4', '10.0.0.5'), 'invalid_code', 'the old code no longer works');
select is(tests.redeem((select code from public.player_codes where player_id = tests.id('ben')), 'phone4', '10.0.0.5'), 'ok', 'the new code works');

delete from public.player_codes where player_id = tests.id('ben');
select is_empty($$ select * from public.trip_sessions where player_id = tests.id('ben') $$, 'revoking a code signs its phones out');
select tests.as_user('phone4');
select is_empty('select * from public.trips', 'a signed-out phone can no longer read the trip');
select tests.as_postgres();

-- ── Rate limit per device: 5 failed attempts a minute ───────────────────────

select is(tests.redeem('NOPE-1', 'clumsy', '10.0.0.9'), 'invalid_code', 'wrong code 1 of 5');
select is(tests.redeem('NOPE-2', 'clumsy', '10.0.0.9'), 'invalid_code', 'wrong code 2');
select is(tests.redeem('NOPE-3', 'clumsy', '10.0.0.9'), 'invalid_code', 'wrong code 3');
select is(tests.redeem('NOPE-4', 'clumsy', '10.0.0.9'), 'invalid_code', 'wrong code 4');
select is(tests.redeem('NOPE-5', 'clumsy', '10.0.0.9'), 'rate_limited', 'the 5th wrong code locks the device out');
select is(tests.redeem('NOPE-5', 'clumsy', '10.0.0.9', 'retry_after'), '300', '...for five minutes');
select is(tests.redeem('VERO-FW27-K4M9', 'clumsy', '10.0.0.9'), 'rate_limited', 'even the right code is refused during the lockout');
select is(tests.redeem('VERO-FW27-K4M9', 'clumsy', '172.16.0.1'), 'rate_limited', 'changing network does not lift a device lockout');
select is(tests.redeem('VERO-FW27-K4M9', 'housemate', '10.0.0.9'), 'ok', 'someone else on the same Wi-Fi is not locked out');

update private.redeem_lockouts set locked_until = now() - interval '1 second';
select is(tests.redeem('VERO-FW27-K4M9', 'clumsy', '10.0.0.9'), 'ok', 'after the lockout the right code works');

-- A correct login clears the device's count: four more mistakes are allowed again.
select is(
  (select string_agg(tests.redeem('NOPE-' || n, 'clumsy', '10.0.0.9'), ',') from generate_series(1, 4) as n),
  'invalid_code,invalid_code,invalid_code,invalid_code', 'a successful login resets the count');

-- ── Rate limit per IP: 30 failed attempts a minute ──────────────────────────

delete from private.redeem_attempts;
select is(
  (select count(*) filter (where public.redeem_code('GUESS-' || n, gen_random_uuid(), '203.0.113.7') ->> 'status' = 'invalid_code')
     from generate_series(1, 29) as n),
  29::bigint, '29 wrong guesses from one address, each from a new device, are only refused');
select is(public.redeem_code('GUESS-30', gen_random_uuid(), '203.0.113.7') ->> 'status', 'rate_limited', 'the 30th locks the address out');
select is(tests.redeem('VERO-FW27-K4M9', 'phone5', '203.0.113.7'), 'rate_limited', 'a new device at that address is locked out too');
select is(tests.redeem('VERO-FW27-K4M9', 'phone5', '198.51.100.2'), 'ok', 'the same device elsewhere is fine');

select * from finish();
rollback;
