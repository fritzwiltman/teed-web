import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatDay, localDate } from '../core/format';
import { RoundView, RoundsService } from '../core/rounds';
import { ScoreQueue } from '../core/score-queue';
import { SessionService } from '../core/session';
import {
  Choice,
  GameRow,
  UiButton,
  UiCard,
  UiChoicePills,
  UiGameCard,
  UiListRow,
  UiSectionHead,
  UiSheet,
  UiSkeleton,
  UiStepperRow,
} from '../core/ui';
import { HoleResult, PlayerResult, netDoubleBogey, nextHole } from '../scoring';
import { PlayerHeader } from './player-header';

const GAME_NAMES: Record<string, string> = { nine_point: '9-point game' };

/**
 * The round to score: today's if I'm in it and it isn't final, else the next one that isn't
 * final, else the last round.
 */
export function roundToScore(rounds: RoundView[], today = localDate()): RoundView | null {
  const open = rounds.filter((r) => r.result.state !== 'final');
  return (
    open.find((r) => r.row.play_date === today) ??
    open.find((r) => r.row.play_date > today) ??
    open[0] ??
    rounds.at(-1) ??
    null
  );
}

/**
 * The scorecard: one hole at a time for the group, opening on the next unscored hole. Every row
 * starts at par; − and + change it and save at once. "Save" writes par for anyone not touched
 * and moves on. Anyone in the group can enter for anyone in it.
 */
@Component({
  selector: 'app-score',
  imports: [
    RouterLink,
    PlayerHeader,
    UiButton,
    UiCard,
    UiChoicePills,
    UiGameCard,
    UiListRow,
    UiSectionHead,
    UiSheet,
    UiSkeleton,
    UiStepperRow,
  ],
  template: `
    <app-player-header [label]="label()" title="Scorecard" />
    <main class="content">
      @if (queue.count(); as waiting) {
        <p class="sync" role="status">
          Syncing {{ waiting }} {{ waiting === 1 ? 'score' : 'scores' }}
        </p>
      }
      @if (queue.refused(); as lost) {
        <p class="error-text" role="alert">
          {{ lost }} {{ lost === 1 ? "score wasn't" : "scores weren't" }} saved: the round is
          closed.
        </p>
      }

      @if (view(); as v) {
        @if (current(); as h) {
          <ui-card [attr.aria-label]="'Hole ' + h.hole">
            <ui-section-head [title]="'Hole ' + h.hole" [note]="facts(h)" />
            @for (p of v.result.players; track p.id) {
              @if (editable()) {
                <ui-stepper-row
                  [name]="p.name"
                  [detail]="detail(h, p)"
                  [value]="h.strokes[p.id] ?? h.parFor[p.id]"
                  [par]="h.strokes[p.id] === undefined ? null : h.parFor[p.id]"
                  [max]="15"
                  (valueChange)="enter(p.id, h.hole, $event)"
                />
              } @else {
                <ui-list-row
                  [title]="p.name"
                  [detail]="detail(h, p)"
                  [value]="
                    h.strokes[p.id] === undefined
                      ? '–'
                      : h.strokes[p.id] + (h.pickedUp[p.id] ? ' PU' : '')
                  "
                />
              }
            }
          </ui-card>

          @if (needsIndex(); as name) {
            <p class="error-text" role="alert">
              @if (sessions.canManage()) {
                <a [routerLink]="['/admin/trips', session()?.trip?.id, 'roster']"
                  >Add {{ name }}'s handicap index</a
                >
              } @else {
                Add {{ name }}'s handicap index
              }
            </p>
          } @else if (closed(); as why) {
            <p class="center">{{ why }}</p>
          }
          <div class="pair">
            <button
              ui-button
              type="button"
              variant="outline"
              [disabled]="!previous()"
              (click)="go(previous())"
            >
              Back
            </button>
            @if (editable()) {
              <button ui-button type="button" (click)="saveHole(h)">
                {{ following() ? 'Save · Hole ' + following() : 'Save hole' }}
              </button>
            } @else {
              <button ui-button type="button" [disabled]="!following()" (click)="go(following())">
                Next
              </button>
            }
          </div>
          <div class="pair">
            <button ui-button type="button" variant="text" (click)="picking.set(true)">
              All holes
            </button>
            @if (editable() && pickupOn()) {
              <button ui-button type="button" variant="text" (click)="pickingUp.set(true)">
                Pick up
              </button>
            }
          </div>

          @for (game of gameRows(h); track game.title) {
            <ui-game-card [title]="game.title" [note]="'Hole ' + h.hole" [rows]="game.rows" />
          }
        }
        @for (game of totals(); track game.title) {
          <ui-game-card [title]="game.title" [note]="game.note" [rows]="game.rows" />
        }
        <ui-game-card title="Strokes" [note]="'Thru ' + thru()" [rows]="strokeTotals()" />

        <ui-sheet [(open)]="picking" label="Holes">
          <ui-choice-pills
            label="Go to hole"
            [options]="holeChoices()"
            [value]="hole()"
            (valueChange)="go($event)"
          />
        </ui-sheet>

        <ui-sheet [(open)]="pickingUp" label="Pick up">
          @if (current(); as h) {
            <ui-section-head title="Pick up" [note]="'Hole ' + h.hole + ' · net double bogey'" />
            @for (p of v.result.players; track p.id) {
              <button
                ui-list-row
                type="button"
                [title]="p.name"
                [value]="'' + pickupFor(h, p)"
                (click)="pickUp(h, p)"
              ></button>
            }
          }
        </ui-sheet>
      } @else if (loading()) {
        <ui-skeleton shape="block" height="320px" />
      } @else {
        <ui-card pad><p>No round to score yet.</p></ui-card>
      }
    </main>
  `,
  styles: `
    .sync {
      font-size: 14px;
      font-weight: 600;
      color: var(--muted);
      text-align: center;
    }
  `,
})
export class Score {
  /** ?round=<id> opens that round instead of the one to score now. */
  readonly round = input<string>();

