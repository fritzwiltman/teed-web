-- M3.6: accounts, roles and permissions.
--
-- Everyone signs in with an email one-time code. Player codes, anonymous sign-in, the spectator
-- codes and "This is me" are gone; roles on the trip replace them.
--
-- Who is who
--   app admin      profiles.is_admin (set by SQL only): everything, on every trip
--   trip creator   listed in trip_creators (managed by the app admin): may create trips
--   organizer      exactly one per trip: everything on that trip, including deleting it,
--                  handing it off and choosing co-organizers
--   co-organizer   everything on the trip except those three
--   player         reads the trip once it is published, scores for their own group, suggests
--                  itinerary changes
--   spectator      no account: a revocable link, served by the `spectate` edge function
--   anon           not signed in: no access to any table
--
-- Existing tables changed here (approved): players is renamed trip_members and gains the
-- account, invite and buy-in columns; trips loses owner_id and owner_player_id and gains
-- reopened_at and buy_in_amount; itinerary_proposals gains proposed_by; player_contacts is
-- renamed member_contacts. Columns elsewhere keep the name player_id: they point at a member.

-- ── Profiles ────────────────────────────────────────────────────────────────

-- One per signed-in person. email follows the verified sign-in email (see private.auth_user_saved).
create table public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  display_name   text not null default '' check (length(display_name) <= 40),
  email          text,
  handicap_index numeric(3, 1) check (handicap_index between -9.9 and 54.0),   -- the current index
  is_admin       boolean not null default false,                                -- set by SQL only
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index profiles_email_idx on public.profiles (lower(email));

create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- Everyone who already signs in by email (the organizer accounts) gets a profile.
insert into public.profiles (id, email, is_admin)
select u.id, lower(u.email), exists (select 1 from public.app_admins a where a.user_id = u.id)
from auth.users u
where u.email is not null and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false);

-- ── Small helpers ───────────────────────────────────────────────────────────

-- 'Fritz Wiltman' → 'FW'. Never empty.
create function private.initials_for(p_name text) returns text
language sql immutable set search_path = ''
as $$
  select coalesce(nullif(left(string_agg(upper(left(w, 1)), '' order by n), 4), ''), 'X')
  from regexp_split_to_table(regexp_replace(coalesce(p_name, ''), '[^A-Za-z\s-]', '', 'g'), '[\s-]+')
       with ordinality as t (w, n)
  where w <> '';
$$;

-- A new invite or spectator token: 244 random bits, safe in a link. Only its hash is stored.
create function private.new_token() returns text
language sql volatile set search_path = ''
as $$
  select translate(encode(uuid_send(gen_random_uuid()) || uuid_send(gen_random_uuid()), 'base64'), '+/=', '-_');
$$;

create function private.token_hash(p_token text) returns text
language sql immutable set search_path = ''
as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
$$;

-- ── Trip members (was: players) ─────────────────────────────────────────────

alter table public.players rename to trip_members;
alter table public.player_contacts rename to member_contacts;

alter table public.trip_members
  add column profile_id        uuid references public.profiles (id) on delete set null,   -- null until the invite is claimed
  add column email             text check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column invite_token_hash text unique,
  add column invited_by        uuid references public.profiles (id) on delete set null,
  add column invited_at        timestamptz,
  add column claimed_at        timestamptz,
  add column buy_in_paid       boolean not null default false;

alter table public.trip_members drop constraint players_role_check;
update public.trip_members set role = 'co_organizer' where role = 'co_admin';

-- Each trip's organizer: the player marked "This is me", linked to the owner's account.
update public.trip_members m
   set role = 'organizer',
       profile_id = (select p.id from public.profiles p where p.id = t.owner_id),
       claimed_at = case when exists (select 1 from public.profiles p where p.id = t.owner_id) then now() end
  from public.trips t
 where m.id = t.owner_player_id and m.trip_id = t.id;

-- A profile starts with the name its owner goes by on their trips, and their latest index.
update public.profiles p
   set display_name = coalesce(
         (select m.name from public.trip_members m join public.trips t on t.id = m.trip_id
           where m.profile_id = p.id order by t.start_date desc limit 1),
         left(split_part(p.email, '@', 1), 40)),
       handicap_index =
         (select m.handicap_index from public.trip_members m join public.trips t on t.id = m.trip_id
           where m.profile_id = p.id and m.handicap_index is not null order by t.start_date desc limit 1);

-- A trip with no "This is me": its owner's account becomes the organizer, as a new member.
insert into public.trip_members (trip_id, name, initials, role, profile_id, claimed_at, handicap_index, sort_order)
select t.id, n.name, private.initials_for(n.name), 'organizer', p.id, now(), p.handicap_index,
       coalesce((select max(m.sort_order) from public.trip_members m where m.trip_id = t.id), 0) + 1
from public.trips t
join public.profiles p on p.id = t.owner_id
cross join lateral (
  select case
           when exists (select 1 from public.trip_members m where m.trip_id = t.id and m.name = p.display_name)
             then left(p.display_name, 28) || ' (organizer)'
           else p.display_name
         end as name) as n
where t.owner_player_id is null;

do $$
declare
  v_names text;
begin
  select string_agg(t.name, ', ') into v_names
  from public.trips t
  where not exists (select 1 from public.trip_members m where m.trip_id = t.id and m.role = 'organizer');
  if v_names is not null then
    raise exception 'No organizer could be worked out for: %. Set trips.owner_id or owner_player_id first.', v_names;
  end if;
end;
$$;

alter table public.trip_members
  add constraint trip_members_role_check check (role in ('organizer', 'co_organizer', 'player'));

