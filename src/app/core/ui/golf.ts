import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  input,
  model,
} from '@angular/core';
import { UiLiveDot } from './feedback';
import { IconName, UiIcon } from './icon';

/**
 * A round's course: the photo with the course name over it, an optional LIVE pill, a row of
 * chips (put ui-chip elements inside), then anything else you put inside.
 */
@Component({
  selector: 'ui-course-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiLiveDot],
  template: `
    <div class="photo" [class.plain]="!photo()">
      @if (photo(); as url) {
        <img [src]="url" alt="" loading="lazy" />
      }
      @if (live()) {
        <span class="live"><ui-live-dot /> Live</span>
      }
      <div class="over">
        @if (label()) {
          <p class="label">{{ label() }}</p>
        }
        <h2>{{ name() }}</h2>
      </div>
    </div>
    <div class="body">
      <div class="chips"><ng-content select="ui-chip" /></div>
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: block;
      background: var(--card);
      border-radius: var(--radius-card);
      box-shadow: var(--shadow-card);
      overflow: hidden;
    }
    .photo {
      position: relative;
      aspect-ratio: 16 / 9;
      background: var(--band);
      color: #fff;
    }
    .photo.plain {
      aspect-ratio: auto;
      min-height: 104px;
    }
    img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .photo:not(.plain)::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(to top, rgb(0 0 0 / 75%), rgb(0 0 0 / 0%) 60%);
    }
    .over {
      position: absolute;
      left: var(--s4);
      right: var(--s4);
      bottom: var(--s3);
      z-index: 1;
    }
    .label {
      font-size: 13px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      opacity: 0.9;
    }
    h2 {
      font-size: 26px;
    }
    .live {
      position: absolute;
      top: var(--s3);
      right: var(--s3);
      z-index: 1;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: var(--radius-pill);
      background: rgb(0 0 0 / 65%);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: var(--s3);
      padding: var(--s4);
    }
    .body:empty {
      display: none;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--s2);
    }
    .chips:empty {
      display: none;
    }
  `,
})
export class UiCourseCard {
  readonly name = input.required<string>();
  /** The day header over the name: "Round 3 · Sun, Oct 11". */
  readonly label = input<string>();
  readonly photo = input<string | null>(null);
  readonly live = input(false, { transform: booleanAttribute });
}