  protected readonly sessions = inject(SessionService);
  private readonly rounds = inject(RoundsService);
  protected readonly queue = inject(ScoreQueue);
  protected readonly session = this.sessions.session;

  /** The hole on show. Set once the round is known, then only by the buttons. */
  protected readonly hole = signal<number | null>(null);
  protected readonly picking = signal(false);
  protected readonly pickingUp = signal(false);
  protected readonly loading = signal(true);
  private openedFor: string | null = null;

  protected readonly view = computed<RoundView | null>(() => {
    const all = this.rounds.for(this.session()?.trip.id);
    return all.find((r) => r.row.id === this.round()) ?? roundToScore(all);
  });

  protected readonly current = computed<HoleResult | null>(() => {
    const holes = this.view()?.result.holes ?? [];
    return holes.find((h) => h.hole === this.hole()) ?? holes[0] ?? null;
  });

  /** "Round 2 · Fri, Nov 27 · Fazio" */
  protected readonly label = computed(() => {
    const v = this.view();
    if (!v) return this.session()?.trip.name ?? '';
    return [
      `Round ${v.row.round_number}`,
      formatDay(v.row.play_date),
      v.row.courses?.short_name || v.row.courses?.name,
    ]
      .filter(Boolean)
      .join(' · ');
  });

  /** I may enter scores: scoring is open, and I'm in the group or run the trip. */
  protected readonly editable = computed(() => {
    const v = this.view();
    const s = this.session();
    if (!v || !s || v.result.state === 'final' || s.trip.status !== 'live') return false;
    if (this.needsIndex()) return false;
    return v.result.players.some((p) => p.id === s.player.id) || this.sessions.canManage();
  });

  /**
   * The first player in the group with no handicap index, by name. Strokes are worked out from
   * it, never guessed, so nobody scores until it is in.
   */
  protected readonly needsIndex = computed(
    () => this.view()?.result.players.find((p) => p.playing === null)?.name ?? null,
  );

  /** Why nobody can score, when that needs saying. */
  protected readonly closed = computed<string | null>(() => {
    const v = this.view();
    const s = this.session();
    if (!v || !s) return null;
    if (v.result.state === 'final' || s.trip.status === 'final') return 'Final';
    return s.trip.status === 'draft' ? 'Publish the trip to start scoring.' : null;
  });

  protected readonly pickupOn = computed(
    () => !!this.view() && this.rules()?.pickup_net_double !== false,
  );

  protected readonly previous = computed(() => this.neighbour(-1));
  protected readonly following = computed(() => this.neighbour(1));

  protected readonly holeChoices = computed<Choice<number>[]>(() =>
    (this.view()?.result.holes ?? []).map((h) => ({
      value: h.hole,
      label: h.complete ? `${h.hole} ✓` : `${h.hole}`,
    })),
  );

  protected readonly thru = computed(() =>
    Math.min(...(this.view()?.result.players.map((p) => p.thru) ?? [0])),
  );

