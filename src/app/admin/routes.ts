import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { SessionService } from '../core/session';
import { AdminAuth } from './auth';
import { AdminHome } from './admin-home';
import { AdminShell } from './admin-shell';
import { CourseAdd } from './course-add';
import { CourseEdit } from './course-edit';
import { Courses } from './courses';
import { MyTrips } from './my-trips';
import { Roster } from './roster';
import { Rounds } from './rounds';
import { SignIn } from './sign-in';
import { Stub } from './stub';
import { TripDetails } from './trip-details';

/** The organizer's own screens (their trips, new trips, the course library): email sign-in only. */
export const organizerOnly: CanActivateFn = async () => {
  const auth = inject(AdminAuth);
  const router = inject(Router);
  await auth.ready();
  return auth.isOrganizer() ? true : router.parseUrl('/admin/sign-in');
};

/**
 * One trip's screens: the organizer, or a co-admin of that trip on the phone they logged in on
 * with their code. (What a co-admin can actually change is decided by the database.)
 */
export const tripAdmin: CanActivateFn = async (route) => {
  const auth = inject(AdminAuth);
  const router = inject(Router);
  const session = inject(SessionService).session();
  await auth.ready();
  if (auth.isOrganizer()) return true;
  const coAdmin =
    session?.via !== 'owner' &&
    session?.player?.role === 'co_admin' &&
    session.trip.id === route.paramMap.get('id');
  return coAdmin ? true : router.parseUrl('/admin/sign-in');
};

const trip = { canActivate: [tripAdmin] };
const own = { canActivate: [organizerOnly] };

export const ADMIN_ROUTES: Routes = [
  { path: 'sign-in', component: SignIn, title: 'Teed · Organizer sign-in' },
  {
    path: '',
    component: AdminShell,
    children: [
      { path: '', component: MyTrips, title: 'Teed · My trips', ...own },
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
