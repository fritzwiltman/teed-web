# Teed

Live scoring and trip hub for golf trips. Players sign in with an emailed code (invited by a texted link), score
hole by hole, and follow live leaderboards; an organizer sets up trips, rounds, formats, pairings and trip info.

- Build plan: `docs/plan.md` (copy of https://claude.ai/artifact/EjFNgELk12pGAnNS5CpSZu, the master)
- Wireframes (approved design): https://claude.ai/artifact/CAMT8mmSpgajXZkR5YPbBL
- First real trip: Vero Beach, the week before MLK weekend 2027 (about Jan 11–15). M1–M6 done by Jan 1.

## Stack

- **Angular** (standalone components, signals) as a **PWA** (`@angular/pwa`), phone-first.
- **Supabase**: Postgres, Realtime, Auth (email one-time codes for everyone), Edge Functions, Storage (course
  photos). Free tier.
- **Cloudflare Worker with static assets** serves the built app (`wrangler.jsonc`). Free tier.
- **Web Push** (VAPID) sent from a Supabase Edge Function.

## Layout

```
src/                      Angular app
  app/auth/               the sign-in form: email, then the 6-digit code
  app/player/             sign in, invite, You, the trip shell and its screens: Home, scorecard, board, Trip overview
                          (itinerary, courses, people, info), a round's page (setup, edited in place), suggested changes,
                          spectator link
  app/admin/              the data layer for running trips (data.ts), New trip, Trip creators, the course library
  app/scoring/            pure TypeScript scoring engine: handicaps, strokes, net stroke play, the 9-point game, Nassau, settle-up (no Angular imports)
  app/core/               supabase client, auth (who is signed in), session (which trip is open), rounds (live rounds and results), score queue, launch (landing on your hole), theme
  app/core/ui/            the design system: every card, button, row, tab bar and sheet (ui-*)
  app/dev/                /dev/ui, every component in every state, light beside dark (not linked anywhere)
  styles/tokens.scss      Theme "Tour" tokens: colors (light and dark), shape, spacing
supabase/migrations/      SQL schema, RLS policies, functions (one file per change)
supabase/functions/       edge functions: invite, spectate, spectator-link, notify
supabase/templates/       the sign-in emails (a 6-digit code, no link)
supabase/seed/            Southern Pines 2026 test trip, course library seed list
supabase/tests/           pgTAP tests (accounts, seed, the permissions matrix, rounds) and end-to-end tests; CI runs them on every PR
scripts/                  local DB test runner, the accounts-migration test, one-off course library import (OpenGolfAPI)
docs/                     notes; wireframes live at the link above
```

## Rules

- **Never commit secrets.** The Supabase anon key is public by design; the service-role key, VAPID private
  key and database password never go in the repo. Use `.env` locally and Supabase/Cloudflare secrets.
- **Security lives in the database.** Every table has RLS, following the permissions matrix in `docs/plan.md`.
  Roles: app admin (everything, everywhere), trip creators (may create trips), and on each trip exactly one
  organizer, co-organizers (everything but deleting, handing off and choosing co-organizers) and players (read
  their trip, score their own group, suggest itinerary changes). Spectators have no account: a revocable link
  served by an edge function shows rounds and boards only. The anon role reads no table.
- **Sign-in is an emailed 6-digit code,** typed in the app, for everyone. Never a link, never a password.
- **Scores are raw strokes per hole.** Formats (stroke, Stableford, Nassau with presses, Sixes, skins,
  scramble, alt shot, wolf, 9-point, Ryder Cup) are computed from them and never stored as results.
- **Handicaps are worked out, never guessed.** New rounds calculate strokes from each player's handicap index
  and their own tees' rating, slope and par (a player's tees default to the round's), plus the par difference
  when pars differ within the group. A round can be set up before everyone's index is in, but nobody can score
  it until every player in the group has one ("Add Dad's handicap index"). Only Southern Pines 2026 has stored
  per-round handicaps.
- **Money is integer cents,** and every settle-up sums to zero. The 9-point game checks itself: 9 a hole, 81 a
  nine, 162 a round.
- **Rounds finish after a night's sleep.** A complete round becomes Final from 3 AM local on the day after the
  latest of its date, its last score change and its last reopening, never when a score is saved. Until then its
  group can correct it; after, an organizer can reopen it from the Board.
- **Saves are silent.** No line or spinner per tap on the scorecard. A score waiting more than five seconds says
  so in a fixed spot that moves nothing.
- **Scoring engine is pure and tested.** Every format has unit tests; the Southern Pines 2026 rerun must
  reproduce the old site's standings and settle-up (90% allowance, strokes off the low man).
- **Offline first on the course.** Score entry works with no signal and syncs without duplicates.
- **Zero-fiddle scoring.** App opens to the next unscored hole; your rows start at par; big tap targets.
- **Theme "Tour"** is the default: Barlow Semi Condensed headings and big numbers, Barlow body, tabular figures
  everywhere; pale green-gray background, white cards with a soft shadow, a pine-green header band; red only for
  under par, "Not paid", urgent alerts and the live dot; a docked bottom tab bar with icons, the active tab on a
  tinted pill. Light and dark follow the phone's setting with a manual override. Themes change tokens only, never
  layout. Screens compose components from `app/core/ui`; never restyle a card or button inline.
- **Only pertinent info on screen.** No labels that explain how the app works. No app-computed drive or leave times.
- **"Live" means a round in play:** at least one score in and not final. Only then the red dot and "Live".
  Trips are Draft, Upcoming, In progress or Final; the organizer "publishes" a trip.
- **Sheets:** every bottom sheet is `ui-sheet` (drag to dismiss, background locked). No one-off drawers.
- **One app for everyone.** No organizer mode: organizer powers appear in place on the shared screens, gated by
  role. Edit sits beside the title of what it edits (`button[ui-edit-pill]`), only where there is something to
  edit; it becomes a filled Done in the same spot. Things that can't be undone ask in `ui-confirm-sheet`.
- **Pickers:** no native `<select>`. Up to four choices: `ui-segmented`. More: `ui-picker-sheet` (with search
  when the list can grow). Dates, times and number keypads stay native (`inputmode="decimal"` for an index).
- **Disclosure rows** use `ui-list-row`'s `expanded`: the chevron turns from right to down.
- **Day headers** always read `Label · Ddd, Mon D` (`Round 3 · Sun, Oct 11`, `Travel day · Thu, Oct 8`).
- **Screens render data, never a format.** Cards, leaderboards and breakdowns take rows that each format plug-in
  supplies. No screen hard-codes Sixes, Nassau or any other format.
- **Loading:** skeletons hold the layout for content. Spinners only appear inside a button or a sync line, never
  full screen.
- **Native-app guardrails.** No Safari-only APIs. Every push goes through the one server-side notify function.
  Complex UI behavior (overlays, sheets, focus, a11y) builds on Angular CDK; ask before adding any other UI
  dependency.
- **Browser-first.** Everything works in Safari without installing. "Add to Home Screen" is strongly suggested
  but always skippable.

## Workflow

- Work on a branch, open a PR into `main`; `main` is protected. Cloudflare deploys on merge.
- One milestone per session (see the plan's Phase 4 table). Plan first, then code, then tests.
- Ask before adding a dependency or changing the schema of an existing table.
- **Who builds what.** Fable: schema, RLS, auth, edge functions, the scoring engine, offline sync, realtime, push.
  Opus 5.5: screens, restyles, copy, loading states, layout fixes. Opus never touches `supabase/migrations`, RLS,
  `supabase/functions` or `app/scoring/`.

## Commands

```
npm install
npm start                 # ng serve
npm test
npm run build             # outputs dist/teed/browser
npx supabase db push      # apply migrations (add --include-seed for the test trip)
npm run test:db           # RLS + seed tests in a throwaway local Postgres (no Docker needed)
npx supabase functions deploy invite spectate spectator-link   # deploy the edge functions
scripts/test-accounts-migration.sh   # what migration 0008 does to existing data (throwaway local Postgres)
npx wrangler deploy       # manual deploy (normally via Cloudflare on merge)
```
