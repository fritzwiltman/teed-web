import { Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { formatDateRange, formatDay } from '../core/format';
import { AdminData, AdminError, RoundSummary, Trip } from './data';

/** Admin home for one trip. */
@Component({
  selector: 'app-admin-home',
  imports: [RouterLink],
  template: `
    <main class="page">
      <a class="back" routerLink="/admin">‹ My trips</a>
      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }
      @if (trip(); as t) {
        <header>
          <p class="label">{{ t.slug }} · {{ dates(t) }}</p>
          <h1>{{ t.name }}</h1>
        </header>

        @if (t.status === 'draft') {
          <p class="banner" role="status">
            Players can't see this trip yet. Codes start working when you set it live.
          </p>
        }

        <section class="card">
          <a class="row" [routerLink]="['details']"
            ><span>Trip details</span><span aria-hidden="true">›</span></a
          >
          <a class="row" [routerLink]="['roster']"
            ><span>Roster and codes</span><span aria-hidden="true">›</span></a
          >
          <a class="row" [routerLink]="['info']"
            ><span>Trip info</span><span aria-hidden="true">›</span></a
          >
        </section>

        @if (rounds().length) {
          <section class="card" aria-label="Rounds">
            <div class="row"><span class="label">Rounds</span></div>
            @for (round of rounds(); track round.id) {
              <div class="row">
                <span>
                  <span class="label">R{{ round.round_number }} · {{ day(round.play_date) }}</span
                  ><br />
                  <strong>{{ round.courses?.short_name || round.courses?.name }}</strong>
                </span>
                <span class="label">{{ status(round) }}</span>
              </div>
            }
          </section>
        }

        @if (t.status !== 'final') {
          <a class="button quiet" [routerLink]="['rounds', 'new']">+ Add round</a>
        }

        @if (t.status === 'draft') {
          @if (confirming()) {
            <section class="card pad confirm">
              <p>
                Set <strong>{{ t.name }}</strong> live? Player codes start working straight away.
              </p>
              <div class="actions">
                <button type="button" class="button" [disabled]="busy()" (click)="setLive(t)">
                  Set live
                </button>
                <button type="button" class="button quiet" (click)="confirming.set(false)">
                  Cancel
                </button>
              </div>
            </section>
          } @else {
            <button type="button" class="button" (click)="confirming.set(true)">
              Set trip live · send codes
            </button>
          }
        }
      }
    </main>
  `,
  styles: `
    h1 {
      font-size: 2rem;
      margin-top: 0.3rem;
    }
    .confirm {
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
    }
    .confirm .button {
      flex: 1;
    }
  `,
})
export class AdminHome {
  readonly id = input.required<string>();

  private readonly data = inject(AdminData);
  private readonly router = inject(Router);

  protected readonly trip = signal<Trip | null>(null);
  protected readonly rounds = signal<RoundSummary[]>([]);
  protected readonly confirming = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly day = formatDay;

  constructor() {
    effect(() => void this.load(this.id()));
  }

  protected dates(trip: Trip): string {
    return formatDateRange(trip.start_date, trip.end_date);
  }

  protected status(round: RoundSummary): string {
    if (round.status === 'final') return 'Final';
    if (round.status === 'live') return 'Live';
    return round.pairings_tbd ? 'Pairings TBD' : 'Ready';
  }

  protected async setLive(trip: Trip): Promise<void> {
    this.busy.set(true);
    try {
      this.trip.set(await this.data.updateTrip(trip.id, { status: 'live' }));
      // Straight on to sending the codes.
      await this.router.navigate(['/admin/trips', trip.id, 'roster'], {
        queryParams: { send: 'all' },
      });
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't set the trip live.");
    } finally {
      this.busy.set(false);
      this.confirming.set(false);
    }
  }

  private async load(id: string): Promise<void> {
    try {
      const [trip, rounds] = await Promise.all([this.data.trip(id), this.data.rounds(id)]);
      this.trip.set(trip);
      this.rounds.set(rounds);
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't load that trip.");
    }
  }
}
