-- Production-shaped data as it stood before 0008, on top of the old Southern Pines seed:
-- the owner's email account (an app admin), a live trip with "This is me" set (Vero), an empty
-- draft without it (Vic), and two phones logged in with player codes (anonymous users).
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-00000000000a', 'Owner@Example.com', now());
insert into auth.users (id, is_anonymous) values
  ('00000000-0000-0000-0000-0000000000b1', true), ('00000000-0000-0000-0000-0000000000b2', true);
insert into public.app_admins (user_id) values ('00000000-0000-0000-0000-00000000000a');

update public.trips set owner_id = '00000000-0000-0000-0000-00000000000a' where slug = 'PINES';

insert into public.trips (id, owner_id, name, slug, start_date, end_date, status, handicap_lock_date) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000a', 'Vero Beach 2027', 'VERO', current_date + 50, current_date + 54, 'live', null),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-00000000000a', 'Vic 27', 'VIC', current_date + 200, current_date + 203, 'draft', null);
insert into public.players (id, trip_id, name, initials, role, handicap_index, sort_order) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'Fritz', 'FW', 'player', 17.9, 1),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'Von', 'V', 'co_admin', 7.5, 2),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 'Matt', 'M', 'player', null, 3);
update public.trips set owner_player_id = '00000000-0000-0000-0000-0000000000d1' where slug = 'VERO';
insert into public.player_codes (player_id, code) values ('00000000-0000-0000-0000-0000000000d2', 'K4M-9QT');
insert into public.player_contacts (player_id, phone) values ('00000000-0000-0000-0000-0000000000d2', '+17725550101');
insert into public.trip_sessions (user_id, trip_id, player_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d2');

-- A score entered from one of those phones, to see that it survives the phone's account going.
update public.trips set status = 'live' where slug = 'PINES';
update public.scores s set entered_by = '00000000-0000-0000-0000-0000000000b1'
 where s.hole = 1 and s.round_id = (select r.id from public.rounds r join public.trips t on t.id = r.trip_id
                                     where t.slug = 'PINES' and r.round_number = 1);
update public.trips set status = 'final' where slug = 'PINES';

create table public.before_0008 as
select (select count(*) from public.scores) as scores,
       (select sum(strokes) from public.scores) as strokes,
       (select count(*) from public.score_history) as history,
       (select count(*) from public.group_players) as slots,
       (select jsonb_agg(jsonb_build_array(p.id, p.name, p.handicap_index) order by p.id) from public.players p) as people;
