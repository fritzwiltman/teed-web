import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import arlo from '../../assets/arlo.svg' with { loader: 'text' };
import { AdminData, AdminError, Proposal, RosterPlayer, TripAlert } from '../admin/data';
import { dayHeader, formatTime, gameLine, localDate } from '../core/format';
import { InstallService } from '../core/install';
import { inPlay } from '../core/round';
import { RoundsService } from '../core/rounds';
import { SessionService } from '../core/session';
import {
  AlertLevel,
  BoardRow,
  Choice,
  UiAlertCard,
  UiBadge,
  UiBoard,
  UiButton,
  UiCard,
  UiChip,
  UiCourseCard,
  UiField,
  UiIndexSheet,
  UiListRow,
  UiSectionHead,
  UiSegmented,
  UiSheet,
  UiSkeleton,
} from '../core/ui';
import { nextHole, toParText } from '../scoring';
import { TripHeader } from './trip-header';

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

/** How far the band stretches before Arlo is all there. */
const PULL_MAX = 230;

/**
 * Trip home: the round that matters now (course photo, tee time, game, tees, your group), the way
 * into scoring and the mini board. Organizers also get, in place: the Alert pill (the composer),
 * the Publish card on a draft, and Review when someone has suggested a change. Pull down past
 * the top and the band stretches to show Arlo.
 */
