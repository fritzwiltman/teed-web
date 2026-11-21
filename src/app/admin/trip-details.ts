import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth';
import { SessionService } from '../core/session';
import { UiButton, UiCard, UiField, UiHeaderBand } from '../core/ui';
import { AdminData, AdminError, Trip, TripFields } from './data';

/** 'YYYY-MM-DD' plus a number of days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const BLANK: TripFields = {
  name: '',
  slug: '',
  location: null,
  start_date: '',
  end_date: '',
  theme: 'tour',
  handicap_allowance: 1,
  strokes_off_low: true,
  pickup_net_double: true,
  spectators_see_money: false,
  handicap_lock_date: null,
  // A new trip is played where the phone that creates it is: a round's day ends at midnight there.
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
  buy_in_amount: null,
};

/**
 * A trip's short internal handle, made from its name: 'Vero Beach 2027' → 'VEROBEACH202'.
 * Nobody sees it; it only has to be unique, so a clash gets two random characters on the end.
 */
export function slugFor(name: string, clash = false): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!clash) return (base || 'TRIP').slice(0, 12).padEnd(2, 'X');
  const tail = Array.from(
    { length: 2 },
    () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)],
  ).join('');
  return (base || 'TRIP').slice(0, 10) + tail;
}

/**
 * + New trip: the trip's name, its first and last day, and where. Creating it makes you its
 * organizer and opens the draft's Home, where the rest is set up in place (Trip › Courses,
 * People, Info) before it is published. House rules start at 100%, off the low man.
 */
@Component({
  selector: 'app-new-trip',
  imports: [UiButton, UiCard, UiField, UiHeaderBand],
  template: `
    <ui-header-band title="New trip" back="/you" [backLabel]="backLabel()" />
    <main class="content">
      <form class="stack form" (submit)="save($event)" novalidate>
        <ui-card pad>
          <ui-field label="Trip name">
            <input
              name="name"
              autocomplete="off"
              [value]="f().name"
              (input)="set('name', text($event))"
            />
          </ui-field>
          <div class="pair">
            <ui-field label="Starts">
              <input
                name="start"
                type="date"
                [value]="f().start_date"
                (change)="setStart($event, lastDay)"
              />
            </ui-field>
            <ui-field label="Ends">
              <input
                name="end"
                type="date"
                #lastDay
                [value]="f().end_date"
                [min]="f().start_date"
                (change)="setEnd($event)"
              />
            </ui-field>
          </div>
          <ui-field label="Where">
            <input
              name="location"
              autocomplete="off"
              [value]="f().location ?? ''"
              (input)="set('location', text($event) || null)"
            />
          </ui-field>
        </ui-card>
        @if (error(); as text) {
          <p class="error-text" role="alert">{{ text }}</p>
        }
        <button ui-button type="submit" [busy]="busy()">
          {{ busy() ? 'Creating…' : 'Create trip' }}
        </button>
      </form>
    </main>
  `,
  styles: `
    .form {
      gap: var(--gap-cards);
    }
  `,
})
export class TripDetails {
  private readonly data = inject(AdminData);
  private readonly router = inject(Router);
  private readonly sessions = inject(SessionService);
  private readonly me = inject(AuthService).me;

  protected readonly f = signal<TripFields>(BLANK);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly backLabel = computed(() => this.me()?.display_name || 'You');

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected set<K extends keyof TripFields>(key: K, value: TripFields[K]): void {
    this.f.update((f) => ({ ...f, [key]: value }));
    this.error.set(null);
  }

  /**
   * Choosing the first day fills in the last day (three days later) when it is empty or now
   * falls before the first day, and opens the last-day picker to confirm or change it.
   */
  protected setStart(event: Event, lastDay: HTMLInputElement): void {
    const start = this.text(event);
    this.set('start_date', start);
    const end = this.f().end_date;
    if (!start || (end && end >= start)) return;
    this.set('end_date', addDays(start, 3));
    if (!end) {
      setTimeout(() => {
        try {
          lastDay.showPicker();
        } catch {
          lastDay.focus();
        }
      });
    }
  }

  /** A last day before the first day is moved forward to the first day. */
  protected setEnd(event: Event): void {
    const input = event.target as HTMLInputElement;
    const start = this.f().start_date;
    if (input.value && start && input.value < start) input.value = start;
    this.set('end_date', input.value);
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    const f = { ...this.f(), name: this.f().name.trim() };
    const problem = !f.name
      ? 'Give the trip a name.'
      : !f.start_date || !f.end_date
        ? 'Set the first and last day.'
        : f.end_date < f.start_date
          ? 'The last day is before the first day.'
          : null;
    if (problem) {
      this.error.set(problem);
      return;
    }
    this.busy.set(true);
    try {
      const trip = await this.create(f);
      await this.sessions.loadTrips();
      if (await this.sessions.open(trip.id)) await this.router.navigateByUrl('/home');
      else await this.router.navigateByUrl('/you');
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't create the trip.");
    } finally {
      this.busy.set(false);
    }
  }

  /** A new trip gets its handle from its name; if another trip has that one, try a different ending. */
  private async create(fields: TripFields): Promise<Trip> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.data.createTrip({ ...fields, slug: slugFor(fields.name, attempt > 0) });
      } catch (e) {
        const clash = e instanceof AdminError && e.message.startsWith('That is already in use');
        if (!clash || attempt >= 4) throw e;
      }
    }
  }
}