-- One person, one membership per trip; one row per email per trip; one organizer per trip.
create unique index trip_members_profile_idx on public.trip_members (trip_id, profile_id);
create unique index trip_members_email_idx on public.trip_members (trip_id, email);
create unique index trip_members_one_organizer_idx on public.trip_members (trip_id) where role = 'organizer';
create index trip_members_profile_id_idx on public.trip_members (profile_id);

update public.trip_members m
   set email = p.email
  from public.profiles p
 where p.id = m.profile_id;

-- ── Trips ───────────────────────────────────────────────────────────────────

drop policy trips_insert on public.trips;
drop policy trips_delete on public.trips;
drop trigger trips_guard_owner on public.trips;

alter table public.trips
  drop column owner_player_id,
  drop column owner_id,
  add column reopened_at   timestamptz,     -- set when a final trip is reopened; holds off the automatic final
  add column buy_in_amount numeric(7, 2) check (buy_in_amount >= 0);

alter table public.itinerary_proposals
  add column proposed_by uuid references public.trip_members (id) on delete set null;

-- ── Things that are gone ────────────────────────────────────────────────────

-- Phones that logged in with a code were anonymous users. Their scores stay; only "entered by" clears.
delete from auth.users where coalesce(is_anonymous, false);

drop function public.redeem_code(text, uuid, text);
drop function public.regenerate_player_code(uuid);
drop function public.issue_spectator_code(uuid);
drop function public.replace_player(uuid, text, text);
drop function public.submit_handicap(uuid, numeric, text);

drop table public.trip_sessions;
drop table public.player_codes;
drop table public.spectator_codes;
drop table public.app_admins;
drop table private.redeem_attempts;
drop table private.redeem_lockouts;

drop function private.player_codes_end_sessions();
drop function private.spectator_codes_end_sessions();
drop function private.redeem_fail(text, int);
drop function private.random_code_suffix();
drop function private.new_login_code();
drop function private.trips_guard_owner();

-- ── New tables ──────────────────────────────────────────────────────────────

-- Who may create trips, besides the app admin. A row is an invite until profile_id is set.
create table public.trip_creators (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (length(btrim(name)) between 1 and 40),
  phone             text check (phone ~ '^\+?[0-9]{7,15}$'),
  profile_id        uuid unique references public.profiles (id) on delete cascade,
  invite_token_hash text unique,
  invited_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  claimed_at        timestamptz
);

-- The trip's spectator link. The link itself is never stored: the edge functions derive it from
-- a server secret and this nonce, and look a visitor up by the hash. A reset is a new nonce.
create table public.spectator_links (
  trip_id    uuid primary key references public.trips (id) on delete cascade,
  nonce      text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);

-- Announcements from the organizer. Delivery (push) comes with M7; this is who may send and read.
create table public.alerts (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  level      text not null default 'announcement' check (level in ('announcement', 'important', 'urgent')),
  body       text not null check (length(btrim(body)) between 1 and 500),
  sent_by    uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index alerts_trip_id_idx on public.alerts (trip_id, created_at desc);

-- ── Who is the caller ───────────────────────────────────────────────────────
-- SECURITY DEFINER, in `private`, as before. The policies written in 0003 call these by name, so
-- giving them their new meaning moves every one of those policies to the role rules.

create or replace function private.is_app_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin);
$$;

