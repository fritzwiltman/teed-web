# Seed data

- `southern-pines-2026.sql` (M1): the Southern Pines 2026 trip from the old GitHub Pages site, used as the test trip.
  Courses, tees, GHIN handicaps, formats, Friday's press and all 288 gross scores. Safe to run more than once.
- `southern-pines-2026.expected.json`: what the old site computed from those scores (match results, points, money,
  settle-up). The scoring engine's rerun has to reproduce it.
- `course-library.md`: the starter course list to bulk-import in M3 (see the build plan).

## Applying it

```
npx supabase db push --include-seed     # migrations, then the seed
```

The trip is seeded as `final` (it's over): players can read it but scoring is closed. To test scoring on it,
set it live in the SQL editor: `update trips set status = 'live' where slug = 'PINES';` and the rounds you want
to `'live'` or `'scheduled'`.

Login codes are generated at random when the seed runs and are never committed (the repo is public). Read them
in the SQL editor:

```sql
select p.name, c.code from player_codes c join players p on p.id = c.player_id;
```

## Making yourself the app admin

Creating trips and editing the course library is limited to users listed in `app_admins`. After signing in once
with your email magic link, run this in the SQL editor with your address:

```sql
insert into app_admins (user_id) select id from auth.users where email = 'you@example.com';
update trips set owner_id = (select user_id from app_admins limit 1) where owner_id is null;
```
