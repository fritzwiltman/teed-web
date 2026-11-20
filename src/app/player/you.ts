import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth';
import { formatDateRange } from '../core/format';
import { MyTrip, SessionService } from '../core/session';
import {
  TripStage,
  UiBadge,
  UiButton,
  UiCard,
  UiField,
  UiHeaderBand,
  UiListRow,
  UiSectionHead,
  UiSkeleton,
} from '../core/ui';

const STAGE: Record<MyTrip['stage'], TripStage> = {
  draft: 'draft',
  upcoming: 'upcoming',
  in_progress: 'in-progress',
  final: 'final',
};

/**
 * You: the first screen after sign-in when no trip is in progress. My trips (next, upcoming,
 * past), my name and handicap index, and the ways into creating and running trips for those who
 * may. A plain list for now; its design comes with the You page proper.
 */
@Component({
  selector: 'app-you',
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
    <ui-header-band [title]="me()?.display_name || 'You'" />
    <main class="content">
      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }
      @if (loading() && !trips().length) {
        <ui-skeleton shape="block" height="130px" />
      }

      @for (group of groups(); track group.title) {
        <ui-card [attr.aria-label]="group.title">
          <ui-section-head [title]="group.title" />
          @for (trip of group.trips; track trip.id) {
            <button
              ui-list-row
              type="button"
              [title]="trip.name"
              [detail]="detail(trip)"
              chevron
              (click)="open(trip)"
            >
              <ui-badge [stage]="stage(trip)" />
            </button>
          }
        </ui-card>
      }

      @if (me(); as m) {
        <ui-card pad aria-label="Your golf">
          <ui-section-head title="Your golf" />
          <form class="stack" (submit)="save($event)" novalidate>
            <div class="pair wide">
              <ui-field label="Name">
                <input
                  name="name"
                  autocomplete="name"
                  [value]="name()"
                  (input)="type(name, $event)"
                />
              </ui-field>
              <ui-field label="Handicap index">
                <input
                  name="index"
                  inputmode="decimal"
                  autocomplete="off"
                  placeholder="18.6"
                  [value]="index()"
                  (input)="type(index, $event)"
                />
              </ui-field>
            </div>
            <p class="detail">{{ m.email }}</p>
            @if (formError(); as text) {
              <p class="error-text" role="alert">{{ text }}</p>
            }
            <button ui-button size="small" variant="outline" type="submit" [busy]="saving()">
              {{ saved() ? 'Saved' : 'Save' }}
            </button>
          </form>
        </ui-card>

        @if (m.is_trip_creator) {
          <ui-card aria-label="Organize">
            <a ui-list-row routerLink="/admin/trips/new" icon="plus" title="New trip" chevron></a>
            <a ui-list-row routerLink="/admin/courses" title="Course library" chevron></a>
            @if (m.is_admin) {
              <a ui-list-row routerLink="/admin" title="All trips" chevron></a>
              <a ui-list-row routerLink="/admin/creators" title="Trip creators" chevron></a>
            }
          </ui-card>
        }
      }

      <button ui-button variant="text" type="button" class="center" (click)="signOut()">
        Sign out
      </button>
    </main>
  `,
})
export class You {
  private readonly auth = inject(AuthService);
  private readonly sessions = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly me = this.auth.me;
  protected readonly trips = this.sessions.trips;
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly groups = computed(() =>
    [
      { title: 'Next', trips: this.trips().filter((t) => t.bucket === 'next') },
      { title: 'Upcoming', trips: this.trips().filter((t) => t.bucket === 'upcoming') },
      { title: 'Past', trips: this.trips().filter((t) => t.bucket === 'past') },
    ].filter((group) => group.trips.length),
  );

  // Name and handicap index.
  protected readonly name = signal(this.me()?.display_name ?? '');
  protected readonly index = signal(
    this.me()?.handicap_index == null ? '' : String(this.me()!.handicap_index),
  );
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly formError = signal<string | null>(null);

  constructor() {
    this.sessions.leave(); // You is outside any one trip
    void this.sessions.loadTrips().finally(() => this.loading.set(false));
  }

  protected stage(trip: MyTrip): TripStage {
    return STAGE[trip.stage];
  }

  /** "Jan 11–15, 2027 · 4 players", and for a past trip the finish and winnings once known. */
  protected detail(trip: MyTrip): string {
    const result =
      trip.finish &&
      [trip.finish, trip.winnings == null ? null : `$${trip.winnings}`].filter(Boolean).join(' · ');
    return [
      formatDateRange(trip.start_date, trip.end_date),
      result || `${trip.player_count} ${trip.player_count === 1 ? 'player' : 'players'}`,
    ].join(' · ');
  }

  /** A draft opens where it is set up; anything published opens at its Home. */
  protected async open(trip: MyTrip): Promise<void> {
    this.error.set(null);
    if (trip.stage === 'draft') {
      await this.router.navigate(['/admin/trips', trip.id]);
    } else if (await this.sessions.open(trip.id)) {
      await this.router.navigateByUrl('/home');
    } else {
      this.error.set("Couldn't open that trip. Check your signal and try again.");
    }
  }

  protected type(field: { set(value: string): void }, event: Event): void {
    field.set((event.target as HTMLInputElement).value);
    this.formError.set(null);
    this.saved.set(false);
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.name().trim();
    const typed = this.index().trim();
    const index = typed === '' ? null : Number(typed.replace('+', '-'));
    const problem = !name
      ? 'Enter your name.'
      : name.length > 40
        ? 'Keep your name to 40 characters.'
        : index !== null && (Number.isNaN(index) || index < -9.9 || index > 54)
          ? 'A handicap index is a number up to 54.0.'
          : null;
    this.formError.set(problem);
    if (problem) return;

    this.saving.set(true);
    const ok = await this.auth.saveProfile({
      display_name: name,
      handicap_index: index === null ? null : Math.round(index * 10) / 10,
    });
    this.saving.set(false);
    this.saved.set(ok);
    if (!ok) this.formError.set("That didn't save. Check your signal and try again.");
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
