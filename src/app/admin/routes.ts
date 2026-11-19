import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { AdminAuth } from './auth';
import { AdminHome } from './admin-home';
import { CourseAdd } from './course-add';
import { CourseEdit } from './course-edit';
import { Courses } from './courses';
import { MyTrips } from './my-trips';
import { Roster } from './roster';
import { SignIn } from './sign-in';
import { Stub } from './stub';
import { TripDetails } from './trip-details';

/** The organizer area is for app_admins users signed in by email. Everyone else gets the sign-in screen. */
export const organizerOnly: CanActivateFn = async () => {
  const auth = inject(AdminAuth);
  const router = inject(Router);
  await auth.ready();
  return auth.isOrganizer() ? true : router.parseUrl('/admin/sign-in');
};

export const ADMIN_ROUTES: Routes = [
  { path: 'sign-in', component: SignIn, title: 'Teed · Organizer sign-in' },
  {
    path: '',
    canActivate: [organizerOnly],
    children: [
      { path: '', component: MyTrips, title: 'Teed · My trips' },
      { path: 'trips/new', component: TripDetails, title: 'Teed · New trip' },
      { path: 'trips/:id', component: AdminHome, title: 'Teed · Trip' },
      { path: 'trips/:id/details', component: TripDetails, title: 'Teed · Trip details' },
      { path: 'trips/:id/roster', component: Roster, title: 'Teed · Roster and codes' },
      {
        path: 'trips/:id/rounds/new',
        component: Stub,
        title: 'Teed · Add round',
        data: { heading: 'Add round' },
      },
      {
        path: 'trips/:id/info',
        component: Stub,
        title: 'Teed · Trip info',
        data: { heading: 'Trip info' },
      },
      { path: 'courses', component: Courses, title: 'Teed · Course library' },
      { path: 'courses/add', component: CourseAdd, title: 'Teed · Add a course' },
      { path: 'courses/:id', component: CourseEdit, title: 'Teed · Course' },
    ],
  },
];