-- The caller's role on the trip: organizer, co_organizer, player, or null when not on it.
create function private.my_role(p_trip_id uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select m.role from public.trip_members m where m.trip_id = p_trip_id and m.profile_id = auth.uid();
$$;

-- Organizer, co-organizer or app admin: may set the trip up and run it.
create or replace function private.is_trip_admin(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_app_admin()
      or coalesce(private.my_role(p_trip_id) in ('organizer', 'co_organizer'), false);
$$;

-- The organizer or the app admin: delete, hand off, choose co-organizers.
create or replace function private.is_trip_owner(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_app_admin() or coalesce(private.my_role(p_trip_id) = 'organizer', false);
$$;

-- The caller's member row on this trip. A player has one only once the trip is published;
-- the organizer and co-organizers always do.
create or replace function private.my_player_id(p_trip_id uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.id
  from public.trip_members m
  join public.trips t on t.id = m.trip_id
  where m.trip_id = p_trip_id and m.profile_id = auth.uid()
    and (m.role <> 'player' or t.status in ('live', 'final'));
$$;

create or replace function private.can_read_trip(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_trip_admin(p_trip_id) or private.is_trip_player(p_trip_id);
$$;

create or replace function private.can_read_trip_private(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_read_trip(p_trip_id);
$$;

-- Everyone on the trip sees the money. Spectators never come through here.
create or replace function private.can_see_money(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.can_read_trip(p_trip_id);
$$;

drop function private.is_trip_spectator(uuid);

create or replace function private.player_trip_id(p_player_id uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select m.trip_id from public.trip_members m where m.id = p_player_id;
$$;

create function private.can_create_trips() returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_app_admin()
      or exists (select 1 from public.trip_creators c where c.profile_id = auth.uid());
$$;

create or replace function private.group_players_same_trip() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select m.trip_id from public.trip_members m where m.id = new.player_id)
     is distinct from (select r.trip_id from public.rounds r where r.id = new.round_id) then
    raise exception 'Player and round belong to different trips' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Every insert, update and delete of a score, by anyone: who, when, old and new value.
create or replace function private.scores_log() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    -- Skip when the round or member is itself being deleted (the history goes with it).
    if exists (select 1 from public.rounds r where r.id = old.round_id)
       and exists (select 1 from public.trip_members m where m.id = old.player_id) then
      insert into public.score_history (round_id, player_id, hole, op, strokes, previous_strokes, changed_by, changed_by_player_id)
      values (old.round_id, old.player_id, old.hole, 'delete', null, old.strokes, auth.uid(),
              private.my_player_id(private.round_trip_id(old.round_id)));
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

-- ── One organizer per trip ──────────────────────────────────────────────────
-- The unique index allows at most one. These check, at the end of each transaction, that a trip
-- that still exists has one: so the organizer can't be removed or demoted except by a hand-off.

create function private.trip_has_one_organizer(p_trip_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.trips t where t.id = p_trip_id)
     and (select count(*) from public.trip_members m where m.trip_id = p_trip_id and m.role = 'organizer') <> 1 then
    raise exception 'A trip has exactly one organizer' using errcode = '23514';
  end if;
end;
$$;

create function private.trip_members_check_organizer() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then perform private.trip_has_one_organizer(old.trip_id); end if;
  if tg_op <> 'DELETE' then perform private.trip_has_one_organizer(new.trip_id); end if;
  return null;
end;
$$;

create function private.trips_check_organizer() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.trip_has_one_organizer(new.id);
  return null;
end;
$$;

create constraint trigger trip_members_check_organizer
  after insert or update of role, trip_id or delete on public.trip_members
  deferrable initially deferred
  for each row execute function private.trip_members_check_organizer();

create constraint trigger trips_check_organizer
  after insert on public.trips
  deferrable initially deferred
  for each row execute function private.trips_check_organizer();

-- ── Handicap index: live on the profile, locked per trip ────────────────────
--
-- trip_members.handicap_index is always the index the trip uses. Until the trip locks, a claimed
-- member's copy follows their profile. From the lock date on, it stands on its own: before a
-- profile's index changes, every trip of theirs that is due is marked locked with the old value,
-- so the lock needs no scheduled job and reads are never out of date.

-- The start of this day closes it: the date set on the trip, else 7 days before the first round
-- (or before the trip's first day while it has no rounds).
create function private.handicap_lock_date(p_trip_id uuid) returns date
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    t.handicap_lock_date,
    coalesce((select min(r.play_date) from public.rounds r where r.trip_id = t.id), t.start_date) - 7)
  from public.trips t
  where t.id = p_trip_id;
$$;

create function private.handicaps_locked(p_trip_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select t.status = 'final' from public.trips t where t.id = p_trip_id)
    or current_date >= private.handicap_lock_date(p_trip_id), false);
$$;

-- Marks as locked every membership that is due: for one profile, one trip, or both.
create function private.lock_due_handicaps(p_profile_id uuid, p_trip_id uuid) returns void
language sql volatile security definer set search_path = ''
as $$
  update public.trip_members m
     set index_locked_at = now()
   where m.index_locked_at is null
     and (p_profile_id is null or m.profile_id = p_profile_id)
     and (p_trip_id is null or m.trip_id = p_trip_id)
     and (p_profile_id is not null or p_trip_id is not null)
     and private.handicaps_locked(m.trip_id);
$$;

create function private.profiles_index_changing() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.lock_due_handicaps(old.id, null);
  if new.handicap_index is not null then
    update public.trip_members m
       set handicap_index = new.handicap_index, index_entered_at = now()
     where m.profile_id = new.id and m.index_locked_at is null;
  end if;
  return new;
end;
$$;

create trigger profiles_index_changing
  before update of handicap_index on public.profiles
  for each row when (new.handicap_index is distinct from old.handicap_index)
  execute function private.profiles_index_changing();

-- A profile that is being deleted leaves its trips with the index they had.
create function private.profiles_leaving() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.trip_members m
     set index_locked_at = coalesce(m.index_locked_at, now()), claimed_at = null
   where m.profile_id = old.id;
  return old;
end;
$$;

create trigger profiles_leaving before delete on public.profiles
  for each row execute function private.profiles_leaving();

-- Trips already past their lock (Southern Pines) are locked as they stand.
update public.trip_members m
   set index_locked_at = now()
 where m.index_locked_at is null and private.handicaps_locked(m.trip_id);

-- ── Claiming a membership ───────────────────────────────────────────────────

-- Links a member row to a signed-in person. Returns false when that person is already on the trip.
create function private.claim_member(p_member_id uuid, p_profile_id uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_member  public.trip_members;
  v_profile public.profiles;
begin
  select * into v_member from public.trip_members m where m.id = p_member_id for update;
  select * into v_profile from public.profiles p where p.id = p_profile_id;
  if v_member.id is null or v_profile.id is null then return false; end if;
  if v_member.profile_id = p_profile_id then return true; end if;
  if v_member.profile_id is not null
     or exists (select 1 from public.trip_members m
                where m.trip_id = v_member.trip_id and m.profile_id = p_profile_id)
     or exists (select 1 from public.trip_members m
                where m.trip_id = v_member.trip_id and m.email = v_profile.email and m.id <> v_member.id) then
    return false;
  end if;

  -- A new account takes the name and index the organizer entered for it.
  update public.profiles p
     set display_name = case when btrim(p.display_name) = '' then v_member.name else p.display_name end,
         handicap_index = coalesce(p.handicap_index, v_member.handicap_index)
   where p.id = p_profile_id
  returning * into v_profile;

  -- Joining copies the person's current index onto the trip; after the lock it stays there.
  update public.trip_members m
     set profile_id = p_profile_id,
         claimed_at = now(),
         invite_token_hash = null,
         email = v_profile.email,
         handicap_index = coalesce(v_profile.handicap_index, m.handicap_index),
         index_entered_at = case when v_profile.handicap_index is not null then now() else m.index_entered_at end,
         index_locked_at = case when private.handicaps_locked(m.trip_id) then coalesce(m.index_locked_at, now()) end
   where m.id = p_member_id;
  return true;
end;
$$;

-- When a person's email is verified (their first code, or a changed address): make or update
-- their profile, and give them every unclaimed membership the organizer entered that email for.
create function private.auth_user_saved() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_member uuid;
begin
  if new.email is null or new.email_confirmed_at is null or coalesce(new.is_anonymous, false) then
    return new;
  end if;

  insert into public.profiles (id, email) values (new.id, lower(new.email))
  on conflict (id) do update set email = excluded.email;

  for v_member in
    select m.id from public.trip_members m where m.profile_id is null and m.email = lower(new.email)
  loop
    perform private.claim_member(v_member, new.id);
  end loop;
  return new;
end;
$$;

create trigger teed_auth_user_saved
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function private.auth_user_saved();

-- An email typed onto a member: tidy it, and if that person already has an account, they're on.
create function private.trip_members_email_tidy() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.email := nullif(lower(btrim(new.email)), '');
  if tg_op = 'UPDATE' and old.profile_id is not null and new.profile_id is not distinct from old.profile_id
     and new.email is distinct from old.email then
    raise exception 'This person has signed in: their email is the one they sign in with' using errcode = '23514';
  end if;
  -- An organizer who hasn't signed in yet (a seeded trip): whoever gets that email gets the trip,
  -- so only the app admin (or SQL) may set it.
  if tg_op = 'UPDATE' and new.role = 'organizer' and new.email is distinct from old.email
     and auth.uid() is not null and not private.is_app_admin() then
    raise exception 'Only the app admin can say who the organizer is' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger trip_members_email_tidy before insert or update of email on public.trip_members
  for each row execute function private.trip_members_email_tidy();

create function private.trip_members_email_claim() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_profile uuid;
begin
  select p.id into v_profile from public.profiles p where p.email = new.email;
  if v_profile is not null then
    perform private.claim_member(new.id, v_profile);
  end if;
  return null;
end;
$$;

create trigger trip_members_email_claim after insert or update of email on public.trip_members
  for each row when (new.profile_id is null and new.email is not null)
  execute function private.trip_members_email_claim();

-- ── Trip lifecycle ──────────────────────────────────────────────────────────

-- Reopening a final trip holds off the automatic final until a round is finalized again. Moving
-- the handicap lock back into the future lets claimed members follow their profiles again.
create function private.trips_changing() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.status = 'final' and new.status <> 'final' then
    new.reopened_at := now();
  elsif new.status = 'final' then
    new.reopened_at := null;
  end if;
  return new;
end;
$$;

create trigger trips_changing before update on public.trips
  for each row execute function private.trips_changing();

create function private.trips_lock_moved() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.handicaps_locked(new.id) then
    update public.trip_members m
       set index_locked_at = null,
           handicap_index = coalesce(
             (select p.handicap_index from public.profiles p where p.id = m.profile_id), m.handicap_index)
     where m.trip_id = new.id and m.index_locked_at is not null;
  end if;
  return null;
end;
$$;

create trigger trips_lock_moved after update of handicap_lock_date, status on public.trips
  for each row
  when (new.handicap_lock_date is distinct from old.handicap_lock_date or new.status is distinct from old.status)
  execute function private.trips_lock_moved();

-- A published trip becomes final on its own once every round is final and its last day has
-- passed (from noon UTC the day after: early morning in the US).
create function private.finalize_due_trips(p_trip_id uuid default null) returns void
language sql volatile security definer set search_path = ''
as $$
  update public.trips t
     set status = 'final'
   where t.status = 'live'
     and t.reopened_at is null
     and (p_trip_id is null or t.id = p_trip_id)
     and now() >= (t.end_date + 1)::timestamp at time zone 'UTC' + interval '12 hours'
     and exists (select 1 from public.rounds r where r.trip_id = t.id)
     and not exists (select 1 from public.rounds r where r.trip_id = t.id and r.status <> 'final');
$$;

create function private.rounds_finalized() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.trips t set reopened_at = null where t.id = new.trip_id and t.reopened_at is not null;
  perform private.finalize_due_trips(new.trip_id);
  return null;
end;
$$;

create trigger rounds_finalized after update of status on public.rounds
  for each row when (new.status = 'final' and old.status <> 'final')
  execute function private.rounds_finalized();

-- ── What the app calls ──────────────────────────────────────────────────────

-- The signed-in person, with what they may do app-wide.
create function public.me() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'email', p.email,
    'handicap_index', p.handicap_index,
    'is_admin', p.is_admin,
    'is_trip_creator', private.can_create_trips())
  from public.profiles p
  where p.id = auth.uid();
$$;

-- Every trip the caller is on, soonest first: status, dates, player count and their role.
-- bucket: 'next' (in progress, else the soonest to come), 'upcoming' or 'past'.
-- finish and winnings are for final trips; null until the scoring engine can supply them.
create function public.my_trips() returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return '[]'::jsonb; end if;
  perform private.finalize_due_trips(m.trip_id) from public.trip_members m where m.profile_id = v_uid;
  perform private.lock_due_handicaps(v_uid, null);

  return (
    with mine as (
      select t.id, t.name, t.location, t.start_date, t.end_date, t.status, m.role, m.id as member_id,
             case
               when t.status = 'draft' then 'draft'
               when t.status = 'final' then 'final'
               when current_date < t.start_date then 'upcoming'
               else 'in_progress'
             end as stage,
             (select count(*) from public.trip_members x where x.trip_id = t.id) as player_count
      from public.trip_members m
      join public.trips t on t.id = m.trip_id
      where m.profile_id = v_uid and (m.role <> 'player' or t.status <> 'draft')
    ), ranked as (
      select mine.*,
             row_number() over (partition by (stage = 'final')
                                order by (stage = 'in_progress') desc, start_date, name) as n
      from mine
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', id, 'name', name, 'location', location, 'start_date', start_date, 'end_date', end_date,
             'status', status, 'stage', stage, 'role', role, 'member_id', member_id,
             'player_count', player_count,
             'bucket', case when stage = 'final' then 'past' when n = 1 then 'next' else 'upcoming' end,
             'finish', null, 'winnings', null)
           order by (stage = 'final'), case when stage = 'final' then null else n end, start_date desc), '[]'::jsonb)
    from ranked);
end;
$$;

-- The caller's standing on one trip: 'admin' (app admin who isn't on it), a role, or null.
create function public.trip_role(p_trip_id uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when private.my_player_id(p_trip_id) is not null then private.my_role(p_trip_id)
    when private.is_app_admin() then 'admin'
  end;
$$;

-- The people on a trip, for anyone who can read it. The organizer, co-organizers and the app
-- admin also get each person's email, phone, invite state and the "!" flags; players don't.
create function public.trip_roster(p_trip_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_manager boolean := private.is_trip_admin(p_trip_id);
  v_buy_in  numeric;
begin
  if not private.can_read_trip(p_trip_id) then
    raise exception 'Not on this trip' using errcode = '42501';
  end if;
  perform private.lock_due_handicaps(null, p_trip_id);
  select t.buy_in_amount into v_buy_in from public.trips t where t.id = p_trip_id;

  return (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', m.id, 'name', m.name, 'initials', m.initials, 'role', m.role,
        'handicap_index', m.handicap_index, 'index_locked', m.index_locked_at is not null,
        'buy_in_paid', m.buy_in_paid, 'sort_order', m.sort_order,
        'is_me', m.profile_id is not null and m.profile_id = auth.uid())
      || case when v_manager then jsonb_build_object(
           'email', m.email,
           'phone', (select c.phone from public.member_contacts c where c.player_id = m.id),
           'claimed', m.profile_id is not null,
           'invited_at', m.invited_at,
           'flags', jsonb_build_object(
             'no_email', m.email is null,
             'not_claimed', m.profile_id is null,
             'not_paid', coalesce(v_buy_in, 0) > 0 and not m.buy_in_paid))
         else '{}'::jsonb end
      order by m.sort_order, m.name), '[]'::jsonb)
    from public.trip_members m
    where m.trip_id = p_trip_id);
end;
$$;

-- Creates a trip. The creator is its organizer, in the same transaction.
create function public.create_trip(p_name text, p_slug text, p_location text, p_start_date date, p_end_date date)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_profile public.profiles;
  v_name    text;
  v_trip    uuid;
begin
  if not private.can_create_trips() then
    raise exception 'Only trip creators can create a trip' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles p where p.id = auth.uid();
  v_name := left(coalesce(nullif(btrim(v_profile.display_name), ''), split_part(v_profile.email, '@', 1)), 40);

  insert into public.trips (name, slug, location, start_date, end_date, theme)
  values (p_name, p_slug, p_location, p_start_date, p_end_date, 'tour')
  returning id into v_trip;

  insert into public.trip_members (trip_id, name, initials, role, profile_id, email, claimed_at,
                                   handicap_index, index_entered_at, sort_order)
  values (v_trip, v_name, private.initials_for(v_name), 'organizer', v_profile.id, v_profile.email, now(),
          v_profile.handicap_index, case when v_profile.handicap_index is not null then now() end, 1);
  return v_trip;
end;
$$;

-- Adds a person to a trip and returns {id, token, claimed}. token goes in the invite link the
-- organizer texts; it is null when the email belongs to someone who already has an account
-- (they are on the trip at once). Only the organizer may add a co-organizer.
create function public.add_member(
  p_trip_id uuid, p_name text, p_email text default null, p_role text default 'player',
  p_handicap_index numeric default null, p_initials text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text := private.new_token();
  v_id    uuid;
  v_claimed boolean;
begin
  if p_role not in ('player', 'co_organizer') then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  if not private.is_trip_admin(p_trip_id) or (p_role = 'co_organizer' and not private.is_trip_owner(p_trip_id)) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  insert into public.trip_members (trip_id, name, initials, role, email, handicap_index, index_entered_at,
                                   index_locked_at, invite_token_hash, invited_by, invited_at, sort_order)
  values (p_trip_id, btrim(p_name), coalesce(nullif(upper(btrim(p_initials)), ''), private.initials_for(p_name)),
          p_role, p_email, p_handicap_index, case when p_handicap_index is not null then now() end,
          case when private.handicaps_locked(p_trip_id) then now() end,
          private.token_hash(v_token), auth.uid(), now(),
          coalesce((select max(m.sort_order) from public.trip_members m where m.trip_id = p_trip_id), 0) + 1)
  returning id into v_id;

  select m.profile_id is not null into v_claimed from public.trip_members m where m.id = v_id;
  return jsonb_build_object('id', v_id, 'token', case when v_claimed then null else v_token end, 'claimed', v_claimed);
end;
$$;

-- A fresh invite link for someone who hasn't joined yet. The link sent before stops working.
create function public.invite_member(p_member_id uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text := private.new_token();
begin
  if not private.is_trip_admin(private.player_trip_id(p_member_id))
     -- the organizer's own seat, if nobody has taken it yet, is the app admin's to hand out
     or (not private.is_app_admin()
         and exists (select 1 from public.trip_members m where m.id = p_member_id and m.role = 'organizer')) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.trip_members m
     set invite_token_hash = private.token_hash(v_token), invited_by = auth.uid(), invited_at = now()
   where m.id = p_member_id and m.profile_id is null;
  if not found then
    raise exception 'This person has already joined' using errcode = '23514';
  end if;
  return v_token;
end;
$$;

-- Player ↔ co-organizer. Organizer (or app admin) only; the organizer's own role changes only by hand-off.
create function public.set_member_role(p_member_id uuid, p_role text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_role not in ('player', 'co_organizer') then
    raise exception 'Unknown role' using errcode = '22023';
  end if;
  if not private.is_trip_owner(private.player_trip_id(p_member_id)) then
    raise exception 'Only the organizer can change roles' using errcode = '42501';
  end if;
  update public.trip_members m set role = p_role where m.id = p_member_id and m.role <> 'organizer';
  if not found then
    raise exception 'The organizer changes only by handing the trip off' using errcode = '23514';
  end if;
end;
$$;

-- Hands the trip to another member, who must have signed in. The old organizer stays on as a
-- co-organizer. One transaction: the trip is never without an organizer.
create function public.hand_off_trip(p_trip_id uuid, p_member_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_trip_owner(p_trip_id) then
    raise exception 'Only the organizer can hand the trip off' using errcode = '42501';
  end if;
  if not exists (select 1 from public.trip_members m
                 where m.id = p_member_id and m.trip_id = p_trip_id
                   and m.role <> 'organizer' and m.profile_id is not null) then
    raise exception 'The new organizer has to be on the trip and signed in' using errcode = '23514';
  end if;
  update public.trip_members m set role = 'co_organizer' where m.trip_id = p_trip_id and m.role = 'organizer';
  update public.trip_members m set role = 'organizer' where m.id = p_member_id;
end;
$$;

-- Sets a member's index. Before the lock, for someone who has signed in, this is their profile's
-- index (and so every unlocked trip of theirs); otherwise it is this trip's copy alone.
create function public.set_member_index(p_member_id uuid, p_handicap_index numeric) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.trip_members;
begin
  select * into v_member from public.trip_members m where m.id = p_member_id;
  if v_member.id is null or not private.is_trip_admin(v_member.trip_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  perform private.lock_due_handicaps(null, v_member.trip_id);
  select * into v_member from public.trip_members m where m.id = p_member_id;

  if v_member.profile_id is not null and v_member.index_locked_at is null and p_handicap_index is not null then
    update public.profiles p set handicap_index = p_handicap_index where p.id = v_member.profile_id;
  else
    update public.trip_members m
       set handicap_index = p_handicap_index, index_entered_at = now()
     where m.id = p_member_id;
  end if;
end;
$$;

-- After signing in from an invite link: join the trip, or become a trip creator.
-- Returns {status: 'ok', kind: 'trip', trip_id} | {status: 'ok', kind: 'creator'}
--       | {status: 'already_on_trip', trip_id} | {status: 'invalid'}.
create function public.claim_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_hash    text := private.token_hash(coalesce(p_token, ''));
  v_member  public.trip_members;
  v_creator public.trip_creators;
begin
  if v_uid is null or not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  select * into v_member from public.trip_members m where m.invite_token_hash = v_hash;
  if v_member.id is not null then
    if private.claim_member(v_member.id, v_uid) then
      return jsonb_build_object('status', 'ok', 'kind', 'trip', 'trip_id', v_member.trip_id);
    end if;
    return jsonb_build_object('status', 'already_on_trip', 'trip_id', v_member.trip_id);
  end if;

  select * into v_creator from public.trip_creators c where c.invite_token_hash = v_hash;
  if v_creator.id is not null then
    if exists (select 1 from public.trip_creators c where c.profile_id = v_uid) then
      delete from public.trip_creators c where c.id = v_creator.id;
    else
      update public.trip_creators c
         set profile_id = v_uid, claimed_at = now(), invite_token_hash = null
       where c.id = v_creator.id;
      update public.profiles p set display_name = v_creator.name
       where p.id = v_uid and btrim(p.display_name) = '';
    end if;
    return jsonb_build_object('status', 'ok', 'kind', 'creator');
  end if;

  return jsonb_build_object('status', 'invalid');
end;
$$;

-- What an invite link shows before sign-in. Called by the `invite` edge function only.
create function public.invite_preview(p_token text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
              'kind', 'trip',
              'inviter', coalesce(
                (select nullif(btrim(p.display_name), '') from public.profiles p where p.id = m.invited_by),
                (select o.name from public.trip_members o where o.trip_id = m.trip_id and o.role = 'organizer')),
              'name', m.name,
              'email', m.email,
              'trip', jsonb_build_object(
                'name', t.name, 'start_date', t.start_date, 'end_date', t.end_date,
                'players', (select count(*) from public.trip_members x where x.trip_id = t.id)))
       from public.trip_members m
       join public.trips t on t.id = m.trip_id
      where m.invite_token_hash = private.token_hash(coalesce(p_token, ''))),
    (select jsonb_build_object(
              'kind', 'creator',
              'inviter', (select nullif(btrim(p.display_name), '') from public.profiles p where p.id = c.invited_by),
              'name', c.name)
       from public.trip_creators c
      where c.invite_token_hash = private.token_hash(coalesce(p_token, ''))));
$$;

-- App admin: add someone who may create trips. Returns {id, token} for the invite link.
create function public.add_trip_creator(p_name text, p_phone text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text := private.new_token();
  v_id    uuid;
begin
  if not private.is_app_admin() then
    raise exception 'Only the app admin manages trip creators' using errcode = '42501';
  end if;
  insert into public.trip_creators (name, phone, invite_token_hash, invited_by)
  values (btrim(p_name), p_phone, private.token_hash(v_token), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token);
end;
$$;

create function public.invite_trip_creator(p_creator_id uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_token text := private.new_token();
begin
  if not private.is_app_admin() then
    raise exception 'Only the app admin manages trip creators' using errcode = '42501';
  end if;
  update public.trip_creators c
     set invite_token_hash = private.token_hash(v_token), invited_by = auth.uid()
   where c.id = p_creator_id and c.profile_id is null;
  if not found then
    raise exception 'This person has already signed in' using errcode = '23514';
  end if;
  return v_token;
end;
$$;

-- ── Spectators ──────────────────────────────────────────────────────────────

-- Format settings without the money: bets, buy-ins, pots, stakes, payouts.
create function private.without_money(p_settings jsonb) returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  from jsonb_each(p_settings) as e
  where e.key !~ '(value|buy_in|pot|stake|amount|payout|money|wager|skin_worth)';
$$;

-- Everything a spectator link shows: the trip's name and dates, its rounds, groups, scores and
-- presses, which is what the leaderboards are worked out from. No itinerary, no emails, roles or
-- buy-ins; money settings only when the trip says spectators see winnings. Null for an unknown
-- or reset link and for a trip that isn't published. Called by the `spectate` edge function only.
create function public.spectator_view(p_token_hash text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'trip', jsonb_build_object(
      'name', t.name, 'location', t.location, 'start_date', t.start_date, 'end_date', t.end_date,
      'status', t.status, 'handicap_allowance', t.handicap_allowance, 'strokes_off_low', t.strokes_off_low,
      'pickup_net_double', t.pickup_net_double, 'shows_winnings', t.spectators_see_money),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'round_number', r.round_number, 'play_date', r.play_date, 'tee_time', r.tee_time,
        'status', r.status,
        'course', (select jsonb_build_object('name', c.name, 'short_name', c.short_name, 'photo_path', c.photo_path)
                     from public.courses c where c.id = r.course_id),
        'tee', (select jsonb_build_object('name', x.name, 'yards', x.yards, 'rating', x.rating, 'slope', x.slope,
                                          'par', x.par, 'stroke_index', x.stroke_index)
                  from public.tees x where x.id = r.tee_id),
        'formats', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', f.id, 'format_key', f.format_key,
                   'settings', case when t.spectators_see_money then f.settings else private.without_money(f.settings) end)
                 order by f.sort_order, f.format_key)
          from public.round_formats f where f.round_id = r.id), '[]'::jsonb),
        'groups', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'id', g.id, 'group_number', g.group_number, 'tee_time', g.tee_time,
                   'players', coalesce((
                     select jsonb_agg(jsonb_build_object(
                              'id', m.id, 'name', m.name, 'initials', m.initials, 'position', gp.position,
                              'team', gp.team, 'handicap_index', m.handicap_index,
                              'course_handicap', gp.course_handicap, 'playing_handicap', gp.playing_handicap)
                            order by gp.position)
                     from public.group_players gp
                     join public.trip_members m on m.id = gp.player_id
                     where gp.group_id = g.id), '[]'::jsonb))
                 order by g.group_number)
          from public.groups g where g.round_id = r.id), '[]'::jsonb),
        'scores', coalesce((
          select jsonb_agg(jsonb_build_object('player_id', s.player_id, 'hole', s.hole, 'strokes', s.strokes)
                           order by s.player_id, s.hole)
          from public.scores s where s.round_id = r.id), '[]'::jsonb),
        'presses', coalesce((
          select jsonb_agg(jsonb_build_object('round_format_id', p.round_format_id, 'group_id', p.group_id,
                                              'bet', p.bet, 'after_hole', p.after_hole)
                           order by p.after_hole)
          from public.presses p where p.round_id = r.id), '[]'::jsonb))
        order by r.round_number)
      from public.rounds r where r.trip_id = t.id), '[]'::jsonb))
  from public.spectator_links l
  join public.trips t on t.id = l.trip_id
  where l.token_hash = p_token_hash and t.status in ('live', 'final');
