import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth';
import { daysUntil, formatShortRange } from '../core/format';
import { MyTrip, SessionService } from '../core/session';
import {
  TripStage,
  UiBadge,
  UiButton,
  UiCard,
  UiIndexSheet,
  UiListRow,
  UiLogo,
  UiSectionHead,
  UiSkeleton,
} from '../core/ui';

const STAGE: Record<MyTrip['stage'], TripStage> = {
  draft: 'draft',
  upcoming: 'upcoming',
  in_progress: 'in-progress',
  final: 'final',
};

/**
 * You: the first screen after sign-in when no trip is in progress, and where the trip line in
 * any trip's header leads. Your name beside the logo; one Trips card (the next trip big, with its
 * countdown and Open trip; then Upcoming and Past); Your golf (handicap index and email). Trip
 * creators get "+ New trip" floating at the bottom; the app admin also gets Trip creators.
 */
@Component({
  selector: 'app-you',
  imports: [
    RouterLink,
    UiBadge,
    UiButton,
    UiCard,
    UiIndexSheet,
    UiListRow,
    UiLogo,
    UiSectionHead,
    UiSkeleton,
  ],
  template: `
    <header class="band">
      <div class="inner">
        <h1>{{ me()?.display_name || 'You' }}</h1>
        <ui-logo tone="band" [size]="20" />
      </div>
    </header>
    <main class="content" [class.floating]="me()?.is_trip_creator">
      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }

      <ui-card aria-label="Trips">
        <ui-section-head title="Trips" />
        @if (loading() && !trips().length) {
          <div class="next"><ui-skeleton shape="block" height="120px" /></div>
        } @else if (next(); as t) {
          <div class="next">
            <div class="next-top">
              <div class="next-text">
                <p class="eyebrow">
                  Next
                  @if (t.stage === 'draft') {
                    <ui-badge stage="draft" />
                  }
                </p>
                <h2>{{ t.name }}</h2>
                <p class="facts">{{ facts(t) }}</p>
              </div>
              @if (t.stage !== 'in_progress') {
                <div class="count">
                  <span class="days">{{ days(t) }}</span>
                  <span class="unit">{{ days(t) === 1 ? 'day' : 'days' }}</span>
                </div>
              }
            </div>
            <button ui-button type="button" (click)="open(t)">Open trip</button>
          </div>
        } @else {
          <div class="next">
            <h2>No trips yet</h2>
            <p class="facts">
              {{
                me()?.is_trip_creator
                  ? 'Start one and invite your group.'
                  : 'When an organizer adds you, the trip shows up here.'
              }}
            </p>
          </div>
        }
        @if (upcoming().length) {
          <p class="group">Upcoming</p>
          @for (t of upcoming(); track t.id) {
            <button
              ui-list-row
              type="button"
              [title]="t.name"
              [detail]="facts(t)"
              chevron
              (click)="open(t)"
            >
              @if (t.stage === 'draft') {
                <ui-badge stage="draft" />
              }
            </button>
          }
        }
        @if (past().length) {
          <p class="group">Past</p>
          @for (t of past(); track t.id) {
            <button
              ui-list-row
              type="button"
              [title]="t.name"
              [detail]="pastDetail(t)"
              chevron
              (click)="open(t)"
            >
              <ui-badge [stage]="stage(t)" />
            </button>
          }
        }
      </ui-card>

      @if (me(); as m) {
        <ui-card aria-label="Your golf">
          <ui-section-head title="Your golf" />
          <button
            ui-list-row
            type="button"
            title="Handicap index"
            [value]="m.handicap_index === null ? null : m.handicap_index.toFixed(1)"
            chevron
            (click)="editingIndex.set(true)"
          >
            @if (m.handicap_index === null) {
              <span class="warn-text">Add</span>
            }
          </button>
          <ui-list-row title="Email" [value]="m.email" />
        </ui-card>

        @if (m.is_admin) {
          <ui-card aria-label="Admin">
            <a ui-list-row routerLink="/you/creators" title="Trip creators" chevron></a>
          </ui-card>
        }
        @if (m.is_trip_creator) {
          <ui-card aria-label="Courses">
            <a ui-list-row routerLink="/courses" title="Course library" chevron></a>
          </ui-card>
        }
      }

      <button ui-button variant="text" type="button" class="center" (click)="signOut()">
        Sign out
      </button>
    </main>

    @if (me()?.is_trip_creator) {
      <a class="fab" routerLink="/you/new-trip">+ New trip</a>
    }

    <ui-index-sheet
      [(open)]="editingIndex"
      [value]="me()?.handicap_index ?? null"
      allowClear
      [busy]="saving()"
      [error]="indexError()"
      (saved)="saveIndex($event)"
    />
  `,
  styles: `
    .band {
      background: var(--band);
      color: var(--on-band);
      padding-top: env(safe-area-inset-top);
    }
    .band .inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--s3);
      max-width: var(--column);
      margin: 0 auto;
      padding: var(--s3) var(--s4);
    }
    .band h1 {
      font-size: 32px;
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .floating {
      padding-bottom: 104px;
    }
    .next {
      display: flex;
      flex-direction: column;
      gap: var(--s3);
      padding: var(--s1) var(--s4) var(--s4);
    }
    .next-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--s3);
    }
    .next-text {
      min-width: 0;
    }
    .eyebrow,
    .group {
      display: flex;
      align-items: center;
      gap: var(--s2);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--muted);
    }
    .group {
      padding: var(--s3) var(--s4) var(--s1);
      border-top: 1px solid var(--line);
    }
    .next h2 {
      font-size: 24px;
    }
    .facts {
      font-size: 15px;
      font-weight: 500;
      color: var(--ink-2);
    }
    .count {
      flex: none;
      text-align: right;
    }
    .days {
      display: block;
      font: 700 40px/1 var(--font-heading);
    }
    .unit {
      font-size: 13px;
      color: var(--muted);
    }
    .fab {
      position: fixed;
      left: 50%;
      bottom: calc(var(--s5) + env(safe-area-inset-bottom));
      z-index: 30;
      transform: translateX(-50%);
      display: inline-flex;
      align-items: center;
      height: 52px;
      padding: 0 26px;
      border-radius: var(--radius-pill);
      background: var(--fill);
      color: var(--on-fill);
      box-shadow: var(--shadow-raised);
      font-size: 17px;
      font-weight: 700;
      text-decoration: none;
      white-space: nowrap;
    }
  `,
})
export class You {
  private readonly auth = inject(AuthService);
  private readonly sessions = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly me = this.auth.me;
  protected readonly trips = this.sessions.trips;
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly next = computed(() => this.trips().find((t) => t.bucket === 'next') ?? null);
  protected readonly upcoming = computed(() => this.trips().filter((t) => t.bucket === 'upcoming'));
  protected readonly past = computed(() => this.trips().filter((t) => t.bucket === 'past'));

