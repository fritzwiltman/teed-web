// End-to-end test of a round: set it up, score it from two phones, watch it arrive live, and
// finalize it. Over real HTTP and Realtime against a local Supabase stack (`supabase start`),
// with the same client library and the same queries the app uses.
//
//   API_URL=... ANON_KEY=... SERVICE_ROLE_KEY=... node --test supabase/tests/functions/rounds.test.mjs
//
// Every user here is made up (…@test.teed) and exists only in the local stack. Run it after
// accounts.test.mjs, not beside it: both read the one local mail catcher.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';

const API_URL = process.env.API_URL;
const ANON_KEY = process.env.ANON_KEY ?? process.env.PUBLISHABLE_KEY;
const SERVICE_KEY = process.env.SERVICE_ROLE_KEY ?? process.env.SECRET_KEY;
const MAIL_URL = process.env.MAILPIT_URL ?? process.env.INBUCKET_URL ?? 'http://127.0.0.1:54324';
assert.ok(API_URL && ANON_KEY && SERVICE_KEY, 'set API_URL, ANON_KEY and SERVICE_ROLE_KEY (see `supabase status -o env`)');

const run = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Signs in the way the app does (an emailed code) and returns a client that is that person. */
async function signIn(name) {
  const email = `${name}.${run}@test.teed`;
  const client = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const asked = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  assert.equal(asked.error, null, `asking for a code failed: ${asked.error?.message}`);
  let code = null;
  for (let i = 0; i < 40 && !code; i++) {
    const list = await (await fetch(`${MAIL_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const found = list.messages?.[0];
    if (found) {
      const mail = await (await fetch(`${MAIL_URL}/api/v1/message/${found.ID}`)).json();
      code = /\b(\d{6})\b/.exec(mail.Text ?? '')?.[1] ?? null;
    }
    if (!code) await sleep(250);
  }
  assert.ok(code, `no code arrived for ${email}`);
  const verified = await client.auth.verifyOtp({ email, token: code, type: 'email' });
  assert.equal(verified.error, null, `verifying the code failed: ${verified.error?.message}`);
  return { client, email, id: verified.data.user.id };
}

// The select the app's RoundsService uses (src/app/core/rounds.ts), word for word.
const ROUND_COLUMNS =
  'id, round_number, play_date, tee_time, status, holes, courses(id, name, short_name, photo_path), ' +
  'tees(id, name, yards, rating, slope, par, stroke_index, hole_yards), ' +
  'round_formats(format_key, settings, sort_order), ' +
  'groups(id, group_number, group_players(position, playing_handicap, ' +
  'player:trip_members(id, name, initials, handicap_index), scores(hole, strokes)))';

const today = new Date().toISOString().slice(0, 10);

test('a round, end to end: set up, scored from two phones live, retried without duplicates, finalized', async () => {
  // ── Three accounts; Fritz may create trips ──
  const fritz = await signIn('fritz-r');
  const dad = await signIn('dad-r');
  const brother = await signIn('brother-r');
  const stranger = await signIn('stranger-r');
  const made = await admin.from('trip_creators').insert({ name: 'Fritz', profile_id: fritz.id, claimed_at: new Date().toISOString() });
  assert.equal(made.error, null, made.error?.message);

  // ── The trip: 100% allowance, off the low man, three players ──
  const slug = `PGA${run}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const created = await fritz.client.rpc('create_trip', {
    p_name: `PGA National ${run}`,
    p_slug: slug,
    p_location: 'Palm Beach Gardens, FL',
    p_start_date: today,
    p_end_date: today,
  });
  assert.equal(created.error, null, created.error?.message);
  const trip = created.data;
  const rules = await fritz.client
    .from('trips')
    .update({ handicap_allowance: 1, strokes_off_low: true, timezone: 'America/New_York' })
    .eq('id', trip)
    .select('handicap_allowance, timezone')
    .single();
  assert.deepEqual(rules.data, { handicap_allowance: 1, timezone: 'America/New_York' }, rules.error?.message);
  const badZone = await fritz.client.from('trips').update({ timezone: 'Mars/Olympus' }).eq('id', trip);
  assert.ok(badZone.error, 'a made-up time zone is refused');

  const add = async (name, email, index) => {
    const res = await fritz.client.rpc('add_member', { p_trip_id: trip, p_name: name, p_email: email, p_handicap_index: index });
    assert.equal(res.error, null, res.error?.message);
    return res.data.id;
  };
  const dadId = await add('Dad', dad.email, 22.0);
  const brotherId = await add('Brother', brother.email, 9.4);
  const samId = await add('Sam', null, null);
  const roster = (await fritz.client.rpc('trip_roster', { p_trip_id: trip })).data;
  const fritzId = roster.find((p) => p.is_me).id;
  const setIndex = await fritz.client.rpc('set_member_index', { p_member_id: fritzId, p_handicap_index: 18.6 });
  assert.equal(setIndex.error, null, setIndex.error?.message);

  // ── The course library has PGA National's three courses, with rated tees ──
  const library = await fritz.client
    .from('courses')
    .select('id, name, tees(id, name, yards, rating, slope, par)')
    .ilike('name', 'Pga National Resort%')
    .order('name');
  assert.equal(library.error, null, library.error?.message);
  const names = library.data.map((c) => c.name).join(' | ');
  for (const course of ['Palmer', 'Fazio', 'Champion']) assert.match(names, new RegExp(course), `${course} is in the library`);
  const palmer = library.data.find((c) => c.name.includes('Palmer'));
  const tee = palmer.tees.filter((t) => t.rating && t.slope && t.par.length === 18).sort((a, b) => b.yards - a.yards)[0];
  assert.ok(tee, 'Palmer has 18-hole tees with a rating and slope');

  // ── Round setup ──
  const setup = (client, players, more = {}) =>
    client.rpc('save_round', {
      p_trip_id: trip,
      p_round_id: null,
      p_course_id: palmer.id,
      p_tee_id: tee.id,
      p_holes: '18',
      p_play_date: today,
      p_tee_time: '08:10',
      p_player_ids: players,
      p_nine_point: true,
      p_point_value_cents: 50,
      ...more,
    });
  const noIndex = await setup(fritz.client, [fritzId, dadId, samId]);
  assert.equal(noIndex.error?.message, "Add Sam's handicap index", 'a player with no index blocks round setup, by name');
  assert.equal(noIndex.error?.code, '23514');
  assert.ok((await setup(dad.client, [fritzId, dadId, brotherId])).error, 'a player cannot set up a round');
  const saved = await setup(fritz.client, [fritzId, dadId, brotherId]);
  assert.equal(saved.error, null, saved.error?.message);
  const round = saved.data;

  // ── Before the trip is published, players cannot see it or score ──
  assert.deepEqual((await dad.client.from('rounds').select('id').eq('trip_id', trip)).data, []);
  const published = await fritz.client.from('trips').update({ status: 'live' }).eq('id', trip).select('status').single();
  assert.equal(published.data?.status, 'live', published.error?.message);

  // ── The app's own query, as a player ──
  const read = async (client) => {
    const res = await client.from('rounds').select(ROUND_COLUMNS).eq('trip_id', trip).order('round_number');
    assert.equal(res.error, null, `the app's rounds query failed: ${res.error?.message}`);
    return res.data;
  };
  const [row] = await read(dad.client);
  assert.equal(row.holes, '18');
  assert.equal(row.tees.par.length, 18);
  assert.equal(row.tees.stroke_index.length, 18);
  assert.ok(row.tees.rating && row.tees.slope);
  assert.deepEqual(
    row.round_formats.sort((a, b) => a.sort_order - b.sort_order).map((f) => [f.format_key, f.settings]),
    [['stroke', {}], ['nine_point', { point_value_cents: 50 }]],
  );
  const group = row.groups[0].group_players.sort((a, b) => a.position - b.position);
  assert.deepEqual(group.map((gp) => [gp.player.name, Number(gp.player.handicap_index), gp.playing_handicap, gp.scores]), [
    ['Fritz', 18.6, null, []],
    ['Dad', 22, null, []],
    ['Brother', 9.4, null, []],
  ]);
  assert.equal((await dad.client.rpc('finalize_due_rounds', { p_trip_id: trip })).error, null);
  assert.ok((await stranger.client.rpc('finalize_due_rounds', { p_trip_id: trip })).error, 'not for someone off the trip');

  // ── Two phones: Brother's hears what Dad's enters ──
  const heard = [];
  const channel = brother.client
    .channel(`trip-${trip}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, (change) =>
      heard.push({ at: Date.now(), type: change.eventType, row: change.new }),
    );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime did not connect')), 15_000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  await sleep(1000); // Realtime needs a moment after joining before changes flow

  // The app's write: an upsert keyed by round, player and hole.
  const enter = (client, rows) => client.from('scores').upsert(rows, { onConflict: 'round_id,player_id,hole' });
  const score = (player, hole, strokes) => ({ round_id: round, player_id: player, hole, strokes });

  const sentAt = Date.now();
  const first = await enter(dad.client, [score(fritzId, 1, 5), score(dadId, 1, 6), score(brotherId, 1, 4)]);
  assert.equal(first.error, null, `anyone in the group enters for the group: ${first.error?.message}`);
  for (let i = 0; i < 50 && heard.length < 3; i++) await sleep(100);
  assert.equal(heard.length, 3, 'the other phone hears all three scores');
  const took = Math.max(...heard.map((h) => h.at)) - sentAt;
  console.log(`  Realtime: 3 scores reached the other phone in ${took} ms`);
  assert.ok(took < 5000, `scores should arrive within a couple of seconds (took ${took} ms)`);
  assert.deepEqual(
    heard.map((h) => [h.row.player_id, h.row.hole, h.row.strokes]).sort(),
    [[brotherId, 1, 4], [dadId, 1, 6], [fritzId, 1, 5]].sort(),
  );

  // ── A retry never duplicates; a change overwrites ──
  const count = async () => (await admin.from('scores').select('*', { count: 'exact', head: true }).eq('round_id', round)).count;
  assert.equal(await count(), 3);
  for (let i = 0; i < 3; i++) assert.equal((await enter(dad.client, [score(fritzId, 1, 5), score(dadId, 1, 6)])).error, null);
  assert.equal(await count(), 3, 'sending the same scores again adds nothing');
  assert.equal((await enter(brother.client, [score(dadId, 1, 7)])).error, null);
  assert.equal(await count(), 3);
  const dadsFirst = await admin.from('scores').select('strokes').eq('round_id', round).eq('player_id', dadId).eq('hole', 1).single();
  assert.equal(dadsFirst.data.strokes, 7, 'the later entry wins');

  // ── Nobody outside the trip can write or read ──
  assert.ok((await enter(stranger.client, [score(dadId, 2, 4)])).error, 'a stranger cannot enter a score');
  assert.deepEqual((await stranger.client.from('scores').select('strokes').eq('round_id', round)).data, []);
  assert.equal(await count(), 3);

  // ── The rest of the round, in one batch as the queue sends it after airplane mode ──
  const rest = [];
  for (let hole = 2; hole <= 18; hole++)
    for (const player of [fritzId, dadId, brotherId]) rest.push(score(player, hole, 4 + ((hole + player.charCodeAt(0)) % 3)));
  assert.equal((await enter(dad.client, rest)).error, null);
  assert.equal((await enter(dad.client, rest)).error, null, 'and the same batch again, as a retry');
  assert.equal(await count(), 54, '3 players × 18 holes, no duplicates');
  const scored = (await read(brother.client))[0].groups[0].group_players;
  assert.ok(scored.every((gp) => gp.scores.length === 18), 'the app query brings every score back');

  // ── Complete: it waits for midnight; the organizer finalizes; then it is closed ──
  await dad.client.rpc('finalize_due_rounds', { p_trip_id: trip });
  assert.equal((await read(dad.client))[0].status, 'scheduled', 'a complete round is not final before its day is over');
  assert.deepEqual((await dad.client.from('rounds').update({ status: 'final' }).eq('id', round).select('id')).data, [], 'a player cannot finalize');
  const final = await fritz.client.from('rounds').update({ status: 'final' }).eq('id', round).select('status');
  assert.equal(final.data?.[0]?.status, 'final', final.error?.message);
  assert.ok((await enter(dad.client, [score(dadId, 18, 3)])).error, 'a final round is closed to players');
  assert.equal((await enter(fritz.client, [score(dadId, 18, 5)])).error, null, 'the organizer can still fix a score');

  // ── A second round, and deleting the first renumbers it ──
  const second = await setup(fritz.client, [brotherId, fritzId, dadId], { p_holes: 'front', p_point_value_cents: 100 });
  assert.equal(second.error, null, second.error?.message);
  assert.deepEqual((await read(fritz.client)).map((r) => [r.round_number, r.holes]), [[1, '18'], [2, 'front']]);

  // ── The spectator link: the same rounds, with holes in play, and no point value ──
  const link = await fritz.client.functions.invoke('spectator-link', { body: { trip_id: trip, action: 'reset' } });
  assert.equal(link.error, null, link.error?.message);
  const watch = async () => (await admin.functions.invoke('spectate', { body: { token: link.data.token } })).data;
  let view = await watch();
  assert.deepEqual(view.rounds.map((r) => r.holes), ['18', 'front']);
  assert.equal(view.rounds[0].scores.length, 54);
  assert.equal(view.rounds[0].tee.par.length, 18);
  assert.deepEqual(view.rounds[0].formats.map((f) => [f.format_key, f.settings]), [['stroke', {}], ['nine_point', {}]]);
  await fritz.client.from('trips').update({ spectators_see_money: true }).eq('id', trip);
  view = await watch();
  assert.deepEqual(view.rounds[0].formats[1].settings, { point_value_cents: 50 }, 'winnings shown: the point value comes too');

  assert.ok((await dad.client.rpc('delete_round', { p_round_id: round })).error, 'a player cannot delete a round');
  assert.equal((await fritz.client.rpc('delete_round', { p_round_id: round })).error, null);
  assert.deepEqual((await read(fritz.client)).map((r) => [r.round_number, r.holes]), [[1, 'front']]);
  assert.equal(await count(), 0, 'its scores went with it');

  await brother.client.removeChannel(channel);
  for (const who of [fritz, dad, brother, stranger]) await who.client.removeAllChannels();
});
