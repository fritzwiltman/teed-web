import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import {
  dayHeader,
  formatDay,
  formatName,
  formatTime,
  gameLine,
  localDate,
  tripLine,
} from '../core/format';
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
  matchCards,
} from '../scoring';
import {
  Choice,
  GameRow,
  Tab,
  UiBoard,
  UiCard,
  UiChip,
  UiChoicePills,
  UiCourseCard,
  UiGameCard,
  UiHeaderBand,
  UiListRow,
  UiLogo,
  UiSectionHead,
  UiSkeleton,
  UiTabBar,
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
  formats: { id?: string; format_key: string; settings?: Record<string, unknown> }[];
  /** Presses made by hand in a match game. */
  presses?: { round_format_id: string; bet: string; after_hole: number }[];
  groups: {
    players: {
      id: string;
      name: string;
      position?: number;
      handicap_index?: number | null;
      course_handicap?: number | null;
      playing_handicap?: number | null;
      tee?: SpectatorRound['tee'];
    }[];
  }[];
  scores: { player_id: string; hole: number; strokes: number; picked_up?: boolean }[];
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
        tee: p.tee
          ? {
              par: p.tee.par ?? [],
              strokeIndex: p.tee.stroke_index ?? [],
              rating: p.tee.rating ?? null,
              slope: p.tee.slope ?? null,
              name: p.tee.name,
            }
          : null,
        storedCourse: p.course_handicap ?? null,
        storedPlaying: p.playing_handicap ?? null,
      })),
    scores: r.scores.map((s) => ({
      playerId: s.player_id,
      hole: s.hole,
      strokes: s.strokes,
      pickedUp: !!s.picked_up,
    })),
    formats: r.formats.map((f) => ({
      key: f.format_key,
      settings: f.settings ?? {},
      presses: (r.presses ?? [])
        .filter((p) => p.round_format_id === f.id)
        .map((p) => ({ bet: p.bet, afterHole: p.after_hole })),
    })),
  };
}

const REFRESH_MS = 30_000;

/** The last view of each link, so switching between Home and Board shows it at once. */
const seen = new Map<string, SpectatorView>();

/**
 * The spectator link: no account, just the golf, on two tabs. Home: the round that matters now
 * (with how many are playing, not who), its game, and the list of rounds. Board: each round's
 * leaderboard and the trip's, with the money only when the trip shows spectators winnings. It
 * refreshes itself while open, and always follows the phone's light or dark setting.
 */
