import { Component, computed, effect, inject, signal } from '@angular/core';
import { RoundView, RoundsService } from '../core/rounds';
import { SessionService } from '../core/session';
import {
  Choice,
  UiBadge,
  UiBoard,
  UiButton,
  UiCard,
  UiChoicePills,
  UiListRow,
  UiSectionHead,
  UiSkeleton,
} from '../core/ui';
import {
  BoardTable,
  SettleUp,
  pointValueText,
  roundBoard,
  roundNets,
  settleUp,
  tripBoard,
  tripNets,
} from '../scoring';
import { TripHeader } from './trip-header';

/** Which board is on show: a round's id, or the whole trip. */
type Shown = string | 'trip';

/** The round a board opens on: the one in play, else the last with a score, else the first. */
export function boardToOpen(rounds: RoundView[]): Shown {
  const started = rounds.filter((r) => r.result.state !== 'scheduled');
  return (
    rounds.find((r) => r.result.state === 'live' || r.result.state === 'complete')?.row.id ??
    started.at(-1)?.row.id ??
    rounds[0]?.row.id ??
    'trip'
  );
}

/** "Settle up" for a round or the trip, worded for whoever is looking. */
export function settleFor(
  nets: Record<string, number> | null,
  rounds: RoundView[],
  me: string | null,
): SettleUp | null {
  if (!nets) return null;
  const names: Record<string, string> = {};
  for (const r of rounds) for (const p of r.result.players) names[p.id] = p.name;
  return settleUp(nets, names, me);
}

/**
 * Leaderboards: each round (gross, net, to par, thru, and a column per game) and the trip, live.
 * Under a board, "Settle up": who is up and down, and the fewest payments that square it.
 */
@Component({
  selector: 'app-board',
  imports: [
    TripHeader,
    UiBadge,
    UiBoard,
    UiButton,
    UiCard,
    UiChoicePills,
    UiListRow,
    UiSectionHead,
    UiSkeleton,
  ],
  template: `
    <app-trip-header title="Leaderboard" />
    <main class="content">
      @if (views().length) {
        <ui-choice-pills
          label="Board"
          [options]="choices()"
          [value]="shown()"
          (valueChange)="picked.set($event)"
        />

        @if (round(); as r) {
          @if (r.result.state === 'complete') {
            @if (sessions.canManage()) {
              <ui-card pad aria-label="Finalize">
                <ui-section-head title="All scores are in" />
                <p class="detail">Check it, then make it official</p>
                <button ui-button type="button" [busy]="finalizing()" (click)="finalize(r)">
                  {{ finalizing() ? 'Finalizing…' : 'Finalize' }}
                </button>
                @if (error(); as text) {
                  <p class="error-text" role="alert">{{ text }}</p>
                }
              </ui-card>
            } @else {
              <ui-badge stage="complete" class="status" />
            }
          }
          <ui-board
            [title]="title(r)"
            [columns]="table().columns"
            [valueColumn]="table().valueColumn"
            [rows]="table().rows"
            [live]="r.result.state === 'live'"
          />
        } @else {
          <ui-board
            title="Trip"
            [columns]="table().columns"
            [valueColumn]="table().valueColumn"
            [rows]="table().rows"
          />
        }

        @if (settle(); as s) {
          <ui-card aria-label="Settle up">
            <ui-section-head title="Settle up" [note]="settleNote()" />
            @for (line of s.nets; track line.name) {
              <ui-list-row [title]="line.name" [value]="line.text" />
            }
            @for (payment of s.payments; track payment) {
              <ui-list-row [title]="payment" />
            }
            @if (!s.payments.length) {
              <ui-list-row title="All square" />
            }
          </ui-card>
        }
      } @else if (loading()) {
        <ui-skeleton shape="block" height="260px" />
      } @else {
        <ui-card pad><p>No rounds yet.</p></ui-card>
      }
    </main>
  `,
  styles: `
    .status {
      align-self: flex-start;
    }
  `,
})
export class Board {
  protected readonly sessions = inject(SessionService);
  private readonly rounds = inject(RoundsService);
  protected readonly session = this.sessions.session;

  protected readonly picked = signal<Shown | null>(null);
  protected readonly loading = signal(true);
  protected readonly finalizing = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly views = computed(() => this.rounds.for(this.session()?.trip.id));
  protected readonly shown = computed<Shown>(() => {
    const picked = this.picked();
    const views = this.views();
    return picked && (picked === 'trip' || views.some((r) => r.row.id === picked))
      ? picked
      : boardToOpen(views);
  });
  protected readonly round = computed(
    () => this.views().find((r) => r.row.id === this.shown()) ?? null,
  );

  protected readonly choices = computed<Choice<Shown>[]>(() => [
    ...this.views().map((r) => ({
      value: r.row.id,
      label: `R${r.row.round_number}${r.result.state === 'live' ? ' · Live' : ''}`,
    })),
    { value: 'trip', label: 'Trip' },
  ]);

  private readonly me = computed(() => this.session()?.player.id ?? null);

  protected readonly table = computed<BoardTable>(() => {
    const round = this.round();
    return round
      ? roundBoard(round.result, this.me())
      : tripBoard(
          this.views().map((r) => r.result),
          this.me(),
        );
  });

  protected readonly settle = computed<SettleUp | null>(() => {
    const round = this.round();
    const nets = round ? roundNets(round.result) : tripNets(this.views().map((r) => r.result));
    return settleFor(nets, this.views(), this.me());
  });

  /** "If it ended now · 50¢ a point" until the round is final; then "Final · 50¢ a point". */
  protected readonly settleNote = computed(() => {
    const round = this.round();
    if (!round) {
      const open = this.views().some(
        (r) => r.result.state === 'live' || r.result.state === 'complete',
      );
      return open ? 'If it ended now' : '';
    }
    const cents = round.result.games.find((g) => g.settle)?.settle?.pointValueCents;
    return [
      round.result.state === 'final' ? 'Final' : 'If it ended now',
      cents ? `${pointValueText(cents)} a point` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  });

  constructor() {
    effect(() => {
      const tripId = this.session()?.trip.id;
      if (!tripId) return;
      if (this.rounds.tripId() === tripId) this.loading.set(false);
      else void this.rounds.load(tripId).finally(() => this.loading.set(false));
    });
  }

  /** "Palmer · net stroke play" */
  protected title(r: RoundView): string {
    return r.row.courses?.short_name || r.row.courses?.name || `Round ${r.row.round_number}`;
  }

  protected async finalize(r: RoundView): Promise<void> {
    if (this.finalizing()) return;
    this.finalizing.set(true);
    this.error.set(null);
    const done = await this.rounds.finalize(r.row.id);
    if (!done) this.error.set("Couldn't finalize the round. Check your signal and try again.");
    this.finalizing.set(false);
  }
}
