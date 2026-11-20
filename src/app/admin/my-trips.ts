import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { formatDateRange, localDate } from '../core/format';
import {
  UiBadge,
  UiButton,
  UiCard,
  UiHeaderBand,
  UiListRow,
  UiSectionHead,
  UiSkeleton,
  tripStage,
} from '../core/ui';
import { AdminData, AdminError, Trip } from './data';

/** The app admin's list: every trip, upcoming (draft or published) and past (final). No tab bar here. */
@Component({
  selector: 'app-my-trips',
  imports: [
    RouterLink,
    UiBadge,
    UiButton,
    UiCard,
    UiHeaderBand,
    UiListRow,
    UiSectionHead,
    UiSkeleton,
  ],
  template: `
    <ui-header-band title="All trips" back="/you" backLabel="You" />
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
    </main>
  `,
})
export class MyTrips {
  private readonly data = inject(AdminData);
  private readonly router = inject(Router);

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
          this.error.set(e instanceof AdminError ? e.message : "Couldn't load the trips."),
      )
      .finally(() => this.loading.set(false));
  }

  /** Every trip opens on its organizer screens here: the app admin may not be on it. */
  protected async open(trip: Trip): Promise<void> {
    await this.router.navigate(['/admin/trips', trip.id]);
  }

  protected stage(trip: Trip) {
    return tripStage(trip, localDate());
  }

  protected dates(trip: Trip): string {
    return formatDateRange(trip.start_date, trip.end_date);
  }
}
