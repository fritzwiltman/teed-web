import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { COURSE_RETURN } from '../admin/course-edit';
import { AdminData, AdminError, CourseChoice, RosterPlayer, RoundSetupFields } from '../admin/data';
import { formatDay, formatName, formatTime } from '../core/format';
import { RoundsService } from '../core/rounds';
import { SessionService } from '../core/session';
import {
  BoardRow,
  Choice,
  PickerOption,
  UiBoard,
  UiButton,
  UiCard,
  UiCheckbox,
  UiConfirmSheet,
  UiEditPill,
  UiField,
  UiHeaderBand,
  UiIndexSheet,
  UiListRow,
  UiPickerSheet,
  UiSectionHead,
  UiSegmented,
  UiSkeleton,
  UiSwitch,
  UiTeesChip,
  teeDetail,
} from '../core/ui';
import { pointValueText } from '../scoring';

const HOLES = { '18': '18 holes', front: 'Front 9', back: 'Back 9' };
const POINT_VALUES = [25, 50, 100];
const DRAFT_KEY = 'teed.round-draft';

/**
 * A round's own page. Everyone sees its setup, the strokes each player gets (laid out like GHIN)
 * and the scores so far. The organizer and co-organizers get Edit beside "Round setup", which
 * turns the setup into its edit mode in place: course, tees, holes, day and tee time, the group
 * (each player with a tees chip, and the amber "!" for a missing handicap index) and the game.
 * /trip/rounds/new opens straight into it.
 */
