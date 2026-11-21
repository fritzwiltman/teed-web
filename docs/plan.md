# Teed — Build Plan

Markdown copy of the build plan (source: https://claude.ai/artifact/EjFNgELk12pGAnNS5CpSZu), exported Nov 18, 2026, then
updated in the repo for the M1 schema, the Nov 19 design review (M3.5) and accounts and roles (M3.6) as built. The claude.ai doc
is the master: sync it from the Design review, Schema, Sign-in and Permissions sections here. Wireframes: https://claude.ai/artifact/CAMT8mmSpgajXZkR5YPbBL

Current setup: repo `fritzwiltman/teed-web`, Cloudflare Worker `teed` at https://teed.fgwilt1.workers.dev,
Supabase project `https://mhfuxacwpzzthethgfcp.supabase.co`.

## Overview

A free, reusable live-scoring web app for golf trips: players sign in with an emailed code (invited by a texted link), enter scores hole by hole
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
- **One app, many trips.** Every record belongs to a trip; you see only the trips you are on.
- **Small, reviewable steps.** One milestone per session, each ending in a working deploy.

## Design review decisions (Nov 19)

The wireframes' Player, Organizer and Design system pages are the spec. Where this plan and the wireframes disagree, the wireframes win.
M3.6 replaced the codes below with accounts and "co-admins" with co-organizers: see "Sign-in, accounts and roles" in Phase 2.

- **Theme:**
  - Tour, light and dark from the phone's setting.
  - Build a token file and shared components first; screens only compose them.
  - Skeletons for loading content; spinners only inside a button or a sync line.
- **Screens render data, never a format.** The "today's game" card, leaderboards and breakdowns take rows that each format plug-in supplies. No screen hard-codes Sixes, Nassau or any other format.
- **Only pertinent info on screen.**
  - No labels that explain how the app works, and no app-computed drive or leave times.
  - Every day header reads "Label · Ddd, Mon D".
- **Login:**
  - Browser-first, with 6-character codes sent as a texted join link.
  - "Add to Home Screen" is a strongly suggested, skippable step after the link, plus a home-page reminder until installed. On iPhone, push only works from the Home Screen app.
  - "Paste my code" if the Home Screen app opens signed out.
  - The alerts permission is asked after install, from a button tap.
- **Home page states:**
  - Travel day: the next item up and the house.
  - Before your tee time: a countdown to that player's own tee time, "Start scoring" about 30 minutes out, and the game card.
  - During a round: "Continue scoring" and the live mini board.
  - After the round: your finish, winnings and "See breakdown".
  - After the trip: winnings only.
  - Each state is followed by Rest of today and Tomorrow; there's no whole-trip overview.
- **Live dot:** a blinking red dot marks a live round on the course photo, the leaderboard tab and the home mini board. It stops for Reduce Motion.
- **Round lifecycle:** Scheduled → Live → Complete → Final.
  - Live starts with the first score.
  - Complete means every player has every hole; a pickup counts.
  - Final happens when the organizer taps Finalize after reviewing flags (e.g. late score changes), or automatically at midnight.
  - Final locks scores (the organizer can still fix one, with history), makes results official and sends a "Round final" alert.
  - The organizer can mark a player "Didn't finish", end a round early after hole N, or reopen a final round.
- **Money:**
  - Buy-ins only, so money is winnings from the pot, never negative.
  - "See breakdown" shows where each dollar came from. Payment stays outside the app.
  - Buy-ins: a dollar amount per round on the trip, and a paid checkbox per player that only the organizer and co-admins can tick.
  - Everyone can see who's paid: a home card until all have paid, and always under Trip › Info.
- **Round setup:**
  - 18 holes, front 9 or back 9.
  - Handicap settings are trip defaults that any round can override.
  - Formats can bring their own rule: a scramble's team handicap is A% of the low player plus B% of the high.
  - Rounds store only their overrides.
- **Pairings:**
  - Manual, Random or Balanced.
  - Every name is a tappable button; tap one, then another, to swap, with Undo.
  - Swaps work across teams and groups.
- **Itinerary:** anyone on the trip can suggest a change; only the organizer and co-admins edit or approve (enforced in RLS).
- **Alerts:**
  - Three levels for organizer announcements: Announcement (green), Important (amber) and Urgent (red, sent time-sensitive).
  - Saving a tee time or itinerary change offers "Notify everyone?"
- **Organizer mode:**
  - Its own docked tab bar: Overview · Rounds · People · Itinerary.
  - "Publish", then a separate prompt to text everyone their link.
  - Trip badges read Draft, Upcoming, In progress or Final (from the status and the dates). "Live" and the red dot
    only ever mean a round in play: at least one score in, and not final.
- **Trip tab:** Itinerary · Courses · Info (stay, buy-ins, house rules).

## Screens (from the wireframes)

Written before the design review. Where a screen below disagrees with the decisions above, the decisions win.


1. **Login:** (superseded by M3.6: sign in with an emailed 6-digit code.) Was: one field for the player or spectator code, big "Join trip" button. "Add to Home
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
created (US East), Data API on, RLS on new tables automatically, email sign-in with one-time codes (anonymous
sign-ins off since M3.6; setup steps in `docs/setup-auth.md`),
`ping()` function, keep-alive GitHub Action (every 3 days) verified.

**Schema** (as built in `supabase/migrations`; helper functions live in a `private` schema the Data API doesn't
expose)

| Table | Key columns |
| --- | --- |
| `profiles` | one per signed-in person: display name, email (follows the verified sign-in email), current handicap index, `is_admin` (set by SQL only) |
| `trip_creators` | who may create trips, besides the app admin: name, phone, the profile once their invite is claimed. App admin only |
| `trips` | name, slug (an internal handle made from the name), dates, status (draft/live/final), theme, house rules (handicap allowance, strokes off low man, pick-up at net double, spectators see winnings, handicap lock date), banker, buy-in amount, reopened at |
| `trip_members` | (was `players`) trip, name, initials, role (organizer/co-organizer/player), profile (null until the invite is claimed), email as entered, invite token hash, the trip's own handicap index and when it locked, buy-in paid. Exactly one organizer per trip. Clients read only the roster columns; email and invite state come through `trip_roster()` to the organizer and co-organizers |
| `player_ghin` | member, GHIN number |
| `member_contacts` | member, mobile number (for texting their invite). Organizer and co-organizers |
| `spectator_links` | trip, nonce, token hash. No client access: the edge functions derive the link from a server secret and the nonce |
| `courses` | name, short name, location, architect, year, description, links, photo, source + ratings_checked_at |
| `tees` | course, name, yards, rating, slope; par, stroke index and yards per hole (arrays) |
| `rounds` | trip, number, course, tee, date, tee time, status (scheduled/live/final), pairings TBD flag, drive note |
| `round_formats` | round, format key, settings (stakes, presses, carryover, pot split, Sixes rotation) |
| `groups` / `group_players` | round, number, tee time; member (`player_id`) with position, team (A/B) and optional GHIN course/playing handicap overrides (GHIN applies the allowance to the unrounded course handicap, so computing it can be off by one) |
| `scores` | round, player, hole, strokes, entered by (user and member), timestamps; primary key round + player + hole |
| `score_history` | every insert, update and delete of a score by anyone: who, when, old and new value |
| `presses` | round format, group, bet (`front`/`back`/`overall`, `m1`–`m3`), after hole. Entered by players mid-round, like scores |
| `itinerary_items` | trip, day, time, type (lodging, meal, activity, tv, travel, cost, note), title, details per type, optional player |
| `tasks` / `task_status` | trip checklist (with a "players can tick this themselves" flag) and per-player status |
| `itinerary_proposals` | trip, payload, source, status (pending/approved/rejected), proposed by |
| `alerts` | trip, level (announcement/important/urgent), text, sender. Who may send and read; delivery is M7 |
| `push_subscriptions` | auth user, trip, endpoint, keys |

Columns in other tables keep the name `player_id`: they point at a `trip_members` row.

**Sign-in, accounts and roles** (M3.6)

- **Sign-in:** everyone signs in the same way: type your email, get a 6-digit code by email, type it into six
  boxes. No links (they open in Safari, never in the Home Screen app), no passwords, no anonymous sign-in. A new
  address gets an account when its code is verified. Sessions persist; signing out returns to Sign in. The email
  templates (code, no link) are in `supabase/templates/`; dashboard steps in `docs/setup-auth.md`.
- **Roles on a trip:** exactly one **organizer** (enforced in the database), **co-organizers**, **players**. The
  organizer can't be removed or demoted except by handing the trip to another member who has signed in
  (`hand_off_trip()`, one transaction; they stay on as a co-organizer). App-wide: the **app admin**
  (`profiles.is_admin`, set by SQL only) can do everything on every trip; **trip creators** may create trips.
  Creating a trip makes the creator its organizer.
- **Invites:** the organizer or a co-organizer adds a person with a name and optional email, then texts an invite
  link from their own phone (`<site>/invite/<token>`; the token works for one person and is stored only as a
  hash). The text reads "Fritz added you to <trip> on Teed. Tap to join: <link>". The link shows "Fritz invited
  you to <trip>" and the email field, filled in if known. After the code is verified the membership is claimed:
  by the token, or with no token by a matching email. The person then sees "You're in" and goes on to the trip's
  Home. The link keeps working for the person who took it up (it says they're in); for anyone else it is used.
  One person, one membership per trip. Resending makes a new link and stops the old one.
- **Trip creator invite:** the app admin adds a name and phone on Trip creators and texts a link ("Fritz invited
  you to plan golf trips on Teed"); signing in from it makes that profile a trip creator.
- **Handicap index:** the profile holds the current index; a player edits their own, and the organizer and
  co-organizers can edit any member's. Each trip has a lock date (default: 7 days before the first round). Until
  then a member's trip index follows their profile; from then on it is the trip's own copy, and changing a
  profile never changes a locked or final trip. The organizer and co-organizers can still edit the trip's copy.
  Someone who joins after the lock gets their current index copied on joining. No scheduled job: before a
  profile's index changes, the database first locks that person's trips that are due.
- **Trip lifecycle:** Draft, Upcoming, In progress, Final. Players see a trip once it is published. A trip becomes
  Final on its own once every round is final and its last day has passed (noon UTC the day after); the organizer
  or a co-organizer can reopen it, and finalizing a round again re-arms it.
- **Spectator link:** `<site>/watch/<token>`, no account. A revocable token per trip, derived from a server secret
  (`SPECTATOR_LINK_SECRET`) and a per-trip nonce, so the database holds only the nonce and a hash. The `spectate`
  edge function returns rounds, groups, scores and presses (what the boards are worked out from), and the money
  settings only when "Spectators see winnings" is on. No itinerary, people list, emails or buy-ins. The anon role
  has no access to any table.
- **Edge functions:** `invite` (what an invite link shows before sign-in), `spectate`, `spectator-link` (anyone on
  the trip gets the link to share; the organizer, co-organizers and app admin create or reset it).
- **Read model for the You page:** `my_trips()` (every trip I am on: status, dates, player count, my role, and a
  bucket of next / upcoming / past; finish and winnings are null until the scoring engine exists), `me()` (my
  profile with `is_admin` and `is_trip_creator`), `trip_roster()` (the people on a trip; the "!" flags, from the
  data, only for the organizer, co-organizers and app admin). The app starts at the Home of a trip in progress,
  otherwise at You.
- **Native-app guardrails:** no Safari-only APIs; every push goes through the one server-side notify function;
  sign-in stays email codes; complex UI behavior builds on Angular CDK.

**Who can do what** (enforced in RLS and the edge functions; `supabase/tests/03_permissions.test.sql` has one
check per row and role)

✓ = allowed, — = not. "Admin" is the app admin, who can do everything on every trip, including trips they aren't on.

| Capability | Admin | Organizer | Co-organizer | Player | Spectator link |
|---|---|---|---|---|---|
| Sign in with an email code | ✓ | ✓ | ✓ | ✓ | — (no account) |
| Edit own name, email, handicap index | ✓ | ✓ | ✓ | ✓ | — |
| Create a trip | ✓ | trip creators only | trip creators only | trip creators only | — |
| Manage the Trip creators list | ✓ | — | — | — | — |
| Open any trip, even one they're not on | ✓ | — | — | — | — |
| See itinerary, stay, trip details, people | ✓ | ✓ | ✓ | ✓ | — |
| Edit trip details, stay, house rules, handicap defaults | ✓ | ✓ | ✓ | — | — |
| Publish the trip | ✓ | ✓ | ✓ | — | — |
| Delete the trip | ✓ | ✓ | — | — | — |
| Hand the trip to a new organizer | ✓ | ✓ | — | — | — |
| Add or remove co-organizers | ✓ | ✓ | — | — | — |
| Add or remove players; send or resend invites | ✓ | ✓ | ✓ | — | — |
| Change a member's trip handicap (before or after the lock) | ✓ | ✓ | ✓ | — | — |
| Create or reset the spectator link | ✓ | ✓ | ✓ | — | — |
| Share the spectator link | ✓ | ✓ | ✓ | ✓ | — |
| Edit the itinerary | ✓ | ✓ | ✓ | — | — |
| Suggest an itinerary change | — | — | — | ✓ | — |
| Approve or reject suggestions | ✓ | ✓ | ✓ | — | — |
| Create, edit or delete rounds, formats, groups, teams | ✓ | ✓ | ✓ | — | — |
| Enter scores for their own group | ✓ | ✓ | ✓ | ✓ | — |
| Enter or fix scores for any group (kept in history) | ✓ | ✓ | ✓ | — | — |
| Finalize or reopen a round; Didn't finish; end early | ✓ | ✓ | ✓ | — | — |
| See scores, scorecards and leaderboards | ✓ | ✓ | ✓ | ✓ | ✓ |
| Set the buy-in amount; mark buy-ins paid | ✓ | ✓ | ✓ | — | — |
| See buy-ins, paid status, winnings | ✓ | ✓ | ✓ | ✓ | winnings only if "Spectators see winnings" is on |
| Send alerts | ✓ | ✓ | ✓ | — | — |
| Get push notifications | trips they're on | ✓ | ✓ | ✓ | — |
| See the organizer "!" flags on People | ✓ | ✓ | ✓ | — | — |

The course library is not in the matrix: trip creators (and the app admin) add and edit courses; only the app
admin deletes one.

**Who builds what**

- **Fable:** schema, RLS, auth, edge functions, the scoring engine, offline sync, realtime, push.
- **Opus 5.5:** screens, restyles, copy, loading states, layout fixes. Opus never touches migrations, RLS,
  functions or `app/scoring/`.

**People:** the organizer and co-organizers add players and text their invites; names and handicaps can be edited
any time; removing a player takes them out of every group.

**Groups, teams, late pairings:** presets Balance by handicap, Shuffle, Same as previous round, Seed from standings
(after a chosen round, by money/points/net); then tap two names to swap. Pairings can stay TBD. Groups lock when the
round starts (admin can still change).

**Courses:** reusable library; import from OpenGolfAPI (free, no key, ODbL; shown as "Course data: OpenGolf")
straight from the admin screen (no edge function needed) with tees, rating, slope, par, stroke index; women's
ratings import as separate tees ("White (W)"); Refresh re-pulls and flags changes; trip courses re-checked ~2 weeks out; spot-check against the
USGA Course Rating and Slope Database before the handicap lock. Photos in Supabase Storage.

**Handicaps:** GHIN has no public API; players keep their index on their profile, the organizer spot-checks. Course handicap =
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
| M3.5 | Design system: Tour tokens, shared components in `app/core/ui`, `/dev/ui`; existing screens restyled; 6-character codes and join links; logo and icons; owner plays on the organizer sign-in | `/dev/ui` is right in light and dark on an iPhone; a texted link logs straight in; "Paste my code" works in the Home Screen app |
| M3.6 | Accounts, roles and permissions: email-code sign-in, profiles, trip members with roles, invites, trip creators, handicap lock, spectator link, the permissions matrix in RLS. Screens on top of it (You, edit in place, spectator) follow from Opus | The "friend organizes" flow works end to end; every matrix test passes in CI |
| Slice | Thanksgiving slice (a thin, real cut of M3b, M4, the engine and M6): round setup with one group, the scorecard with a retrying score queue, the scoring engine (handicaps, strokes, net stroke play, the 9-point game, settle-up), live round and trip boards. See "Thanksgiving slice, as built" below | Four rounds at PGA National set up and scored on production; a second phone updates within seconds |
| M4 | Scorecard for the foursome | Scores save per hole; teammates see edits |
| M5 | Offline queue | Airplane-mode scores sync with no duplicates |
| M6 | Live round and trip leaderboards (gross and net) | Two phones update within seconds |
| M7 | Push notifications | See Phase 5 |
| M8 | Polish: icons, splash, install hint, dark mode | Installs cleanly from Safari |

Target: M1–M6 by Jan 1, 2027; test round Jan 2–3; invites out by Jan 6; trip ~Jan 11–15 (Vero Beach, 4 players).

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

**Thanksgiving slice, as built** (migration `0010`)

- **Round setup:** `save_round()` creates or changes a round in one transaction: course, tees, `rounds.holes`
  (18, front or back), day and tee time, one group in playing order, and the games. Net stroke play is always on;
  the 9-point game is a `round_formats` row (`nine_point`, `{"point_value_cents": 50}`) for a group of exactly
  three. A player with no handicap index blocks setup ("Add Dad's handicap index"); so do tees with no rating
  and slope. `delete_round()` renumbers the rest.
- **Handicaps:** course handicap = index × slope / 113 + (rating − par), unrounded; times the trip's allowance;
  rounded to the nearest stroke (a half up). Off the low man: strokes over the group's lowest. Nine holes play
  half, rounded, spread over those nine by stroke index (9-hole ratings aren't in the library). New rounds never
  store a handicap. Southern Pines 2026 keeps the per-round numbers read off GHIN, and the engine uses a stored
  number when there is one (the formula reproduces Saturday to Monday exactly; Friday's were Saturday's).
- **Net scores:** with "pick up at net double bogey" on, a hole counts at most net double bogey in net stroke
  totals, as the old site did. Gross is always the raw strokes.
- **Pickups:** "Pick up" saves net double bogey as the strokes and sets `scores.picked_up`; − or + afterwards
  clears it. The scorecard and the round's page mark it "PU".
- **9-point game:** a hole counts once all three have a score. It is ranked by actual net strokes (no cap), and
  a player who picked up ranks below everyone who finished the hole; two pickups tie. The engine throws unless every counted hole is 9
  points, a finished nine 81 and a finished round 162.
- **Money:** against par, 3 points a hole: (points − 3 × holes counted) × the point value, in cents. A round's
  nets sum to zero. Settle-up reduces nets to the fewest payments (whoever owes most pays whoever is owed most);
  the trip settle-up adds every round's nets and reduces once.
- **Lifecycle:** Complete = every player has every hole in play. An organizer finalizes a Complete round; a
  Complete round also becomes Final once its day is over in `trips.timezone`, the next time anyone opens the
  trip (no cron). A round with holes missing never finalizes on its own.
- **Score queue:** scores go into a list on the phone and are upserted on (round, player, hole), the table's
  key, so a retry never duplicates. Retries back off to 30 seconds and run at once when the phone comes back
  online. Last write wins; conflict rules and service-worker sync are M5.
- **Live:** `RoundsService` reads the trip's rounds once, saves them on the phone and follows `scores` and
  `rounds` over Realtime. Boards and settle-up are worked out on the phone from raw strokes; nothing is stored.
- **Left for the full milestones:** more than one group, team formats, pairing tools, presses, tee-time alerts,
  a Net / Gross switch, score-change flags on Finalize.
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
- [ ] Sign in again with an emailed code after installing (home-screen storage is separate)
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
| Dormie Network | Ballyhack (VA), Briggs Ranch (TX), Dormie Club (NC), Hidden Creek (NJ), Hunting Hawk (VA) |
| Kohler, WI | Whistling Straits: Straits |
| Near Kohler, WI | Erin Hills |

## Theme

Theme "Tour" (replaced Theme A "Scorecard" in the Nov 19 design review): Barlow Semi Condensed headings and big
numbers, Barlow body, tabular figures everywhere; pale green-gray background `#F3F5F2`, white cards with a soft
shadow, a pine-green header band `#14532D`; red `#C0262D` only for under par, "Not paid", urgent alerts and the
live dot; a docked bottom tab bar with icons, the active tab on a tinted pill. Light and dark follow the phone's
setting with a manual override. Tokens live in `src/styles/tokens.scss`; fonts are self-hosted in `public/fonts`
so the installed app has them with no signal. Screens compose the components in `src/app/core/ui` and never
restyle a card or button themselves; `/dev/ui` shows every component in every state, light beside dark.
The logo is a green tee drawn as a T with a red ball on it; the wordmark is "teed" in Barlow Semi Condensed 700.

## Open decisions

Decided in the Nov 19 design review:

- [x] Theme: Tour, light and dark from the phone's setting (was Theme A "Scorecard").
- [x] Code format: 6 random characters, sent as a texted join link (was `VERO-FW27-K4M9`, typed in).
- [x] Owner as a player: "This is me" plus the organizer sign-in; no second session (was: display only).

Decided for M3.6:

- [x] Sign-in: emailed one-time codes for everyone; player codes, anonymous sign-in and "This is me" are gone.
- [x] Roles: one organizer per trip, co-organizers, players; an app admin and trip creators app-wide.
- [x] Spectators: a revocable link with no account; winnings only when the trip says so.

Still open:

- [ ] Spectators and money: should spectators see pots, payouts and buy-ins by default? (Per-trip toggle either way.)