/** One line of the itinerary: an icon tile (filled for a round), title, time at the right, detail. */
@Component({
  selector: 'ui-itinerary-row, a[ui-itinerary-row], button[ui-itinerary-row]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  template: `
    <span class="tile" [class.round]="round()"><ui-icon [name]="icon()" /></span>
    <span class="text">
      <span class="top">
        <span class="title">{{ title() }}</span>
        @if (time()) {
          <span class="time">{{ time() }}</span>
        }
      </span>
      @if (detail()) {
        <span class="detail">{{ detail() }}</span>
      }
    </span>
    @if (chevron()) {
      <ui-icon class="chevron" name="chevron-right" />
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--s3);
      width: 100%;
      min-height: 56px;
      padding: var(--s3) var(--s4);
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      text-decoration: none;
    }
    :host(a),
    :host(button) {
      cursor: pointer;
    }
    .chevron {
      width: 20px;
      height: 20px;
      color: var(--muted);
    }
    :host(:not(:first-child)) {
      border-top: 1px solid var(--line);
    }
    .tile {
      flex: none;
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: var(--chip);
      color: var(--accent);
    }
    .tile.round {
      background: var(--fill);
      color: var(--on-fill);
    }
    .tile ui-icon {
      width: 20px;
      height: 20px;
    }
    .text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .top {
      display: flex;
      justify-content: space-between;
      gap: var(--s3);
    }
    .title {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .time {
      flex: none;
      color: var(--ink-2);
    }
    .detail {
      font-size: 14px;
      font-weight: 500;
      color: var(--muted);
    }
  `,
})
export class UiItineraryRow {
  readonly icon = input<IconName>('note');
  readonly title = input.required<string>();
  readonly time = input<string | null>();
  readonly detail = input<string | null>();
  readonly round = input(false, { transform: booleanAttribute });
  /** In edit mode: the row opens its sheet. */
  readonly chevron = input(false, { transform: booleanAttribute });
}

/** One line of a leaderboard. The format plug-in supplies these; the board only draws them. */
export interface BoardRow {
  pos: string;
  name: string;
  /** The one value of a plain board. Not needed when the board has `columns`. */
  value?: string;
  thru?: string;
  /** One cell per column, for a board with `columns`. */
  cells?: string[];
  /** A small line under the name: "18.7 HCI". */
  detail?: string;
  /** Under par: the value is drawn in red. */
  under?: boolean;
  /** The row of the person looking. */
  me?: boolean;
}

/**
 * A leaderboard, mini (on trip home) or full: Pos / Name / value / Thru. Give `columns` (and
 * `cells` on each row) for a board with more to say: Gross, Net, To par, Thru, Pts.
 */
@Component({
  selector: 'ui-board',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiLiveDot],
  host: { '[class.mini]': 'mini()', '[class.wide]': '!!columns()', '[class.plain]': 'plain()' },
  template: `
    <table>
      <caption>
        @if (live()) {
          <ui-live-dot />
        }
        {{
          title()
        }}
        @if (note()) {
          <span class="note">{{ note() }}</span>
        }
      </caption>
      <thead>
        <tr>
          @if (!plain()) {
            <th scope="col" class="pos">Pos</th>
          }
          <th scope="col" class="name">{{ plain() ? nameLabel() : 'Name' }}</th>
          @if (columns(); as names) {
            @for (name of names; track $index) {
              <th scope="col" class="num">{{ name }}</th>
            }
          } @else {
            <th scope="col" class="num">{{ valueLabel() }}</th>
            <th scope="col" class="num">Thru</th>
          }
        </tr>
      </thead>
      <tbody>
        @for (row of rows(); track $index) {
          <tr [class.me]="row.me">
            @if (!plain()) {
              <td class="pos">{{ row.pos }}</td>
            }
            <td class="name">
              {{ row.name }}
              @if (row.detail) {
                <span class="sub">{{ row.detail }}</span>
              }
            </td>
            @if (columns()) {
              @for (cell of row.cells ?? []; track $index) {
                <td
                  class="num"
                  [class.value]="$index === valueColumn()"
                  [class.under]="$index === valueColumn() && row.under"
                >
                  {{ cell }}
                </td>
              }
            } @else {
              <td class="num value" [class.under]="row.under">{{ row.value }}</td>
              <td class="num thru">{{ row.thru ?? '' }}</td>
            }
          </tr>
        }
      </tbody>
    </table>
  `,
  styles: `
    :host {
      display: block;
      background: var(--card);
      border-radius: var(--radius-card);
      box-shadow: var(--shadow-card);
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    caption {
      padding: var(--s3) var(--s4) var(--s1);
      text-align: left;
      font: 700 20px var(--font-heading);
    }
    caption .note {
      float: right;
      margin-top: 4px;
      font: 500 14px var(--font-body);
      color: var(--muted);
    }
    caption ui-live-dot {
      margin-right: 6px;
      vertical-align: 3px;
    }
    th {
      padding: var(--s1) var(--s2);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--muted);
      text-align: left;
    }
    td {
      padding: 0 var(--s2);
      height: 48px;
      border-top: 1px solid var(--line);
    }
    :host(.mini) td {
      height: 40px;
    }
    .pos {
      width: 52px;
      padding-left: var(--s4);
      color: var(--ink-2);
    }
    .num {
      width: 60px;
      text-align: right;
    }
    :host(.wide) .num {
      width: 46px;
      padding: 0 var(--s1);
    }
    :host(.plain) .name {
      padding-left: var(--s4);
    }
    :host(.plain) td {
      height: 56px;
    }
    .sub {
      display: block;
      font-size: 13px;
      color: var(--muted);
    }
    :host(.wide) th {
      letter-spacing: 0;
      white-space: nowrap;
    }
    :host(.wide) th.num:last-child,
    :host(.wide) td.num:last-child {
      width: 58px;
      padding-right: var(--s4);
    }
    :host(.wide) .pos {
      width: 44px;
    }
    th.num:last-child,
    td.num:last-child {
      padding-right: var(--s4);
    }
    .value {
      font: 700 20px var(--font-heading);
    }
    .value.under {
      color: var(--red);
    }
    .thru {
      color: var(--muted);
      font-size: 15px;
    }
    tr.me td {
      background: var(--me-row);
    }
  `,
})
export class UiBoard {
  readonly title = input.required<string>();
  /** A note at the right of the title: "90% · off the low man". */
  readonly note = input<string>();
  readonly rows = input.required<BoardRow[]>();
  readonly valueLabel = input('Net');
  /** Column headings for a board with several values; each row then gives `cells`. */
  readonly columns = input<string[]>();
  /** Which of `columns` is drawn big, and red when the row is under par. */
  readonly valueColumn = input(0);
  /** A table of people rather than a ranking: no Pos column. */
  readonly plain = input(false, { transform: booleanAttribute });
  /** The heading over the names of a `plain` table. */
  readonly nameLabel = input('Player');
  readonly live = input(false, { transform: booleanAttribute });
  readonly mini = input(false, { transform: booleanAttribute });
}

/** One label / value line of a game card. */
export interface GameRow {
  label: string;
  value: string;
}

/**
 * "Today's game": a title, a note at the right, then label / value rows. The format plug-in
 * supplies the rows; nothing here knows what a Nassau or a Sixes is.
 */
@Component({
  selector: 'ui-game-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <h2>{{ title() }}</h2>
      @if (note()) {
        <span class="note">{{ note() }}</span>
      }
    </div>
    <dl>
      @for (row of rows(); track $index) {
        <div>
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      }
    </dl>
  `,
  styles: `
    :host {
      display: block;
      background: var(--card);
      border-radius: var(--radius-card);
      box-shadow: var(--shadow-card);
      overflow: hidden;
    }
    .head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--s3);
      padding: var(--s3) var(--s4) var(--s2);
    }
    .note {
      font-size: 14px;
      font-weight: 500;
      color: var(--muted);
    }
    dl {
      margin: 0;
    }
    dl > div {
      display: flex;
      justify-content: space-between;
      gap: var(--s4);
      padding: var(--s3) var(--s4);
      border-top: 1px solid var(--line);
    }
    dt {
      color: var(--ink-2);
    }
    dd {
      margin: 0;
      text-align: right;
    }
  `,
})
export class UiGameCard {
  readonly title = input.required<string>();
  readonly note = input<string>();
  readonly rows = input.required<GameRow[]>();
}

