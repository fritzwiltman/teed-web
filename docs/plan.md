# Teed — Build Plan

Markdown copy of the build plan (source: https://claude.ai/artifact/EjFNgELk12pGAnNS5CpSZu), exported Nov 18, 2026, then
updated in the repo for the M1 schema and M2 login as built. The claude.ai doc is the master: sync it from the
Schema and Login sections here. Wireframes: https://claude.ai/artifact/CAMT8mmSpgajXZkR5YPbBL

Current setup: repo `fritzwiltman/teed-web`, Cloudflare Worker `teed` at https://teed.fgwilt1.workers.dev,
Supabase project `https://mhfuxacwpzzthethgfcp.supabase.co`.

## Overview

A free, reusable live-scoring web app for golf trips: players log in with a personal code, enter scores hole by hole
for themselves or their foursome, and watch a live leaderboard with push alerts. One deployment serves every trip;
a new trip is a few minutes of admin setup, not a new app.

| Layer | Choice | Cost |
| --- | --- | --- |
| Front end | Angular PWA (installable to iPhone home screen) | $0 |
| Hosting | Cloudflare Worker with static assets (`teed.fgwilt1.workers.dev`) | $0 |
| Database, realtime, auth, server functions | Supabase free tier | $0 |
| Notifications | Web Push (VAPID) sent from a Supabase Edge Function | $0 |
| Source control, CI | GitHub repo, auto-deploy on merge to `main` | $0 |

Principles:

- **Design before code.** Build from the approved wireframes.
- **Offline first on the course.** Scores save on the phone and sync when signal returns.
- **One app, many trips.** Every record belongs to a trip; codes only open their own trip.
- **Small, reviewable steps.** One milestone per session, each ending in a working deploy.

## Screens (from the wireframes)

1. **Login:** one field for the player or spectator code (e.g. `VERO-FW27-K4M9`), big "Join trip" button. "Add to Home
   Screen" hint on first visit with browser-specific steps (iPhone Safari/Chrome: Share → Add to Home Screen, with a
   short looping GIF; Android Chrome: one-tap Install). Hidden once launched from the home screen.
2. **Trip home:** course photo, today's round (time, format, tees, course, group), big "Continue scoring · Hole N",
   leaderboard snapshot, trip info link.
3. **Trip (Itinerary · Courses · Logistics · Players):** itinerary by day (lodging, meals with reservations, rounds,
   optional TV line), course cards (photo, architect/year, drive time, par/tees/yards/rating/slope, description,
   website/scorecard/directions), logistics (lodging, getting there, per-person costs), roster.
4. **Trip checklist:** to-dos with a status per player (buy-in paid, handicap confirmed, app installed).
5. **Handicap check-in:** players enter GHIN number and index before a deadline; locks on that date; admin can override.
6. **Scorecard:** one hole at a time; header with hole number (tap → hole picker), par, yards, stroke index.
   "Whole group / Me + partner / Just me" switch decides which rows this phone keeps. Your rows have −/+ and start at
   par (grey until confirmed; tap the number to confirm par; unconfirmed pars save when you move on). Other rows are
   read-only and live ("Entered on Jack's phone"), with "Score for <name>" takeover. One dot per handicap stroke on
   the hole, "+1" for plus handicaps. + stops at net double bogey ("Picked up · net double bogey").
   **Hole complete:** every row checked, green "Hole N complete · all 4 scores in" banner, Next button turns green.
7. **Hole picker:** 18-hole grid: ✓ scored, ! missing a score, current hole; tap to jump.
8. **Leaderboard:** round switcher (R1 · R2 Live · R3 · Trip), Net/Gross, columns Pos · Player · Net · Thru;
   under par in red with the minus sign; skins summary; "How these games work".
9. **Game rules:** plain-English explanation of each format in the round, with chosen settings and house rules.
10. **Notifications prompt:** explain alerts, then "Allow" (iOS requires a tap, installed app only).
11. **Admin:** My trips → Admin home (DRAFT banner until live) → Trip details, Roster and codes, Rounds,
    Groups and teams, Course library (search/import), Itinerary editor (phone and two-pane desktop), Proposed changes.

