-- What 0008 must have made of scripts/migration-test/before.sql (pgTAP).
begin;
select * from no_plan();

select results_eq(
  $$ select email, is_admin, display_name, handicap_index from public.profiles $$,
  $$ values ('owner@example.com', true, 'Fritz', 17.9::numeric(3,1)) $$,
  'the owner has a profile: app admin, named as on their trips, with their latest index');

select results_eq(
  $$ select t.slug, m.name, m.profile_id is not null, m.claimed_at is not null
     from public.trips t join public.trip_members m on m.trip_id = t.id and m.role = 'organizer' order by t.slug $$,
  $$ values ('PINES', 'Fritz', true, true), ('VERO', 'Fritz', true, true), ('VIC', 'Fritz', true, true) $$,
  'every trip has one organizer linked to the owner''s account: "This is me" where set, else a new member');

select results_eq(
  $$ select m.name, m.role from public.trip_members m join public.trips t on t.id = m.trip_id
     where t.slug = 'VERO' order by m.sort_order $$,
  $$ values ('Fritz', 'organizer'), ('Von', 'co_organizer'), ('Matt', 'player') $$,
  'co-admins are co-organizers; players stay players');

select results_eq(
  $$ select scores, strokes, history, slots from public.before_0008 $$,
  $$ select (select count(*) from public.scores), (select sum(strokes) from public.scores),
            (select count(*) from public.score_history), (select count(*) from public.group_players) $$,
  'no score, history row or group slot was lost or changed');

select is(
  (select jsonb_agg(jsonb_build_array(m.id, m.name, m.handicap_index) order by m.id)
     from public.trip_members m where m.id in (select (e ->> 0)::uuid from public.before_0008 b, jsonb_array_elements(b.people) e)),
  (select people from public.before_0008),
  'every member kept their id, name and handicap');

select results_eq(
  $$ select t.slug, bool_and(m.index_locked_at is not null) from public.trip_members m
     join public.trips t on t.id = m.trip_id where t.slug in ('PINES', 'VERO') group by t.slug order by t.slug $$,
  $$ values ('PINES', true), ('VERO', false) $$,
  'Southern Pines is locked; Vero, weeks from its lock date, is not');

select is((select count(*) from auth.users), 1::bigint, 'the anonymous code-login users are gone');
select is((select count(*) from public.scores where entered_by is not null), 0::bigint,
          'their scores stay, with only "entered by" cleared');
select is((select phone from public.member_contacts where player_id = '00000000-0000-0000-0000-0000000000d2'),
          '+17725550101', 'saved phone numbers are kept');
select is((select count(*) from public.trip_members where email is not null), 3::bigint,
          'only the organizer rows have an email (the owner''s)');

-- Changing the owner's profile index moves Vero (unlocked) but not Southern Pines.
update public.profiles set handicap_index = 15.2;
select results_eq(
  $$ select t.slug, m.handicap_index from public.trip_members m join public.trips t on t.id = m.trip_id
     where m.role = 'organizer' and t.slug in ('PINES', 'VERO') order by t.slug $$,
  $$ values ('PINES', 18.6::numeric(3,1)), ('VERO', 15.2) $$,
  'a new profile index reaches the unlocked trip and leaves the locked one alone');

select * from finish();
rollback;
