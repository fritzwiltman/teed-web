-- M3a: admin, part 1. No changes to existing tables.
--
--   * player_contacts: a player's phone number, for texting them their code. Owner only, and in
--     its own table so it never rides along with the roster that everyone on the trip can read.
--   * replace_player(): someone drops out and someone else takes the slot.
--   * issue_spectator_code(): the trip's spectator code, created or regenerated.
--   * course-photos storage bucket.

create table public.player_contacts (
  player_id  uuid primary key references public.players (id) on delete cascade,
  phone      text not null check (phone ~ '^\+?[0-9]{7,15}$'),
  updated_at timestamptz not null default now()
);

alter table public.player_contacts enable row level security;
revoke all on public.player_contacts from anon, authenticated;
grant select, insert, update, delete on public.player_contacts to authenticated;
grant all on public.player_contacts to service_role;

create policy player_contacts_owner on public.player_contacts for all to authenticated
  using (private.is_trip_owner(private.player_trip_id(player_id)))
  with check (private.is_trip_owner(private.player_trip_id(player_id)));

-- Puts a new person in a roster slot. The slot keeps its groups, teams and tee times; the old
-- person's code stops working, their phones are signed out, and their handicap, GHIN number and
-- phone number are cleared. Returns the new code. Trip owner only.
create function public.replace_player(p_player_id uuid, p_name text, p_initials text) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_trip_owner(private.player_trip_id(p_player_id)) then
    raise exception 'Only the trip owner can replace a player' using errcode = '42501';
  end if;

  update public.players
     set name = btrim(p_name), initials = upper(btrim(p_initials)), role = 'player',
         handicap_index = null, index_entered_at = null, index_locked_at = null
   where id = p_player_id;
  delete from public.player_ghin where player_id = p_player_id;
  delete from public.player_contacts where player_id = p_player_id;
  delete from public.trip_sessions where player_id = p_player_id;

  return public.regenerate_player_code(p_player_id);
end;
$$;

-- The trip's spectator code (SLUG-WATCH-XXXX). Creates it the first time; after that, issues a
-- new one, which signs out everyone watching with the old one. Trip owner only.
create function public.issue_spectator_code(p_trip_id uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_slug text;
  v_code text;
  v_id uuid;
begin
  if not private.is_trip_owner(p_trip_id) then
    raise exception 'Only the trip owner can issue codes' using errcode = '42501';
  end if;
  select t.slug into v_slug from public.trips t where t.id = p_trip_id;
  select c.id into v_id from public.spectator_codes c where c.trip_id = p_trip_id order by c.created_at limit 1;

  for attempt in 1..5 loop
    v_code := v_slug || '-WATCH-' || private.random_code_suffix();
    begin
      if v_id is null then
        insert into public.spectator_codes (trip_id, code) values (p_trip_id, v_code);
      else
        update public.spectator_codes set code = v_code where id = v_id;
      end if;
      return v_code;
    exception when unique_violation then
      null;   -- try another
    end;
  end loop;
  raise exception 'Could not generate a unique code';
end;
$$;

revoke all on function public.replace_player(uuid, text, text) from public, anon;
revoke all on function public.issue_spectator_code(uuid) from public, anon;
grant execute on function public.replace_player(uuid, text, text) to authenticated, service_role;
grant execute on function public.issue_spectator_code(uuid) to authenticated, service_role;

-- ── Course photos ───────────────────────────────────────────────────────────
-- A public bucket (photos are shown to everyone on a trip); only app admins can write to it.
-- Skipped where Supabase Storage isn't running (the database-only test stack).
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'Supabase Storage not present: skipping the course-photos bucket.';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('course-photos', 'course-photos', true, 2097152, array['image/jpeg', 'image/webp'])
  on conflict (id) do nothing;

  create policy course_photos_select on storage.objects for select to authenticated
    using (bucket_id = 'course-photos');
  create policy course_photos_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'course-photos' and private.is_app_admin());
  create policy course_photos_update on storage.objects for update to authenticated
    using (bucket_id = 'course-photos' and private.is_app_admin())
    with check (bucket_id = 'course-photos' and private.is_app_admin());
  create policy course_photos_delete on storage.objects for delete to authenticated
    using (bucket_id = 'course-photos' and private.is_app_admin());
end;
$$;
