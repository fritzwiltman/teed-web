import { Component, computed, inject, signal } from '@angular/core';
import { formatDateRange, formatDay, formatName, formatTime, localDate } from '../core/format';
import { SessionService } from '../core/session';
import { SUPABASE } from '../core/supabase';

interface RoundRow {
  round_number: number;
  play_date: string;
  tee_time: string | null;
  status: 'scheduled' | 'live' | 'final';
  courses: { name: string } | null;
  tees: { name: string } | null;
  round_formats: { format_key: string }[];
  groups: { group_players: { position: number; players: { id: string; name: string } | null }[] }[];
}

/**
 * Trip home. Placeholder for M2: trip, who you are, and the round that matters now.
 * The real screen (course photo, "Continue scoring", leaderboard snapshot) comes with M4 and M6.
 */
@Component({
  selector: 'app-trip-home',
  template: `
    @if (session(); as s) {
      <main class="page">
        <header>
          <p class="label">{{ s.trip.location ?? 'Golf trip' }} · {{ dates() }}</p>
          <h1>{{ s.trip.name }}</h1>
        </header>

        <section class="card" aria-label="You">
          @if (s.player; as player) {
            <div class="row">
              <span class="label">Playing as</span>
              <strong class="who">{{ player.name }}</strong>
            </div>
          }
          @if (role(); as r) {
            <div class="row">
              <span class="label">Role</span>
              <span>{{ r }}</span>
            </div>
          }
        </section>

        @if (shown(); as r) {
          <section class="card" aria-label="Round">
            <div class="row">
              <span class="label nowrap">{{ r.label }}</span>
            </div>
            @if (r.cells.length) {
              <div class="strip">
                @for (cell of r.cells; track cell.name) {
                  <span class="cell label" [attr.aria-label]="cell.name">{{ cell.value }}</span>
                }
              </div>
            }
            <div class="row">
              <strong class="course">{{ r.round.courses?.name }}</strong>
            </div>
            @if (r.group) {
              <div class="row">
                <span>{{ r.group }}</span>
              </div>
            }
            <!-- M4: the "Continue scoring" button goes here. -->
          </section>
        }
      </main>
    }
  `,
  styles: `
    h1 {
      font-size: 2rem;
      margin-top: 0.3rem;
    }
    .who,
    .course {
      font-family: var(--font-heading);
      font-size: 1.25rem;
    }
    .nowrap {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .cell {
      color: var(--ink);
    }
  `,
})
export class TripHome {
  private readonly supabase = inject(SUPABASE);
  protected readonly session = inject(SessionService).session;

  private readonly rounds = signal<RoundRow[]>([]);

  protected readonly dates = computed(() => {
    const trip = this.session()?.trip;
    return trip ? formatDateRange(trip.start_date, trip.end_date) : '';
  });

  /** Owner, Co-admin or Spectator. Regular players have no role worth showing. */
  protected readonly role = computed(() => {
    const s = this.session();
    if (!s) return null;
    if (!s.player) return 'Spectator';
    if (s.trip.owner_player_id === s.player.id) return 'Owner';
    return s.player.role === 'co_admin' ? 'Co-admin' : null;
  });

  /**
   * Today's round, else the next one, else the last one. Label "Round 4 · Mon, Oct 12", or
   * "Round 2 · Today"; then the TIME | FORMAT | TEES cells (empty ones dropped) and my group.
   */
  protected readonly shown = computed(() => {
    const rows = this.rounds();
    const today = localDate();
    const round = rows.find((r) => r.play_date >= today) ?? rows.at(-1);
    if (!round) return null;

    const cells = [
      { name: 'Time', value: formatTime(round.tee_time) },
      {
        name: 'Format',
        value: round.round_formats.map((f) => formatName(f.format_key)).join(' + '),
      },
      { name: 'Tees', value: round.tees?.name ?? '' },
    ].filter((cell) => cell.value);

    const me = this.session()?.player?.id;
    const mine = round.groups?.find((g) => g.group_players.some((gp) => gp.players?.id === me));
    const group = [...(mine?.group_players ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((gp) => gp.players?.name)
      .filter(Boolean)
      .join(' · ');

    const when = round.play_date === today ? 'Today' : formatDay(round.play_date);
    return { label: `Round ${round.round_number} · ${when}`, round, cells, group };
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const trip = this.session()?.trip;
    if (!trip) return;
    try {
      const { data } = await this.supabase
        .from('rounds')
        .select(
          'round_number, play_date, tee_time, status, courses(name), tees(name), round_formats(format_key), groups(group_players(position, players(id, name)))',
        )
        .eq('trip_id', trip.id)
        .order('play_date')
        .order('round_number');
      this.rounds.set((data ?? []) as unknown as RoundRow[]);
    } catch {
      // no signal: the round card stays hidden until there is something to show
    }
  }
}