## Phase 1: GitHub repo (done)

- `fritzwiltman/teed-web`, public (the publishable key is public by design; security is RLS).
- Ruleset "protect main": PR required (0 approvals), block force pushes and deletion; add the Cloudflare build
  status check once it appears. Auto-delete merged branches.
- Only Fritz pushes; Claude Code works on branches and opens PRs; Fritz merges.

## Phase 2: Supabase

Free tier: 500 MB database, 2 active projects, projects pause after 1 week of inactivity. Done so far: project
created (US East), Data API on, RLS on new tables automatically, anonymous sign-ins on, email on (admin magic link),
`ping()` function, keep-alive GitHub Action (every 3 days) verified.

**Schema** (as built in `supabase/migrations`; helper functions and rate-limit tables live in a `private` schema
the Data API doesn't expose)

| Table | Key columns |
| --- | --- |
| `app_admins` | user id. Who may create trips and edit the course library (email sign-up is open, so it's an explicit list) |
| `trips` | owner, name, slug (`VERO`), dates, status (draft/live/final), theme, house rules (handicap allowance, strokes off low man, pick-up at net double, spectators see money, handicap lock date), banker, owner's player (display only) |
| `players` | trip, name, initials, role (player/co-admin), handicap index, index entered/locked at. No codes or GHIN numbers here: everyone on the trip can read this table |
| `player_codes` | player, code, issued at. Trip admins only |
| `player_ghin` | player, GHIN number. Players and admins, never spectators |
| `spectator_codes` | trip, code, label, enabled. Trip admins only |
| `trip_sessions` | auth user, trip, player **or** spectator code. Written only by `redeem-code`. One player can have several (Safari and the home-screen app are separate anonymous users) |
| `courses` | name, short name, location, architect, year, description, links, photo, source + ratings_checked_at |
| `tees` | course, name, yards, rating, slope; par, stroke index and yards per hole (arrays) |
| `rounds` | trip, number, course, tee, date, tee time, status (scheduled/live/final), pairings TBD flag, drive note |
| `round_formats` | round, format key, settings (stakes, presses, carryover, pot split, Sixes rotation) |
| `groups` / `group_players` | round, number, tee time; player with position, team (A/B) and optional GHIN course/playing handicap overrides (GHIN applies the allowance to the unrounded course handicap, so computing it can be off by one) |
| `scores` | round, player, hole, strokes, entered by (user and player), timestamps; primary key round + player + hole |
| `score_history` | every insert, update and delete of a score, with the previous value |
| `presses` | round format, group, bet (`front`/`back`/`overall`, `m1`–`m3`), after hole. Entered by players mid-round, like scores |
| `itinerary_items` | trip, day, time, type (lodging, meal, activity, tv, travel, cost, note), title, details per type, optional player |
| `tasks` / `task_status` | trip checklist (with a "players can tick this themselves" flag) and per-player status |
| `itinerary_proposals` | trip, payload, source, status (pending/approved/rejected) |
| `push_subscriptions` | auth user, trip, endpoint, keys |

**Login and security**

- Players and spectators: the phone signs in anonymously, then edge function `redeem-code` links that session to
  a player (or a read-only spectator) on a **live** trip and returns the trip and player. The link is a
  `trip_sessions` row; the app also caches it so it opens with no signal.
- Codes: trip slug + initials + 2-digit year + 4 random characters (`VERO-FW27-K4M9`, no I/O/0/1); typed in any
  case, with or without dashes. Regenerating or revoking a code signs out every phone that used it.
- Rate limit on failed codes: 5 a minute per device, 30 a minute per IP (looser, since a group shares one Wi-Fi
  address), then a 5-minute lockout.
- Owner (Fritz): email magic link, listed in `app_admins`. Owner-only: creating and deleting trips, the course
  library, login codes, deleting players or rounds. `trips.owner_player_id` marks the owner's player so trip home
  can show "Owner"; it grants nothing, and the owner's player code logs in with ordinary player rights.
- Co-admins: any player, per trip, acting through their code: pairings, score fixes, rounds and trip info.
- RLS everywhere: players read only their trip (once it is live or final) and write scores and presses only for
  their group while the trip is live and the round isn't final; spectators read-only and never see GHIN numbers,
  codes or the checklist; only owner/co-admins write setup. Handicap check-in goes through `submit_handicap()`.
- Spectators and money: `spectators_see_money` (off by default) hides itinerary cost lines. TODO: stakes in
  `round_formats.settings` are still readable by spectators; hiding payouts fully needs a separate stakes table.

**Roster:** admin adds players (no self sign-up); can edit names/handicaps any time; replacing a player revokes the
old code, issues a new one, and keeps the slot's tee times, group and team.

**Groups, teams, late pairings:** presets Balance by handicap, Shuffle, Same as previous round, Seed from standings
(after a chosen round, by money/points/net); then tap two names to swap. Pairings can stay TBD. Groups lock when the
round starts (admin can still change).

**Courses:** reusable library; import from OpenGolfAPI (free, ODbL, attribution required) with tees, rating, slope,
par, stroke index; Refresh re-pulls and flags changes; trip courses re-checked ~2 weeks out; spot-check against the
USGA Course Rating and Slope Database before the handicap lock. Photos in Supabase Storage.

**Handicaps:** GHIN has no public API; players enter index in check-in, admin spot-checks. Course handicap =
index × slope ÷ 113 + (rating − par), then the format allowance (e.g. 90%), optionally off the low man.

**Trip info editing:** typed itinerary items feed the right views; rounds come from round setup. Itinerary editor
(two-pane on desktop, stacked on phone) plus a **Proposed changes** inbox fed by edge function `itinerary-propose`
(anything holding the trip's admin key; nothing changes until approved). Later: paste-a-confirmation parsing;
players proposing their own travel details.

**Realtime:** on `scores`; leaderboards subscribe. **Backups:** export each trip's scores to `data/` after the trip.

## Phase 3: Cloudflare (done)

Worker `teed` (Workers Builds from `main`): build `npm run build`, deploy `npx wrangler deploy`, preview
`npx wrangler preview` on PR branches. `wrangler.jsonc` serves `dist/teed/browser` with SPA fallback.
The URL is locked: home-screen installs are tied to it.

## Phase 4: Build milestones

| # | Milestone | Done when |
| --- | --- | --- |
| M1 | Schema, RLS policies, seed: Southern Pines 2026 trip (4 courses, tees, ratings, players, handicaps, real gross scores and formats from the old site) | `supabase db push` succeeds; RLS tests pass |
| M2 | Code login (`redeem-code` + login screen) | A test code logs in on an iPhone and lands on trip home |
| M3 | Admin: trips, roster, courses (+ seed list import), rounds, groups, code generator | A full trip set up without SQL |
| M4 | Scorecard for the foursome | Scores save per hole; teammates see edits |
| M5 | Offline queue | Airplane-mode scores sync with no duplicates |
| M6 | Live round and trip leaderboards (gross and net) | Two phones update within seconds |
| M7 | Push notifications | See Phase 5 |
| M8 | Polish: icons, splash, install hint, dark mode | Installs cleanly from Safari |

Target: M1–M6 by Jan 1, 2027; test round Jan 2–3; codes out by Jan 6; trip ~Jan 11–15 (Vero Beach, 4 players).

**Formats as plug-ins:** each format = settings + pure scoring function over raw hole strokes + rules text.

| Format | Group size | Engine must handle |
| --- | --- | --- |
| Individual net stroke play | Any | Net per hole from course handicap and stroke index |
| Individual net Stableford | Any | Points per hole from net score |
| 2v2 Nassau | 4 | 2-man best ball; front, back, overall; tied hole: push (default), carry over, or 2nd ball; presses |
| Sixes | 4 | Partners rotate every 6 holes; three matches; presses |
| 2-man scramble | 4 | One team score per hole; team handicap % |
| 2-man alternate shot | 4 | One team score per hole; team handicap % |
| Wolf | 3 or 4 | Rotation; wolf picks partner or lone; setting for who is wolf on 17–18 in a 4-some |
| 9-point game | 3 | 5-3-1; two tied 1st 4-4-1; two tied 2nd 5-2-2; all tied 3-3-3 |

- House rule: pick up at net double bogey (par + 2 + strokes received), on by default.
- **Presses** (match formats only): off, manual, auto when closed out, auto when dormie, auto both; per bet in Nassau.
- **Ryder Cup** (trip level): two teams; matches worth 1 (½ halve); live match status.
- **Skins** add-on per round: gross or net, carryovers optional. **Pots:** buy-in × players split by % across games;
  payouts view.
- Later: **side matches** (e.g. Fritz vs Ben, net Nassau) computed from existing scores.

## Phase 5: Push notifications

VAPID keys (private in Supabase secrets); prompt after login on an installed app; database webhook on `scores` →
edge function `notify`; send to the trip except the enterer; drop "gone" subscriptions. Alerts: birdie or better;
new leader (only after every group is through 2 holes, judged on score to par); a group finishes; final results.

## Phase 6: Testing and trip readiness

- [ ] Install from Safari on two iPhones and one Android
- [ ] Log in with codes after installing (home-screen storage is separate)
- [ ] Full 18 for a foursome, including fixing someone else's score
- [ ] Airplane mode for three holes, then confirm sync
- [ ] Two phones watch the leaderboard live
- [ ] Push alert on a locked iPhone
- [ ] Southern Pines 2026 rerun reproduces the old site's standings and settle-up (90%, off the low man)
- [ ] Supabase awake the week of the trip
- [ ] Codes texted with a one-line install guide (sms: link prefilled; free)
- [ ] Scores exported to the repo after the trip

## Course library seed list (M3)

| Area | Courses |
| --- | --- |
| Pittsburgh | Sewickley Heights Golf Club |
| Indiana | Victoria National |
| Streamsong, FL | Blue, Red, Black, Bone Valley |
| Vero Beach, FL | Sandridge: Dunes, Lakes |
| Port St. Lucie, FL | PGA Golf Club: Wanamaker, Ryder, Dye |
| Palm Beach Gardens, FL | PGA National: Champion, Fazio, Palmer |
| Sandhills, NC | Southern Pines, Mid Pines, Pine Needles, Tobacco Road, Tot Hill Farm |
| Pinehurst, NC | No. 2, No. 3, No. 4, No. 5, No. 7, No. 8, No. 10 |
| Dormie Network | ArborLinks (NE), Ballyhack (VA), Briggs Ranch (TX), Dormie Club (NC), Hidden Creek (NJ), Hunting Hawk (VA); GrayBull (NE) when open; confirm roster on import |
| Kohler, WI | Whistling Straits: Straits, Irish; Blackwolf Run: River, Meadow Valleys |
| Near Kohler, WI | Erin Hills; Lawsonia: Links, Woodlands |
| Sand Valley, WI | Sand Valley, Mammoth Dunes, Lido, Sedge Valley, The Sandbox (par 3) |

## Theme

Theme A "Scorecard" default: Bitter headings, IBM Plex Mono numbers/labels, Libre Franklin body; card stock
`#F1EBDC`, ink `#1C2B22`, pine `#1F4D36`, under-par red `#B3392F`; dark frames with light inner lines; floating pill
nav with a filled active pill; dark mode (pine-black `#141B16`, cream text `#ECE5D3`, coral-red `#EE7A6D`).
Follows the phone's light/dark setting with an override. Coastal is the first alternate; later, per-trip themes
change tokens only.

## Open decisions

- [ ] Spectators and money: should spectators see pots, payouts and buy-ins by default? (Per-trip toggle either way.)