@Component({
  selector: 'app-round-page',
  imports: [
    RouterLink,
    UiBoard,
    UiButton,
    UiCard,
    UiCheckbox,
    UiConfirmSheet,
    UiEditPill,
    UiField,
    UiHeaderBand,
    UiIndexSheet,
    UiListRow,
    UiPickerSheet,
    UiSectionHead,
    UiSegmented,
    UiSkeleton,
    UiSwitch,
    UiTeesChip,
  ],
  template: `
    <ui-header-band [title]="heading()" back="/trip/courses" backLabel="Trip" />
    <main class="content">
      @if (editing()) {
        @if (loadingSetup()) {
          <ui-skeleton shape="block" height="320px" />
        } @else {
          <ui-card aria-label="Round setup">
            <ui-section-head title="Round setup">
              @if (roundId()) {
                <button
                  ui-edit-pill
                  action
                  editing
                  [disabled]="busy() || !ready()"
                  (click)="save()"
                ></button>
              }
            </ui-section-head>
            <button
              ui-list-row
              type="button"
              title="Course"
              [detail]="courseName() || 'Pick a course'"
              chevron
              (click)="pickingCourse.set(true)"
            ></button>
            <button
              ui-list-row
              type="button"
              title="Tees"
              [detail]="roundTeeLine() || (f().course_id ? 'Pick the tees' : 'Pick a course first')"
              chevron
              [disabled]="!tees().length"
              (click)="pickingTee.set(true)"
            ></button>
            <ui-list-row title="Holes">
              <ui-segmented
                label="Holes"
                [options]="holeChoices"
                [value]="f().holes"
                (valueChange)="set('holes', $event ?? '18')"
              />
            </ui-list-row>
            <div class="when pair">
              <ui-field label="Day">
                <input
                  name="day"
                  type="date"
                  [value]="f().play_date"
                  (change)="set('play_date', text($event))"
                />
              </ui-field>
              <ui-field label="Tee time">
                <input
                  name="time"
                  type="time"
                  [value]="f().tee_time ?? ''"
                  (change)="set('tee_time', text($event) || null)"
                />
              </ui-field>
            </div>
          </ui-card>

          <ui-card aria-label="Players">
            <ui-section-head [title]="'Players · ' + f().player_ids.length">
              <span action class="column">Tees</span>
            </ui-section-head>
            @for (p of roster(); track p.id) {
              <ui-list-row
                [title]="p.name"
                [detail]="
                  p.handicap_index === null
                    ? 'No handicap index'
                    : p.handicap_index.toFixed(1) + ' HCI'
                "
              >
                @if (p.handicap_index === null) {
                  <button
                    after-title
                    type="button"
                    class="mark"
                    [attr.aria-label]="'Add ' + p.name + '’s handicap index'"
                    (click)="indexFor.set(p)"
                  >
                    !
                  </button>
                }
                @if (picked(p.id) && tees().length) {
                  <ui-tees-chip
                    [tees]="tees()"
                    [label]="p.name + '’s tees'"
                    [value]="teeFor(p.id)"
                    [changed]="ownTees(p.id)"
                    (valueChange)="setPlayerTee(p.id, $event)"
                  />
                }
                <ui-checkbox
                  [label]="p.name + ' plays'"
                  [checked]="picked(p.id)"
                  (checkedChange)="pick(p.id, $event)"
                />
              </ui-list-row>
            }
          </ui-card>

          <ui-card aria-label="Game">
            <ui-section-head title="Game" />
            <label
              ui-list-row
              title="9-point game"
              [detail]="threesome() ? null : 'For a group of exactly 3'"
            >
              <ui-switch
                label="9-point game"
                [checked]="f().nine_point && threesome()"
                [disabled]="!threesome()"
                (checkedChange)="set('nine_point', $event)"
              />
            </label>
            @if (f().nine_point && threesome()) {
              <ui-list-row title="A point is worth">
                <ui-segmented
                  label="A point is worth"
                  [options]="pointChoices"
                  [value]="f().point_value_cents"
                  (valueChange)="set('point_value_cents', $event ?? 50)"
                />
              </ui-list-row>
            }
          </ui-card>

          @if (error(); as text) {
            <p class="error-text" role="alert">{{ text }}</p>
          }
          @if (!roundId()) {
            <button ui-button type="button" [busy]="busy()" [disabled]="!ready()" (click)="save()">
              {{ busy() ? 'Adding…' : 'Add round' }}
            </button>
          } @else {
            <button
              ui-button
              type="button"
              variant="text"
              class="center"
              tone="danger"
              [disabled]="busy()"
              (click)="deleting.set(true)"
            >
              Delete round
            </button>
          }

          <ui-picker-sheet
            [(open)]="pickingCourse"
            title="Course"
            searchable
            addLabel="+ Add a course"
            [options]="courseOptions()"
            [value]="f().course_id || null"
            (picked)="setCourse($event)"
            (added)="addCourse()"
          />
          <ui-picker-sheet
            [(open)]="pickingTee"
            title="Tees"
            [options]="teeOptions()"
            [value]="f().tee_id || null"
            (picked)="setRoundTee($event)"
          />
          <ui-index-sheet
            [open]="!!indexFor()"
            (openChange)="!$event && indexFor.set(null)"
            [name]="indexFor()?.name ?? ''"
            [busy]="busy()"
            [error]="indexError()"
            (saved)="saveIndex($event)"
          />
          <ui-confirm-sheet
            [(open)]="deleting"
            [title]="'Delete Round ' + (number() ?? '') + '?'"
            line="Its scores go away for everyone. This can't be undone."
            action="Delete round"
            [busy]="busy()"
            (confirmed)="remove()"
          />
        }
      } @else if (view(); as v) {
        <ui-card aria-label="Round setup">
          <ui-section-head title="Round setup">
            @if (canEdit()) {
              <button ui-edit-pill action (click)="startEdit()"></button>
            }
          </ui-section-head>
          <ui-list-row [title]="v.row.courses?.name ?? ''" [detail]="when()" />
          <ui-list-row title="Tees" [value]="viewTees()" />
          <ui-list-row title="Holes" [value]="holes()" />
          @for (game of games(); track game.name) {
            <ui-list-row [title]="game.name" [value]="game.value" />
          }
        </ui-card>

        <ui-board
          plain
          aria-label="Strokes"
          title="Strokes"
          [note]="rule()"
          [columns]="strokes().columns"
          [valueColumn]="strokes().columns.length - 1"
          [rows]="strokes().rows"
        />

        @if (scores().length) {
          <ui-card aria-label="Scores">
            <ui-section-head title="Scores" />
            @for (line of scores(); track line.name) {
              <ui-list-row [title]="line.name" [detail]="line.holes" [value]="line.gross" />
            }
          </ui-card>
        }

        <a ui-button variant="outline" routerLink="/score" [queryParams]="{ round: v.row.id }">
          Scorecard
        </a>
      } @else if (loading()) {
        <ui-skeleton shape="block" height="260px" />
      } @else {
        <ui-card pad><p>That round isn't on this trip.</p></ui-card>
      }
    </main>
  `,
  styles: `
    .when {
      padding: 0 var(--s4) var(--s4);
    }
    .column {
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--muted);
    }
    .mark {
      display: inline-grid;
      place-items: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border: 1.5px solid var(--warn-edge);
      border-radius: 50%;
      background: var(--warn-bg);
      color: var(--warn-edge);
      font: 800 13px/1 var(--font-body);
      cursor: pointer;
    }
  `,
})
export class RoundPage {
  /** Absent on /trip/rounds/new. */
  readonly roundId = input<string>();
  /** ?course=<id>: back from adding a course, with it picked. */
  readonly course = input<string>();