/** A player's score for the hole: name, detail line, − and + (52px, + filled), and the big number. */
@Component({
  selector: 'ui-stepper-row',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  template: `
    <span class="text">
      <span class="name">{{ name() }}</span>
      @if (detail()) {
        <span class="detail">{{ detail() }}</span>
      }
    </span>
    <button
      type="button"
      class="minus"
      [attr.aria-label]="'One fewer for ' + name()"
      [disabled]="value() <= min()"
      (click)="step(-1)"
    >
      <ui-icon name="minus" />
    </button>
    <output class="score" [class.under]="under()" [attr.aria-label]="name() + ' score'">{{
      value()
    }}</output>
    <button
      type="button"
      class="plus"
      [attr.aria-label]="'One more for ' + name()"
      [disabled]="value() >= max()"
      (click)="step(1)"
    >
      <ui-icon name="plus" />
    </button>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--s2);
      padding: var(--s3) var(--s4);
    }
    :host(:not(:first-child)) {
      border-top: 1px solid var(--line);
    }
    .text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail {
      font-size: 14px;
      font-weight: 500;
      color: var(--muted);
    }
    button {
      flex: none;
      display: grid;
      place-items: center;
      width: 52px;
      height: 52px;
      padding: 0;
      border: 2px solid var(--line-strong);
      border-radius: var(--radius-button);
      background: transparent;
      color: var(--ink);
      cursor: pointer;
      touch-action: manipulation;
    }
    button.plus {
      border-color: var(--fill);
      background: var(--fill);
      color: var(--on-fill);
    }
    button:disabled {
      opacity: 0.4;
      cursor: default;
    }
    .score {
      flex: none;
      width: 44px;
      text-align: center;
      font: 700 36px/1 var(--font-heading);
    }
    .score.under {
      color: var(--red);
    }
  `,
})
export class UiStepperRow {
  readonly name = input.required<string>();
  readonly detail = input<string | null>();
  readonly value = model.required<number>();
  readonly min = input(1);
  readonly max = input(15);
  /** Par for the hole, when known: a score under it is drawn in red. */
  readonly par = input<number | null>(null);

