import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { formatDateRange, formatDay, formatName, formatTime, localDate } from '../core/format';
import { safeResult } from '../core/rounds';
import { SUPABASE } from '../core/supabase';
import {
  BoardTable,
  Holes,
  RoundInput,
  SettleUp,
  roundBoard,
  roundNets,
  settleUp,
  tripBoard,
  tripNets,
} from '../scoring';
import {
  UiBoard,
  UiCard,
  UiChip,
  UiCourseCard,
  UiHeaderBand,
  UiListRow,
  UiSectionHead,
  UiSkeleton,
} from '../core/ui';

/** What the `spectate` function returns: the trip's header and its rounds, nothing else. */
export interface SpectatorView {
  trip: {
    name: string;
    location: string | null;
    start_date: string;
    end_date: string;
    status: string;
    handicap_allowance: number;
    strokes_off_low: boolean;
    pickup_net_double: boolean;
    shows_winnings: boolean;
  };
  rounds: SpectatorRound[];
}

export interface SpectatorRound {
  id: string;
  round_number: number;
  play_date: string;
  tee_time: string | null;
  status: 'scheduled' | 'live' | 'final';
  holes?: Holes;
  course: { name: string; short_name: string | null; photo_path: string | null } | null;
  tee: {
    name: string;
    rating?: number | null;
    slope?: number | null;
    par?: number[];
    stroke_index?: number[];
  } | null;
  /** Money settings (a point value) are only here when the trip shows spectators winnings. */
  formats: { format_key: string; settings?: Record<string, unknown> }[];
  groups: {
    players: {
      id: string;
      name: string;
      position?: number;
      handicap_index?: number | null;
      playing_handicap?: number | null;
    }[];
  }[];
  scores: { player_id: string; hole: number; strokes: number }[];
}

/** A spectator's round as the engine takes it. */
export function spectatorInput(r: SpectatorRound, trip: SpectatorView['trip']): RoundInput {
  return {
    id: r.id,
    number: r.round_number,
    holes: r.holes ?? '18',
    status: r.status,
    tee: {
      par: r.tee?.par ?? [],
      strokeIndex: r.tee?.stroke_index ?? [],
      rating: r.tee?.rating ?? null,
      slope: r.tee?.slope ?? null,
    },
    rules: {
      allowance: Number(trip.handicap_allowance ?? 1),
      offLowMan: trip.strokes_off_low ?? true,
      pickupNetDouble: trip.pickup_net_double ?? true,
    },
    players: r.groups
      .flatMap((g) => g.players)
      .map((p) => ({
        id: p.id,
        name: p.name,
        index: p.handicap_index == null ? null : Number(p.handicap_index),
        storedPlaying: p.playing_handicap ?? null,
      })),
    scores: r.scores.map((s) => ({ playerId: s.player_id, hole: s.hole, strokes: s.strokes })),
    formats: r.formats.map((f) => ({ key: f.format_key, settings: f.settings ?? {} })),
  };
}

const REFRESH_MS = 30_000;

/**
 * The spectator link: no account, just the golf. Shows the round that matters now and the list
 * of rounds; leaderboards join it when they are built (M6). Refreshes itself while open. Its
 * design comes with the spectator screens proper.
 */
@Component({
  selector: 'app-watch',
  imports: [
    UiBoard,
    UiCard,
    UiChip,
    UiCourseCard,
    UiHeaderBand,
    UiListRow,
    UiSectionHead,
    UiSkeleton,
  ],
  template: `
    @if (view(); as v) {
      <ui-header-band [label]="where()" [title]="v.trip.name" />
      <main class="content">
        @if (shown(); as r) {
          <ui-course-card
            [name]="r.course?.name ?? ''"
            [label]="label(r)"
            [photo]="photo(r)"
            [live]="live(r)"
          >
            @for (chip of chips(r); track chip) {
              <ui-chip>{{ chip }}</ui-chip>
            }
          </ui-course-card>
          @if (board(); as b) {
            <ui-board
              [title]="'Round ' + r.round_number"
              [columns]="b.table.columns"
              [valueColumn]="b.table.valueColumn"
              [rows]="b.table.rows"
              [live]="live(r)"
            />
            @if (b.settle; as s) {
              <ui-card aria-label="Settle up">
                <ui-section-head
                  title="Settle up"
                  [note]="r.status === 'final' ? 'Final' : 'If it ended now'"
                />
                @for (line of s.nets; track line.name) {
                  <ui-list-row [title]="line.name" [value]="line.text" />
                }
                @for (payment of s.payments; track payment) {
                  <ui-list-row [title]="payment" />
                }
              </ui-card>
            }
          }
        }
        @if (trip(); as t) {
          <ui-board
            title="Trip"
            [columns]="t.table.columns"
            [valueColumn]="t.table.valueColumn"
            [rows]="t.table.rows"
          />
          @if (t.settle; as s) {
            <ui-card aria-label="Trip settle up">
              <ui-section-head title="Trip settle up" />
              @for (line of s.nets; track line.name) {
                <ui-list-row [title]="line.name" [value]="line.text" />
              }
              @for (payment of s.payments; track payment) {
                <ui-list-row [title]="payment" />
              }
            </ui-card>
          }
        }
        @if (v.rounds.length) {
          <ui-card aria-label="Rounds">
            @for (r of v.rounds; track r.id) {
              <ui-list-row
                icon="flag"
                [title]="
                  'R' + r.round_number + ' · ' + (r.course?.short_name || r.course?.name || '')
                "
                [detail]="detail(r)"
              >
                <ui-chip>{{ status(r) }}</ui-chip>
              </ui-list-row>
            }
          </ui-card>
        }
      </main>
    } @else if (gone()) {
      <main class="content">
        <p class="wordmark">teed</p>
        <p role="alert">This link no longer works.</p>
      </main>
    } @else {
      <main class="content"><ui-skeleton shape="block" height="260px" /></main>
    }
  `,
  styles: `
    .wordmark {
      margin-top: calc(72px + env(safe-area-inset-top));
      font: 700 40px/1 var(--font-heading);
      color: var(--accent);
    }
  `,
})
export class Watch {
  readonly token = input.required<string>();