@Component({
  selector: 'app-trip-home',
  imports: [
    RouterLink,
    TripHeader,
    UiAlertCard,
    UiBadge,
    UiBoard,
    UiButton,
    UiCard,
    UiChip,
    UiCourseCard,
    UiField,
    UiIndexSheet,
    UiListRow,
    UiSectionHead,
    UiSegmented,
    UiSheet,
    UiSkeleton,
  ],
  template: `
    @if (session(); as s) {
      <app-trip-header
        [title]="title()"
        [action]="sessions.canManage() && s.trip.status !== 'final' ? 'Alert' : undefined"
        actionIcon="bell"
        (acted)="composing.set(true)"
      />
      <div class="arlo" [style.height.px]="pull()" aria-hidden="true">
        <div class="arlo-inner" [style.opacity]="pull() / pullMax">
          <div class="dog" [innerHTML]="arlo"></div>
          <p>Arlo sinks it</p>
        </div>
      </div>
      <main class="content">
        @for (alert of alerts(); track alert.id) {
          <ui-alert-card [level]="alert.level">{{ alert.body }}</ui-alert-card>
        }

        @if (s.trip.status === 'draft' && sessions.canManage()) {
          <ui-card pad aria-label="Draft">
            <div class="draft-head">
              <ui-badge stage="draft" />
              <span class="detail">Only organizers can see this</span>
            </div>
            <p>Set up the trip, then publish it and text everyone the invite.</p>
            <button ui-button type="button" [busy]="busy()" (click)="publish()">
              {{ busy() ? 'Publishing…' : 'Publish' }}
            </button>
          </ui-card>
          @if (toDo().length) {
            <ui-card aria-label="Still to do">
              <ui-section-head title="Still to do" />
              @for (item of toDo(); track item.title) {
                <a
                  ui-list-row
                  [routerLink]="item.link"
                  [title]="item.title"
                  [detail]="item.detail"
                  chevron
                ></a>
              }
            </ui-card>
          }
        }

        @if (proposals().length && sessions.canManage()) {
          <ui-card aria-label="Suggested changes">
            <a
              ui-list-row
              routerLink="/trip/suggestions"
              [title]="
                proposals().length +
                (proposals().length === 1 ? ' suggested change' : ' suggested changes')
              "
              value="Review"
              chevron
            ></a>
          </ui-card>
        }

        @if (error(); as text) {
          <p class="error-text" role="alert">{{ text }}</p>
        }

        @if (loading() && !shown()) {
          <ui-skeleton shape="block" height="260px" />
        } @else if (shown(); as r) {
          <ui-course-card [name]="r.round.courses?.name ?? ''" [photo]="r.photo" [live]="r.live">
            @for (chip of r.chips; track chip.name) {
              <ui-chip [icon]="chip.icon" [attr.aria-label]="chip.name">{{ chip.value }}</ui-chip>
            }
            @if (r.group) {
              <p>{{ r.group }}</p>
            }
            @if (r.round.status !== 'final' && s.trip.status === 'live') {
              @if (needsIndex(); as p) {
                <p class="warn-text">Add {{ p.name }}'s handicap index</p>
                @if (sessions.canManage()) {
                  <button ui-button type="button" (click)="indexFor.set(p)">Add it</button>
                }
              } @else {
                <a ui-button routerLink="/score">{{
                  (r.live ? 'Continue scoring' : 'Start scoring') +
                    (hole() ? ' · Hole ' + hole() : '')
                }}</a>
              }
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

        @if (canInstall()) {
          <ui-card aria-label="Install">
            <a ui-list-row routerLink="/install" title="Add Teed to your Home Screen" chevron></a>
          </ui-card>
        }
      </main>

      <ui-sheet [(open)]="composing" label="Alert everyone">
        <form class="stack" (submit)="sendAlert($event)" novalidate>
          <h2>Alert everyone</h2>
          <ui-field label="Message">
            <textarea
              name="message"
              maxlength="500"
              [value]="message()"
              (input)="message.set(text($event))"
            ></textarea>
          </ui-field>
          <ui-segmented
            label="Priority"
            [options]="levels"
            [value]="level()"
            (valueChange)="level.set($event ?? 'announcement')"
          />
          @if (alertError(); as text) {
            <p class="error-text" role="alert">{{ text }}</p>
          }
          <button ui-button type="submit" [busy]="busy()">
            Send to {{ playerCount() }} {{ playerCount() === 1 ? 'player' : 'players' }}
          </button>
        </form>
      </ui-sheet>

      <ui-sheet [(open)]="offering" label="Text the invite">
        <h2>{{ s.trip.name }} is live</h2>
        <p class="detail">Text everyone the invite?</p>
        <a ui-button routerLink="/trip/people" [queryParams]="{ send: 'all' }"
          >Text {{ playerCount() }} players</a
        >
        <button ui-button type="button" variant="outline" (click)="offering.set(false)">
          Later
        </button>
      </ui-sheet>

      <ui-index-sheet
        [open]="!!indexFor()"
        (openChange)="!$event && indexFor.set(null)"
        [name]="indexFor()?.name ?? ''"
        [busy]="busy()"
        [error]="indexError()"
        (saved)="saveIndex($event)"
      />
    }
  `,
  styles: `
    .arlo {
      overflow: hidden;
      background: var(--band);
      color: var(--on-band);
    }
    .arlo-inner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--s1);
      padding-top: var(--s2);
    }
    .dog {
      width: 240px;
      max-width: 70vw;
    }
    .dog ::ng-deep svg {
      display: block;
      width: 100%;
      height: auto;
    }
    .arlo p {
      font: 700 16px var(--font-heading);
    }
    @media (prefers-reduced-motion: reduce) {
      .dog ::ng-deep * {
        animation: none !important;
      }
    }
    .draft-head {
      display: flex;
      align-items: center;
      gap: var(--s2);
    }
  `,
})
export class TripHome {
  protected readonly sessions = inject(SessionService);
  private readonly install = inject(InstallService);
  private readonly live = inject(RoundsService);
  private readonly data = inject(AdminData);
  protected readonly session = this.sessions.session;
  protected readonly arlo = inject(DomSanitizer).bypassSecurityTrustHtml(arlo);
  protected readonly pullMax = PULL_MAX;