@Component({
  selector: 'app-watch',
  imports: [
    UiBoard,
    UiCard,
    UiChip,
    UiChoicePills,
    UiCourseCard,
    UiGameCard,
    UiHeaderBand,
    UiListRow,
    UiLogo,
    UiSectionHead,
    UiSkeleton,
    UiTabBar,
  ],
  template: `
    @if (view(); as v) {
      <div class="screen with-tabs">
        <ui-header-band [label]="line()" [title]="tab() === 'board' ? 'Leaderboard' : title()" />
        <main class="content">
          @if (tab() === 'board') {
            @if (results().length) {
              <ui-choice-pills
                label="Board"
                [options]="choices()"
                [value]="picked()"
                (valueChange)="pick.set($event)"
              />
              @if (picked() === 'trip') {
                @if (trip(); as t) {
                  <ui-board
                    title="Trip"
                    [columns]="t.table.columns"
                    [valueColumn]="t.table.valueColumn"
                    [rows]="t.table.rows"
                  />
                  @if (t.settle; as s) {
                    <ui-card aria-label="Trip settle up">
                      <ui-section-head title="Settle up" />
                      @for (line of s.nets; track line.name) {
                        <ui-list-row [title]="line.name" [value]="line.text" />
                      }
                      @for (payment of s.payments; track payment) {
                        <ui-list-row [title]="payment" />
                      }
                    </ui-card>
                  }
                }
              } @else if (board(); as b) {
                <ui-board
                  [title]="b.title"
                  [columns]="b.table.columns"
                  [valueColumn]="b.table.valueColumn"
                  [rows]="b.table.rows"
                  [live]="b.live"
                />
                @for (match of b.matches; track match.key) {
                  <ui-game-card [title]="match.title" [rows]="match.rows" />
                }
                @if (b.settle; as s) {
                  <ui-card aria-label="Settle up">
                    <ui-section-head
                      title="Settle up"
                      [note]="b.final ? 'Final' : 'If it ended now'"
                    />
                    @for (line of s.nets; track line.name) {
                      <ui-list-row [title]="line.name" [value]="line.text" />
                    }
                    @for (payment of s.payments; track payment) {
                      <ui-list-row [title]="payment" />
                    }
                  </ui-card>
                }
              } @else {
                <ui-card pad><p>No scores yet.</p></ui-card>
              }
            } @else {
              <ui-card pad
                ><p>{{ empty() }}</p></ui-card
              >
            }
          } @else {
            @if (shown(); as r) {
              <ui-course-card [name]="r.course?.name ?? ''" [photo]="photo(r)" [live]="live(r)">
                @for (chip of chips(r); track chip) {
                  <ui-chip>{{ chip }}</ui-chip>
                }
                <p>{{ playing(r) }}</p>
              </ui-course-card>
              @if (game(); as g) {
                <ui-game-card [title]="g.title" [note]="g.note" [rows]="g.rows" />
              }
            }
            @if (v.rounds.length) {
              <ui-card aria-label="Rounds">
                <ui-section-head title="Rounds" />
                @for (r of v.rounds; track r.id) {
                  <ui-list-row
                    [title]="
                      'R' + r.round_number + ' · ' + (r.course?.short_name || r.course?.name || '')
                    "
                    [detail]="detail(r)"
                  >
                    <ui-chip>{{ status(r) }}</ui-chip>
                  </ui-list-row>
                }
              </ui-card>
            } @else {
              <ui-card pad
                ><p>{{ empty() }}</p></ui-card
              >
            }
          }
        </main>
      </div>
      <ui-tab-bar [tabs]="tabs()" [active]="tab()" />
    } @else if (gone()) {
      <main class="content gone">
        <ui-logo [size]="40" />
        <p role="alert">This link no longer works.</p>
      </main>
    } @else {
      <main class="content"><ui-skeleton shape="block" height="260px" /></main>
    }
  `,
  styles: `
    .gone {
      padding-top: calc(72px + env(safe-area-inset-top));
    }
  `,
})
export class Watch {
  readonly token = input.required<string>();
  /** Which tab: 'board', or Home. */
  readonly tab = input<'home' | 'board'>('home');

  private readonly supabase = inject(SUPABASE);

  protected readonly view = signal<SpectatorView | null>(null);
  protected readonly gone = signal(false);
  protected readonly pick = signal<string | null>(null);

  protected readonly tabs = computed<Tab[]>(() => [
    { key: 'home', label: 'Home', icon: 'home', link: ['/watch', this.token()] },
    { key: 'board', label: 'Board', icon: 'board', link: ['/watch', this.token(), 'board'] },
  ]);

  /** "SOUTHERN PINES · OCT 8–12" (no switcher: a spectator has no other trips). */
  protected readonly line = computed(() => {
    const trip = this.view()?.trip;
    return trip ? tripLine(trip) : '';
  });

  /** "Round 2 · Sat, Oct 10" while there is a round; else the trip's name. */
  protected readonly title = computed(() => {
    const r = this.shown();
    return r ? this.label(r) : (this.view()?.trip.name ?? '');
  });

  /** "Rounds start Thu, Jan 14" */
  protected readonly empty = computed(() => {
    const trip = this.view()?.trip;
    return trip ? `Rounds start ${formatDay(trip.start_date)}` : '';
  });

  /** Today's round, else the next one, else the last one. */
  protected readonly shown = computed(() => {
    const rounds = this.view()?.rounds ?? [];
    const today = localDate();
    return rounds.find((r) => r.play_date >= today) ?? rounds.at(-1) ?? null;
  });

  /** Every round worked out by the same engine the players' boards use. */
  protected readonly results = computed(() => {
    const v = this.view();
    return (v?.rounds ?? []).map((r) => ({
      round: r,
      result: safeResult(spectatorInput(r, v!.trip)),
    }));
  });

  protected readonly choices = computed<Choice<string>[]>(() => [
    ...this.results().map((r) => ({
      value: r.round.id,
      label: `R${r.round.round_number}${r.result.state === 'live' ? ' · Live' : ''}`,
    })),
    { value: 'trip', label: 'Trip' },
  ]);