$$;

-- ── Privileges ──────────────────────────────────────────────────────────────

revoke all on public.profiles, public.trip_creators, public.spectator_links, public.alerts from anon, authenticated;
grant all on public.profiles, public.trip_creators, public.spectator_links, public.alerts to service_role;

-- profiles: read your own row; change only your name and index. is_admin and email are not writable.
grant select on public.profiles to authenticated;
grant update (display_name, handicap_index) on public.profiles to authenticated;

-- trip_members: the roster columns only. Email, the account link and invite state are read
-- through trip_roster(), which gives them to the organizer and co-organizers alone. Adding
-- people, roles and the index go through the functions above.
revoke select, insert, update on public.trip_members from authenticated;
grant select (id, trip_id, name, initials, role, handicap_index, index_entered_at, index_locked_at,
              sort_order, created_at, buy_in_paid)
  on public.trip_members to authenticated;
grant update (name, initials, email, sort_order, buy_in_paid) on public.trip_members to authenticated;

-- trips are created by create_trip().
revoke insert on public.trips from authenticated;

grant select (id, name, phone, profile_id, created_at, claimed_at) on public.trip_creators to authenticated;
grant delete on public.trip_creators to authenticated;
grant select, insert, delete on public.alerts to authenticated;
-- spectator_links: no client access at all; the edge functions use the service role.

