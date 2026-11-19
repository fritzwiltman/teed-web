// End-to-end tests for the redeem-code edge function, over real HTTP against a local Supabase
// stack (`supabase start`). No dependencies: Node's test runner and fetch.
//
//   API_URL=... ANON_KEY=... SERVICE_ROLE_KEY=... node --test supabase/tests/functions/
//
// (`supabase status -o env` prints those values. CI does this in .github/workflows/db-tests.yml.)
// Uses the seeded Southern Pines trip: sets it live, and puts it back to final at the end.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

const API_URL = process.env.API_URL;
const ANON_KEY = process.env.ANON_KEY ?? process.env.PUBLISHABLE_KEY;
const SERVICE_KEY = process.env.SERVICE_ROLE_KEY ?? process.env.SECRET_KEY;
assert.ok(API_URL && ANON_KEY && SERVICE_KEY, 'set API_URL, ANON_KEY and SERVICE_ROLE_KEY (see `supabase status -o env`)');

const adminHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

/** Data API as the service role (bypasses RLS): fixture setup only. */
async function admin(method, path, body) {
  const res = await fetch(`${API_URL}/rest/v1/${path}`, {
    method,
    headers: { ...adminHeaders, Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  assert.ok(res.ok, `${method} ${path} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

/** A new phone: an anonymous sign-in. Returns its access token. */
async function newPhone() {
  const res = await fetch(`${API_URL}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await res.json();
  assert.ok(res.ok && body.access_token, `anonymous sign-in failed: ${res.status} ${JSON.stringify(body)}`);
  return body.access_token;
}

async function redeem(token, code) {
  const res = await fetch(`${API_URL}/functions/v1/redeem-code`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ code }),
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // leave null
  }
  return { status: res.status, body, headers: res.headers };
}

/** What this phone can read through the Data API under RLS. */
async function read(token, path) {
  const res = await fetch(`${API_URL}/rest/v1/${path}`, { headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` } });
  assert.ok(res.ok, `GET ${path} -> ${res.status}`);
  return res.json();
}

let trip;
let codes; // { Fritz: 'PINES-FW26-XXXX', ... }
let spectatorCode;

async function setTripStatus(status) {
  await admin('PATCH', `trips?id=eq.${trip.id}`, { status });
}

before(async () => {
  // The edge runtime can take a few seconds to come up after `supabase start`.
  for (let i = 0; ; i++) {
    const res = await fetch(`${API_URL}/functions/v1/redeem-code`, { method: 'OPTIONS' }).catch(() => null);
    if (res?.status === 204) break;
    assert.ok(i < 30, `redeem-code never came up (last status ${res?.status})`);
    await new Promise((r) => setTimeout(r, 2000));
  }

  [trip] = await admin('GET', 'trips?slug=eq.PINES&select=id,name');
  assert.ok(trip, 'the Southern Pines seed is loaded');
  await setTripStatus('live');

  const rows = await admin('GET', `player_codes?select=code,players!inner(name,trip_id)&players.trip_id=eq.${trip.id}`);
  codes = Object.fromEntries(rows.map((r) => [r.players.name, r.code]));
  assert.equal(Object.keys(codes).length, 4);

  [{ code: spectatorCode }] = await admin('POST', 'spectator_codes', { trip_id: trip.id, code: 'PINES-WATCH-T3ST' });
});

after(async () => {
  if (!trip) return;
  await admin('DELETE', 'spectator_codes?code=eq.PINES-WATCH-T3ST');
  await setTripStatus('final');
});

test('a valid code logs the phone in and returns the trip and player', async () => {
  const phone = await newPhone();
  assert.deepEqual(await read(phone, 'trips?select=name'), [], 'before logging in the phone sees no trips');

  const res = await redeem(phone, codes.Fritz);
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.role, 'player');
  assert.equal(res.body.trip.name, 'Southern Pines 2026');
  assert.equal(res.body.trip.status, 'live');
  assert.deepEqual(
    { name: res.body.player.name, initials: res.body.player.initials, role: res.body.player.role },
    { name: 'Fritz', initials: 'FW', role: 'co_admin' },
  );

  assert.deepEqual(await read(phone, 'trips?select=name'), [{ name: 'Southern Pines 2026' }], 'now it can read its trip');
  assert.equal((await read(phone, 'players?select=name')).length, 4);
});

test('lowercase and missing dashes are accepted', async () => {
  const phone = await newPhone();
  const res = await redeem(phone, ` ${codes.Von.toLowerCase().replaceAll('-', '')} `);
  assert.equal(res.status, 200);
  assert.equal(res.body.player.name, 'Von');
});

test('a wrong code is refused with 404', async () => {
  const phone = await newPhone();
  const res = await redeem(phone, 'PINES-FW26-0000');
  assert.equal(res.status, 404);
  assert.equal(res.body.status, 'invalid_code');
  assert.deepEqual(await read(phone, 'trips?select=name'), []);
});

test('a call without a session is refused with 401', async () => {
  assert.equal((await redeem(null, codes.Fritz)).status, 401);
  assert.equal((await redeem('not-a-real-token', codes.Fritz)).status, 401);
});

test('a spectator code logs in read-only', async () => {
  const phone = await newPhone();
  const res = await redeem(phone, spectatorCode);
  assert.equal(res.status, 200);
  assert.equal(res.body.role, 'spectator');
  assert.equal(res.body.player, null);
  assert.equal((await read(phone, 'scores?select=hole&limit=5')).length, 5, 'a spectator can read scores');

  const write = await fetch(`${API_URL}/rest/v1/scores?hole=eq.1`, {
    method: 'PATCH',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${phone}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ strokes: 1 }),
  });
  assert.deepEqual(await write.json(), [], 'but cannot change any');
});

test('a regenerated code stops working and signs its phones out', async () => {
  const phone = await newPhone();
  assert.equal((await redeem(phone, codes.Charlie)).status, 200);

  const [player] = await admin('GET', `players?trip_id=eq.${trip.id}&name=eq.Charlie&select=id`);
  await admin('PATCH', `player_codes?player_id=eq.${player.id}`, { code: 'PINES-C26-N3WW' });

  assert.deepEqual(await read(phone, 'trips?select=name'), [], 'the phone that used the old code is signed out');
  assert.equal((await redeem(await newPhone(), codes.Charlie)).status, 404, 'the old code is refused');
  assert.equal((await redeem(await newPhone(), 'PINES-C26-N3WW')).status, 200, 'the new code works');
});

test('a revoked code stops working', async () => {
  const [player] = await admin('GET', `players?trip_id=eq.${trip.id}&name=eq.Matt&select=id`);
  await admin('DELETE', `player_codes?player_id=eq.${player.id}`);
  try {
    assert.equal((await redeem(await newPhone(), codes.Matt)).status, 404);
  } finally {
    await admin('POST', 'player_codes', { player_id: player.id, code: codes.Matt });
  }
});

test('codes do not work while the trip is a draft, or once it is final', async () => {
  const phone = await newPhone();
  try {
    await setTripStatus('draft');
    let res = await redeem(phone, codes.Fritz);
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { status: 'trip_not_live', trip_status: 'draft' });

    await setTripStatus('final');
    res = await redeem(phone, codes.Fritz);
    assert.equal(res.status, 409);
    assert.equal(res.body.trip_status, 'final');
  } finally {
    await setTripStatus('live');
  }
});

test('five wrong codes in a minute lock the phone out, even for the right code', async () => {
  const phone = await newPhone();
  for (let i = 1; i <= 4; i++) {
    assert.equal((await redeem(phone, `PINES-NOPE-${i}`)).status, 404, `wrong code ${i}`);
  }
  const fifth = await redeem(phone, 'PINES-NOPE-5');
  assert.equal(fifth.status, 429);
  assert.equal(fifth.body.status, 'rate_limited');
  assert.equal(fifth.headers.get('retry-after'), '300');

  const right = await redeem(phone, codes.Fritz);
  assert.equal(right.status, 429, 'the right code is refused during the lockout');
  assert.ok(right.body.retry_after > 0 && right.body.retry_after <= 300);

  assert.equal((await redeem(await newPhone(), codes.Fritz)).status, 200, 'another phone on the same network still gets in');
});