  private readonly rounds = signal<RoundRow[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pull = signal(0);

  protected readonly alerts = signal<TripAlert[]>([]);
  protected readonly proposals = signal<Proposal[]>([]);
  private readonly roster = signal<RosterPlayer[]>([]);

  // The alert composer.
  protected readonly composing = signal(false);
  protected readonly message = signal('');
  protected readonly level = signal<AlertLevel>('announcement');
  protected readonly alertError = signal<string | null>(null);
  protected readonly levels: Choice<AlertLevel>[] = [
    { value: 'announcement', label: 'Announcement' },
    { value: 'important', label: 'Important' },
    { value: 'urgent', label: 'Urgent' },
  ];
  /** After publishing: the separate prompt to text everyone the invite. */
  protected readonly offering = signal(false);
  protected readonly indexFor = signal<{ id: string; name: string } | null>(null);
  protected readonly indexError = signal<string | null>(null);

  protected readonly playerCount = computed(() => {
    const id = this.session()?.trip.id;
    return this.sessions.trips().find((t) => t.id === id)?.player_count ?? this.roster().length;
  });

  /** The reminder stays until the app is opened from the Home Screen. */
  protected readonly canInstall = computed(() => {
    const platform = this.install.platform();
    return platform !== 'standalone' && platform !== 'other';
  });

  /** "Round 2 · Sat, Oct 10" while there is a round to show; else the trip's name. */
  protected readonly title = computed(() => this.shown()?.label ?? this.session()?.trip.name ?? '');

  /** A draft's loose ends: tee times to add, emails to add. */
  protected readonly toDo = computed(() => {
    const rows = this.rows();
    const noTime = rows.filter((r) => !r.tee_time).map((r) => r.round_number);
    return [
      ...(noTime.length
        ? [
            {
              title: 'Add tee times',
              detail: `${noTime.length === 1 ? 'Round' : 'Rounds'} ${noTime.join(noTime.length === 2 ? ' and ' : ', ')}`,
              link: '/trip/courses',
            },
          ]
        : []),
      ...this.roster()
        .filter((p) => p.flags?.no_email)
        .map((p) => ({
          title: `Add an email for ${p.name}`,
          detail: 'So the invite can reach them',
          link: '/trip/people',
        })),
    ];
  });

  /**
   * Today's round, else the next one, else the last one: "Round 4 · Mon, Oct 12" over the course
   * name, chips for tee time, the game and tees (empty ones dropped), and my group.
   */
  protected readonly shown = computed(() => {
    const rows = this.rows();
    const today = localDate();
    const round = rows.find((r) => r.play_date >= today) ?? rows.at(-1);
    if (!round) return null;

    const chips = [
      { name: 'Tee time', icon: 'clock' as const, value: formatTime(round.tee_time) },
      {
        name: 'Game',
        icon: undefined,
        value: gameLine(round.round_formats.map((f) => f.format_key)),
      },
      { name: 'Tees', icon: undefined, value: round.tees?.name ? `${round.tees.name} tees` : '' },
    ].filter((chip) => chip.value);

    const me = this.session()?.player.id;
    const mine =
      round.groups?.find((g) => g.group_players.some((gp) => gp.players?.id === me)) ??
      round.groups?.[0];
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
      label: dayHeader(`Round ${round.round_number}`, round.play_date),
      round,
      live: inPlay(round),
      chips,
      group,
      photo,
    };
  });

  /**
   * The trip's rounds: the live ones when they are in hand (they are saved on the phone, so Home
   * has its round card with no signal), else what this screen read itself.
   */
  private readonly rows = computed<RoundRow[]>(() => {
    const live = this.live.for(this.session()?.trip.id);
    if (!live.length) return this.rounds();
    return [...live]
      .sort(
        (a, b) =>
          a.row.play_date.localeCompare(b.row.play_date) || a.row.round_number - b.row.round_number,
      )
      .map(({ row }) => ({
        round_number: row.round_number,
        play_date: row.play_date,
        tee_time: row.tee_time,
        status: row.status,
        courses: row.courses,
        tees: row.tees,
        round_formats: row.round_formats,
        groups: row.groups.map((g) => ({
          group_players: g.group_players.map((gp) => ({
            position: gp.position,
            players: gp.player,
            scores: [{ count: gp.scores?.length ?? 0 }],
          })),
        })),
      }));
  });

