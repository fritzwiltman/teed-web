-- M1 schema. Row-level security is in 0003_rls.sql; nothing here is readable through the API on its own.
--
-- Conventions
--   * Every trip-scoped row hangs off public.trips and is removed with it (on delete cascade).
--   * Scores are raw gross strokes per hole. Results are computed by the app's scoring engine, never stored.
--   * Helper functions live in the `private` schema, which the Data API does not expose.

create schema if not exists private;

-- ── Small helpers ───────────────────────────────────────────────────────────

-- True when the array is exactly 1..n in some order (a valid stroke index row).
create function private.is_permutation(a smallint[]) returns boolean
language sql immutable
as $$
  select coalesce(
    (select array_agg(x order by x) from unnest(a) as x)
      = (select array_agg(g::smallint order by g) from generate_series(1, cardinality(a)) as g),
    false);
$$;

create function private.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Platform admins ─────────────────────────────────────────────────────────
-- Email sign-up is open, so "may create trips and edit the course library" is an explicit list.
-- Rows are added by hand in the SQL editor (see supabase/seed/README.md).

create table public.app_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ── Trips and people ────────────────────────────────────────────────────────

create table public.trips (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid default auth.uid() references auth.users (id) on delete set null,
  name                 text not null check (length(btrim(name)) between 1 and 80),
  slug                 text not null unique check (slug ~ '^[A-Z0-9]{2,12}$'),   -- code prefix, e.g. VERO
  location             text,
  start_date           date not null,
  end_date             date not null,
  status               text not null default 'draft' check (status in ('draft', 'live', 'final')),
  theme                text not null default 'scorecard',
  -- House rules
  handicap_allowance   numeric(3, 2) not null default 0.90 check (handicap_allowance > 0 and handicap_allowance <= 1),
  strokes_off_low      boolean not null default true,    -- strokes come off the low man
  pickup_net_double    boolean not null default true,    -- pick up at net double bogey
  spectators_see_money boolean not null default false,
  handicap_lock_date   date,                             -- check-in closes at the start of this day
  banker_player_id     uuid,                             -- settles up with everyone; FK added below
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (end_date >= start_date)
);

create trigger trips_set_updated_at before update on public.trips
  for each row execute function private.set_updated_at();

create table public.players (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references public.trips (id) on delete cascade,
  name             text not null check (length(btrim(name)) between 1 and 40),
  initials         text not null check (initials ~ '^[A-Z]{1,4}$'),
  role             text not null default 'player' check (role in ('player', 'co_admin')),
  handicap_index   numeric(3, 1) check (handicap_index between -9.9 and 54.0),   -- plus handicaps are negative
  index_entered_at timestamptz,
  index_locked_at  timestamptz,
  sort_order       smallint not null default 0,
  created_at       timestamptz not null default now(),
  unique (trip_id, name),
  unique (id, trip_id)
);

alter table public.trips
  add constraint trips_banker_fkey foreign key (banker_player_id, id)
  references public.players (id, trip_id) on delete set null (banker_player_id);

-- Login codes. Kept out of `players` so that reading the roster never reveals anyone's code.
create table public.player_codes (
  player_id uuid primary key references public.players (id) on delete cascade,
  code      text not null unique check (code ~ '^[A-Z0-9]{2,12}(-[A-Z0-9]{1,8}){1,3}$'),
  issued_at timestamptz not null default now()
);

-- GHIN numbers. Separate so spectators can read the roster but not these.
create table public.player_ghin (
  player_id   uuid primary key references public.players (id) on delete cascade,
  ghin_number text not null check (ghin_number ~ '^[0-9]{5,10}$'),
  updated_at  timestamptz not null default now()
);

create table public.spectator_codes (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  code       text not null unique check (code ~ '^[A-Z0-9]{2,12}(-[A-Z0-9]{1,8}){1,3}$'),
  label      text,
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, trip_id)
);
create index spectator_codes_trip_id_idx on public.spectator_codes (trip_id);

