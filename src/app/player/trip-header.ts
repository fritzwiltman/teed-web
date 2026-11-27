import { Component, computed, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth';
import { formatShortRange, tripLine } from '../core/format';
import { SessionService } from '../core/session';
import { IconName, SwitcherTrip, UiHeaderBand, UiTripSwitcher } from '../core/ui';

/**
 * The header band on every trip screen: the trip line with its down arrow ("SOUTHERN PINES ·
 * OCT 8–12 ⌄"), which opens the trip switcher, over the screen's title. An optional pill sits at
 * the right (Alert, for organizers on Home). `label` replaces the trip line where a screen needs
 * its own ("Round 4 · Mon, Oct 12" on the scorecard); the arrow stays.
 */
@Component({
  selector: 'app-trip-header',
  imports: [UiHeaderBand, UiTripSwitcher],
  host: { style: 'display: contents' },
  template: `
    <ui-header-band
      switcher
      [label]="label() ?? line()"
      [title]="title()"
      [action]="action()"
      [actionIcon]="actionIcon()"
      [titleTap]="titleTap()"
      (switched)="switching.set(true)"
      (acted)="acted.emit()"
      (titleTapped)="titleTapped.emit()"
    />
    <ui-trip-switcher
      [(open)]="switching"
      [name]="name()"
      [initial]="initial()"
      [trips]="trips()"
      [current]="session()?.trip?.id ?? null"
      (chosen)="choose($event)"
    />
  `,
})
export class TripHeader {
  readonly title = input.required<string>();
  readonly label = input<string>();
  readonly action = input<string>();
  readonly actionIcon = input<IconName>();
  readonly titleTap = input(false);
  readonly acted = output<void>();
  readonly titleTapped = output<void>();

  private readonly sessions = inject(SessionService);
  private readonly router = inject(Router);
  private readonly me = inject(AuthService).me;
  protected readonly session = this.sessions.session;
  protected readonly switching = signal(false);

  protected readonly line = computed(() => {
    const trip = this.session()?.trip;
    return trip ? tripLine(trip) : '';
  });
  protected readonly name = computed(() => this.me()?.display_name || this.me()?.email || 'You');
  protected readonly initial = computed(() => this.name().charAt(0).toUpperCase());

  /** Current and upcoming trips, in the order You shows them. */
  protected readonly trips = computed<SwitcherTrip[]>(() =>
    this.sessions
      .trips()
      .filter((t) => t.bucket !== 'past')
      .map((t) => ({
        id: t.id,
        name: t.name,
        detail: [
          formatShortRange(t.start_date, t.end_date),
          t.stage === 'in_progress' ? 'now' : t.stage === 'draft' ? 'Draft' : '',
        ]
          .filter(Boolean)
          .join(' · '),
      })),
  );

  protected async choose(id: string | null): Promise<void> {
    if (id === null) {
      this.sessions.leave(); // the shell takes it from there, to You
      await this.router.navigateByUrl('/you');
      return;
    }
    if (id === this.session()?.trip.id) return;
    if (await this.sessions.open(id)) await this.router.navigateByUrl('/home');
  }
}
