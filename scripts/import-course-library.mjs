#!/usr/bin/env node
// One-off: looks up the course library seed list (docs/plan.md) on OpenGolfAPI and writes
//
//   supabase/seed/course-library.sql         the courses it could match with certainty
//   supabase/seed/course-library-report.md   what it imported, and everything it didn't and why
//
// It never guesses. A course is imported only when exactly one OpenGolf record in the right
// state has every word of the name, and that record has tees, pars and a full stroke index.
// When several records fit, the report lists them; put the id you want in PICKS and run again.
//
//   node scripts/import-course-library.mjs [--cache <dir>]
//
// OpenGolfAPI allows 500 requests a day; --cache keeps responses on disk so re-runs are free.
// Course data: OpenGolf (https://opengolfapi.org), ODbL 1.0.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.opengolfapi.org/v1';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = process.argv.includes('--cache') ? process.argv[process.argv.indexOf('--cache') + 1] : null;

// label: what the plan calls it · q: what to search · state · words: all must be in the record's
// name · not: none of these may be · unsure: why a lone match still needs your pick · skip: why
// it isn't looked up.
const IN_LIBRARY = 'Already in the library from the Southern Pines 2026 seed (checked against the official scorecards).';
const SEED_LIST = [
  { area: 'Pittsburgh', label: 'Sewickley Heights Golf Club', q: 'sewickley heights', state: 'PA', words: ['sewickley', 'heights'] },
  { area: 'Indiana', label: 'Victoria National', q: 'victoria national', state: 'IN', words: ['victoria', 'national'] },
  { area: 'Streamsong, FL', label: 'Streamsong Blue', q: 'streamsong', state: 'FL', words: ['streamsong', 'blue'] },
  { area: 'Streamsong, FL', label: 'Streamsong Red', q: 'streamsong', state: 'FL', words: ['streamsong', 'red'] },
  { area: 'Streamsong, FL', label: 'Streamsong Black', q: 'streamsong', state: 'FL', words: ['streamsong', 'black'] },
  { area: 'Streamsong, FL', label: 'Streamsong Bone Valley', q: 'streamsong', state: 'FL', words: ['streamsong', 'bone', 'valley'] },
  { area: 'Vero Beach, FL', label: 'Sandridge Dunes', q: 'sandridge', state: 'FL', words: ['sandridge', 'dunes'] },
  { area: 'Vero Beach, FL', label: 'Sandridge Lakes', q: 'sandridge', state: 'FL', words: ['sandridge', 'lakes'] },
  { area: 'Port St. Lucie, FL', label: 'PGA Golf Club Wanamaker', q: 'pga golf club', state: 'FL', words: ['pga', 'wanamaker'] },
  { area: 'Port St. Lucie, FL', label: 'PGA Golf Club Ryder', q: 'pga golf club', state: 'FL', words: ['pga', 'ryder'] },
  { area: 'Port St. Lucie, FL', label: 'PGA Golf Club Dye', q: 'pga golf club', state: 'FL', words: ['pga', 'dye'] },
  { area: 'Palm Beach Gardens, FL', label: 'PGA National Champion', q: 'pga national', state: 'FL', words: ['pga', 'national', 'champion'] },
  { area: 'Palm Beach Gardens, FL', label: 'PGA National Fazio', q: 'pga national', state: 'FL', words: ['pga', 'national', 'fazio'] },
  { area: 'Palm Beach Gardens, FL', label: 'PGA National Palmer', q: 'pga national', state: 'FL', words: ['pga', 'national', 'palmer'] },
  { area: 'Sandhills, NC', label: 'Southern Pines', skip: IN_LIBRARY },
  { area: 'Sandhills, NC', label: 'Mid Pines', skip: IN_LIBRARY },
  { area: 'Sandhills, NC', label: 'Pine Needles', skip: IN_LIBRARY },
  { area: 'Sandhills, NC', label: 'Tot Hill Farm', skip: IN_LIBRARY },
  { area: 'Sandhills, NC', label: 'Tobacco Road', q: 'tobacco road', state: 'NC', words: ['tobacco', 'road'] },
  ...[2, 3, 4, 5, 7, 8, 10].map((n) => ({ area: 'Pinehurst, NC', label: `Pinehurst No. ${n}`, q: 'pinehurst', state: 'NC', words: ['pinehurst'], number: n })),
  { area: 'Dormie Network', label: 'ArborLinks (NE)', q: 'arborlinks', state: 'NE', words: ['arborlinks'] },
  { area: 'Dormie Network', label: 'Ballyhack (VA)', q: 'ballyhack', state: 'VA', words: ['ballyhack'] },
  { area: 'Dormie Network', label: 'Briggs Ranch (TX)', q: 'briggs ranch', state: 'TX', words: ['briggs', 'ranch'] },
  { area: 'Dormie Network', label: 'Dormie Club (NC)', q: 'dormie club', state: 'NC', words: ['dormie', 'club'] },
  { area: 'Dormie Network', label: 'Hidden Creek (NJ)', q: 'hidden creek', state: 'NJ', words: ['hidden', 'creek'] },
  { area: 'Dormie Network', label: 'Hunting Hawk (VA)', q: 'hunting hawk', state: 'VA', words: ['hunting', 'hawk'] },
  { area: 'Dormie Network', label: 'GrayBull (NE)', q: 'graybull', state: 'NE', words: ['graybull'] },
  { area: 'Kohler, WI', label: 'Whistling Straits: Straits', q: 'whistling straits', state: 'WI', words: ['whistling', 'straits'], not: ['irish'],
    unsure: 'The record is named for the whole club, so it may not be the Straits course. Check its card, then pick it.' },
  { area: 'Kohler, WI', label: 'Whistling Straits: Irish', q: 'whistling straits', state: 'WI', words: ['whistling', 'straits', 'irish'] },
  { area: 'Kohler, WI', label: 'Blackwolf Run: River', q: 'blackwolf run', state: 'WI', words: ['blackwolf', 'river'] },
  { area: 'Kohler, WI', label: 'Blackwolf Run: Meadow Valleys', q: 'blackwolf run', state: 'WI', words: ['blackwolf', 'meadow'] },
  { area: 'Near Kohler, WI', label: 'Erin Hills', q: 'erin hills', state: 'WI', words: ['erin', 'hills'] },
  { area: 'Near Kohler, WI', label: 'Lawsonia: Links', q: 'lawsonia', state: 'WI', words: ['lawsonia', 'links'] },
  { area: 'Near Kohler, WI', label: 'Lawsonia: Woodlands', q: 'lawsonia', state: 'WI', words: ['lawsonia', 'woodlands'] },
  { area: 'Sand Valley, WI', label: 'Sand Valley', q: 'sand valley', state: 'WI', words: ['sand', 'valley'], not: ['mammoth', 'lido', 'sedge', 'sandbox'] },
  { area: 'Sand Valley, WI', label: 'Mammoth Dunes', q: 'mammoth dunes', state: 'WI', words: ['mammoth', 'dunes'] },
  { area: 'Sand Valley, WI', label: 'Lido', q: 'lido', state: 'WI', words: ['lido'] },
  { area: 'Sand Valley, WI', label: 'Sedge Valley', q: 'sedge valley', state: 'WI', words: ['sedge', 'valley'] },
  { area: 'Sand Valley, WI', label: 'The Sandbox (par 3)', q: 'sandbox', state: 'WI', words: ['sandbox'] },
];

