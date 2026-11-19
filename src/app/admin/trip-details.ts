import { Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AdminData, AdminError, TripFields, TripStatus } from './data';

const BLANK: TripFields = {
  name: '',
  slug: '',
  location: null,
  start_date: '',
  end_date: '',
  theme: 'scorecard',
  handicap_allowance: 0.9,
  strokes_off_low: true,
  pickup_net_double: true,
  spectators_see_money: false,
  handicap_lock_date: null,
};

/** Trip details: the New trip form, and the same form for an existing trip. */
@Component({
  selector: 'app-trip-details',
  imports: [RouterLink],
  template: `
    <main class="page">
      <a class="back" [routerLink]="id() ? ['/admin/trips', id()] : ['/admin']"
        >‹ {{ id() ? 'Trip' : 'My trips' }}</a
      >
      <h1>{{ id() ? 'Trip details' : 'New trip' }}</h1>

      <form (submit)="save($event)" novalidate>
        <fieldset [disabled]="readOnly() || busy()">
          <section class="card pad fields">
            <label class="field">
              <span class="label">Name</span>
              <input
                class="input"
                name="name"
                autocomplete="off"
                [value]="f().name"
                (input)="set('name', text($event))"
              />
            </label>
            <label class="field">
              <span class="label">Code prefix</span>
              <input
                class="input mono"
                name="slug"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
                placeholder="VERO"
                [value]="f().slug"
                (input)="setSlug($event)"
              />
            </label>
            <label class="field">
              <span class="label">Location</span>
              <input
                class="input"
                name="location"
                autocomplete="off"
                [value]="f().location ?? ''"
                (input)="set('location', text($event) || null)"
              />
            </label>
            <div class="pair">
              <label class="field">
                <span class="label">First day</span>
                <input
                  class="input"
                  name="start"
                  type="date"
                  [value]="f().start_date"
                  (input)="set('start_date', text($event))"
                />
              </label>
              <label class="field">
                <span class="label">Last day</span>
                <input
                  class="input"
                  name="end"
                  type="date"
                  [value]="f().end_date"
                  [min]="f().start_date"
                  (input)="set('end_date', text($event))"
                />
              </label>
            </div>
          </section>

          <section class="card" aria-label="Theme">
            <div class="row"><span class="label">Theme</span></div>
            @for (theme of themes; track theme.key) {
              <label class="row" [class.off]="!theme.ready">
                <span>
                  {{ theme.name }}
                  @if (!theme.ready) {
                    <span class="label"> · coming later</span>
                  }
                </span>
                <input
                  type="radio"
                  name="theme"
                  [value]="theme.key"
                  [checked]="f().theme === theme.key"
                  [disabled]="!theme.ready"
                  (change)="set('theme', theme.key)"
                />
              </label>
            }
          </section>

          <section class="card" aria-label="House rules">
            <div class="row"><span class="label">House rules</span></div>
            <label class="row">
              <span>Handicap allowance</span>
              <span class="percent">
                <input
                  class="input mono"
                  name="allowance"
                  type="number"
                  inputmode="numeric"
                  min="1"
                  max="100"
                  [value]="percent()"
                  (input)="setPercent($event)"
                />
                %
              </span>
            </label>
            <label class="row">
              <span>Strokes off the low man</span>
              <input
                type="checkbox"
                name="low"
                [checked]="f().strokes_off_low"
                (change)="set('strokes_off_low', checked($event))"
              />
            </label>
            <label class="row">
              <span>Pick up at net double bogey</span>
              <input
                type="checkbox"
                name="pickup"
                [checked]="f().pickup_net_double"
                (change)="set('pickup_net_double', checked($event))"
              />
            </label>
            <label class="row">
              <span>Spectators see money</span>
              <input
                type="checkbox"
                name="money"
                [checked]="f().spectators_see_money"
                (change)="set('spectators_see_money', checked($event))"
              />
            </label>
            <label class="row">
              <span>Handicap lock date</span>
              <input
                class="input date"
                name="lock"
                type="date"
                [value]="f().handicap_lock_date ?? ''"
                [max]="f().start_date"
                (input)="set('handicap_lock_date', text($event) || null)"
              />
            </label>
          </section>
        </fieldset>

        @if (error(); as text) {
          <p class="error-text" role="alert">{{ text }}</p>
        }
        @if (!readOnly()) {
          <button class="button" type="submit" [disabled]="busy()">
            {{ id() ? 'Save' : 'Create trip' }}
          </button>
        }
      </form>
    </main>
  `,
  styles: `
    form,
    fieldset {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    fieldset {
      border: 0;
      margin: 0;
      padding: 0;
      min-width: 0;
    }
    .fields {
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.6rem;
    }
    .row {
      align-items: center;
    }
    .row.off {
      color: var(--muted);
    }
    input[type='checkbox'],
    input[type='radio'] {
      width: 1.5rem;
      height: 1.5rem;
      accent-color: var(--pine);
    }
    .percent {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }
    .percent .input {
      width: 5rem;
      text-align: right;
    }
    .date {
      width: auto;
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

  protected readonly themes = [
    { key: 'scorecard', name: 'Scorecard', ready: true },
    { key: 'coastal', name: 'Coastal', ready: false },
  ];

  constructor() {
    effect(() => {
      const id = this.id();
      if (id) void this.load(id);
    });
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  protected set<K extends keyof TripFields>(key: K, value: TripFields[K]): void {
    this.f.update((f) => ({ ...f, [key]: value }));
    this.error.set(null);
  }

  protected setSlug(event: Event): void {
    const input = event.target as HTMLInputElement;
    input.value = input.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 12);
    this.set('slug', input.value);
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
      : f.slug.length < 2
        ? 'The code prefix needs at least 2 letters or numbers.'
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
      const trip = id ? await this.data.updateTrip(id, f) : await this.data.createTrip(f);
      await this.router.navigate(['/admin/trips', trip.id]);
    } catch (e) {
      this.error.set(
        e instanceof AdminError
          ? e.message.replace(
              'That is already in use',
              `The code prefix ${f.slug} is already in use`,
            )
          : "Couldn't save the trip.",
      );
    } finally {
      this.busy.set(false);
    }
  }

  private async load(id: string): Promise<void> {
    try {
      const { id: _id, status, owner_player_id: _owner, ...fields } = await this.data.trip(id);
      this.f.set(fields);
      this.percent.set(String(Math.round(fields.handicap_allowance * 100)));
      this.status.set(status);
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't load that trip.");
    }
  }
}
