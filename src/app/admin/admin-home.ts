import { Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { formatDateRange } from '../core/format';
import { UiBadge, UiButton, UiCard, UiListRow, UiSheet, UiSkeleton } from '../core/ui';
import { AdminAuth } from './auth';
import { AdminData, AdminError, Trip } from './data';
import { OrganizerHeader } from './organizer-header';

/** Overview: one trip's organizer home. */
@Component({
  selector: 'app-admin-home',
  imports: [RouterLink, OrganizerHeader, UiBadge, UiButton, UiCard, UiListRow, UiSheet, UiSkeleton],
  template: `
    <app-organizer-header title="Overview" [trip]="trip()" />
    <main class="content">
      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }
      @if (trip(); as t) {
        <ui-card aria-label="Trip">
          <ui-list-row [title]="t.name" [detail]="where(t)">
            <ui-badge [status]="t.status" />
          </ui-list-row>
          <a ui-list-row [routerLink]="['details']" title="Trip details" chevron></a>
        </ui-card>

        @if (auth.isOrganizer()) {
          @if (t.status === 'draft') {
            <button ui-button type="button" (click)="confirming.set(true)">Go live</button>
          }

          <ui-card>
            <a ui-list-row routerLink="/admin/courses" title="Course library" chevron></a>
            <a ui-list-row routerLink="/admin" title="All trips" chevron></a>
          </ui-card>
        }

        <ui-sheet [(open)]="confirming" label="Go live">
          <h2>Set {{ t.name }} live?</h2>
          <p class="detail">Player links start working straight away.</p>
          <button ui-button type="button" [busy]="busy()" (click)="goLive(t)">
            {{ busy() ? 'Going live…' : 'Go live' }}
          </button>
          <button ui-button type="button" variant="outline" (click)="confirming.set(false)">
            Not yet
          </button>
        </ui-sheet>

        <ui-sheet [(open)]="offering" label="Text links">
          <h2>{{ t.name }} is live</h2>
          <a ui-button [routerLink]="['roster']" [queryParams]="{ send: 'all' }"
            >Text everyone their link</a
          >
          <button ui-button type="button" variant="outline" (click)="offering.set(false)">
            Not now
          </button>
        </ui-sheet>
      } @else if (!error()) {
        <ui-skeleton shape="block" height="120px" />
      }
    </main>
  `,
})
export class AdminHome {
  readonly id = input.required<string>();

  private readonly data = inject(AdminData);
  private readonly router = inject(Router);
  protected readonly auth = inject(AdminAuth);

  protected readonly trip = signal<Trip | null>(null);
  protected readonly confirming = signal(false);
  /** After going live: the separate prompt to text everyone their link. */
  protected readonly offering = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => void this.load(this.id()));
  }

  protected where(trip: Trip): string {
    return [trip.location, formatDateRange(trip.start_date, trip.end_date)]
      .filter(Boolean)
      .join(' · ');
  }

  protected async goLive(trip: Trip): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      this.trip.set(await this.data.updateTrip(trip.id, { status: 'live' }));
      this.offering.set(true);
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't set the trip live.");
    } finally {
      this.busy.set(false);
      this.confirming.set(false);
    }
  }

  private async load(id: string): Promise<void> {
    try {
      this.trip.set(await this.data.trip(id));
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't load that trip.");
    }
  }
}