  /** The round shown on Board: the one picked, else the one in play, else the last with scores. */
  protected readonly picked = computed(() => {
    const pick = this.pick();
    if (pick && (pick === 'trip' || this.results().some((r) => r.round.id === pick))) return pick;
    const results = this.results();
    return (
      results.find((r) => r.result.state === 'live' || r.result.state === 'complete')?.round.id ??
      results.filter((r) => r.result.state !== 'scheduled').at(-1)?.round.id ??
      results[0]?.round.id ??
      'trip'
    );
  });

  private names(): Record<string, string> {
    const names: Record<string, string> = {};
    for (const r of this.results()) for (const p of r.result.players) names[p.id] = p.name;
    return names;
  }

  /** The picked round's board once it has a score; its money only when the trip shows winnings. */
  protected readonly board = computed(() => {
    const found = this.results().find((r) => r.round.id === this.picked());
    if (!found || found.result.state === 'scheduled') return null;
    const nets = this.view()?.trip.shows_winnings ? roundNets(found.result) : null;
    return {
      title:
        found.round.course?.short_name ||
        found.round.course?.name ||
        `Round ${found.round.round_number}`,
      table: roundBoard(found.result) as BoardTable,
      matches: matchCards(found.result).map((m) => ({ ...m, title: formatName(m.key) })),
      settle: (nets && settleUp(nets, this.names())) as SettleUp | null,
      live: found.result.state === 'live',
      final: found.result.state === 'final',
    };
  });

  /** The trip's board, every round added up. */
  protected readonly trip = computed<{ table: BoardTable; settle: SettleUp | null } | null>(() => {
    const started = this.results()
      .map((r) => r.result)
      .filter((r) => r.state !== 'scheduled');
    if (!started.length) return null;
    const nets = this.view()?.trip.shows_winnings ? tripNets(started) : null;
    return { table: tripBoard(started), settle: nets && settleUp(nets, this.names()) };
  });

  /** The shown round's game, once it has a score: each player's points. */
  protected readonly game = computed<{ title: string; note: string; rows: GameRow[] } | null>(
    () => {
      const result = this.results().find((r) => r.round.id === this.shown()?.id)?.result;
      const game = result?.games[0];
      if (!result || !game || !game.holesCounted) return null;
      const match = matchCards(result).find((m) => m.key === game.key);
      if (match)
        return {
          title: `Today · Round ${result.number}`,
          note: `${formatName(game.key)} · thru ${game.holesCounted}`,
          rows: match.rows,
        };
      return {
        title: `Today · Round ${result.number}`,
        note: `9-point game · thru ${game.holesCounted}`,
        rows: [...result.players]
          .sort((a, b) => (game.total[b.id] ?? 0) - (game.total[a.id] ?? 0))
          .map((p) => ({ label: p.name, value: `${game.total[p.id] ?? 0} pts` })),
      };
    },
  );

  constructor() {
    // A spectator page always follows the phone, whatever this phone's app is set to.
    const root = document.documentElement;
    const forced = root.dataset['theme'];
    delete root.dataset['theme'];
    effect(() => {
      const cached = seen.get(this.token());
      if (cached && !this.view()) this.view.set(cached);
      void this.load(this.token());
    });
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !this.gone()) void this.load(this.token());
    }, REFRESH_MS);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      if (forced) root.dataset['theme'] = forced;
    });
  }

  protected label(r: SpectatorRound): string {
    return dayHeader(`Round ${r.round_number}`, r.play_date);
  }

  protected chips(r: SpectatorRound): string[] {
    return [
      formatTime(r.tee_time),
      gameLine(r.formats.map((f) => f.format_key)),
      r.tee?.name ? `${r.tee.name} tees` : '',
    ].filter(Boolean);
  }

  /** "4 players · 1 group": who is playing stays off the spectator page. */
  protected playing(r: SpectatorRound): string {
    const players = r.groups.reduce((n, g) => n + g.players.length, 0);
    const groups = r.groups.length;
    return `${players} ${players === 1 ? 'player' : 'players'} · ${groups} ${groups === 1 ? 'group' : 'groups'}`;
  }

  /** "Fri, Oct 9 · 9-point game" */
  protected detail(r: SpectatorRound): string {
    return [formatDay(r.play_date), gameLine(r.formats.map((f) => f.format_key))]
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
          seen.delete(token);
          this.view.set(null);
          this.gone.set(true);
        }
        return;
      }
      seen.set(token, data as SpectatorView);
      this.view.set(data as SpectatorView);
    } catch {
      // offline: keep what's shown
    }
  }
}