revoke all on all functions in schema private from public;
grant execute on all functions in schema private to authenticated, service_role;

revoke all on function
  public.me(), public.my_trips(), public.trip_role(uuid), public.trip_roster(uuid),
  public.create_trip(text, text, text, date, date),
  public.add_member(uuid, text, text, text, numeric, text), public.invite_member(uuid),
  public.set_member_role(uuid, text), public.hand_off_trip(uuid, uuid),
  public.set_member_index(uuid, numeric), public.claim_invite(text),
  public.add_trip_creator(text, text), public.invite_trip_creator(uuid),
  public.invite_preview(text), public.spectator_view(text)
  from public, anon, authenticated;

grant execute on function
  public.me(), public.my_trips(), public.trip_role(uuid), public.trip_roster(uuid),
  public.create_trip(text, text, text, date, date),
  public.add_member(uuid, text, text, text, numeric, text), public.invite_member(uuid),
  public.set_member_role(uuid, text), public.hand_off_trip(uuid, uuid),
  public.set_member_index(uuid, numeric), public.claim_invite(text),
  public.add_trip_creator(text, text), public.invite_trip_creator(uuid)
  to authenticated, service_role;

grant execute on function public.invite_preview(text), public.spectator_view(text) to service_role;

-- ── Policies ────────────────────────────────────────────────────────────────
-- Most of 0003's policies stand as written: the functions they call now mean the roles above.
-- These are the ones whose rule itself changed, and those for the new tables.

