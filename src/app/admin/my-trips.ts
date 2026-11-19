import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { formatDateRange } from '../core/format';
import { AdminAuth } from './auth';
import { AdminData, AdminError, Trip } from './data';

/** The organizer's trips: upcoming (draft or live) and past (final). */
@Component({
  selector: 'app-my-trips',
  imports: [RouterLink],
  template: `
    <main class="page">
      <h1>My trips</h1>
      <a class="button" routerLink="/admin/trips/new">+ New trip</a>

      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }

      @if (upcoming().length) {
        <section class="card" aria-label="Upcoming">
          <div class="row"><span class="label">Upcoming</span></div>
          @for (trip of upcoming(); track trip.id) {
            <a class="row" [routerLink]="['/admin/trips', trip.id]">
              <span class="trip">
                <strong>{{ trip.name }}</strong>
                <span class="label">{{ dates(trip) }}</span>
              </span>
              <span class="badge" [class]="trip.status">{{ trip.status }}</span>
            </a>
          }
        </section>
      }

      @if (past().length) {
        <section class="card" aria-label="Past">
          <div class="row"><span class="label">Past</span></div>
          @for (trip of past(); track trip.id) {
            <a class="row" [routerLink]="['/admin/trips', trip.id]">
              <span class="trip">
                <strong>{{ trip.name }}</strong>
                <span class="label">{{ dates(trip) }}</span>
              </span>
              <span class="badge final">Final</span>
            </a>
          }
        </section>
      }

      <section class="card">
        <a class="row" routerLink="/admin/courses"
          ><span>Course library</span><span aria-hidden="true">›</span></a
        >
      </section>

      <footer>
        <span class="label">{{ auth.email() }}</span>
        <button type="button" class="link-button" (click)="signOut()">Sign out</button>
      </footer>
    </main>
  `,
  styles: `
    .trip {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      min-width: 0;
    }
    .trip strong {
      font-family: var(--font-heading);
      font-size: 1.15rem;
    }
    footer {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin-top: 1rem;
    }
  `,
})
export class MyTrips {
  private readonly data = inject(AdminData);
  private readonly router = inject(Router);
  protected readonly auth = inject(AdminAuth);

  private readonly trips = signal<Trip[]>([]);
  protected readonly error = signal<string | null>(null);

  protected readonly upcoming = computed(() =>
    this.trips()
      .filter((t) => t.status !== 'final')
      .sort((a, b) => a.start_date.localeCompare(b.start_date)),
  );
  protected readonly past = computed(() => this.trips().filter((t) => t.status === 'final'));

  constructor() {
    this.data.trips().then(
      (trips) => this.trips.set(trips),
      (e: unknown) =>
        this.error.set(e instanceof AdminError ? e.message : "Couldn't load your trips."),
    );
  }

  protected dates(trip: Trip): string {
    return formatDateRange(trip.start_date, trip.end_date);
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
