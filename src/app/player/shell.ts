import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { AuthService } from '../core/auth';
import { SessionService } from '../core/session';
import { Tab, UiTabBar } from '../core/ui';

const TABS: Tab[] = [
  { key: 'home', label: 'Home', icon: 'home', link: '/home' },
  { key: 'score', label: 'Scorecard', icon: 'card', link: '/score' },
  { key: 'board', label: 'Board', icon: 'board', link: '/board' },
  { key: 'trip', label: 'Trip', icon: 'trip', link: '/trip' },
];

/** A trip's frame: the current page over the docked tab bar. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, UiTabBar],
  template: `
    <div class="screen with-tabs"><router-outlet /></div>
    <ui-tab-bar [tabs]="tabs()" [active]="active()" />
  `,
})
export class Shell {
  private readonly auth = inject(AuthService);
  private readonly sessions = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly tabs = signal(TABS);

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
    // The trip was closed (back to You), the person was taken off it, or they signed out.
    effect(() => {
      if (!this.sessions.session())
        void this.router.navigateByUrl(this.auth.me() ? '/you' : '/login');
    });
  }
}
