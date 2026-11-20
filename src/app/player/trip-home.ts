import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatDateRange, formatDay, formatName, formatTime, localDate } from '../core/format';
import { InstallService } from '../core/install';
import { inPlay } from '../core/round';
import { SessionService } from '../core/session';
import { UiButton, UiCard, UiChip, UiCourseCard, UiListRow, UiSkeleton } from '../core/ui';
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
            @if (s.player && r.round.status !== 'final') {
              <a ui-button routerLink="/score">{{
                r.live ? 'Continue scoring' : 'Start scoring'
              }}</a>
            }
          </ui-course-card>
        }

        @if (role(); as r) {
          <ui-card aria-label="You">
            <ui-list-row [title]="s.player?.name ?? 'Watching'">
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

  /** Owner, Co-admin or Spectator. Regular players have no role worth showing. */
  protected readonly role = computed(() => {
    const s = this.session();
    if (!s) return null;
    if (!s.player) return 'Spectator';
    if (s.trip.owner_player_id === s.player.id) return 'Owner';
    return s.player.role === 'co_admin' ? 'Co-admin' : null;
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

    const me = this.session()?.player?.id;
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
          'round_number, play_date, tee_time, status, courses(name, photo_path), tees(name), round_formats(format_key), groups(group_players(position, players(id, name), scores(count)))',
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
