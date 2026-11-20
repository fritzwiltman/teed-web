import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { formatDateRange, localDate } from '../core/format';
import { SessionService } from '../core/session';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiField,
  UiHeaderBand,
  UiListRow,
  UiSectionHead,
  UiSkeleton,
  tripStage,
} from '../core/ui';
import { AdminAuth } from './auth';
import { AdminData, AdminError, Trip } from './data';
import { enterPlayerMode } from './organizer-header';

/** The organizer's trips: upcoming (draft or published) and past (final). No tab bar here. */
@Component({
  selector: 'app-my-trips',
  imports: [
    RouterLink,
    UiBadge,
    UiButton,
    UiCard,
    UiField,
    UiHeaderBand,
    UiListRow,
    UiSectionHead,
    UiSkeleton,
  ],
  template: `
    <ui-header-band label="Organizer" title="My trips" />
    <main class="content">
      <a ui-button routerLink="/admin/trips/new">New trip</a>

      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }
      @if (loading()) {
        <ui-skeleton shape="block" height="130px" />
      }

      @if (upcoming().length) {
        <ui-card aria-label="Upcoming">
          <ui-section-head title="Upcoming" />
          @for (trip of upcoming(); track trip.id) {
            <button
              ui-list-row
              type="button"
              [title]="trip.name"
              [detail]="dates(trip)"
              chevron
              (click)="open(trip)"
            >
              <ui-badge [stage]="stage(trip)" />
            </button>
          }
        </ui-card>
      }

      @if (past().length) {
        <ui-card aria-label="Past">
          <ui-section-head title="Past" />
          @for (trip of past(); track trip.id) {
            <button
              ui-list-row
              type="button"
              [title]="trip.name"
              [detail]="dates(trip)"
              chevron
              (click)="open(trip)"
            >
              <ui-badge stage="final" />
            </button>
          }
        </ui-card>
      }

      <ui-card>
        <a ui-list-row routerLink="/admin/courses" title="Course library" chevron></a>
      </ui-card>

      <ui-card pad aria-label="Account">
        <p class="detail">{{ auth.email() }}</p>
        @if (settingPassword()) {
          <form class="stack" (submit)="savePassword($event)" novalidate>
            <ui-field label="New password">
              <input
                name="new-password"
                type="password"
                autocomplete="new-password"
                [value]="newPassword()"
                (input)="typePassword($event)"
              />
            </ui-field>
            @if (passwordError(); as text) {
              <p class="error-text" role="alert">{{ text }}</p>
            }
            <div class="actions">
              <button ui-button size="small" type="submit">Save password</button>
              <button
                ui-button
                size="small"
                variant="outline"
                type="button"
                (click)="settingPassword.set(false)"
              >
                Cancel
              </button>
            </div>
          </form>
        } @else {
          <div class="actions">
            <button ui-button variant="text" type="button" (click)="startPassword()">
              {{ passwordSaved() ? 'Password saved' : 'Set password' }}
            </button>
            <button ui-button variant="text" type="button" (click)="signOut()">Sign out</button>
          </div>
        }
      </ui-card>
    </main>
  `,
})
export class MyTrips {
  private readonly data = inject(AdminData);
  private readonly router = inject(Router);
  private readonly sessions = inject(SessionService);
  protected readonly auth = inject(AdminAuth);

  private readonly trips = signal<Trip[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly upcoming = computed(() =>
    this.trips()
      .filter((t) => t.status !== 'final')
      .sort((a, b) => a.start_date.localeCompare(b.start_date)),
  );
  protected readonly past = computed(() => this.trips().filter((t) => t.status === 'final'));

  constructor() {
    this.data
      .trips()
      .then(
        (trips) => this.trips.set(trips),
        (e: unknown) =>
          this.error.set(e instanceof AdminError ? e.message : "Couldn't load your trips."),
      )
      .finally(() => this.loading.set(false));
  }

  /**
   * A draft opens in organizer mode. A trip that is open to players opens in player mode, as the
   * player marked "This is me"; without one it opens in organizer mode too.
   */
  protected async open(trip: Trip): Promise<void> {
    try {
      if (await enterPlayerMode(trip, this.auth, this.data, this.sessions, this.router)) return;
    } catch {
      // fall through to the organizer screens
    }
    await this.router.navigate(['/admin/trips', trip.id]);
  }

  // Setting a password, for signing in without the emailed link.
  protected readonly settingPassword = signal(false);
  protected readonly newPassword = signal('');
  protected readonly passwordError = signal<string | null>(null);
  protected readonly passwordSaved = signal(false);

  protected startPassword(): void {
    this.newPassword.set('');
    this.passwordError.set(null);
    this.settingPassword.set(true);
  }

  protected typePassword(event: Event): void {
    this.newPassword.set((event.target as HTMLInputElement).value);
    this.passwordError.set(null);
  }

  protected async savePassword(event: Event): Promise<void> {
    event.preventDefault();
    if (this.newPassword().length < 8) {
      this.passwordError.set('Use at least 8 characters.');
      return;
    }
    if (await this.auth.setPassword(this.newPassword())) {
      this.settingPassword.set(false);
      this.passwordSaved.set(true);
    } else {
      this.passwordError.set("That password wasn't accepted. Try a longer one.");
    }
  }

  protected stage(trip: Trip) {
    return tripStage(trip, localDate());
  }

  protected dates(trip: Trip): string {
    return formatDateRange(trip.start_date, trip.end_date);
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
