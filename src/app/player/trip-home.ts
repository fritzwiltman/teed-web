import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatDateRange, formatDay, formatName, formatTime, localDate } from '../core/format';
import { InstallService } from '../core/install';
import { inPlay } from '../core/round';
import { RoundsService } from '../core/rounds';
import { nextHole, toParText } from '../scoring';
import { SessionService } from '../core/session';
import {
  BoardRow,
  UiBoard,
  UiButton,
  UiCard,
  UiChip,
  UiCourseCard,
  UiListRow,
  UiSkeleton,
} from '../core/ui';
import { PlayerHeader } from './player-header';

interface RoundRow {
  round_number: number;
  play_date: string;
  tee_time: string | null;
  status: 'scheduled' | 'live' | 'final';
  courses: { name: string; photo_path: string | null } | null;
  tees: { name: string } | null;
  round_formats: { format_key: string }[];
  groups: {
    group_players: {
      position: number;
      players: { id: string; name: string } | null;
      scores?: { count: number }[];
    }[];
  }[];
}

/**
 * Trip home: the round that matters now (course photo, tee time, format, tees, your group) and
 * the way into scoring. The other home states (countdown, live board, winnings) come with M4–M6.
 */
@Component({
  selector: 'app-trip-home',
  imports: [
    RouterLink,
    PlayerHeader,
    UiBoard,
    UiButton,
    UiCard,
    UiChip,
    UiCourseCard,
    UiListRow,
    UiSkeleton,
  ],
  template: `
    @if (session(); as s) {
      <app-player-header [label]="where()" [title]="s.trip.name" />
      <main class="content">
        @if (loading()) {
          <ui-skeleton shape="block" height="260px" />
        } @else if (shown(); as r) {
          <ui-course-card
            [name]="r.round.courses?.name ?? ''"
            [label]="r.label"
            [photo]="r.photo"
            [live]="r.live"
          >
            @for (chip of r.chips; track chip.name) {
              <ui-chip [icon]="chip.icon" [attr.aria-label]="chip.name">{{ chip.value }}</ui-chip>
            }
            @if (r.group) {
              <p>{{ r.group }}</p>
            }
            @if (r.round.status !== 'final') {
              <a ui-button routerLink="/score">{{
                (r.live ? 'Continue scoring' : 'Start scoring') +
                  (hole() ? ' · Hole ' + hole() : '')
              }}</a>
            }
          </ui-course-card>
          @if (mini(); as board) {
            <ui-board
              mini
              [title]="'Round ' + r.round.round_number"
              valueLabel="Net"
              [rows]="board.rows"
              [live]="board.live"
            />
          }
        }

        @if (role(); as r) {
          <ui-card aria-label="You">
            <ui-list-row [title]="s.player.name">
              <ui-chip>{{ r }}</ui-chip>
            </ui-list-row>
          </ui-card>
        }

        @if (canInstall()) {
          <ui-card aria-label="Install">
            <a ui-list-row routerLink="/install" title="Add Teed to your Home Screen" chevron></a>
          </ui-card>
        }
      </main>
    }
  `,
})
export class TripHome {
  private readonly sessions = inject(SessionService);
  private readonly install = inject(InstallService);
  private readonly live = inject(RoundsService);
  protected readonly session = this.sessions.session;

  private readonly rounds = signal<RoundRow[]>([]);
  protected readonly loading = signal(true);

  /** "Vero Beach, FL · Jan 11–15, 2027" */
  protected readonly where = computed(() => {
    const trip = this.session()?.trip;
    if (!trip) return '';
    return [trip.location, formatDateRange(trip.start_date, trip.end_date)]
      .filter(Boolean)
      .join(' · ');
  });

  /** Organizer or Co-organizer. Players have no role worth showing. */
  protected readonly role = computed(() => {
    const role = this.session()?.player.role;
    return role === 'organizer' ? 'Organizer' : role === 'co_organizer' ? 'Co-organizer' : null;
  });

  /** The reminder stays until the app is opened from the Home Screen. */
  protected readonly canInstall = computed(() => {
    const platform = this.install.platform();
    return platform !== 'standalone' && platform !== 'other';
  });

  /**
   * Today's round, else the next one, else the last one: "Round 4 · Mon, Oct 12" over the course
   * name, chips for tee time, format and tees (empty ones dropped), and my group.
   */
  protected readonly shown = computed(() => {
    const rows = this.rounds();
    const today = localDate();
    const round = rows.find((r) => r.play_date >= today) ?? rows.at(-1);
    if (!round) return null;

    const chips = [
      { name: 'Tee time', icon: 'clock' as const, value: formatTime(round.tee_time) },
      {
        name: 'Format',
        icon: undefined,
        value: round.round_formats.map((f) => formatName(f.format_key)).join(' + '),
      },
      { name: 'Tees', icon: undefined, value: round.tees?.name ? `${round.tees.name} tees` : '' },
    ].filter((chip) => chip.value);

    const me = this.session()?.player.id;
    const mine = round.groups?.find((g) => g.group_players.some((gp) => gp.players?.id === me));
    const group = [...(mine?.group_players ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((gp) => gp.players?.name)
      .filter(Boolean)
      .join(' · ');

    const path = round.courses?.photo_path;
    const photo = path
      ? this.sessions.db().storage.from('course-photos').getPublicUrl(path).data.publicUrl
      : null;

    return {
      label: `Round ${round.round_number} · ${formatDay(round.play_date)}`,
      round,
      live: inPlay(round),
      chips,
      group,
      photo,
    };
  });

  /** The shown round as the engine has it, once the live rounds are in hand. */
  private readonly scored = computed(() => {
    const number = this.shown()?.round.round_number;
    return (
      this.live.for(this.session()?.trip.id).find((r) => r.row.round_number === number) ?? null
    );
  });

  /** The hole "Continue scoring" opens on. */
  protected readonly hole = computed(() => {
    const scored = this.scored();
    return scored && scored.result.state !== 'final' ? nextHole(scored.result) : null;
  });

  /** The mini board: net to par and thru, once the round has a score. */
  protected readonly mini = computed<{ rows: BoardRow[]; live: boolean } | null>(() => {
    const result = this.scored()?.result;
    if (!result || result.state === 'scheduled') return null;
    const me = this.session()?.player.id;
    const rows = result.players
      .filter((p) => p.thru > 0)
      .sort((a, b) => (a.toPar ?? 999) - (b.toPar ?? 999))
      .map((p, _i, all) => ({
        pos: `${all.findIndex((o) => o.toPar === p.toPar) + 1}`,
        name: p.name,
        value: toParText(p.toPar),
        thru: result.state === 'final' ? 'F' : `${p.thru}`,
        under: (p.toPar ?? 0) < 0,
        me: p.id === me,
      }));
    return rows.length ? { rows, live: result.state === 'live' } : null;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const trip = this.session()?.trip;
    if (!trip) return;
    try {
      const { data } = await this.sessions
        .db()
        .from('rounds')
        .select(
          'round_number, play_date, tee_time, status, courses(name, photo_path), tees(name), round_formats(format_key), groups(group_players(position, players:trip_members(id, name), scores(count)))',
        )
        .eq('trip_id', trip.id)
        .order('play_date')
        .order('round_number');
      this.rounds.set((data ?? []) as unknown as RoundRow[]);
    } catch {
      // no signal: the round card stays hidden until there is something to show
    } finally {
      this.loading.set(false);
    }
  }
}
