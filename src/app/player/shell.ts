import { Component, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionService } from '../core/session';

/** The logged-in frame: the current page with the floating pill nav over it. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="with-nav"><router-outlet /></div>
    <nav class="pill-nav" aria-label="Main">
      @for (tab of tabs; track tab.path) {
        <a [routerLink]="tab.path" routerLinkActive="active" ariaCurrentWhenActive="page">{{
          tab.label
        }}</a>
      }
    </nav>
  `,
})
export class Shell {
  protected readonly tabs = [
    { path: '/home', label: 'Home' },
    { path: '/score', label: 'Score' },
    { path: '/board', label: 'Board' },
    { path: '/trip', label: 'Trip' },
  ];

  constructor() {
    const session = inject(SessionService).session;
    const router = inject(Router);
    // Logged out (by choice, or because the code was revoked): back to the login screen.
    effect(() => {
      if (!session()) void router.navigateByUrl('/login');
    });
  }
}