  protected readonly editingIndex = signal(false);
  protected readonly saving = signal(false);
  protected readonly indexError = signal<string | null>(null);

  constructor() {
    this.sessions.leave(); // You is outside any one trip
    void this.sessions.loadTrips().finally(() => this.loading.set(false));
  }

  protected stage(trip: MyTrip): TripStage {
    return STAGE[trip.stage];
  }

  protected days(trip: MyTrip): number {
    return daysUntil(trip.start_date);
  }

  /** "Jan 14–17 · 4 players" */
  protected facts(trip: MyTrip): string {
    return `${formatShortRange(trip.start_date, trip.end_date)} · ${trip.player_count} ${
      trip.player_count === 1 ? 'player' : 'players'
    }`;
  }

  /** "Oct 8–12 · 1st · $190" once the finish and winnings are known; until then the dates. */
  protected pastDetail(trip: MyTrip): string {
    return [
      formatShortRange(trip.start_date, trip.end_date),
      trip.finish,
      trip.winnings == null ? null : `$${trip.winnings}`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** Every trip opens at its Home; a draft's Home is where it is set up. */
  protected async open(trip: MyTrip): Promise<void> {
    this.error.set(null);
    if (await this.sessions.open(trip.id)) await this.router.navigateByUrl('/home');
    else this.error.set("Couldn't open that trip. Check your signal and try again.");
  }

  protected async saveIndex(index: number | null): Promise<void> {
    const me = this.me();
    if (!me) return;
    this.saving.set(true);
    this.indexError.set(null);
    const ok = await this.auth.saveProfile({
      display_name: me.display_name,
      handicap_index: index,
    });
    this.saving.set(false);
    if (ok) this.editingIndex.set(false);
    else this.indexError.set("That didn't save. Check your signal and try again.");
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }
}