  protected readonly sessions = inject(SessionService);
  private readonly live = inject(RoundsService);
  private readonly data = inject(AdminData);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly loading = signal(true);
  protected readonly tripId = computed(() => this.sessions.session()?.trip.id);
  protected readonly view = computed(
    () => this.live.for(this.tripId()).find((r) => r.row.id === this.roundId()) ?? null,
  );
  protected readonly canEdit = computed(
    () => this.sessions.canManage() && this.sessions.session()?.trip.status !== 'final',
  );

  // ── Edit mode ──────────────────────────────────────────────────────────────

  protected readonly editing = signal(false);
  protected readonly loadingSetup = signal(false);
  protected readonly courses = signal<CourseChoice[]>([]);
  protected readonly roster = signal<RosterPlayer[]>([]);
  protected readonly number = signal<number | null>(null);
  /** Courses this trip has played, most recent first: the course sheet lists them first. */
  private readonly recent = signal<string[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pickingCourse = signal(false);
  protected readonly pickingTee = signal(false);
  protected readonly deleting = signal(false);
  protected readonly indexFor = signal<RosterPlayer | null>(null);
  protected readonly indexError = signal<string | null>(null);

  protected readonly f = signal<RoundSetupFields>({
    course_id: '',
    tee_id: '',
    holes: '18',
    play_date: '',
    tee_time: null,
    player_ids: [],
    player_tees: {},
    nine_point: false,
    point_value_cents: 50,
  });

  protected readonly holeChoices: Choice<RoundSetupFields['holes']>[] = [
    { value: '18', label: '18' },
    { value: 'front', label: 'Front 9' },
    { value: 'back', label: 'Back 9' },
  ];
  protected readonly pointChoices: Choice<number>[] = POINT_VALUES.map((cents) => ({
    value: cents,
    label: pointValueText(cents),
  }));

  protected readonly heading = computed(() => {
    if (!this.roundId()) return 'Add round';
    const number = this.view()?.row.round_number ?? this.number();
    return number ? `Round ${number}` : 'Round';
  });

  protected readonly tees = computed(
    () => this.courses().find((c) => c.id === this.f().course_id)?.tees ?? [],
  );
  protected readonly courseName = computed(
    () => this.courses().find((c) => c.id === this.f().course_id)?.name ?? '',
  );
  /** "Blue · 6,412 yds" */
  protected readonly roundTeeLine = computed(() => {
    const tee = this.tees().find((t) => t.id === this.f().tee_id);
    return tee ? [tee.name, teeDetail(tee)].join(' · ') : '';
  });
  protected readonly courseOptions = computed<PickerOption[]>(() => {
    const order = this.recent();
    const rank = (id: string) => (order.includes(id) ? order.indexOf(id) : order.length);
    return [...this.courses()]
      .sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name))
      .map((c) => ({ value: c.id, title: c.name, detail: c.location }));
  });
  protected readonly teeOptions = computed<PickerOption[]>(() =>
    this.tees().map((t) => ({ value: t.id, title: t.name, detail: teeDetail(t) })),
  );
  protected readonly threesome = computed(() => this.f().player_ids.length === 3);
  protected readonly ready = computed(() => {
    const f = this.f();
    return !!f.course_id && !!f.tee_id && !!f.play_date && f.player_ids.length > 0;
  });

  // ── View ───────────────────────────────────────────────────────────────────

  /** "Thu, Nov 26 · 8:10 AM" */
  protected readonly when = computed(() => {
    const row = this.view()?.row;
    return row
      ? [formatDay(row.play_date), formatTime(row.tee_time)].filter(Boolean).join(' · ')
      : '';
  });

  /** "Blue · 6,412 yds · par 72" */
  protected readonly viewTees = computed(() => {
    const tee = this.view()?.row.tees;
    if (!tee) return '';
    return [
      tee.name,
      tee.yards ? `${tee.yards.toLocaleString('en-US')} yds` : '',
      `par ${tee.par.reduce((a, b) => a + b, 0)}`,
    ]
      .filter(Boolean)
      .join(' · ');
  });

  protected readonly holes = computed(() => HOLES[this.view()?.row.holes ?? '18']);

  /**
   * The side games, with what they are played for: "9-point game · 50¢ a point". Net stroke play
   * is always on the board, so it is listed only when it is the only game.
   */
  protected readonly games = computed(() => {
    const formats = (this.view()?.row.round_formats ?? [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order);
    const side = formats.filter((f) => f.format_key !== 'stroke');
    return (side.length ? side : formats).map((f) => {
      const cents = Number(f.settings?.['point_value_cents']);
      return {
        name: formatName(f.format_key),
        value: cents > 0 ? `${pointValueText(cents)} a point` : '',
      };
    });
  });

  /** Each player's strokes hole by hole, a pickup marked "PU": "5 · 4 · 7 PU · 3". */
  protected readonly scores = computed(() => {
    const result = this.view()?.result;
    if (!result || result.state === 'scheduled') return [];
    return result.players
      .filter((p) => p.thru > 0)
      .map((p) => ({
        name: p.name,
        gross: `${p.gross}`,
        holes: result.holes
          .filter((h) => h.strokes[p.id] !== undefined)
          .map((h) => `${h.strokes[p.id]}${h.pickedUp[p.id] ? ' PU' : ''}`)
          .join(' · '),
      }));
  });

  /**
   * Laid out like GHIN: the name over "18.7 HCI" (and the tees, when they differ), then CH
   * (course handicap), PH (playing handicap, only when it isn't simply the CH) and SO (shots off
   * the low man).
   */
  protected readonly strokes = computed<{ columns: string[]; rows: BoardRow[] }>(() => {
    const players = this.view()?.result.players ?? [];
    const allowance = Number(this.live.rules()?.handicap_allowance ?? 1);
    const showPlaying = allowance !== 1 || players.some((p) => p.parAdjustment !== 0);
    const text = (n: number | null) => (n === null ? '–' : `${n}`);
    return {
      columns: ['CH', ...(showPlaying ? ['PH'] : []), 'SO'],
      rows: players.map((p) => ({
        pos: '',
        name: p.name,
        detail: [
          p.index === null ? 'No handicap index' : `${p.index.toFixed(1)} HCI`,
          p.teeName ? `${p.teeName} tees` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        cells: [text(p.course), ...(showPlaying ? [text(p.playing)] : []), text(p.strokes)],
      })),
    };
  });

  /** "100% · off the low man" */
  protected readonly rule = computed(() => {
    const rules = this.live.rules();
    if (!rules) return '';
    return [
      `${Math.round(Number(rules.handicap_allowance) * 100)}%`,
      rules.strokes_off_low ? 'off the low man' : '',
    ]
      .filter(Boolean)
      .join(' · ');
  });

  constructor() {
    effect(() => {
      const tripId = this.tripId();
      if (!tripId) return;
      if (this.live.tripId() === tripId) this.loading.set(false);
      else void this.live.load(tripId).finally(() => this.loading.set(false));
    });
    // A new round opens in edit mode; so does coming back from adding a course.
    effect(() => {
      const tripId = this.tripId();
      if (tripId && (!this.roundId() || this.course())) void this.startEdit();
    });
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected set<K extends keyof RoundSetupFields>(key: K, value: RoundSetupFields[K]): void {
    this.f.update((f) => ({ ...f, [key]: value }));
    this.error.set(null);
  }

  /** A new course: its only tees if it has one set, else none until picked; everyone back on them. */
  protected setCourse(courseId: string): void {
    const tees = this.courses().find((c) => c.id === courseId)?.tees ?? [];
    this.f.update((f) => ({
      ...f,
      course_id: courseId,
      tee_id: tees.length === 1 ? tees[0].id : '',
      player_tees: {},
    }));
    this.error.set(null);
  }

  /** The round's tees, like GHIN: picking them puts every player on them. */
  protected setRoundTee(teeId: string): void {
    this.f.update((f) => ({ ...f, tee_id: teeId, player_tees: {} }));
    this.error.set(null);
  }

  protected picked(playerId: string): boolean {
    return this.f().player_ids.includes(playerId);
  }

  /** The tees a player plays: their own, else the round's. */
  protected teeFor(playerId: string): string {
    return this.f().player_tees[playerId] || this.f().tee_id;
  }

  /** On tees of their own (the chip is drawn bold). */
  protected ownTees(playerId: string): boolean {
    const own = this.f().player_tees[playerId];
    return !!own && own !== this.f().tee_id;
  }

  /** Picking the round's tees for a player puts them back on "the round's tees". */
  protected setPlayerTee(playerId: string, teeId: string | null): void {
    this.set('player_tees', {
      ...this.f().player_tees,
      [playerId]: teeId && teeId !== this.f().tee_id ? teeId : null,
    });
  }

  /** Players keep the roster's order in the group. */
  protected pick(playerId: string, on: boolean): void {
    const picked = new Set(this.f().player_ids);
    if (on) picked.add(playerId);
    else picked.delete(playerId);
    this.set(
      'player_ids',
      this.roster()
        .filter((p) => picked.has(p.id))
        .map((p) => p.id),
    );
  }

  /** "+ Add a course": to the course library, keeping this form, and back with it picked. */
  protected async addCourse(): Promise<void> {
    try {
      sessionStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ round: this.roundId() ?? 'new', fields: this.f() }),
      );
    } catch {
      // storage unavailable: the form starts over
    }
    const here = this.roundId() ? `/trip/rounds/${this.roundId()}` : '/trip/rounds/new';
    try {
      sessionStorage.setItem(COURSE_RETURN, here);
    } catch {
      // storage unavailable: the course library keeps the new course and stays there
    }
    await this.router.navigateByUrl('/courses/add');
  }

  /** "Charlie's handicap index", saved in place: the form keeps everything else. */
  protected async saveIndex(index: number | null): Promise<void> {
    const player = this.indexFor();
    const tripId = this.tripId();
    if (!player || !tripId) return;
    this.busy.set(true);
    this.indexError.set(null);
    try {
      await this.data.setIndex(player.id, index);
      this.roster.set(await this.data.roster(tripId));
      this.indexFor.set(null);
      void this.live.load(tripId);
    } catch (e) {
      this.indexError.set(
        e instanceof AdminError ? e.message : "Couldn't save the handicap index.",
      );
    } finally {
      this.busy.set(false);
    }
  }

  /** Done (or Add round): saves the round, then shows it. */
  protected async save(): Promise<void> {
    const tripId = this.tripId();
    if (!tripId || this.busy() || !this.ready()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const f = this.f();
      const id = await this.data.saveRound(tripId, this.roundId() ?? null, {
        ...f,
        nine_point: f.nine_point && this.threesome(),
      });
      await this.live.load(tripId);
      this.editing.set(false);
      if (!this.roundId() || this.course())
        await this.router.navigate(['/trip/rounds', id], { replaceUrl: true });
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't save the round.");
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const roundId = this.roundId();
    const tripId = this.tripId();
    if (!roundId || !tripId || this.busy()) return;
    this.busy.set(true);
    try {
      await this.data.deleteRound(roundId);
      await this.live.load(tripId);
      this.deleting.set(false);
      await this.router.navigateByUrl('/trip/courses');
    } catch (e) {
      this.deleting.set(false);
      this.error.set(e instanceof AdminError ? e.message : "Couldn't delete the round.");
    } finally {
      this.busy.set(false);
    }
  }

  /** Into edit mode: the course library, the people, and this round's setup (or a new one's). */
  protected async startEdit(): Promise<void> {
    const tripId = this.tripId();
    if (!tripId || this.editing()) return;
    this.editing.set(true);
    this.loadingSetup.set(true);
    const roundId = this.roundId();
    try {
      const [trip, courses, roster, round, lastValue, rounds] = await Promise.all([
        this.data.trip(tripId),
        this.data.courseChoices(),
        this.data.roster(tripId),
        roundId ? this.data.roundSetup(roundId) : null,
        this.data.lastPointValue(tripId),
        this.data.rounds(tripId),
      ]);
      this.courses.set(courses);
      this.roster.set(roster);
      this.recent.set(
        [...this.live.for(tripId)]
          .sort((a, b) => b.row.play_date.localeCompare(a.row.play_date))
          .map((r) => r.row.courses?.id ?? '')
          .filter((id, i, all) => id && all.indexOf(id) === i),
      );
      if (round) {
        const { id: _id, round_number, status: _status, scored: _scored, ...fields } = round;
        this.number.set(round_number);
        this.f.set({ ...fields, point_value_cents: fields.point_value_cents || lastValue || 50 });
      } else {
        // A new round: the day after the last one (or the trip's first day), the last group,
        // and the point value the trip last played for.
        const last = rounds.at(-1);
        const previous = last ? await this.data.roundSetup(last.id) : null;
        const day = last ? nextDay(last.play_date) : trip.start_date;
        const players = previous?.player_ids ?? (roster.length <= 4 ? roster.map((p) => p.id) : []);
        this.f.set({
          course_id: '',
          tee_id: '',
          holes: '18',
          play_date: day > trip.end_date ? trip.end_date : day,
          tee_time: null,
          player_ids: players,
          player_tees: {},
          nine_point: previous ? previous.nine_point : players.length === 3,
          point_value_cents: lastValue ?? 50,
        });
      }
      this.restoreDraft();
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't load the round.");
    } finally {
      this.loadingSetup.set(false);
    }
  }

  /** Back from "+ Add a course": the form as it was, with the new course picked. */
  private restoreDraft(): void {
    try {
      const saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? 'null') as {
        round: string;
        fields: RoundSetupFields;
      } | null;
      sessionStorage.removeItem(DRAFT_KEY);
      if (saved && saved.round === (this.roundId() ?? 'new')) this.f.set(saved.fields);
    } catch {
      // nothing saved
    }
    const course = this.course();
    if (course && this.courses().some((c) => c.id === course)) this.setCourse(course);
    if (course) void this.router.navigate([], { relativeTo: this.route, replaceUrl: true });
  }
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
