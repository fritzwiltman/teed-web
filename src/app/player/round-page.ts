import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatDay, formatName, formatTime } from '../core/format';
import { RoundsService } from '../core/rounds';
import { SessionService } from '../core/session';
import {
  BoardRow,
  UiBoard,
  UiButton,
  UiCard,
  UiHeaderBand,
  UiListRow,
  UiSectionHead,
  UiSkeleton,
} from '../core/ui';
import { pointValueText } from '../scoring';

const HOLES = { '18': '18 holes', front: 'Front 9', back: 'Back 9' };

/**
 * A round's setup, for everyone on the trip: where and when, the tees, the game, and the strokes
 * each player gets. The organizer and co-organizers get the way in to change it.
 */
@Component({
  selector: 'app-round-page',
  imports: [
    RouterLink,
    UiBoard,
    UiButton,
    UiCard,
    UiHeaderBand,
    UiListRow,
    UiSectionHead,
    UiSkeleton,
  ],
  template: `
    <ui-header-band
      [title]="'Round ' + (view()?.row?.round_number ?? '')"
      back="/trip"
      backLabel="Trip"
    />
    <main class="content">
      @if (view(); as v) {
        <ui-card aria-label="Round setup">
          <ui-section-head title="Round setup" />
          <ui-list-row [title]="v.row.courses?.name ?? ''" [detail]="when()" />
          <ui-list-row title="Tees" [value]="tees()" />
          <ui-list-row title="Holes" [value]="holes()" />
          @for (game of games(); track game.name) {
            <ui-list-row [title]="game.name" [value]="game.value" />
          }
        </ui-card>

        <ui-board
          plain
          aria-label="Strokes"
          [title]="'Strokes · ' + rule()"
          [columns]="strokes().columns"
          [valueColumn]="strokes().columns.length - 1"
          [rows]="strokes().rows"
        />

        @if (scores().length) {
          <ui-card aria-label="Scores">
            <ui-section-head title="Scores" />
            @for (line of scores(); track line.name) {
              <ui-list-row [title]="line.name" [detail]="line.holes" [value]="line.gross" />
            }
          </ui-card>
        }

        <a ui-button variant="outline" routerLink="/score" [queryParams]="{ round: v.row.id }">
          Scorecard
        </a>
        @if (sessions.canManage() && tripId()) {
          <a
            ui-button
            variant="text"
            class="center"
            [routerLink]="['/admin/trips', tripId(), 'rounds', v.row.id]"
          >
            Edit round
          </a>
        }
      } @else if (loading()) {
        <ui-skeleton shape="block" height="260px" />
      } @else {
        <ui-card pad><p>That round isn't on this trip.</p></ui-card>
      }
    </main>
  `,
})
export class RoundPage {
  readonly roundId = input.required<string>();

  protected readonly sessions = inject(SessionService);
  private readonly rounds = inject(RoundsService);
  protected readonly loading = signal(true);

  protected readonly tripId = computed(() => this.sessions.session()?.trip.id);
  protected readonly view = computed(
    () => this.rounds.for(this.tripId()).find((r) => r.row.id === this.roundId()) ?? null,
  );

  /** "Thu, Nov 26 · 8:10 AM" */
  protected readonly when = computed(() => {
    const row = this.view()?.row;
    return row
      ? [formatDay(row.play_date), formatTime(row.tee_time)].filter(Boolean).join(' · ')
      : '';
  });

  /** "Blue · 6,412 yds · par 72" */
  protected readonly tees = computed(() => {
    const tee = this.view()?.row.tees;
    if (!tee) return '';
    return [
      tee.name,
      tee.yards ? `${tee.yards.toLocaleString('en-US')} yds` : '',
      `par ${tee.par.reduce((a, b) => a + b, 0)}`,
    ]
      .filter(Boolean)
      .join(' · ');
  });

  protected readonly holes = computed(() => HOLES[this.view()?.row.holes ?? '18']);

  /** Each game, with what it is played for: "9-point game · 50¢ a point". */
  protected readonly games = computed(() =>
    (this.view()?.row.round_formats ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((f) => {
        const cents = Number(f.settings?.['point_value_cents']);
        return {
          name: formatName(f.format_key),
          value: cents > 0 ? `${pointValueText(cents)} a point` : '',
        };
      }),
  );

  /** Each player's strokes hole by hole, a pickup marked "PU": "5 · 4 · 7 PU · 3". */
  protected readonly scores = computed(() => {
    const result = this.view()?.result;
    if (!result || result.state === 'scheduled') return [];
    return result.players
      .filter((p) => p.thru > 0)
      .map((p) => ({
        name: p.name,
        gross: `${p.gross}`,
        holes: result.holes
          .filter((h) => h.strokes[p.id] !== undefined)
          .map((h) => `${h.strokes[p.id]}${h.pickedUp[p.id] ? ' PU' : ''}`)
          .join(' · '),
      }));
  });

  /**
   * Laid out like GHIN: the name over "18.7 HCI" (and the tees, when they differ), then CH
   * (course handicap), PH (playing handicap, only when it isn't simply the CH) and SO (shots off
   * the low man).
   */
  protected readonly strokes = computed<{ columns: string[]; rows: BoardRow[] }>(() => {
    const players = this.view()?.result.players ?? [];
    const allowance = Number(this.rounds.rules()?.handicap_allowance ?? 1);
    const showPlaying = allowance !== 1 || players.some((p) => p.parAdjustment !== 0);
    const text = (n: number | null) => (n === null ? '–' : `${n}`);
    return {
      columns: ['CH', ...(showPlaying ? ['PH'] : []), 'SO'],
      rows: players.map((p) => ({
        pos: '',
        name: p.name,
        detail: [
          p.index === null ? 'No handicap index' : `${p.index.toFixed(1)} HCI`,
          p.teeName ? `${p.teeName} tees` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        cells: [text(p.course), ...(showPlaying ? [text(p.playing)] : []), text(p.strokes)],
      })),
    };
  });

  /** "100% · off the low man" */
  protected readonly rule = computed(() => {
    const rules = this.rounds.rules();
    if (!rules) return '';
    return [
      `${Math.round(Number(rules.handicap_allowance) * 100)}%`,
      rules.strokes_off_low ? 'off the low man' : '',
    ]
      .filter(Boolean)
      .join(' · ');
  });

  constructor() {
    effect(() => {
      const tripId = this.tripId();
      if (!tripId) return;
      if (this.rounds.tripId() === tripId) this.loading.set(false);
      else void this.rounds.load(tripId).finally(() => this.loading.set(false));
    });
  }
}
