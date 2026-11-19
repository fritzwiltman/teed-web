import { Component, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionService } from '../core/session';

/** The logged-in frame: the current page with the floating pill nav over it. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="content"><router-outlet /></div>
    <nav class="pill-nav" aria-label="Main">
      @for (tab of tabs; track tab.path) {
        <a [routerLink]="tab.path" routerLinkActive="active" ariaCurrentWhenActive="page">{{
          tab.label
        }}</a>
      }
    </nav>
  `,
  styles: `
    .content {
      /* room for the nav, so the last thing on a page is never underneath it */
      padding-bottom: calc(5.5rem + env(safe-area-inset-bottom));
    }
    .pill-nav {
      position: fixed;
      left: 50%;
      bottom: calc(0.9rem + env(safe-area-inset-bottom));
      transform: translateX(-50%);
      display: flex;
      gap: 0.25rem;
      padding: 0.3rem;
      width: min(calc(100% - 1.5rem), 24rem);
      background: var(--surface);
      border: 2px solid var(--frame);
      border-radius: 999px;
      box-shadow: var(--shadow);
    }
    a {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 2.9rem;
      border-radius: 999px;
      font: 500 0.8rem var(--font-mono);
      letter-spacing: 0.06em;
      text-transform: uppercase;
      text-decoration: none;
      color: var(--ink);
      touch-action: manipulation;
    }
    a.active {
      background: var(--pine);
      color: var(--on-pine);
    }
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