alter table public.profiles        enable row level security;
alter table public.trip_creators   enable row level security;
alter table public.spectator_links enable row level security;
alter table public.alerts          enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or private.is_app_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy trip_creators_select on public.trip_creators for select to authenticated
  using (private.is_app_admin());
create policy trip_creators_delete on public.trip_creators for delete to authenticated
  using (private.is_app_admin());

-- trips: deleting is the organizer's (and the app admin's).
create policy trips_delete on public.trips for delete to authenticated
  using (private.is_trip_owner(id));

-- trip_members: everyone on the trip reads the roster. The organizer and co-organizers edit it
-- and remove players; only the organizer removes a co-organizer; the organizer's row stays.
drop policy players_select on public.trip_members;
drop policy players_insert on public.trip_members;
drop policy players_update on public.trip_members;
drop policy players_delete on public.trip_members;

create policy trip_members_select on public.trip_members for select to authenticated
  using (private.can_read_trip(trip_id));
create policy trip_members_update on public.trip_members for update to authenticated
  using (private.is_trip_admin(trip_id)) with check (private.is_trip_admin(trip_id));
create policy trip_members_delete on public.trip_members for delete to authenticated
  using ((role = 'player' and private.is_trip_admin(trip_id))
      or (role = 'co_organizer' and private.is_trip_owner(trip_id)));

