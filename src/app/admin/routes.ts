import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { AuthService } from '../core/auth';
import { CourseAdd } from './course-add';
import { CourseEdit } from './course-edit';
import { Courses } from './courses';

/** Signed in, and one of the people who may create trips (or the app admin). */
export const creatorOnly: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready();
  const me = auth.me();
  if (!me) return router.parseUrl('/login');
  return me.is_trip_creator || me.is_admin ? true : router.parseUrl('/you');
};

/** The app admin's own screens: who may create trips. */
export const adminOnly: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready();
  const me = auth.me();
  if (!me) return router.parseUrl('/login');
  return me.is_admin ? true : router.parseUrl('/you');
};

/** The course library, for anyone who may create trips. Loaded only when it is opened. */
export const COURSE_ROUTES: Routes = [
  { path: '', component: Courses, title: 'Teed · Course library' },
  { path: 'add', component: CourseAdd, title: 'Teed · Add a course' },
  { path: ':id', component: CourseEdit, title: 'Teed · Course' },
];