// Your choice where several records fit: label → OpenGolf course id (from the report).
const PICKS = {
  // 'Pinehurst No. 4': '00000000-0000-0000-0000-000000000000',
};

let requests = 0;
async function get(path) {
  const file = cacheDir && join(cacheDir, createHash('sha1').update(path).digest('hex') + '.json');
  if (file && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  requests++;
  const res = await fetch(API + path, { headers: { 'User-Agent': 'course-library-import/1.0' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OpenGolfAPI ${res.status} for ${path} (the daily limit is 500 requests)`);
  const body = await res.json();
  if (file) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(file, JSON.stringify(body));
  }
  await new Promise((r) => setTimeout(r, 150));
  return body;
}

const words = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
function fits(entry, name) {
  const w = words(name);
  if (!entry.words.every((x) => w.includes(x))) return false;
  if (entry.not?.some((x) => w.includes(x))) return false;
  // "No. 2" must be the number 2 as its own word: not 12, and not No. 10 for No. 1.
  if (entry.number !== undefined && !w.includes(String(entry.number))) return false;
  return true;
}

const isPermutation = (a) => [...a].sort((x, y) => x - y).every((v, i) => v === i + 1);

/** Full data for one record, with what (if anything) is missing. */
async function load(id) {
  const [course, teesBody, holesBody] = [await get(`/courses/${id}`), await get(`/courses/${id}/tees`), await get(`/courses/${id}/holes`)];
  const tees = teesBody?.tees ?? [];
  const holes = [...(holesBody?.holes ?? [])].sort((a, b) => a.number - b.number);
  const par = holes.map((h) => h.par);
  const si = holes.map((h) => h.handicap_index);
  const missing = [];
  if (!tees.length) missing.push('no tees');
  if (!holes.length || !par.every((p) => Number.isInteger(p) && p >= 3 && p <= 6)) missing.push('no hole pars');
  if (!holes.length || !isPermutation(si)) missing.push('no stroke index');
  return { course, tees, holes, par, si, missing };
}

const sql = (v) => (v === null || v === undefined || v === '' ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => `'{${a.join(',')}}'`;

function courseSql({ course, tees, holes, par, si }) {
  const location = [course.city, course.state].filter(Boolean).join(', ') || null;
  const seen = new Set();
  const rows = [];
  for (const tee of tees) {
    const name = /^f/i.test(tee.gender ?? '') ? `${tee.tee_name} (W)` : tee.tee_name;
    if (seen.has(name.toLowerCase())) continue; // the same tee listed twice
    seen.add(name.toLowerCase());
    const color = (tee.tee_color ?? tee.tee_name).toLowerCase();
    const yards = holes.map((h) => h.yardages?.[color]);
    const holeYards = yards.every((y) => Number.isInteger(y) && y > 0) ? arr(yards) : 'null';
    rows.push(`  (${sql(name)}, ${sql(tee.yardage)}, ${sql(tee.course_rating)}, ${sql(tee.slope)}, ${arr(par)}::smallint[], ${arr(si)}::smallint[], ${holeYards}::smallint[])`);
  }
  return `-- ${course.name} (${location ?? 'location unknown'})
insert into public.courses (name, location, architect, year_opened, description, website_url, source, source_ref, ratings_checked_at)
values (${sql(course.name)}, ${sql(location)}, ${sql(course.architect)}, ${sql(course.year_built)}, ${sql(course.description)}, ${sql(course.website)}, 'opengolfapi', ${sql(course.id)}, now())
on conflict do nothing;
insert into public.tees (course_id, name, yards, rating, slope, par, stroke_index, hole_yards)
select c.id, v.name, v.yards, v.rating, v.slope, v.par, v.stroke_index, v.hole_yards
from (values
${rows.join(',\n')}
) as v (name, yards, rating, slope, par, stroke_index, hole_yards)
join public.courses c on c.source = 'opengolfapi' and c.source_ref = ${sql(course.id)}
on conflict do nothing;
`;
}

const describe = (c, extra = '') => `\`${c.id}\` ${c.name} · ${[c.city, c.state].filter(Boolean).join(', ')}${c.par ? ` · par ${c.par}` : ''}${extra}`;

const imported = [];
const ambiguous = [];
const incomplete = [];
const unmatched = [];
const skipped = [];
const statements = [];

for (const entry of SEED_LIST) {
  if (entry.skip) {
    skipped.push(`- **${entry.label}**: ${entry.skip}`);
    continue;
  }
  const found = (await get(`/courses/search?q=${encodeURIComponent(entry.q)}&state=${entry.state}`))?.courses ?? [];
  let candidates = found.filter((c) => c.state === entry.state && fits(entry, c.name));

  const pick = PICKS[entry.label];
  if (pick) candidates = candidates.filter((c) => c.id === pick);

  if (candidates.length === 0) {
    const near = found.filter((c) => c.state === entry.state).slice(0, 5);
    unmatched.push(`- **${entry.label}** (searched "${entry.q}" in ${entry.state})${pick ? ` — the pick \`${pick}\` was not among the results` : ''}${near.length ? '\n' + near.map((c) => `  - not matched: ${describe(c)}`).join('\n') : ''}`);
    continue;
  }
  if (candidates.length > 1 || (entry.unsure && !pick)) {
    const lines = [];
    for (const c of candidates) {
      const data = await load(c.id);
      lines.push(`  - ${describe(c, ` · ${data.tees.length} tees${data.missing.length ? ` · ${data.missing.join(', ')}` : ' · complete'}`)}`);
    }
    const count = candidates.length === 1 ? `1 match, unconfirmed. ${entry.unsure}` : `${candidates.length} matches`;
    ambiguous.push(`- **${entry.label}** → ${count}\n${lines.join('\n')}`);
    continue;
  }
  const data = await load(candidates[0].id);
  if (data.missing.length) {
    incomplete.push(`- **${entry.label}** → ${describe(candidates[0])} · ${data.missing.join(', ')}`);
    continue;
  }
  statements.push(courseSql(data));
  imported.push(`- **${entry.label}** → ${describe(candidates[0], ` · ${data.tees.length} tees`)}`);
  console.log(`ok   ${entry.label}`);
}

const section = (title, note, lines) => (lines.length ? `## ${title} (${lines.length})\n\n${note}\n\n${lines.join('\n')}\n\n` : '');
const report = `# Course library import report

Generated by \`scripts/import-course-library.mjs\` on ${new Date().toISOString().slice(0, 10)}. Course data: OpenGolf (ODbL 1.0).
${SEED_LIST.length} courses on the seed list: ${imported.length} imported, ${ambiguous.length} ambiguous, ${incomplete.length} incomplete at the source, ${unmatched.length} not found, ${skipped.length} already in the library.

${section('Ambiguous: pick one', 'More than one OpenGolf record fits, or the only one cannot be confirmed from its name. Put the id you want in `PICKS` in the script and run it again, or add the course from the app (Course library → Add a course).', ambiguous)}${section('Found, but incomplete at the source', 'One record fits, but it lacks data the app needs, so it was not imported. Add it from the app and fill the gaps from the scorecard.', incomplete)}${section('Not found', 'Nothing in the right state has every word of the name. Add these by hand from the app.', unmatched)}${section('Imported', 'In `course-library.sql`. Spot-check ratings and slopes against the USGA database before a trip uses them.', imported)}${section('Already in the library', 'Not looked up.', skipped)}`;

const header = `-- Course library: the seed list from docs/plan.md, as matched on OpenGolfAPI.
-- Generated by scripts/import-course-library.mjs; do not edit by hand (edit courses in the app).
-- Course data: OpenGolf (https://opengolfapi.org), ODbL 1.0. See course-library-report.md for
-- what was not imported and why. Safe to run more than once: existing courses are left alone.

`;
writeFileSync(join(ROOT, 'supabase/seed/course-library.sql'), header + statements.join('\n'));
writeFileSync(join(ROOT, 'supabase/seed/course-library-report.md'), report);
console.log(`\n${imported.length} imported · ${ambiguous.length} ambiguous · ${incomplete.length} incomplete · ${unmatched.length} not found · ${skipped.length} skipped · ${requests} API requests`);