  /** Out / In / Total for each game: the eyeball check that every nine is 81. */
  protected readonly totals = computed(() =>
    (this.view()?.result.games ?? []).map((game) => {
      const players = this.view()!.result.players;
      const sum = (side: Record<string, number>) => players.reduce((n, p) => n + side[p.id], 0);
      return {
        title: `${GAME_NAMES[game.key] ?? game.key} · points`,
        note: `${game.holesCounted} ${game.holesCounted === 1 ? 'hole' : 'holes'}`,
        rows: [
          ...players.map((p) => ({
            label: p.name,
            value: `Out ${game.out[p.id]} · In ${game.in[p.id]} · Total ${game.total[p.id]}`,
          })),
          {
            label: 'All',
            value: `Out ${sum(game.out)} · In ${sum(game.in)} · Total ${sum(game.total)}`,
          },
        ] as GameRow[],
      };
    }),
  );

  protected readonly strokeTotals = computed<GameRow[]>(() =>
    (this.view()?.result.players ?? []).map((p) => ({
      label: p.name,
      value: p.thru ? `Gross ${p.gross} · Net ${p.net ?? '–'}` : '–',
    })),
  );

  constructor() {
    // Open on the next unscored hole, once per round; after that the buttons decide.
    effect(() => {
      const v = this.view();
      if (!v || this.openedFor === v.row.id) return;
      this.openedFor = v.row.id;
      this.hole.set(nextHole(v.result) ?? v.result.holes.at(-1)?.hole ?? null);
    });
    effect(() => {
      const tripId = this.session()?.trip.id;
      if (!tripId) return;
      if (this.rounds.tripId() === tripId) this.loading.set(false);
      else void this.rounds.load(tripId).finally(() => this.loading.set(false));
    });
  }

  /** "Par 4 · SI 5 · 412 yds" */
  protected facts(h: HoleResult): string {
    const yards = this.view()?.row.tees?.hole_yards?.[h.hole - 1];
    return [`Par ${h.par}`, `SI ${h.strokeIndex}`, yards ? `${yards} yds` : '']
      .filter(Boolean)
      .join(' · ');
  }

  /** A dot per stroke received, "PU" for a pickup, then the net: "●● · PU · net 6". */
  protected detail(h: HoleResult, p: PlayerResult): string | null {
    const gets = h.received[p.id] ?? 0;
    const dots = gets > 0 ? '●'.repeat(gets) : gets < 0 ? `+${-gets}` : '';
    const net = h.net[p.id];
    const state =
      h.strokes[p.id] === undefined ? 'not saved' : net === undefined ? '' : `net ${net}`;
    const ownPar = h.parFor[p.id] !== h.par ? `par ${h.parFor[p.id]}` : '';
    return [ownPar, dots, h.pickedUp[p.id] ? 'PU' : '', state].filter(Boolean).join(' · ') || null;
  }

  /** What each game made of this hole, once everyone has a score on it. */
  protected gameRows(h: HoleResult): { title: string; rows: GameRow[] }[] {
    const players = this.view()?.result.players ?? [];
    return h.games.map((game) => ({
      title: GAME_NAMES[game.key] ?? game.key,
      rows: players.map((p) => ({ label: p.name, value: `${game.values[p.id]}` })),
    }));
  }

  /** Saves a score. − and + always save a played score, so they clear a pickup. */
  protected enter(playerId: string, hole: number, strokes: number, pickedUp = false): void {
    const v = this.view();
    if (!v || !this.editable()) return;
    this.queue.refused.set(0);
    this.rounds.setScore(v.row.id, playerId, hole, strokes, pickedUp);
  }

  /** Saves par for anyone not touched on this hole, then moves to the next. */
  protected saveHole(h: HoleResult): void {
    const v = this.view();
    if (!v) return;
    for (const p of v.result.players)
      if (h.strokes[p.id] === undefined) this.enter(p.id, h.hole, h.parFor[p.id]);
    if (this.following()) this.go(this.following());
  }

  protected pickupFor(h: HoleResult, p: PlayerResult): number {
    return netDoubleBogey(h.parFor[p.id] ?? h.par, h.received[p.id] ?? 0);
  }

  protected pickUp(h: HoleResult, p: PlayerResult): void {
    this.enter(p.id, h.hole, this.pickupFor(h, p), true);
    this.pickingUp.set(false);
  }

  protected go(hole: number | null): void {
    if (hole != null) this.hole.set(hole);
    this.picking.set(false);
  }

  private rules() {
    return this.rounds.rules();
  }

  private neighbour(step: 1 | -1): number | null {
    const holes = this.view()?.result.holes.map((h) => h.hole) ?? [];
    const at = holes.indexOf(this.current()?.hole ?? -1);
    return at < 0 ? null : (holes[at + step] ?? null);
  }
}
