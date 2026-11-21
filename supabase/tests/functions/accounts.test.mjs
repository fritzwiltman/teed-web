// End-to-end tests for sign-in, invites and the spectator link, over real HTTP against a local
// Supabase stack (`supabase start`): Auth, the Data API under RLS, the edge functions and the
// local mail catcher. No dependencies: Node's test runner and fetch.
//
//   API_URL=... ANON_KEY=... SERVICE_ROLE_KEY=... node --test supabase/tests/functions/accounts.test.mjs
//
// (`supabase status -o env` prints those values. CI does this in .github/workflows/db-tests.yml.)
// Every user here is made up (…@test.teed) and exists only in the local stack.

import assert from 'node:assert/strict';
import { test } from 'node:test';

const API_URL = process.env.API_URL;
const ANON_KEY = process.env.ANON_KEY ?? process.env.PUBLISHABLE_KEY;
const SERVICE_KEY = process.env.SERVICE_ROLE_KEY ?? process.env.SECRET_KEY;
const MAIL_URL = process.env.MAILPIT_URL ?? process.env.INBUCKET_URL ?? 'http://127.0.0.1:54324';
assert.ok(API_URL && ANON_KEY && SERVICE_KEY, 'set API_URL, ANON_KEY and SERVICE_ROLE_KEY (see `supabase status -o env`)');

const run = Date.now().toString(36);
const address = (name) => `${name}.${run}@test.teed`;
const serviceHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const anonHeaders = { apikey: ANON_KEY, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(url, { method = 'POST', headers = anonHeaders, body } = {}) {
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, ok: res.ok, body: parsed };
}

