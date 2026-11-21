import { Component, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  UiButton,
  UiCard,
  UiField,
  UiHeaderBand,
  UiListRow,
  UiSectionHead,
  UiSwitch,
} from '../core/ui';
import { AdminData, AdminError, Trip, TripFields, TripStatus } from './data';

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
  handicap_allowance: 0.9,
  strokes_off_low: true,
  pickup_net_double: true,
  spectators_see_money: false,
  handicap_lock_date: null,
  // A new trip is played where the phone that creates it is: a round's day ends at midnight there.
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
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

/** Trip details: the New trip form, and the same form for an existing trip. */
@Component({
  selector: 'app-trip-details',
  imports: [UiButton, UiCard, UiField, UiHeaderBand, UiListRow, UiSectionHead, UiSwitch],
  template: `
    <ui-header-band
      [title]="id() ? 'Trip details' : 'New trip'"
      [back]="id() ? ['/admin/trips', id()] : ['/you']"
      [backLabel]="id() ? 'Overview' : 'You'"
    />
    <main class="content">
      <form class="stack form" (submit)="save($event)" novalidate>
        <fieldset class="stack form" [disabled]="readOnly() || busy()">
          <ui-card pad>
            <ui-field label="Name">
              <input
                name="name"
                autocomplete="off"
                [value]="f().name"
                (input)="set('name', text($event))"
              />
            </ui-field>
            <ui-field label="Location">
              <input
                name="location"
                autocomplete="off"
                [value]="f().location ?? ''"
                (input)="set('location', text($event) || null)"
              />
            </ui-field>
            <div class="pair">
              <ui-field label="First day">
                <input
                  name="start"
                  type="date"
                  [value]="f().start_date"
                  (change)="setStart($event, lastDay)"
                />
              </ui-field>
              <ui-field label="Last day">
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
          </ui-card>

          <ui-card pad aria-label="Handicaps">
            <ui-section-head title="Handicaps" />
            <div class="pair">
              <ui-field label="Allowance %">
                <input
                  name="allowance"
                  type="number"
                  inputmode="numeric"
                  min="1"
                  max="100"
                  [value]="percent()"
                  (input)="setPercent($event)"
                />
              </ui-field>
              <ui-field label="Lock date">
                <input
                  name="lock"
                  type="date"
                  [value]="f().handicap_lock_date ?? ''"
                  [max]="f().start_date"
                  (input)="set('handicap_lock_date', text($event) || null)"
                />
              </ui-field>
            </div>
          </ui-card>

          <ui-card aria-label="House rules">
            <ui-section-head title="House rules" />
            <label ui-list-row title="Strokes off the low man">
              <ui-switch
                [checked]="f().strokes_off_low"
                [disabled]="readOnly() || busy()"
                (checkedChange)="set('strokes_off_low', $event)"
              />
            </label>
            <label ui-list-row title="Pick up at net double bogey">
              <ui-switch
                [checked]="f().pickup_net_double"
                [disabled]="readOnly() || busy()"
                (checkedChange)="set('pickup_net_double', $event)"
              />
            </label>
            <label ui-list-row title="Spectators see money">
              <ui-switch
                [checked]="f().spectators_see_money"
                [disabled]="readOnly() || busy()"
                (checkedChange)="set('spectators_see_money', $event)"
              />
            </label>
          </ui-card>
        </fieldset>

        @if (error(); as text) {
          <p class="error-text" role="alert">{{ text }}</p>
        }
        @if (!readOnly()) {
          <button ui-button type="submit" [busy]="busy()">
            {{ busy() ? 'Saving…' : id() ? 'Save' : 'Create trip' }}
          </button>
        }
      </form>
    </main>
  `,
  styles: `
    .form {
      gap: var(--gap-cards);
    }
    fieldset {
      border: 0;
      margin: 0;
      padding: 0;
      min-width: 0;
    }
  `,
})
export class TripDetails {
  /** Absent for a new trip. */
  readonly id = input<string>();

  private readonly data = inject(AdminData);
  private readonly router = inject(Router);

  protected readonly f = signal<TripFields>(BLANK);
  protected readonly percent = signal('90');
  protected readonly status = signal<TripStatus>('draft');
  protected readonly readOnly = () => this.status() === 'final';
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) void this.load(id);
    });
  }

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
      // After this change has rendered. Not every browser lets a page open a picker itself.
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

  protected setPercent(event: Event): void {
    this.percent.set(this.text(event));
    this.error.set(null);
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy() || this.readOnly()) return;
    const f = { ...this.f(), name: this.f().name.trim() };
    const percent = Number(this.percent());

    const problem = !f.name
      ? 'Give the trip a name.'
      : !f.start_date || !f.end_date
        ? 'Set the first and last day.'
        : f.end_date < f.start_date
          ? 'The last day is before the first day.'
          : !Number.isInteger(percent) || percent < 1 || percent > 100
            ? 'The handicap allowance is a whole number from 1 to 100.'
            : null;
    if (problem) {
      this.error.set(problem);
      return;
    }
    f.handicap_allowance = percent / 100;

    this.busy.set(true);
    try {
      const id = this.id();
      const trip = id ? await this.data.updateTrip(id, f) : await this.create(f);
      await this.router.navigate(['/admin/trips', trip.id]);
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't save the trip.");
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

  private async load(id: string): Promise<void> {
    try {
      const { id: _id, status, ...fields } = await this.data.trip(id);
      this.f.set(fields);
      this.percent.set(String(Math.round(fields.handicap_allowance * 100)));
      this.status.set(status);
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't load that trip.");
    }
  }
}
