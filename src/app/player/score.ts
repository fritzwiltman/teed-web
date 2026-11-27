import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { AdminData, AdminError } from '../admin/data';
import { dayHeader, formatName, localDate } from '../core/format';
import { LaunchService } from '../core/launch';
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
  UiIndexSheet,
  UiSkeleton,
  UiStepperRow,
  UiSyncLine,
} from '../core/ui';
import {
  HoleResult,
  PlayerResult,
  Pressable,
  matchCards,
  matchStatus,
  moneyText,
  netDoubleBogey,
  nextHole,
  pressable,
} from '../scoring';
import { TripHeader } from './trip-header';

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
    TripHeader,
    UiIndexSheet,
    UiSyncLine,
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
    <app-trip-header
      [label]="label()"
      [title]="current() && !needsIndex() ? 'Hole ' + current()!.hole : 'Scorecard'"
      [titleTap]="!!current() && !needsIndex()"
      (titleTapped)="picking.set(true)"
    />
    <main class="content">
      <!-- Saves are silent. Only a score stuck for a while (no signal) is said, in a spot of its
           own over the top of the page, so nothing below it ever moves. -->
      @if (queue.slow()) {
        <ui-sync-line class="waiting">
          {{ queue.count() }} {{ queue.count() === 1 ? 'score' : 'scores' }} waiting for signal
        </ui-sync-line>
      }
      @if (queue.refused(); as lost) {
        <p class="error-text" role="alert">
          {{ lost }} {{ lost === 1 ? "score wasn't" : "scores weren't" }} saved: the round is
          closed.
        </p>
      }

      @if (view(); as v) {
        @if (needsIndex(); as name) {
          <ui-card pad aria-label="Handicap index needed">
            <div class="blocked">
              <span class="mark" aria-hidden="true">!</span>
              <p role="alert">Add {{ name }}'s handicap index</p>
            </div>
            @if (sessions.canManage()) {
              <button ui-button type="button" (click)="indexOpen.set(true)">Add it</button>
            }
          </ui-card>
        } @else if (current(); as h) {
          <ui-card [attr.aria-label]="'Hole ' + h.hole">
            <ui-section-head [title]="'Par ' + h.par" [note]="facts(h)" />
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

          @if (closed(); as why) {
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

          <!-- Below the buttons, so a bet changing or Press appearing never moves them. -->
          @if (bets(); as line) {
            <p class="center bets">{{ line }}</p>
          }
          @if (editable() && presses().length) {
            <button ui-button type="button" variant="outline" (click)="pressing.set(true)">
              Press
            </button>
          }

          @for (game of gameRows(h); track game.title) {
            <ui-game-card [title]="game.title" [note]="'Hole ' + h.hole" [rows]="game.rows" />
          }
        }
        @for (game of matches(); track game.title) {
          <ui-game-card [title]="game.title" [note]="game.note" [rows]="game.rows" />
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
        <ui-sheet [(open)]="pressing" label="Press">
          <ui-section-head title="Press" />
          @for (bet of presses(); track bet.bet) {
            <button
              ui-list-row
              type="button"
              [title]="bet.label"
              [detail]="pressDetail(bet)"
              chevron
              [disabled]="pressBusy()"
              (click)="press(bet)"
            ></button>
          }
          @if (pressError(); as text) {
            <p class="error-text" role="alert">{{ text }}</p>
          }
        </ui-sheet>
        <ui-index-sheet
          [(open)]="indexOpen"
          [name]="needsIndex() ?? ''"
          [busy]="savingIndex()"
          [error]="indexError()"
          (saved)="saveIndex($event)"
        />
      } @else if (loading()) {
        <ui-skeleton shape="block" height="320px" />
      } @else {
        <ui-card pad><p>No round to score yet.</p></ui-card>
      }
    </main>
  `,
  styles: `
    .content {
      position: relative;
    }
    .waiting {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: var(--s4);
      font-size: 12px;
      pointer-events: none;
    }
    .bets {
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .blocked {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 17px;
      font-weight: 700;
    }
    .mark {
      flex: none;
      display: inline-grid;
      place-items: center;
      width: 20px;
      height: 20px;
      border: 1.5px solid var(--warn-edge);
      border-radius: 50%;
      background: var(--warn-bg);
      color: var(--warn-edge);
      font: 800 13px/1 var(--font-body);
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
  protected readonly pressing = signal(false);
  protected readonly pressBusy = signal(false);
  protected readonly pressError = signal<string | null>(null);
  private readonly launch = inject(LaunchService);
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
    if (!v) return undefined; // the trip line
    return dayHeader(`Round ${v.row.round_number}`, v.row.play_date);
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
  /** "Add it": the index sheet, in place. */
  protected readonly indexOpen = signal(false);
  protected readonly savingIndex = signal(false);
  protected readonly indexError = signal<string | null>(null);
  private readonly data = inject(AdminData);

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

  /** A match game's open bets from my side: "Front 1 up · Front press AS · Overall 2 up". */
  protected readonly bets = computed(() => {
    const v = this.view();
    return v ? matchStatus(v.result, this.session()?.player.id) : null;
  });

  /** The bets I may press now. */
  protected readonly presses = computed<Pressable[]>(() => {
    const v = this.view();
    return v ? pressable(v.result, this.session()?.player.id) : [];
  });

  /** Every bet of a match game, with who is ahead or how it ended. */
  protected readonly matches = computed(() => {
    const v = this.view();
    if (!v) return [];
    return matchCards(v.result).map((m) => ({
      title: formatName(m.key),
      note: `Thru ${v.result.games.find((g) => g.key === m.key)?.holesCounted ?? 0}`,
      rows: m.rows as GameRow[],
    }));
  });

  /** Out / In / Total for each points game: the eyeball check that every nine is 81. */
  protected readonly totals = computed(() =>
    (this.view()?.result.games ?? [])
      .filter((game) => !game.bets)
      .map((game) => {
        const players = this.view()!.result.players;
        const sum = (side: Record<string, number>) => players.reduce((n, p) => n + side[p.id], 0);
        return {
          title: `${formatName(game.key)} · points`,
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
    // Back in the app after a while mid-round: on to the next unscored hole.
    let landings = this.launch.landed();
    effect(() => {
      const count = this.launch.landed();
      if (count === landings) return;
      landings = count;
      const v = untracked(() => this.view());
      const next = v && nextHole(v.result);
      if (next) this.hole.set(next);
    });
    effect(() => {
      const tripId = this.session()?.trip.id;
      if (!tripId) return;
      if (this.rounds.tripId() === tripId) this.loading.set(false);
      else void this.rounds.load(tripId).finally(() => this.loading.set(false));
    });
  }

  /** "Par 4 · SI 5 · 412 yds" */
  /** Saves the missing index; the round reloads and scoring can start. */
  protected async saveIndex(index: number | null): Promise<void> {
    const v = this.view();
    const player = v?.result.players.find((p) => p.playing === null);
    const tripId = this.session()?.trip.id;
    if (!player || !tripId) return;
    this.savingIndex.set(true);
    this.indexError.set(null);
    try {
      await this.data.setIndex(player.id, index);
      await this.rounds.load(tripId);
      this.indexOpen.set(false);
    } catch (e) {
      this.indexError.set(
        e instanceof AdminError ? e.message : "Couldn't save the handicap index.",
      );
    } finally {
      this.savingIndex.set(false);
    }
  }

  /** "Blue tees · SI 5 · 412 yds" */
  protected facts(h: HoleResult): string {
    const yards = this.view()?.row.tees?.hole_yards?.[h.hole - 1];
    const tees = this.view()?.row.tees?.name;
    return [tees ? `${tees} tees` : '', `SI ${h.strokeIndex}`, yards ? `${yards} yds` : '']
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
      title: formatName(game.key),
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

  /** "Holes 7–9 · $5": what pressing this bet starts. */
  protected pressDetail(bet: Pressable): string {
    const v = this.view();
    const found = v?.result.games.flatMap((g) => g.bets ?? []).find((b) => b.id === bet.bet);
    if (!found) return '';
    return [
      bet.from === found.to ? `Hole ${bet.from}` : `Holes ${bet.from}–${found.to}`,
      found.stakeCents ? moneyText(found.stakeCents).replace('.00', '') : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** Presses a bet: a new one from the next hole. It needs signal. */
  protected async press(bet: Pressable): Promise<void> {
    const v = this.view();
    if (!v || this.pressBusy()) return;
    this.pressBusy.set(true);
    this.pressError.set(null);
    const done = await this.rounds.press(v.row.id, bet.game, bet.bet, bet.afterHole);
    this.pressBusy.set(false);
    if (done) this.pressing.set(false);
    else this.pressError.set("Couldn't press. It needs signal: try again in a moment.");
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
