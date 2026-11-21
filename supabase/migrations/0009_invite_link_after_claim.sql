-- An invite link still knows its person after it has been taken up.
--
-- 0008 forgot a link's token the moment its membership was claimed. When the organizer had
-- entered the person's email, verifying the code claimed the membership (by email) a moment
-- before the app claimed it by the link, so the link looked unknown and the app said "used or
-- replaced" to someone who had just joined. Now the token hash stays on the row: the person who
-- claimed it is told "ok" every time, and anyone else is told it has been used.
--
-- Still single-use: a claimed link never puts a second person on the trip. Resending an invite
-- still replaces the token, which stops the old link.

create or replace function private.claim_member(p_member_id uuid, p_profile_id uuid) returns boolean
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
  -- invite_token_hash is kept, so the link recognises its owner afterwards.
  update public.trip_members m
     set profile_id = p_profile_id,
         claimed_at = now(),
         email = v_profile.email,
         handicap_index = coalesce(v_profile.handicap_index, m.handicap_index),
         index_entered_at = case when v_profile.handicap_index is not null then now() else m.index_entered_at end,
         index_locked_at = case when private.handicaps_locked(m.trip_id) then coalesce(m.index_locked_at, now()) end
   where m.id = p_member_id;
  return true;
end;
$$;

-- After signing in from an invite link: join the trip, or become a trip creator.
-- Returns {status: 'ok', kind: 'trip', trip_id} | {status: 'ok', kind: 'creator'}
--       | {status: 'already_on_trip', trip_id}   (you are on this trip under another spot)
--       | {status: 'used'}                       (someone else took this link up)
--       | {status: 'invalid'}                    (unknown or replaced link)
create or replace function public.claim_invite(p_token text) returns jsonb
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
    if v_member.profile_id is not null and v_member.profile_id <> v_uid then
      return jsonb_build_object('status', 'used');
    end if;
    -- True too when this person already holds the spot (claimed a moment ago by their email,
    -- or the link opened a second time).
    if private.claim_member(v_member.id, v_uid) then
      return jsonb_build_object('status', 'ok', 'kind', 'trip', 'trip_id', v_member.trip_id);
    end if;
    return jsonb_build_object('status', 'already_on_trip', 'trip_id', v_member.trip_id);
  end if;

  select * into v_creator from public.trip_creators c where c.invite_token_hash = v_hash;
  if v_creator.id is not null then
    if v_creator.profile_id = v_uid then
      return jsonb_build_object('status', 'ok', 'kind', 'creator');
    elsif v_creator.profile_id is not null then
      return jsonb_build_object('status', 'used');
    elsif exists (select 1 from public.trip_creators c where c.profile_id = v_uid) then
      delete from public.trip_creators c where c.id = v_creator.id;
    else
      update public.trip_creators c
         set profile_id = v_uid, claimed_at = now()
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
-- A link that has been taken up still previews, so its owner can sign in from it again, but it
-- no longer gives out an email: by then that is the address the person signs in with.
create or replace function public.invite_preview(p_token text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object(
              'kind', 'trip',
              'inviter', coalesce(
                (select nullif(btrim(p.display_name), '') from public.profiles p where p.id = m.invited_by),
                (select o.name from public.trip_members o where o.trip_id = m.trip_id and o.role = 'organizer')),
              'name', m.name,
              'email', case when m.profile_id is null then m.email end,
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
