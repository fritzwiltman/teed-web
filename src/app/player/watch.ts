import { Component, DestroyRef, computed, effect, inject, input, signal } from '@angular/core';
import { formatDateRange, formatDay, formatName, formatTime, localDate } from '../core/format';
import { SUPABASE } from '../core/supabase';
import { UiCard, UiChip, UiCourseCard, UiHeaderBand, UiListRow, UiSkeleton } from '../core/ui';

/** What the `spectate` function returns: the trip's header and its rounds, nothing else. */
export interface SpectatorView {
  trip: {
    name: string;
    location: string | null;
    start_date: string;
    end_date: string;
    status: string;
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
  course: { name: string; short_name: string | null; photo_path: string | null } | null;
  tee: { name: string } | null;
  formats: { format_key: string }[];
  groups: { players: { id: string; name: string }[] }[];
  scores: { player_id: string; hole: number; strokes: number }[];
}

const REFRESH_MS = 30_000;

/**
 * The spectator link: no account, just the golf. Shows the round that matters now and the list
 * of rounds; leaderboards join it when they are built (M6). Refreshes itself while open. Its
 * design comes with the spectator screens proper.
 */
@Component({
  selector: 'app-watch',
  imports: [UiCard, UiChip, UiCourseCard, UiHeaderBand, UiListRow, UiSkeleton],
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
