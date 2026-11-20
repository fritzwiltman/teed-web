import { Component, computed, inject, signal } from '@angular/core';
import { SessionService } from '../core/session';
import { ThemeChoice, ThemeService } from '../core/theme';
import { Choice, UiButton, UiCard, UiSectionHead, UiSegmented, UiSheet } from '../core/ui';
import { PlayerHeader } from './player-header';

/** Trip (itinerary, courses, info). Stub, plus appearance and log out. */
@Component({
  selector: 'app-trip-info',
  imports: [PlayerHeader, UiButton, UiCard, UiSectionHead, UiSegmented, UiSheet],
  template: `
    <app-player-header label="Trip" [title]="session()?.trip?.name ?? ''" />
    <main class="content">
      <ui-card pad>
        <p>The itinerary, courses and trip info will be here.</p>
      </ui-card>

      <ui-card pad aria-label="Appearance">
        <ui-section-head title="Appearance" />
        <ui-segmented
          label="Appearance"
          [options]="themes"
          [value]="theme.choice()"
          (valueChange)="theme.set($event ?? 'auto')"
        />
      </ui-card>

      <button ui-button type="button" variant="text" class="center" (click)="leave()">
        {{ owner() ? 'All trips' : 'Switch trip / log out' }}
      </button>
    </main>

    <ui-sheet [(open)]="confirming" label="Log out">
      <h2>Log out of {{ session()?.trip?.name }} on this phone?</h2>
      <p class="detail">You'll need your link or code to get back in.</p>
      <button ui-button type="button" (click)="logout()">Log out</button>
      <button ui-button type="button" variant="outline" (click)="confirming.set(false)">
        Cancel
      </button>
    </ui-sheet>
  `,
})
export class TripPage {
  private readonly sessions = inject(SessionService);
  protected readonly session = this.sessions.session;
  protected readonly theme = inject(ThemeService);

  protected readonly owner = computed(() => this.session()?.via === 'owner');
  protected readonly confirming = signal(false);
  protected readonly themes: Choice<ThemeChoice>[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  /** The owner just goes back to their trips; a player is asked first, since they need a code to return. */
  protected leave(): void {
    if (this.owner()) void this.logout();
    else this.confirming.set(true);
  }

  protected async logout(): Promise<void> {
    await this.sessions.logout(); // the shell sends us on once the session is gone
  }
}
