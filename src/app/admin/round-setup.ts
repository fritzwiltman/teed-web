import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { pointValueText } from '../scoring';
import {
  Choice,
  UiButton,
  UiCard,
  UiCheckbox,
  UiChoicePills,
  UiField,
  UiHeaderBand,
  UiListRow,
  UiSectionHead,
  UiSegmented,
  UiSkeleton,
  UiSwitch,
} from '../core/ui';
import { AdminData, AdminError, CourseChoice, RosterPlayer, RoundSetupFields, Trip } from './data';

const POINT_VALUES = [25, 50, 100];

/**
 * Round setup: the course and tees, 18 holes or a nine, the day and tee time, the group, and the
 * game. Net stroke play is always on; the 9-point game is offered to a group of exactly three.
 * Each player can play their own tees. A handicap index isn't needed yet: it is needed before
 * the round's first score.
 */
@Component({
  selector: 'app-round-setup',
  imports: [
    UiButton,
    UiCard,
    UiCheckbox,
    UiChoicePills,
    UiField,
    UiHeaderBand,
    UiListRow,
    UiSectionHead,
    UiSegmented,
    UiSkeleton,
    UiSwitch,
  ],
  template: `
    <ui-header-band
      [title]="roundId() ? 'Round ' + (number() ?? '') : 'Add round'"
      [back]="['/admin/trips', id(), 'rounds']"
      backLabel="Rounds"
    />
    <main class="content">
      @if (loading()) {
        <ui-skeleton shape="block" height="320px" />
      } @else {
        <form class="stack form" (submit)="save($event)" novalidate>
          <ui-card pad aria-label="Course">
            <ui-field label="Course">
              <select name="course" [value]="f().course_id" (change)="setCourse(text($event))">
                <option value="" disabled>Pick a course</option>
                @for (course of courses(); track course.id) {
                  <option [value]="course.id" [selected]="course.id === f().course_id">
                    {{ course.name }}
                  </option>
                }
              </select>
            </ui-field>
            <ui-field label="Tees">
              <select
                name="tee"
                [value]="f().tee_id"
                [disabled]="!tees().length"
                (change)="set('tee_id', text($event))"
              >
                <option value="" disabled>Pick the tees</option>
                @for (tee of tees(); track tee.id) {
                  <option [value]="tee.id" [selected]="tee.id === f().tee_id">
                    {{ teeLabel(tee) }}
                  </option>
                }
              </select>
            </ui-field>
            <ui-segmented
              label="Holes"
              [options]="holeChoices"
              [value]="f().holes"
              (valueChange)="set('holes', $event ?? '18')"
            />
            <div class="pair">
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
            <ui-section-head title="Players" [note]="f().player_ids.length + ' in the group'" />
            @for (player of roster(); track player.id) {
              <label
                ui-list-row
                [title]="player.name"
                [detail]="
                  player.handicap_index === null
                    ? 'No handicap index'
                    : 'Index ' + player.handicap_index
                "
              >
                <ui-checkbox
                  [label]="player.name"
                  [checked]="f().player_ids.includes(player.id)"
                  (checkedChange)="pick(player.id, $event)"
                />
              </label>
              @if (f().player_ids.includes(player.id) && tees().length > 1) {
                <div class="own-tees">
                  <ui-field class="compact" [label]="player.name + '’s tees'">
                    <select
                      [attr.name]="'tee-' + player.id"
                      (change)="setPlayerTee(player.id, text($event))"
                    >
                      @for (tee of tees(); track tee.id) {
                        <option [value]="tee.id" [selected]="tee.id === teeFor(player.id)">
                          {{ teeLabel(tee) }}
                        </option>
                      }
                    </select>
                  </ui-field>
                </div>
              }
            }
          </ui-card>

          <ui-card aria-label="Game">
            <ui-section-head title="Game" />
            <ui-list-row title="Net stroke play" value="Always on" />
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
              <div class="value">
                <ui-choice-pills
                  label="A point is worth"
                  [options]="pointChoices"
                  [value]="f().point_value_cents"
                  (valueChange)="set('point_value_cents', $event ?? 50)"
                />
              </div>
            }
          </ui-card>

          @if (error(); as text) {
            <p class="error-text" role="alert">{{ text }}</p>
          }
          @if (trip()?.status !== 'final') {
            <button ui-button type="submit" [busy]="busy()" [disabled]="!ready()">
              {{ busy() ? 'Saving…' : roundId() ? 'Save' : 'Add round' }}
            </button>
            @if (roundId()) {
              <button
                ui-button
                type="button"
                variant="text"
                class="center danger"
                [disabled]="busy()"
                (click)="remove()"
              >
                {{
                  confirming() ? 'Tap again to delete this round and its scores' : 'Delete round'
                }}
              </button>
            }
          }
        </form>
      }
    </main>
  `,
  styles: `
    .form {
      gap: var(--gap-cards);
    }
    .value {
      padding: var(--s2) var(--s4) var(--s4);
    }
    .own-tees {
      padding: 0 var(--s4) var(--s3);
    }
    .danger {
      color: var(--red);
    }
  `,
})
export class RoundSetup {
  /** The trip. */
  readonly id = input.required<string>();
  /** Absent for a new round. */
  readonly roundId = input<string>();