-- Which signed-in user is which player (or a spectator) on a trip. Written only by the
-- redeem-code edge function. A player can have several rows: Safari and the installed
-- home-screen app keep separate storage, so they are separate anonymous users.
create table public.trip_sessions (
  user_id           uuid not null references auth.users (id) on delete cascade,
  trip_id           uuid not null references public.trips (id) on delete cascade,
  player_id         uuid,
  spectator_code_id uuid,
  created_at        timestamptz not null default now(),
  primary key (user_id, trip_id),
  foreign key (player_id, trip_id) references public.players (id, trip_id) on delete cascade,
  foreign key (spectator_code_id, trip_id) references public.spectator_codes (id, trip_id) on delete cascade,
  check (num_nonnulls(player_id, spectator_code_id) = 1)
);
create index trip_sessions_player_id_idx on public.trip_sessions (player_id);
create index trip_sessions_spectator_code_id_idx on public.trip_sessions (spectator_code_id);

-- ── Course library (shared by every trip) ───────────────────────────────────

create table public.courses (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (length(btrim(name)) > 0),
  short_name         text,
  location           text,                 -- "Southern Pines, NC"
  architect          text,
  year_opened        smallint,
  description        text,
  website_url        text,
  scorecard_url      text,
  directions_url     text,
  photo_path         text,                 -- object path in Supabase Storage
  source             text not null default 'manual' check (source in ('manual', 'opengolfapi')),
  source_ref         text,                 -- id at the source, for Refresh
  ratings_checked_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique nulls not distinct (name, location)
);

create trigger courses_set_updated_at before update on public.courses
  for each row execute function private.set_updated_at();

create table public.tees (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.courses (id) on delete cascade,
  name         text not null check (length(btrim(name)) > 0),
  yards        integer check (yards > 0),
  rating       numeric(3, 1) check (rating between 20 and 90),
  slope        smallint check (slope between 55 and 155),
  par          smallint[] not null,        -- one entry per hole
  stroke_index smallint[] not null,        -- one entry per hole, 1 = hardest
  hole_yards   smallint[],
  created_at   timestamptz not null default now(),
  unique (course_id, name),
  unique (id, course_id),
  check (array_ndims(par) = 1 and cardinality(par) between 1 and 18),
  check (3 <= all (par) and 6 >= all (par)),
  check (cardinality(stroke_index) = cardinality(par) and private.is_permutation(stroke_index)),
  check (hole_yards is null or cardinality(hole_yards) = cardinality(par))
);

-- ── Rounds, formats, groups ─────────────────────────────────────────────────

create table public.rounds (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips (id) on delete cascade,
  round_number smallint not null check (round_number > 0),
  course_id    uuid not null references public.courses (id),
  tee_id       uuid not null,
  play_date    date not null,
  tee_time     time,
  status       text not null default 'scheduled' check (status in ('scheduled', 'live', 'final')),
  pairings_tbd boolean not null default true,
  drive_note   text,                       -- "8 min from the house"
  created_at   timestamptz not null default now(),
  unique (trip_id, round_number),
  unique (id, trip_id),
  foreign key (tee_id, course_id) references public.tees (id, course_id)   -- the tee belongs to the course
);
create index rounds_course_id_idx on public.rounds (course_id);
create index rounds_tee_id_idx on public.rounds (tee_id, course_id);

-- One row per game played in a round. format_key names a scoring-engine plug-in
-- (stroke, stableford, nassau, sixes, scramble, alt_shot, wolf, nine_point, skins, ...);
-- settings holds that format's options (stakes, presses, carryover, pot split, rotation).
create table public.round_formats (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references public.rounds (id) on delete cascade,
  format_key text not null check (format_key ~ '^[a-z][a-z0-9_]*$'),
  settings   jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (round_id, format_key),
  unique (id, round_id)
);

create table public.groups (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references public.rounds (id) on delete cascade,
  group_number smallint not null check (group_number > 0),
  tee_time     time,
  created_at   timestamptz not null default now(),
  unique (round_id, group_number),
  unique (id, round_id)
);