  protected readonly under = computed(() => {
    const par = this.par();
    return par !== null && this.value() < par;
  });

  protected step(by: number): void {
    this.value.set(Math.min(this.max(), Math.max(this.min(), this.value() + by)));
  }
}

/**
 * A player in the pairings, as a button: name and handicap.
 *   idle       solid outline
 *   target     dashed accent outline (another name is selected: tap here to swap)
 *   selected   2px fill border on a tinted background
 */
@Component({
  selector: 'button[ui-name-button]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    type: 'button',
    '[class]': 'state()',
    '[attr.aria-pressed]': 'state() === "selected"',
  },
  template: `
    <span class="name">{{ name() }}</span>
    @if (handicap() !== null && handicap() !== undefined) {
      <span class="handicap">{{ handicap() }}</span>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--s2);
      width: 100%;
      min-height: 48px;
      padding: 0 var(--s3);
      border: 1.5px solid var(--line-strong);
      border-radius: var(--radius-button);
      background: var(--card);
      color: var(--ink);
      font: inherit;
      text-align: left;
      cursor: pointer;
      touch-action: manipulation;
    }
    :host(.target) {
      border-style: dashed;
      border-color: var(--accent);
    }
    :host(.selected) {
      border: 2px solid var(--fill);
      background: var(--tab-on);
    }
    .name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .handicap {
      flex: none;
      font-size: 14px;
      font-weight: 500;
      color: var(--muted);
    }
  `,
})
export class UiNameButton {
  readonly name = input.required<string>();
  readonly handicap = input<number | string | null>();
  readonly state = input<'idle' | 'target' | 'selected'>('idle');
}

export type AlertLevel = 'announcement' | 'important' | 'urgent';

const LEVEL_NAMES: Record<AlertLevel, string> = {
  announcement: 'Announcement',
  important: 'Important',
  urgent: 'Urgent',
};

/** An organizer's message: Announcement (green edge), Important (amber) or Urgent (red). */
@Component({
  selector: 'ui-alert-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'level()', '[attr.role]': 'level() === "urgent" ? "alert" : "status"' },
  template: `
    <p class="label">{{ heading() }}</p>
    <div class="body"><ng-content /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--s1);
      padding: var(--s3) var(--s4);
      border-left: 4px solid var(--fill);
      border-radius: var(--radius-card);
      background: var(--card);
      box-shadow: var(--shadow-card);
    }
    .label {
      font-size: 13px;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--accent);
    }
    :host(.important) {
      border-left-color: var(--warn-edge);
      background: var(--warn-bg);
      box-shadow: none;
    }
    :host(.important) .label,
    :host(.important) .body {
      color: var(--warn-text);
    }
    :host(.urgent) {
      border-left-color: var(--urgent-edge);
      background: var(--urgent-bg);
      box-shadow: none;
    }
    :host(.urgent) .label,
    :host(.urgent) .body {
      color: var(--urgent-text);
    }
  `,
})
export class UiAlertCard {
  readonly level = input<AlertLevel>('announcement');
  /** Who sent it: "Announcement · Fritz". */
  readonly from = input<string>();
  protected readonly heading = computed(() =>
    [LEVEL_NAMES[this.level()], this.from()].filter(Boolean).join(' · '),
  );
}
