import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { AuthService } from './core/auth';
import { SessionService } from './core/session';
import { adminOnly, creatorOnly } from './admin/routes';
import { Board } from './player/board';
import { InstallStep } from './player/install-step';
import { Invite } from './player/invite';
import { Login } from './player/login';
import { Score } from './player/score';
import { Shell } from './player/shell';
import { TripHome } from './player/trip-home';
import { TripPage } from './player/trip-page';
import { Watch } from './player/watch';
import { You } from './player/you';

/** Signed in, or off to Sign in. */
export const signedIn: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready();
  return auth.me() ? true : router.parseUrl('/login');
};

/** Sign in is for the signed-out; anyone else goes where the app starts. */
const signedOut: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const sessions = inject(SessionService);
  const router = inject(Router);
  await auth.ready();
  return auth.me() ? router.parseUrl(await sessions.startUrl()) : true;
};

/** Where the app starts: a trip in progress opens at its Home; otherwise You. */
const start: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const sessions = inject(SessionService);
  const router = inject(Router);
  await auth.ready();
  return router.parseUrl(auth.me() ? await sessions.startUrl() : '/login');
};

/** The organizer's (and co-organizers') pages within a trip. */
const manager: CanActivateFn = () => {
  const sessions = inject(SessionService);
  return sessions.canManage() ? true : inject(Router).parseUrl('/trip');
};

/** The trip screens need a trip to be open. */
const inTrip: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const sessions = inject(SessionService);
  const router = inject(Router);
  await auth.ready();
  if (!auth.me()) return router.parseUrl('/login');
  return sessions.session() ? true : router.parseUrl('/you');
};

export const routes: Routes = [
  // The old organizer area: everything it had now lives in the trip's own screens.
  { path: 'admin', children: [{ path: '**', redirectTo: '/you' }] },
  // Trip creators: the course library, and starting a trip. The app admin: who may create trips.
  {
    path: 'courses',
    canActivate: [creatorOnly],
    loadChildren: () => import('./admin/routes').then((m) => m.COURSE_ROUTES),
  },
  {
    path: 'you/new-trip',
    canActivate: [creatorOnly],
    loadComponent: () => import('./admin/trip-details').then((m) => m.TripDetails),
    title: 'Teed · New trip',
  },
  {
    path: 'you/creators',
    canActivate: [adminOnly],
    loadComponent: () => import('./admin/creators').then((m) => m.Creators),
    title: 'Teed · Trip creators',
  },
  // Every component in every state, for reviewing the design system. Not linked from anywhere.
  {
    path: 'dev/ui',
    loadComponent: () => import('./dev/ui-gallery').then((m) => m.UiGallery),
    title: 'Teed · Design system',
  },
  { path: 'login', component: Login, canActivate: [signedOut], title: 'Teed · Sign in' },
  // The texted links. No guard: an invite signs in whoever opens it; a spectator has no account.
  { path: 'invite/:token', component: Invite, title: 'Teed' },
  { path: 'watch/:token', component: Watch, title: 'Teed' },
  { path: 'watch/:token/board', component: Watch, data: { tab: 'board' }, title: 'Teed' },
  { path: 'you', component: You, canActivate: [signedIn], title: 'Teed' },
  { path: 'install', component: InstallStep, canActivate: [inTrip], title: 'Teed' },
  { path: '', pathMatch: 'full', canActivate: [start], children: [] },
  {
    path: '',
    component: Shell,
    canActivate: [inTrip],
    children: [
      { path: 'home', component: TripHome, title: 'Teed · Home' },
      { path: 'score', component: Score, title: 'Teed · Scorecard' },
      { path: 'board', component: Board, title: 'Teed · Board' },
      {
        path: 'trip',
        component: TripPage,
        children: [
          { path: '', pathMatch: 'full', redirectTo: 'itinerary' },
          {
            path: 'itinerary',
            loadComponent: () => import('./player/trip-itinerary').then((m) => m.TripItinerary),
            title: 'Teed · Itinerary',
          },
          {
            path: 'courses',
            loadComponent: () => import('./player/trip-courses').then((m) => m.TripCourses),
            title: 'Teed · Courses',
          },
          {
            path: 'people',
            loadComponent: () => import('./player/trip-people').then((m) => m.TripPeople),
            title: 'Teed · People',
          },
          {
            path: 'info',
            loadComponent: () => import('./player/trip-info').then((m) => m.TripInfo),
            title: 'Teed · Info',
          },
        ],
      },
      {
        path: 'trip/rounds/new',
        loadComponent: () => import('./player/round-page').then((m) => m.RoundPage),
        canActivate: [manager],
        title: 'Teed · Add round',
      },
      {
        path: 'trip/rounds/:roundId',
        loadComponent: () => import('./player/round-page').then((m) => m.RoundPage),
        title: 'Teed · Round',
      },
      {
        path: 'trip/suggestions',
        loadComponent: () => import('./player/suggestions').then((m) => m.Suggestions),
        canActivate: [manager],
        title: 'Teed · Suggested changes',
      },
      { path: 'rounds/:roundId', redirectTo: 'trip/rounds/:roundId' },
    ],
  },
  { path: '**', redirectTo: '' },
];