-- A player's slot in a round: group, position (drives the Sixes rotation), team for 2v2 games.
-- course_handicap / playing_handicap are optional overrides copied from GHIN: GHIN applies the
-- allowance to the unrounded course handicap, so computing it from the rounded one can be off by one.
create table public.group_players (
  round_id         uuid not null,
  player_id        uuid not null references public.players (id) on delete cascade,
  group_id         uuid not null,
  position         smallint not null check (position between 1 and 6),
  team             text check (team in ('A', 'B')),
  course_handicap  smallint check (course_handicap between -10 and 60),
  playing_handicap smallint check (playing_handicap between -10 and 60),   -- after the allowance, before low man
  primary key (round_id, player_id),                                        -- one group per player per round
  foreign key (group_id, round_id) references public.groups (id, round_id) on delete cascade,
  -- deferrable so one UPDATE can swap two players' positions
  unique (group_id, position) deferrable initially immediate
);
create index group_players_player_id_idx on public.group_players (player_id);

create function private.group_players_same_trip() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select p.trip_id from public.players p where p.id = new.player_id)
     is distinct from (select r.trip_id from public.rounds r where r.id = new.round_id) then
    raise exception 'Player and round belong to different trips' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger group_players_same_trip before insert or update on public.group_players
  for each row execute function private.group_players_same_trip();

-- ── Scores ──────────────────────────────────────────────────────────────────

-- Keyed on round + player + hole: an offline phone re-sending a score upserts, it can't duplicate.
create table public.scores (
  round_id             uuid not null,
  player_id            uuid not null,
  hole                 smallint not null check (hole between 1 and 18),
  strokes              smallint not null check (strokes between 1 and 20),
  entered_by           uuid references auth.users (id) on delete set null,
  -- "Entered on Jack's phone". Deliberately not a foreign key: a set-null cascade here would
  -- update score rows in the middle of a trip or player delete. Join to players when reading.
  entered_by_player_id uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (round_id, player_id, hole),
  foreign key (round_id, player_id) references public.group_players (round_id, player_id) on delete cascade
);
create index scores_player_id_idx on public.scores (player_id);

-- Every change to a score, so a wrong edit can be traced and undone.
create table public.score_history (
  id                   bigint generated always as identity primary key,
  round_id             uuid not null references public.rounds (id) on delete cascade,
  player_id            uuid not null references public.players (id) on delete cascade,
  hole                 smallint not null,
  op                   text not null check (op in ('insert', 'update', 'delete')),
  strokes              smallint,           -- new value; null for a delete
  previous_strokes     smallint,
  changed_by           uuid,
  changed_by_player_id uuid,
  changed_at           timestamptz not null default now()
);
create index score_history_round_player_idx on public.score_history (round_id, player_id, hole);
create index score_history_player_id_idx on public.score_history (player_id);

-- Stamps who entered a score and when. The client can't choose these. Re-sending an unchanged
-- score (an offline queue replay) leaves the row exactly as it was.
create function private.scores_stamp() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;
    if new.strokes = old.strokes then
      -- Keep the attribution, except when it is being cleared (the enterer was deleted: on delete set null).
      if new.entered_by is not null then new.entered_by := old.entered_by; end if;
      if new.entered_by_player_id is not null then new.entered_by_player_id := old.entered_by_player_id; end if;
      new.updated_at := old.updated_at;
      return new;
    end if;
  end if;
  new.updated_at := now();
  if uid is not null then
    new.entered_by := uid;
    new.entered_by_player_id := (
      select s.player_id
      from public.trip_sessions s
      join public.rounds r on r.trip_id = s.trip_id
      where s.user_id = uid and r.id = new.round_id);
  end if;
  return new;
end;
$$;

create trigger scores_stamp before insert or update on public.scores
  for each row execute function private.scores_stamp();

