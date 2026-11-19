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
              <span class="label round-label">{{ r.label }}</span>
            </div>
            <div class="row">
              <strong class="course">{{ r.round.courses?.name }}</strong>
            </div>
            @if (r.round.tee_time) {
              <div class="row">
                <span class="label">Tee time</span>
                <span class="mono">{{ time(r.round.tee_time) }}</span>
              </div>
            }
            @if (r.round.tees; as tee) {
              <div class="row">
                <span class="label">Tees</span>
                <span>{{ tee.name }}</span>
              </div>
            }
            @if (formats(r.round); as f) {
              <div class="row">
                <span class="label">Format</span>
                <span>{{ f }}</span>
              </div>
            }
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
    .round-label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
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

  /** Today's round, else the next one, else the trip's final round. Label e.g. "Next · R3 · Fri, Oct 9". */
  protected readonly shown = computed(() => {
    const rows = this.rounds();
    const today = localDate();
    const todays = rows.find((r) => r.play_date === today);
    if (todays) return { label: `Today · R${todays.round_number}`, round: todays };
    const next = rows.find((r) => r.play_date > today);
    if (next)
      return { label: `Next · R${next.round_number} · ${formatDay(next.play_date)}`, round: next };
    const last = rows.at(-1);
    return last
      ? { label: `Final round · R${last.round_number} · ${formatDay(last.play_date)}`, round: last }
      : null;
  });

  protected readonly time = formatTime;

  constructor() {
    void this.load();
  }

  protected formats(round: RoundRow): string {
    return round.round_formats.map((f) => formatName(f.format_key)).join(' + ');
  }

  private async load(): Promise<void> {
    const trip = this.session()?.trip;
    if (!trip) return;
    try {
      const { data } = await this.supabase
        .from('rounds')
        .select(
          'round_number, play_date, tee_time, status, courses(name), tees(name), round_formats(format_key)',
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
