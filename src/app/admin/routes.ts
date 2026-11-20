import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { AuthService } from '../core/auth';
import { SessionService } from '../core/session';
import { AdminHome } from './admin-home';
import { AdminShell } from './admin-shell';
import { CourseAdd } from './course-add';
import { CourseEdit } from './course-edit';
import { Courses } from './courses';
import { Creators } from './creators';
import { AdminData } from './data';
import { MyTrips } from './my-trips';
import { Roster } from './roster';
import { Rounds } from './rounds';
import { Stub } from './stub';
import { TripDetails } from './trip-details';

/** Signed in, and one of the people who may create trips (or the app admin). */
export const creatorOnly: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready();
  const me = auth.me();
  if (!me) return router.parseUrl('/login');
  return me.is_trip_creator || me.is_admin ? true : router.parseUrl('/you');
};

/** The app admin's own screens: every trip, and who may create trips. */
export const adminOnly: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready();
  const me = auth.me();
  if (!me) return router.parseUrl('/login');
  return me.is_admin ? true : router.parseUrl('/you');
};

/**
 * One trip's organizer screens: its organizer, a co-organizer, or the app admin. (What each can
 * actually change is decided by the database.) With no signal, the open trip's saved role decides.
 */
export const tripAdmin: CanActivateFn = async (route) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const sessions = inject(SessionService);
  const data = inject(AdminData);
  const id = route.paramMap.get('id') ?? '';
  await auth.ready();
  if (!auth.me()) return router.parseUrl('/login');
  try {
    const role = await data.tripRole(id);
    return role && role !== 'player' ? true : router.parseUrl('/you');
  } catch {
    return sessions.session()?.trip.id === id && sessions.canManage()
      ? true
      : router.parseUrl('/you');
  }
};

const trip = { canActivate: [tripAdmin] };
const own = { canActivate: [creatorOnly] };
const admin = { canActivate: [adminOnly] };

export const ADMIN_ROUTES: Routes = [
  { path: 'sign-in', redirectTo: '/login' },
  {
    path: '',
    component: AdminShell,
    children: [
      { path: '', component: MyTrips, title: 'Teed · All trips', ...admin },
      { path: 'creators', component: Creators, title: 'Teed · Trip creators', ...admin },
      { path: 'trips/new', component: TripDetails, title: 'Teed · New trip', ...own },
      { path: 'trips/:id', component: AdminHome, title: 'Teed · Overview', ...trip },
      { path: 'trips/:id/details', component: TripDetails, title: 'Teed · Trip details', ...trip },
      { path: 'trips/:id/rounds', component: Rounds, title: 'Teed · Rounds', ...trip },
      {
        path: 'trips/:id/rounds/new',
        component: Stub,
        title: 'Teed · Add round',
        data: { heading: 'Add round', back: 'rounds', backLabel: 'Rounds' },
        ...trip,
      },
      { path: 'trips/:id/roster', component: Roster, title: 'Teed · People', ...trip },
      {
        path: 'trips/:id/itinerary',
        component: Stub,
        title: 'Teed · Itinerary',
        data: { heading: 'Itinerary' },
        ...trip,
      },
      { path: 'courses', component: Courses, title: 'Teed · Course library', ...own },
      { path: 'courses/add', component: CourseAdd, title: 'Teed · Add a course', ...own },
      { path: 'courses/:id', component: CourseEdit, title: 'Teed · Course', ...own },
    ],
  },
];