/** Data API as the service role (bypasses RLS): fixture setup and checks only. */
async function service(method, path, body) {
  const res = await call(`${API_URL}/rest/v1/${path}`, {
    method,
    headers: { ...serviceHeaders, Prefer: 'return=representation' },
    body,
  });
  assert.ok(res.ok, `${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

const as = (token) => ({ ...anonHeaders, Authorization: `Bearer ${token}` });
/** A database function, called as a signed-in person. */
const rpc = (token, name, args = {}) => call(`${API_URL}/rest/v1/rpc/${name}`, { headers: as(token), body: args });
/** A table read or write under RLS, as a signed-in person. */
const rest = (token, method, path, body) =>
  call(`${API_URL}/rest/v1/${path}`, { method, headers: { ...as(token), Prefer: 'return=representation' }, body });
/** An edge function. */
const fn = (name, body, token) =>
  call(`${API_URL}/functions/v1/${name}`, { headers: token ? as(token) : anonHeaders, body });

/** The newest email to an address, from the local mail catcher. */
async function emailTo(to) {
  for (let i = 0; i < 40; i++) {
    const list = await call(`${MAIL_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`, {
      method: 'GET',
      headers: {},
    });
    const found = list.body?.messages?.[0];
    if (found) return (await call(`${MAIL_URL}/api/v1/message/${found.ID}`, { method: 'GET', headers: {} })).body;
    await sleep(250);
  }
  assert.fail(`no email arrived for ${to}`);
}
const clearMail = () => call(`${MAIL_URL}/api/v1/messages`, { method: 'DELETE', headers: {} });

/** Signs in the way the app does: ask for a code, read it from the email, type it in. */
async function signIn(name) {
  const email = address(name);
  await clearMail();
  const asked = await call(`${API_URL}/auth/v1/otp`, { body: { email, create_user: true } });
  assert.ok(asked.ok, `asking for a code failed: ${asked.status} ${JSON.stringify(asked.body)}`);
  const mail = await emailTo(email);
  const code = /\b(\d{6})\b/.exec(mail.Text ?? '')?.[1] ?? /\b(\d{6})\b/.exec(mail.HTML ?? '')?.[1];
  assert.ok(code, `no 6-digit code in the email: ${mail.Text}`);
  const verified = await call(`${API_URL}/auth/v1/verify`, { body: { type: 'email', email, token: code } });
  assert.ok(
    verified.ok && verified.body.access_token,
    `verifying the code failed: ${verified.status} ${JSON.stringify(verified.body)}`,
  );
  return { email, token: verified.body.access_token, id: verified.body.user.id };
}

test('sign-in: the email holds a 6-digit code and no link; a profile exists only once it is verified', async () => {
  const email = address('newcomer');
  await clearMail();
  const asked = await call(`${API_URL}/auth/v1/otp`, { body: { email, create_user: true } });
  assert.equal(asked.status, 200, JSON.stringify(asked.body));

  const first = await emailTo(email);
  assert.match(first.Subject, /Your Teed code/);
  const code = /\b(\d{6})\b/.exec(first.Text)?.[1];
  assert.ok(code, 'the first sign-in email has a 6-digit code');
  for (const part of [first.Text, first.HTML]) {
    assert.doesNotMatch(part, /https?:\/\//, 'no link anywhere in the email');
    assert.doesNotMatch(part, /href=/i, 'no link anywhere in the email');
  }
  assert.deepEqual(await service('GET', `profiles?email=eq.${email}&select=id`), [], 'not verified yet: no profile');

  const wrong = await call(`${API_URL}/auth/v1/verify`, {
    body: { type: 'email', email, token: code === '000000' ? '111111' : '000000' },
  });
  assert.ok(!wrong.ok, 'a wrong code is refused');

  const verified = await call(`${API_URL}/auth/v1/verify`, { body: { type: 'email', email, token: code } });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.ok(verified.body.access_token && verified.body.refresh_token, 'the right code gives a session that can be refreshed');
  const [profile] = await service('GET', `profiles?email=eq.${email}&select=id,is_admin,display_name`);
  assert.deepEqual(profile, { id: verified.body.user.id, is_admin: false, display_name: '' });

  const again = await call(`${API_URL}/auth/v1/verify`, { body: { type: 'email', email, token: code } });
  assert.ok(!again.ok, 'a code works once');

  // Coming back later is the other template: it must be a code with no link too.
  await clearMail();
  await sleep(1100); // Auth sends one email per address per second
  const later = await call(`${API_URL}/auth/v1/otp`, { body: { email, create_user: true } });
  assert.equal(later.status, 200, JSON.stringify(later.body));
  const second = await emailTo(email);
  assert.match(second.Text, /\b\d{6}\b/);
  assert.doesNotMatch(second.Text + second.HTML, /https?:\/\/|href=/i);
});

test('anonymous sign-in is off, and nothing is readable signed out', async () => {
  const anonymous = await call(`${API_URL}/auth/v1/signup`, { body: {} });
  assert.ok(!anonymous.ok, `anonymous sign-in should be refused, got ${anonymous.status}`);
  for (const path of ['trips?select=id', 'trip_members?select=id', 'scores?select=strokes', 'profiles?select=id']) {
    const res = await call(`${API_URL}/rest/v1/${path}`, { method: 'GET' });
    assert.ok(!res.ok, `${path} must not be readable signed out (got ${res.status})`);
  }
  assert.ok(!(await call(`${API_URL}/rest/v1/rpc/spectator_view`, { body: { p_token_hash: 'x' } })).ok);
  assert.ok(!(await call(`${API_URL}/rest/v1/rpc/invite_preview`, { body: { p_token: 'x' } })).ok);
});

test('a friend organizes: the admin invites Brendan, who makes a trip and adds the admin and a player', async () => {
  const fritz = await signIn('fritz');
  await service('PATCH', `profiles?id=eq.${fritz.id}`, { is_admin: true, display_name: 'Fritz' });
  const slug = (prefix) => `${prefix}${run}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const tripArgs = (name, prefix) => ({
    p_name: name,
    p_slug: slug(prefix),
    p_location: 'Bandon, OR',
    p_start_date: '2027-06-10',
    p_end_date: '2027-06-13',
  });

  // The admin adds Brendan as a trip creator and gets the link to text.
  const added = await rpc(fritz.token, 'add_trip_creator', { p_name: 'Brendan', p_phone: '+14125550148' });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const creatorToken = added.body.token;
  assert.deepEqual((await fn('invite', { token: creatorToken })).body, { kind: 'creator', inviter: 'Fritz', name: 'Brendan' });
  assert.equal((await fn('invite', { token: 'nonsense' })).status, 404);

  // Brendan signs in from it, and can then create a trip; he is its organizer.
  const brendan = await signIn('brendan');
  assert.equal((await rpc(brendan.token, 'create_trip', tripArgs('Too soon', 'S'))).status, 403, 'not a trip creator yet');
  assert.deepEqual((await rpc(brendan.token, 'claim_invite', { p_token: creatorToken })).body, { status: 'ok', kind: 'creator' });
  assert.equal((await fn('invite', { token: creatorToken })).status, 404, 'the invite link is single-use');
  assert.equal((await rpc(brendan.token, 'me')).body.is_trip_creator, true);

  const created = await rpc(brendan.token, 'create_trip', tripArgs(`Bandon ${run}`, 'B'));
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const trip = created.body;
  assert.equal((await rpc(brendan.token, 'trip_role', { p_trip_id: trip })).body, 'organizer');

  // He adds Fritz (who has an account) as co-organizer by email, and Sean by a texted link.
  const coOrganizer = await rpc(brendan.token, 'add_member', {
    p_trip_id: trip,
    p_name: 'Fritz',
    p_email: fritz.email,
    p_role: 'co_organizer',
  });
  assert.equal(coOrganizer.body.claimed, true, JSON.stringify(coOrganizer.body));
  const invited = await rpc(brendan.token, 'add_member', { p_trip_id: trip, p_name: 'Sean', p_handicap_index: 21 });
  assert.ok(invited.body.token, JSON.stringify(invited.body));

  const preview = await fn('invite', { token: invited.body.token });
  assert.equal(preview.status, 200);
  assert.deepEqual(preview.body, {
    kind: 'trip',
    inviter: 'Brendan',
    name: 'Sean',
    email: null,
    trip: { name: `Bandon ${run}`, start_date: '2027-06-10', end_date: '2027-06-13', players: 3 },
  });

  // Fritz, as co-organizer, edits the trip.
  const edited = await rest(fritz.token, 'PATCH', `trips?id=eq.${trip}`, { location: 'Bandon Dunes, OR' });
  assert.equal(edited.body?.[0]?.location, 'Bandon Dunes, OR');

  // Sean signs in from his link: a player. He does not see the trip while it is a draft.
  const sean = await signIn('sean');
  assert.deepEqual((await rpc(sean.token, 'claim_invite', { p_token: invited.body.token })).body, {
    status: 'ok',
    kind: 'trip',
    trip_id: trip,
  });
  assert.deepEqual((await rest(sean.token, 'GET', `trips?id=eq.${trip}&select=id`)).body, []);
  await rest(brendan.token, 'PATCH', `trips?id=eq.${trip}`, { status: 'live' });
  assert.equal((await rest(sean.token, 'GET', `trips?id=eq.${trip}&select=id`)).body.length, 1, 'published: the player sees it');
  assert.equal((await rpc(sean.token, 'me')).body.handicap_index, 21, 'his profile took the index the organizer entered');

  // A player reads but does not run the trip; he can suggest an itinerary change but not edit it.
  assert.deepEqual((await rest(sean.token, 'PATCH', `trips?id=eq.${trip}`, { location: 'Mine now' })).body, []);
  assert.deepEqual((await rest(sean.token, 'DELETE', `trips?id=eq.${trip}`)).body, []);
  const item = { trip_id: trip, day: '2027-06-10', type: 'meal', title: 'Dinner' };
  assert.ok(!(await rest(sean.token, 'POST', 'itinerary_items', item)).ok, 'a player cannot edit the itinerary');
  assert.ok((await rest(brendan.token, 'POST', 'itinerary_items', item)).ok);
  const roster = (await rpc(sean.token, 'trip_roster', { p_trip_id: trip })).body;
  const me = roster.find((m) => m.is_me);
  assert.equal(me.name, 'Sean');
  assert.equal('email' in me, false, 'a player gets no emails or "!" flags');
  const idea = await rest(sean.token, 'POST', 'itinerary_proposals', {
    trip_id: trip,
    payload: { title: 'Later dinner' },
    proposed_by: me.id,
  });
  assert.equal(idea.status, 201, JSON.stringify(idea.body));
  const organizerIdea = await rest(brendan.token, 'POST', 'itinerary_proposals', {
    trip_id: trip,
    payload: {},
    proposed_by: roster.find((m) => m.role === 'organizer').id,
  });
  assert.ok(!organizerIdea.ok, 'organizers edit directly: they do not suggest');

  // The exact reads the app's screens make, so a renamed table or relationship fails here.
  const creators = await rest(fritz.token, 'GET', 'trip_creators?select=id,name,phone,claimed_at,profiles!trip_creators_profile_id_fkey(email)');
  assert.equal(creators.status, 200, JSON.stringify(creators.body));
  assert.equal(creators.body.find((c) => c.name === 'Brendan')?.profiles?.email, brendan.email);
  const myRow = await rest(sean.token, 'GET', `trip_members?select=id,name,initials,role&id=eq.${me.id}`);
  assert.deepEqual(myRow.body, [{ id: me.id, name: 'Sean', initials: 'S', role: 'player' }]);
  const homeRounds = await rest(sean.token, 'GET',
    `rounds?select=round_number,play_date,tee_time,status,courses(name,photo_path),tees(name),round_formats(format_key),groups(group_players(position,players:trip_members(id,name),scores(count)))&trip_id=eq.${trip}&order=play_date,round_number`);
  assert.equal(homeRounds.status, 200, JSON.stringify(homeRounds.body));
  const adminRounds = await rest(brendan.token, 'GET',
    `rounds?select=id,round_number,play_date,tee_time,status,pairings_tbd,courses(name,short_name),groups(group_players(scores(count)))&trip_id=eq.${trip}&order=round_number`);
  assert.equal(adminRounds.status, 200, JSON.stringify(adminRounds.body));
  assert.ok(!(await rest(sean.token, 'GET', `trip_members?select=email&trip_id=eq.${trip}`)).ok, 'emails are not readable from the table');
  const trips = (await rpc(sean.token, 'my_trips')).body;
  assert.deepEqual(trips.map((t) => [t.id, t.role, t.stage, t.player_count]), [[trip, 'player', 'upcoming', 3]]);
  const managed = (await rpc(brendan.token, 'trip_roster', { p_trip_id: trip })).body;
  assert.deepEqual(managed.find((m) => m.name === 'Sean').flags, { no_email: false, not_claimed: false, not_paid: false });
  assert.equal(managed.find((m) => m.name === 'Sean').email, sean.email);

  // The spectator link.
  const outsider = await signIn('outsider');
  const link = (action, token) => fn('spectator-link', { trip_id: trip, action }, token);
  assert.equal((await link('get')).status, 401, 'signed out');
  assert.equal((await link('get', outsider.token)).status, 403, 'not on the trip');
  assert.deepEqual((await link('get', sean.token)).body, { token: null }, 'no link made yet');
  assert.equal((await link('reset', sean.token)).status, 403, 'a player cannot create or reset it');

  const made = await link('reset', fritz.token);
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const first = made.body.token;
  assert.match(first, /^[A-Za-z0-9_-]{40,}$/);
  assert.deepEqual((await link('get', sean.token)).body, { token: first }, 'a player can get it to share');
  const [stored] = await service('GET', `spectator_links?trip_id=eq.${trip}&select=nonce,token_hash`);
  assert.ok(!JSON.stringify(stored).includes(first), 'the link itself is not in the database');

  const watching = await fn('spectate', { token: first });
  assert.equal(watching.status, 200, JSON.stringify(watching.body));
  assert.deepEqual(Object.keys(watching.body).sort(), ['rounds', 'trip'], 'rounds and boards only');
  assert.equal(watching.body.trip.name, `Bandon ${run}`);
  const everything = JSON.stringify(watching.body);
  assert.ok(!everything.includes('Dinner') && !everything.includes('@test.teed'), 'no itinerary and no emails');

  const reset = await link('reset', brendan.token);
  assert.notEqual(reset.body.token, first);
  assert.equal((await fn('spectate', { token: first })).status, 404, 'a reset link stops working');
  assert.equal((await fn('spectate', { token: reset.body.token })).status, 200);
  assert.equal((await fn('spectate', { token: 'nonsense' })).status, 404);

  // A co-organizer's limits, shown with Sean (Fritz is the app admin, who may do anything).
  await rpc(brendan.token, 'set_member_role', { p_member_id: me.id, p_role: 'co_organizer' });
  const seanEdit = await rest(sean.token, 'PATCH', `trips?id=eq.${trip}`, { location: 'Edited by Sean' });
  assert.equal(seanEdit.body.length, 1, 'a co-organizer edits the trip');
  assert.deepEqual((await rest(sean.token, 'DELETE', `trips?id=eq.${trip}`)).body, [], 'but cannot delete it');
  assert.equal((await rpc(sean.token, 'hand_off_trip', { p_trip_id: trip, p_member_id: me.id })).status, 403, 'or take it over');

  // Hand-off: Brendan stays on as co-organizer, and the new organizer can delete.
  assert.ok((await rpc(brendan.token, 'hand_off_trip', { p_trip_id: trip, p_member_id: me.id })).ok);
  assert.equal((await rpc(brendan.token, 'trip_role', { p_trip_id: trip })).body, 'co_organizer');
  assert.equal((await rest(sean.token, 'DELETE', `trips?id=eq.${trip}`)).body.length, 1, 'the new organizer can delete the trip');
});