create function private.scores_log() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Skip when the round or player is itself being deleted (the history goes with it).
    if exists (select 1 from public.rounds r where r.id = old.round_id)
       and exists (select 1 from public.players p where p.id = old.player_id) then
      insert into public.score_history (round_id, player_id, hole, op, strokes, previous_strokes, changed_by, changed_by_player_id)
      values (old.round_id, old.player_id, old.hole, 'delete', null, old.strokes, auth.uid(), null);
    end if;
    return old;
  elsif tg_op = 'INSERT' then
    insert into public.score_history (round_id, player_id, hole, op, strokes, previous_strokes, changed_by, changed_by_player_id)
    values (new.round_id, new.player_id, new.hole, 'insert', new.strokes, null, new.entered_by, new.entered_by_player_id);
  elsif new.strokes is distinct from old.strokes then
    insert into public.score_history (round_id, player_id, hole, op, strokes, previous_strokes, changed_by, changed_by_player_id)
    values (new.round_id, new.player_id, new.hole, 'update', new.strokes, old.strokes, new.entered_by, new.entered_by_player_id);
  end if;
  return new;
end;
$$;

create trigger scores_log after insert or update or delete on public.scores
  for each row execute function private.scores_log();

-- Manual presses in match formats (Nassau, Sixes). They are inputs like scores: the engine works
-- out who pressed and whether the press was allowed. bet is the format's name for the bet being
-- pressed ('front', 'back', 'overall' for Nassau; 'm1', 'm2', 'm3' for Sixes).
create table public.presses (
  id              uuid primary key default gen_random_uuid(),
  round_id        uuid not null,
  round_format_id uuid not null,
  group_id        uuid not null,
  bet             text not null check (bet ~ '^[a-z][a-z0-9_]*$'),
  after_hole      smallint not null check (after_hole between 1 and 17),   -- the press starts on the next hole
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (round_format_id, round_id) references public.round_formats (id, round_id) on delete cascade,
  foreign key (group_id, round_id) references public.groups (id, round_id) on delete cascade,
  unique (round_format_id, group_id, bet, after_hole)
);
create index presses_round_id_idx on public.presses (round_id);
create index presses_group_id_idx on public.presses (group_id, round_id);

-- ── Trip info ───────────────────────────────────────────────────────────────

create table public.itinerary_items (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  day        date not null,
  start_time time,
  type       text not null check (type in ('lodging', 'meal', 'activity', 'tv', 'travel', 'cost', 'note')),
  title      text not null check (length(btrim(title)) > 0),
  details    jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),   -- fields per type
  player_id  uuid references public.players (id) on delete cascade,   -- set for one player's own travel
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index itinerary_items_trip_day_idx on public.itinerary_items (trip_id, day, sort_order);

create trigger itinerary_items_set_updated_at before update on public.itinerary_items
  for each row execute function private.set_updated_at();

create table public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  trip_id             uuid not null references public.trips (id) on delete cascade,
  title               text not null check (length(btrim(title)) > 0),
  details             text,
  due_date            date,
  player_can_complete boolean not null default false,   -- players may tick this one for themselves
  sort_order          smallint not null default 0,
  created_at          timestamptz not null default now(),
  unique (id, trip_id)
);
create index tasks_trip_id_idx on public.tasks (trip_id);

create table public.task_status (
  task_id    uuid not null,
  player_id  uuid not null,
  trip_id    uuid not null,
  done       boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (task_id, player_id),
  foreign key (task_id, trip_id) references public.tasks (id, trip_id) on delete cascade,
  foreign key (player_id, trip_id) references public.players (id, trip_id) on delete cascade
);
create index task_status_player_id_idx on public.task_status (player_id);

create table public.itinerary_proposals (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips (id) on delete cascade,
  payload     jsonb not null,
  source      text,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz
);
create index itinerary_proposals_trip_id_idx on public.itinerary_proposals (trip_id, status);

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id    uuid not null references public.trips (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth_key   text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_trip_id_idx on public.push_subscriptions (trip_id);
create index push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

-- ── Realtime ────────────────────────────────────────────────────────────────
-- Leaderboards and scorecards subscribe to score changes.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.scores;
  end if;
end;
$$;
