import { Component, computed, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { SessionService } from '../core/session';
import { Tab, UiTabBar } from '../core/ui';

const TABS: Tab[] = [
  { key: 'home', label: 'Home', icon: 'home', link: '/home' },
  { key: 'score', label: 'Scorecard', icon: 'card', link: '/score' },
  { key: 'board', label: 'Board', icon: 'board', link: '/board' },
  { key: 'trip', label: 'Trip', icon: 'trip', link: '/trip' },
];

/** The logged-in frame: the current page over the docked tab bar. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, UiTabBar],
  template: `
    <div class="screen with-tabs"><router-outlet /></div>
    <ui-tab-bar [tabs]="tabs()" [active]="active()" />
  `,
})
export class Shell {
  private readonly sessions = inject(SessionService);
  private readonly router = inject(Router);

  /** Spectators have no scorecard. */
  protected readonly tabs = computed(() =>
    this.sessions.session()?.role === 'spectator' ? TABS.filter((t) => t.key !== 'score') : TABS,
  );

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  protected readonly active = computed(() => {
    const first = this.url().split(/[/?#]/)[1];
    return TABS.some((t) => t.key === first) ? first : null;
  });

  constructor() {
    // Logged out (by choice, or because the code was revoked): back to login, or for the owner
    // leaving player mode, back to their trips.
    effect(() => {
      if (!this.sessions.session()) void this.router.navigateByUrl(this.sessions.exitUrl());
    });
  }
}