  private readonly data = inject(AdminData);
  private readonly router = inject(Router);

  protected readonly trip = signal<Trip | null>(null);
  protected readonly courses = signal<CourseChoice[]>([]);
  protected readonly roster = signal<RosterPlayer[]>([]);
  protected readonly number = signal<number | null>(null);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly confirming = signal(false);
  protected readonly error = signal<string | null>(null);

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
    { value: '18', label: '18 holes' },
    { value: 'front', label: 'Front 9' },
    { value: 'back', label: 'Back 9' },
  ];
  protected readonly pointChoices: Choice<number>[] = POINT_VALUES.map((cents) => ({
    value: cents,
    label: pointValueText(cents),
  }));

  protected readonly tees = computed(
    () => this.courses().find((c) => c.id === this.f().course_id)?.tees ?? [],
  );
  protected readonly threesome = computed(() => this.f().player_ids.length === 3);
  protected readonly ready = computed(() => {
    const f = this.f();
    return !!f.course_id && !!f.tee_id && !!f.play_date && f.player_ids.length > 0;
  });

  constructor() {
    effect(() => void this.load(this.id(), this.roundId()));
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected set<K extends keyof RoundSetupFields>(key: K, value: RoundSetupFields[K]): void {
    this.f.update((f) => ({ ...f, [key]: value }));
    this.error.set(null);
    this.confirming.set(false);
  }

  /** A new course: its longest tees until another set is picked. */
  protected setCourse(courseId: string): void {
    const tees = this.courses().find((c) => c.id === courseId)?.tees ?? [];
    this.f.update((f) => ({
      ...f,
      course_id: courseId,
      tee_id: tees.length === 1 ? tees[0].id : '',
      player_tees: {}, // another course: everyone back on the round's tees
    }));
    this.error.set(null);
  }

  /** "Blue · 6,412 yds · 71.2 / 131" */
  protected teeLabel(tee: CourseChoice['tees'][number]): string {
    return [
      tee.name,
      tee.yards ? `${tee.yards.toLocaleString('en-US')} yds` : '',
      tee.rating && tee.slope ? `${tee.rating} / ${tee.slope}` : 'no rating',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** The tees a player plays: their own, else the round's. */
  protected teeFor(playerId: string): string {
    return this.f().player_tees[playerId] || this.f().tee_id;
  }

  /** Picking the round's tees for a player puts them back on "the round's tees". */
  protected setPlayerTee(playerId: string, teeId: string): void {
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

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy() || !this.ready()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const f = this.f();
      await this.data.saveRound(this.id(), this.roundId() ?? null, {
        ...f,
        nine_point: f.nine_point && this.threesome(),
      });
      await this.router.navigate(['/admin/trips', this.id(), 'rounds']);
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't save the round.");
    } finally {
      this.busy.set(false);
    }
  }

  /** Two taps: a round takes its scores with it. */
  protected async remove(): Promise<void> {
    const roundId = this.roundId();
    if (!roundId || this.busy()) return;
    if (!this.confirming()) return this.confirming.set(true);
    this.busy.set(true);
    try {
      await this.data.deleteRound(roundId);
      await this.router.navigate(['/admin/trips', this.id(), 'rounds']);
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't delete the round.");
    } finally {
      this.busy.set(false);
    }
  }

  private async load(tripId: string, roundId: string | undefined): Promise<void> {
    this.loading.set(true);
    try {
      const [trip, courses, roster, round, lastValue, rounds] = await Promise.all([
        this.data.trip(tripId),
        this.data.courseChoices(),
        this.data.roster(tripId),
        roundId ? this.data.roundSetup(roundId) : null,
        this.data.lastPointValue(tripId),
        this.data.rounds(tripId),
      ]);
      this.trip.set(trip);
      this.courses.set(courses);
      this.roster.set(roster);
      if (round) {
        const { id: _id, round_number, status: _status, scored: _scored, ...fields } = round;
        this.number.set(round_number);
        this.f.set({
          ...fields,
          point_value_cents: fields.point_value_cents || lastValue || 50,
        });
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
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't load the round.");
    } finally {
      this.loading.set(false);
    }
  }
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
