import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { SessionService } from './core/session';
import { Board } from './player/board';
import { Login } from './player/login';
import { Score } from './player/score';
import { Shell } from './player/shell';
import { TripHome } from './player/trip-home';
import { TripPage } from './player/trip-page';

const loggedIn: CanActivateFn = () =>
  inject(SessionService).session() ? true : inject(Router).parseUrl('/login');
const loggedOut: CanActivateFn = () =>
  inject(SessionService).session() ? inject(Router).parseUrl('/home') : true;

export const routes: Routes = [
  // The organizer area is loaded only when it is visited.
  { path: 'admin', loadChildren: () => import('./admin/routes').then((m) => m.ADMIN_ROUTES) },
  { path: 'login', component: Login, canActivate: [loggedOut], title: 'Teed' },
  {
    path: '',
    component: Shell,
    canActivate: [loggedIn],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', component: TripHome, title: 'Teed · Home' },
      { path: 'score', component: Score, title: 'Teed · Score' },
      { path: 'board', component: Board, title: 'Teed · Board' },
      { path: 'trip', component: TripPage, title: 'Teed · Trip' },
    ],
  },
  { path: '**', redirectTo: '' },
];