drop policy player_contacts_owner on public.member_contacts;
create policy member_contacts_admin on public.member_contacts for all to authenticated
  using (private.is_trip_admin(private.player_trip_id(player_id)))
  with check (private.is_trip_admin(private.player_trip_id(player_id)));

-- rounds: co-organizers delete them too.
drop policy rounds_delete on public.rounds;
create policy rounds_delete on public.rounds for delete to authenticated
  using (private.is_trip_admin(trip_id));

-- Course library: anyone who may create trips adds and edits courses; deleting stays with the app admin.
drop policy courses_insert on public.courses;
drop policy courses_update on public.courses;
drop policy tees_insert on public.tees;
drop policy tees_update on public.tees;
create policy courses_insert on public.courses for insert to authenticated with check (private.can_create_trips());
create policy courses_update on public.courses for update to authenticated
  using (private.can_create_trips()) with check (private.can_create_trips());
create policy tees_insert on public.tees for insert to authenticated with check (private.can_create_trips());
create policy tees_update on public.tees for update to authenticated
  using (private.can_create_trips()) with check (private.can_create_trips());
create policy tees_delete_creator on public.tees for delete to authenticated using (private.can_create_trips());

-- Itinerary suggestions: a player suggests and sees their own; the organizer and co-organizers
-- (who edit the itinerary directly) review them.
drop policy itinerary_proposals_admin on public.itinerary_proposals;
create policy itinerary_proposals_select on public.itinerary_proposals for select to authenticated
  using (private.is_trip_admin(trip_id) or proposed_by = private.my_player_id(trip_id));
