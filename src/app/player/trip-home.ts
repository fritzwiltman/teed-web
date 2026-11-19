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
 * Trip home. Placeholder for M2: shows that the login worked (trip, who you are, today's round).
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
            @if (player.role === 'co_admin') {
              <div class="row"><span class="label">Role</span><span>Co-admin</span></div>
            }
          } @else {
            <div class="row">
              <span class="label">Watching as</span>
              <strong class="who">Spectator</strong>
            </div>
            <div class="row">
              <span class="muted">Read-only: you can follow scores but not enter them.</span>
            </div>
          }
        </section>

        <section class="card" aria-label="Round">
          @switch (rounds().state) {
            @case ('loading') {
              <div class="row"><span class="muted">Loading today's round…</span></div>
            }
            @case ('offline') {
              <div class="row">
                <span class="muted"
                  >Can't load the rounds right now. They'll appear when you're back in signal.</span
                >
              </div>
            }
            @default {
              @if (shown(); as r) {
                <div class="row">
                  <span class="label">{{ r.heading }}</span>
                  <span class="mono"
                    >R{{ r.round.round_number }} · {{ day(r.round.play_date) }}</span
                  >
                </div>
                <div class="row">
                  <strong class="course">{{ r.round.courses?.name }}</strong>
                </div>
                <div class="row">
                  <span class="label">Tee time</span>
                  <span class="mono">{{ time(r.round.tee_time) || 'TBD' }}</span>
                </div>
                <div class="row">
                  <span class="label">Tees</span>
                  <span>{{ r.round.tees?.name }}</span>
                </div>
                <div class="row">
                  <span class="label">Format</span>
                  <span>{{ formats(r.round) }}</span>
                </div>
              } @else {
                <div class="row">
                  <span class="muted">No rounds have been set up for this trip yet.</span>
                </div>
              }
            }
          }
        </section>
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
  `,
})
export class TripHome {
  private readonly supabase = inject(SUPABASE);
  protected readonly session = inject(SessionService).session;

  protected readonly rounds = signal<{ state: 'loading' | 'offline' | 'ready'; rows: RoundRow[] }>({
    state: 'loading',
    rows: [],
  });

  protected readonly dates = computed(() => {
    const trip = this.session()?.trip;
    return trip ? formatDateRange(trip.start_date, trip.end_date) : '';
  });

  /** Today's round if there is one, otherwise the next one, otherwise the last one played. */
  protected readonly shown = computed(() => {
    const rows = this.rounds().rows;
    const today = localDate();
    const todays = rows.find((r) => r.play_date === today);
    if (todays) return { heading: "Today's round", round: todays };
    const next = rows.find((r) => r.play_date > today);
    if (next) return { heading: 'No round today · next', round: next };
    const last = rows.at(-1);
    return last ? { heading: 'No round today · last', round: last } : null;
  });

  protected readonly day = formatDay;
  protected readonly time = formatTime;

  constructor() {
    void this.load();
  }

  protected formats(round: RoundRow): string {
    return round.round_formats.map((f) => formatName(f.format_key)).join(' + ') || 'TBD';
  }

  private async load(): Promise<void> {
    const trip = this.session()?.trip;
    if (!trip) return;
    try {
      const { data, error } = await this.supabase
        .from('rounds')
        .select(
          'round_number, play_date, tee_time, status, courses(name), tees(name), round_formats(format_key)',
        )
        .eq('trip_id', trip.id)
        .order('play_date')
        .order('round_number');
      this.rounds.set(
        error
          ? { state: 'offline', rows: [] }
          : { state: 'ready', rows: (data ?? []) as unknown as RoundRow[] },
      );
    } catch {
      this.rounds.set({ state: 'offline', rows: [] });
    }
  }
}
