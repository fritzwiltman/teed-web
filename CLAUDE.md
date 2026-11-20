# Teed

Live scoring and trip hub for golf trips. Players log in from a texted link (a personal code), score hole by hole,
and follow live leaderboards; an admin sets up trips, rounds, formats, pairings and trip info.

- Build plan: `docs/plan.md` (copy of https://claude.ai/artifact/EjFNgELk12pGAnNS5CpSZu, the master)
- Wireframes (approved design): https://claude.ai/artifact/CAMT8mmSpgajXZkR5YPbBL
- First real trip: Vero Beach, the week before MLK weekend 2027 (about Jan 11–15). M1–M6 done by Jan 1.

## Stack

- **Angular** (standalone components, signals) as a **PWA** (`@angular/pwa`), phone-first.
- **Supabase**: Postgres, Realtime, Auth (anonymous sign-in for players, email sign-in for the organizer),
  Edge Functions, Storage (course photos). Free tier.
- **Cloudflare Worker with static assets** serves the built app (`wrangler.jsonc`). Free tier.
- **Web Push** (VAPID) sent from a Supabase Edge Function.

## Layout

```
src/                      Angular app
  app/player/             login, trip home, scorecard, hole picker, leaderboard, trip info
  app/admin/              my trips, admin home, trip details, roster, rounds, groups, courses, itinerary, proposals
  app/scoring/            pure TypeScript scoring engine, one module per format (no Angular imports)
  app/core/               supabase client, auth, offline queue, theme
  app/core/ui/            the design system: every card, button, row, tab bar and sheet (ui-*)
  app/dev/                /dev/ui, every component in every state, light beside dark (not linked anywhere)
  styles/tokens.scss      Theme "Tour" tokens: colors (light and dark), shape, spacing
supabase/migrations/      SQL schema, RLS policies, functions (one file per change)
supabase/functions/       edge functions: redeem-code, notify, itinerary-propose
supabase/seed/            Southern Pines 2026 test trip, course library seed list
supabase/tests/           pgTAP tests (RLS, seed, code login) and edge function tests; CI runs them on every PR
scripts/                  local DB test runner, one-off course library import (OpenGolfAPI)
docs/                     notes; wireframes live at the link above
```

## Rules

- **Never commit secrets.** The Supabase anon key is public by design; the service-role key, VAPID private
  key and database password never go in the repo. Use `.env` locally and Supabase/Cloudflare secrets.
- **Security lives in the database.** Every table has RLS. Players read only their own trip and write
  scores only for their own group; spectators are read-only; only owner/co-admins write trip setup.
- **Scores are raw strokes per hole.** Formats (stroke, Stableford, Nassau with presses, Sixes, skins,
  scramble, alt shot, wolf, 9-point, Ryder Cup) are computed from them and never stored as results.
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
- **Day headers** always read `Label · Ddd, Mon D` (`Round 3 · Sun, Oct 11`, `Travel day · Thu, Oct 8`).
- **Screens render data, never a format.** Cards, leaderboards and breakdowns take rows that each format plug-in
  supplies. No screen hard-codes Sixes, Nassau or any other format.
- **Loading:** skeletons hold the layout for content. Spinners only appear inside a button or a sync line, never
  full screen.
- **Browser-first.** Everything works in Safari without installing. "Add to Home Screen" is strongly suggested
  but always skippable.

## Workflow

- Work on a branch, open a PR into `main`; `main` is protected. Cloudflare deploys on merge.
- One milestone per session (see the plan's Phase 4 table). Plan first, then code, then tests.
- Ask before adding a dependency or changing the schema of an existing table.

## Commands

```
npm install
npm start                 # ng serve
npm test
npm run build             # outputs dist/teed/browser
npx supabase db push      # apply migrations (add --include-seed for the test trip)
npm run test:db           # RLS + seed tests in a throwaway local Postgres (no Docker needed)
npx supabase functions deploy redeem-code   # deploy an edge function
npx wrangler deploy       # manual deploy (normally via Cloudflare on merge)
```