create policy itinerary_proposals_insert on public.itinerary_proposals for insert to authenticated
  with check (not private.is_trip_admin(trip_id)
              and proposed_by = private.my_player_id(trip_id)
              and status = 'pending' and reviewed_by is null and reviewed_at is null);
create policy itinerary_proposals_update on public.itinerary_proposals for update to authenticated
  using (private.is_trip_admin(trip_id)) with check (private.is_trip_admin(trip_id));
create policy itinerary_proposals_delete on public.itinerary_proposals for delete to authenticated
  using (private.is_trip_admin(trip_id));

-- Alerts: everyone on the trip reads; the organizer and co-organizers send.
create policy alerts_select on public.alerts for select to authenticated
  using (private.can_read_trip(trip_id));
create policy alerts_insert on public.alerts for insert to authenticated
  with check (private.is_trip_admin(trip_id) and sent_by = auth.uid());
create policy alerts_delete on public.alerts for delete to authenticated
  using (private.is_trip_admin(trip_id));

-- Push: for trips you are on (the app admin too: only their own trips).
drop policy push_subscriptions_insert on public.push_subscriptions;
drop policy push_subscriptions_update on public.push_subscriptions;
create policy push_subscriptions_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = auth.uid() and private.my_player_id(trip_id) is not null);
create policy push_subscriptions_update on public.push_subscriptions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and private.my_player_id(trip_id) is not null);

-- Course photos follow the course library.
do $$
begin
  if to_regclass('storage.objects') is null then
    return;
  end if;
  drop policy if exists course_photos_insert on storage.objects;
  drop policy if exists course_photos_update on storage.objects;
  create policy course_photos_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'course-photos' and private.can_create_trips());
  create policy course_photos_update on storage.objects for update to authenticated
    using (bucket_id = 'course-photos' and private.can_create_trips())
    with check (bucket_id = 'course-photos' and private.can_create_trips());
end;
$$;