  /** The shown round as the engine has it, once the live rounds are in hand. */
  private readonly scored = computed(() => {
    const number = this.shown()?.round.round_number;
    return (
      this.live.for(this.session()?.trip.id).find((r) => r.row.round_number === number) ?? null
    );
  });

  /** Someone in the group with no handicap index: nobody scores until it is in. */
  protected readonly needsIndex = computed(() => {
    const p = this.scored()?.result.players.find((x) => x.playing === null);
    return p ? { id: p.id, name: p.name } : null;
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
    effect(() => {
      const trip = this.session()?.trip;
      if (trip && this.sessions.canManage())
        void this.loadOrganizer(trip.id, trip.status === 'draft');
    });
    this.watchPull();
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /** Publish, then the separate prompt to text everyone the invite. */
  protected async publish(): Promise<void> {
    const trip = this.session()?.trip;
    if (!trip || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.data.updateTrip(trip.id, { status: 'live' });
      await this.sessions.loadTrips();
      await this.sessions.open(trip.id);
      this.offering.set(true);
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't publish the trip.");
    } finally {
      this.busy.set(false);
    }
  }

  protected async sendAlert(event: Event): Promise<void> {
    event.preventDefault();
    const trip = this.session()?.trip;
    const body = this.message().trim();
    if (!trip || this.busy()) return;
    if (!body) return this.alertError.set('Write the message.');
    this.busy.set(true);
    this.alertError.set(null);
    try {
      await this.data.sendAlert(trip.id, this.level(), body);
      this.message.set('');
      this.composing.set(false);
      this.alerts.set(await this.data.alerts(trip.id));
    } catch (e) {
      this.alertError.set(e instanceof AdminError ? e.message : "Couldn't send the alert.");
    } finally {
      this.busy.set(false);
    }
  }

  protected async saveIndex(index: number | null): Promise<void> {
    const p = this.indexFor();
    const trip = this.session()?.trip;
    if (!p || !trip) return;
    this.busy.set(true);
    this.indexError.set(null);
    try {
      await this.data.setIndex(p.id, index);
      await this.live.load(trip.id);
      this.indexFor.set(null);
    } catch (e) {
      this.indexError.set(
        e instanceof AdminError ? e.message : "Couldn't save the handicap index.",
      );
    } finally {
      this.busy.set(false);
    }
  }

  private async loadOrganizer(tripId: string, draft: boolean): Promise<void> {
    const [proposals, roster] = await Promise.all([
      this.data.proposals(tripId).catch(() => [] as Proposal[]),
      draft ? this.data.roster(tripId).catch(() => [] as RosterPlayer[]) : Promise.resolve([]),
    ]);
    this.proposals.set(proposals);
    this.roster.set(roster);
  }

  /**
   * Pulling down past the top stretches the band to show Arlo; letting go puts it back. Only while
   * the page is at the top, and only for a pull downwards.
   */
  private watchPull(): void {
    if (typeof window === 'undefined') return;
    let startY: number | null = null;
    const start = (e: TouchEvent) => {
      startY = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (startY === null) return;
      const down = e.touches[0].clientY - startY;
      this.pull.set(down > 0 ? Math.min(PULL_MAX, down * 0.6) : 0);
    };
    const end = () => {
      startY = null;
      this.pull.set(0);
    };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    });
  }

  private async load(): Promise<void> {
    const trip = this.session()?.trip;
    if (!trip) return;
    try {
      const [{ data }, alerts] = await Promise.all([
        this.sessions
          .db()
          .from('rounds')
          .select(
            'round_number, play_date, tee_time, status, courses(name, photo_path), tees(name), round_formats(format_key), groups(group_players(position, players:trip_members(id, name), scores(count)))',
          )
          .eq('trip_id', trip.id)
          .order('play_date')
          .order('round_number'),
        this.data.alerts(trip.id).catch(() => [] as TripAlert[]),
      ]);
      this.rounds.set((data ?? []) as unknown as RoundRow[]);
      this.alerts.set(alerts);
    } catch {
      // no signal: the round card stays hidden until there is something to show
    } finally {
      this.loading.set(false);
    }
  }
}