  private readonly supabase = inject(SUPABASE);

  protected readonly view = signal<SpectatorView | null>(null);
  protected readonly gone = signal(false);

  protected readonly where = computed(() => {
    const trip = this.view()?.trip;
    if (!trip) return '';
    return [trip.location, formatDateRange(trip.start_date, trip.end_date)]
      .filter(Boolean)
      .join(' · ');
  });

  /** Today's round, else the next one, else the last one. */
  protected readonly shown = computed(() => {
    const rounds = this.view()?.rounds ?? [];
    const today = localDate();
    return rounds.find((r) => r.play_date >= today) ?? rounds.at(-1) ?? null;
  });

  /** Every round worked out by the same engine the players' boards use. */
  private readonly results = computed(() => {
    const v = this.view();
    return (v?.rounds ?? []).map((r) => ({
      round: r,
      result: safeResult(spectatorInput(r, v!.trip)),
    }));
  });

  private names(): Record<string, string> {
    const names: Record<string, string> = {};
    for (const r of this.results()) for (const p of r.result.players) names[p.id] = p.name;
    return names;
  }

  /** The shown round's board once it has a score; its money only when the trip shows winnings. */
  protected readonly board = computed<{ table: BoardTable; settle: SettleUp | null } | null>(() => {
    const shown = this.shown();
    const result = this.results().find((r) => r.round.id === shown?.id)?.result;
    if (!result || result.state === 'scheduled') return null;
    const nets = this.view()?.trip.shows_winnings ? roundNets(result) : null;
    return { table: roundBoard(result), settle: nets && settleUp(nets, this.names()) };
  });

  /** The trip's board once more than one round has a score. */
  protected readonly trip = computed<{ table: BoardTable; settle: SettleUp | null } | null>(() => {
    const started = this.results()
      .map((r) => r.result)
      .filter((r) => r.state !== 'scheduled');
    if (started.length < 2) return null;
    const nets = this.view()?.trip.shows_winnings ? tripNets(started) : null;
    return { table: tripBoard(started), settle: nets && settleUp(nets, this.names()) };
  });

  constructor() {
    effect(() => void this.load(this.token()));
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !this.gone()) void this.load(this.token());
    }, REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected label(r: SpectatorRound): string {
    return `Round ${r.round_number} · ${formatDay(r.play_date)}`;
  }

  protected chips(r: SpectatorRound): string[] {
    return [
      formatTime(r.tee_time),
      r.formats.map((f) => formatName(f.format_key)).join(' + '),
      r.tee?.name ? `${r.tee.name} tees` : '',
    ].filter(Boolean);
  }

  /** "Fri, Oct 9 · Sixes" */
  protected detail(r: SpectatorRound): string {
    return [formatDay(r.play_date), r.formats.map((f) => formatName(f.format_key)).join(' + ')]
      .filter(Boolean)
      .join(' · ');
  }

  /** "Live" is a round in play: a score in, and not final. */
  protected live(r: SpectatorRound): boolean {
    return r.status !== 'final' && r.scores.length > 0;
  }

  protected status(r: SpectatorRound): string {
    if (r.status === 'final') return 'Final';
    return this.live(r) ? 'Live' : formatTime(r.tee_time) || formatDay(r.play_date);
  }

  protected photo(r: SpectatorRound): string | null {
    const path = r.course?.photo_path;
    return path
      ? this.supabase.storage.from('course-photos').getPublicUrl(path).data.publicUrl
      : null;
  }

  private async load(token: string): Promise<void> {
    try {
      const { data, error } = await this.supabase.functions.invoke('spectate', { body: { token } });
      if (error) {
        // A reply from the function means the link is dead; no reply means no signal: keep what's shown.
        if ((error as { context?: unknown }).context instanceof Response) {
          this.view.set(null);
          this.gone.set(true);
        }
        return;
      }
      this.view.set(data as SpectatorView);
    } catch {
      // offline: keep what's shown
    }
  }
}
