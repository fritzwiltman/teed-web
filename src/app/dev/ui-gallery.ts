import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  BoardRow,
  Choice,
  GameRow,
  Tab,
  UiAlertCard,
  UiBadge,
  UiBoard,
  UiButton,
  UiCard,
  UiCheckbox,
  UiChip,
  UiChoicePills,
  UiCourseCard,
  UiField,
  UiGameCard,
  UiHeaderBand,
  UiIcon,
  UiItineraryRow,
  UiListRow,
  UiLiveDot,
  UiNameButton,
  UiPaidStatus,
  UiSectionHead,
  UiSegmented,
  UiSheet,
  UiSkeleton,
  UiStepperRow,
  UiSwitch,
  UiTabBar,
  UiToast,
  UiAttention,
  UiConfirmSheet,
  UiEditPill,
  UiIndexSheet,
  UiLogo,
  UiPickerSheet,
  UiSyncLine,
  UiTeesChip,
  UiTripSwitcher,
  PickerOption,
  SwitcherTrip,
  TeeOption,
} from '../core/ui';

// A photo-sized stand-in, so the gallery needs no network: fairway, rough and sky.
const PHOTO =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="#9cc7e6"/><path d="M0 52c40-14 90-10 160 2v36H0z" fill="#3f7d4a"/><path d="M0 66c50-12 100-6 160 4v20H0z" fill="#5fa35f"/><path d="M112 58V34l12 4-12 5" stroke="#fff" stroke-width="1.5" fill="#c0262d"/></svg>',
  );

/**
 * /dev/ui: every component in every state, light beside dark. Not linked from anywhere.
 * The fixed pieces (tab bar, toast, sheet) are held inside frames here so they stay in the page.
 */
@Component({
  selector: 'app-ui-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    UiAlertCard,
    UiBadge,
    UiBoard,
    UiButton,
    UiCard,
    UiCheckbox,
    UiChip,
    UiChoicePills,
    UiCourseCard,
    UiField,
    UiGameCard,
    UiHeaderBand,
    UiIcon,
    UiItineraryRow,
    UiListRow,
    UiLiveDot,
    UiNameButton,
    UiPaidStatus,
    UiSectionHead,
    UiSegmented,
    UiSheet,
    UiSkeleton,
    UiStepperRow,
    UiSwitch,
    UiTabBar,
    UiToast,
    UiAttention,
    UiConfirmSheet,
    UiEditPill,
    UiIndexSheet,
    UiLogo,
    UiPickerSheet,
    UiSyncLine,
    UiTeesChip,
    UiTripSwitcher,
  ],
  template: `
    <div class="halves">
      <section class="half" data-theme="light" aria-label="Light">
        <p class="mode">Light</p>
        <ng-container *ngTemplateOutlet="all" />
      </section>
      <section class="half" data-theme="dark" aria-label="Dark">
        <p class="mode">Dark</p>
        <ng-container *ngTemplateOutlet="all" />
      </section>
    </div>

    <ng-template #all>
      <h3>ui-header-band · main</h3>
      <div class="frame scroll">
        <ui-header-band label="Vero Beach, FL · Jan 11–15, 2027" title="Vero Beach 2027" />
        <div class="filler">Scroll inside this frame: the band collapses to a compact bar.</div>
      </div>

      <h3>ui-header-band · trip: the switcher line, and Alert for organizers</h3>
      <div class="frame">
        <ui-header-band
          switcher
          label="Southern Pines · Oct 8–12"
          title="Round 2 · Sat, Oct 10"
          action="Alert"
          actionIcon="bell"
        />
      </div>

      <h3>ui-header-band · scorecard: the title opens the hole picker</h3>
      <div class="frame">
        <ui-header-band switcher label="Round 4 · Mon, Oct 12" title="Hole 7" titleTap />
      </div>

      <h3>ui-logo</h3>
      <div class="actions">
        <ui-logo [size]="40" />
        <span class="band-swatch"><ui-logo tone="band" [size]="20" /></span>
      </div>

      <h3>ui-header-band · sub-page</h3>
      <div class="frame scroll">
        <ui-header-band title="Trip details" back="/dev/ui" backLabel="Overview" />
        <div class="filler">Scroll: the back chevron stays in the compact bar.</div>
      </div>

      <h3>ui-card · ui-section-head · ui-list-row</h3>
      <ui-card>
        <ui-section-head title="Setup" note="3 of 4 done" chevron />
        <a ui-list-row href="/dev/ui" title="Trip details" chevron></a>
        <a ui-list-row href="/dev/ui" title="People" detail="8 players · 1 co-admin" chevron></a>
        <ui-list-row icon="bed" title="The house" detail="1420 Ocean Dr" value="4:00 PM" />
        <ui-list-row title="Handicap allowance" value="90%" />
        <ui-list-row title="Fritz Wiltman" detail="Index 18.6">
          <ui-chip after-title>Owner</ui-chip>
          <button ui-button size="small" type="button">Text link</button>
        </ui-list-row>
      </ui-card>
      <ui-card pad>
        <ui-section-head title="A padded card" />
        <p class="detail">One block of content rather than rows.</p>
      </ui-card>
      <ui-card link="/dev/ui">
        <ui-section-head title="The whole card is a link" note="See all" chevron />
        <ui-list-row title="Round 1" value="Final" />
      </ui-card>

      <h3>Edit pill · edit mode · ui-attention</h3>
      <ui-card aria-label="People">
        <ui-section-head title="Players · 3">
          <button
            ui-edit-pill
            action
            [editing]="editing()"
            (click)="editing.set(!editing())"
          ></button>
        </ui-section-head>
        <ui-list-row title="Fritz" detail="Organizer" value="18.6" [chevron]="editing()" />
        <ui-list-row title="Charlie" detail="Player" value="19.1" [chevron]="editing()">
          <ui-attention after-title [reasons]="['No email yet', 'Not paid']" />
        </ui-list-row>
        @if (editing()) {
          <button ui-list-row type="button" icon="plus" title="Add a player"></button>
        }
      </ui-card>

      <h3>ui-list-row · disclosure (chevron turns down, 150ms)</h3>
      <ui-card>
        <button
          ui-list-row
          type="button"
          title="Blue tees"
          detail="6,412 yds · 71.2 / 131"
          [expanded]="open()"
          (click)="open.set(!open())"
        ></button>
        @if (open()) {
          <ui-list-row title="Front 9" value="36" />
        }
      </ui-card>

      <h3>ui-tees-chip (a changed one is bold)</h3>
      <ui-card>
        <ui-list-row title="Von" detail="4.2 HCI">
          <ui-tees-chip
            [tees]="tees"
            label="Von's tees"
            [(value)]="teeA"
            [changed]="teeA() !== 'silver'"
          />
        </ui-list-row>
        <ui-list-row title="Matt" detail="27.0 HCI">
          <ui-tees-chip
            [tees]="tees"
            label="Matt's tees"
            [(value)]="teeB"
            [changed]="teeB() !== 'silver'"
          />
        </ui-list-row>
      </ui-card>

      <h3>ui-picker-sheet · course search</h3>
      <button ui-button variant="outline" type="button" (click)="picking.set(true)">
        Pick a course
      </button>
      <ui-picker-sheet
        [(open)]="picking"
        title="Course"
        searchable
        addLabel="+ Add a course"
        [options]="courses"
        [value]="course()"
        (picked)="course.set($event)"
      />

      <h3>ui-index-sheet</h3>
      <button ui-button variant="outline" type="button" (click)="indexing.set(true)">
        Add Charlie's index
      </button>
      <ui-index-sheet [(open)]="indexing" name="Charlie" (saved)="indexing.set(false)" />

      <h3>ui-confirm-sheet</h3>
      <button ui-button variant="outline" type="button" (click)="confirming.set(true)">
        Delete trip
      </button>
      <ui-confirm-sheet
        [(open)]="confirming"
        title="Delete Southern Pines 2026?"
        line="Scores, results, itinerary and photos go away for all 4 players. This can't be undone."
        action="Delete trip"
        (confirmed)="confirming.set(false)"
      />

      <h3>ui-trip-switcher</h3>
      <button ui-button variant="outline" type="button" (click)="switching.set(true)">
        Open the switcher
      </button>
      <ui-trip-switcher
        [(open)]="switching"
        name="Fritz"
        initial="F"
        [trips]="switcherTrips"
        current="sp"
      />

      <h3>ui-board · plain: the strokes card, like GHIN</h3>
      <ui-board
        plain
        title="Strokes"
        note="90% · off the low man"
        [columns]="['CH', 'PH', 'SO']"
        [valueColumn]="2"
        [rows]="strokes"
      />

      <h3>ui-sync-line</h3>
      <ui-sync-line>Syncing 2 scores</ui-sync-line>

      <h3>ui-button</h3>
      <div class="stack">
        <button ui-button type="button">Start scoring</button>
        <button ui-button type="button" busy>Publishing…</button>
        <button ui-button type="button" disabled>Disabled</button>
        <button ui-button type="button" variant="outline">Outline</button>
        <button ui-button type="button" variant="outline" busy>Saving…</button>
        <button ui-button type="button" tone="danger">Delete trip</button>
        <button ui-button type="button" variant="text" tone="danger">Delete round</button>
        <div class="actions">
          <button ui-button type="button" size="small">Small</button>
          <button ui-button type="button" size="small" variant="outline">Small outline</button>
          <button ui-button type="button" size="small" busy>Sending…</button>
          <button ui-button type="button" variant="text">Text link</button>
        </div>
      </div>

      <h3>ui-chip · ui-badge</h3>
      <div class="actions">
        <ui-chip icon="clock">8:10 AM</ui-chip>
        <ui-chip>Sixes</ui-chip>
        <ui-chip>White tees</ui-chip>
        <ui-chip class="warn">Needs stroke index</ui-chip>
      </div>
      <div class="actions">
        <ui-badge stage="draft" />
        <ui-badge stage="upcoming" />
        <ui-badge stage="in-progress" />
        <ui-badge stage="final" />
        <ui-badge stage="live" />
        <ui-badge stage="complete" />
      </div>

      <h3>ui-choice-pills</h3>
      <ui-choice-pills label="Remind me" [options]="remind" [(value)]="reminder" />

      <h3>ui-segmented</h3>
      <div class="stack">
        <ui-segmented label="Appearance" [options]="modes" [(value)]="mode" />
        <ui-segmented label="Holes" [options]="holes" [(value)]="hole" />
      </div>

      <h3>ui-switch · ui-checkbox</h3>
      <ui-card>
        <label ui-list-row title="Spectators see money">
          <ui-switch [(checked)]="on" />
        </label>
        <ui-list-row title="Switch, off and disabled">
          <ui-switch disabled />
        </ui-list-row>
        <ui-list-row title="Ben Keller" detail="$40 buy-in">
          <ui-checkbox [(checked)]="ticked" label="Ben has paid" />
        </ui-list-row>
        <ui-list-row title="Checkbox, unchecked and disabled">
          <ui-checkbox disabled />
        </ui-list-row>
      </ui-card>

      <h3>ui-field</h3>
      <ui-card pad>
        <ui-field label="Name"><input value="Vero Beach 2027" /></ui-field>
        <ui-field label="Location">
          <input placeholder="Vero Beach, FL" />
          <span hint>Shown under the trip name.</span>
        </ui-field>
        <div class="pair">
          <ui-field label="First day"><input type="date" value="2027-01-11" /></ui-field>
          <ui-field label="Last day"><input type="date" value="2027-01-15" /></ui-field>
        </div>
        <div class="pair">
          <ui-field label="Lock date"><input type="date" /></ui-field>
          <ui-field label="Tee time"><input type="time" value="08:10" /></ui-field>
        </div>
        <ui-field label="Not valid"><input value="call me" aria-invalid="true" /></ui-field>
        <ui-field label="Disabled"><input value="Locked" disabled /></ui-field>
        <ui-field label="Notes"><textarea>Bring cash for the pot.</textarea></ui-field>
      </ui-card>

      <h3>ui-paid-status</h3>
      <div class="actions">
        <ui-paid-status paid />
        <ui-paid-status />
      </div>

      <h3>ui-tab-bar · player</h3>
      <div class="frame bar"><ui-tab-bar [tabs]="playerTabs" active="home" /></div>
      <h3>ui-tab-bar · player, a live round</h3>
      <div class="frame bar"><ui-tab-bar [tabs]="liveTabs" active="board" /></div>
      <h3>ui-tab-bar · spectator: Home and Board</h3>
      <div class="frame bar"><ui-tab-bar [tabs]="spectatorTabs" active="board" /></div>

      <h3>ui-course-card</h3>
      <ui-course-card name="Sandridge Dunes" label="Round 2 · Tue, Jan 12" [photo]="photo" live>
        <ui-chip icon="clock">8:10 AM</ui-chip>
        <ui-chip>Sixes</ui-chip>
        <ui-chip>White tees</ui-chip>
        <p>Fritz · Ben · Cal · Dom</p>
        <button ui-button type="button">Continue scoring</button>
      </ui-course-card>
      <ui-course-card name="No photo yet" label="Round 3 · Wed, Jan 13">
        <ui-chip icon="clock">9:00 AM</ui-chip>
        <ui-chip>Scramble</ui-chip>
      </ui-course-card>

      <h3>ui-itinerary-row</h3>
      <ui-card>
        <ui-itinerary-row
          icon="flag"
          round
          title="Sandridge Dunes"
          time="8:10 AM"
          detail="Round 2 · Sixes"
        />
        <ui-itinerary-row icon="food" title="Dinner at Ocean Grill" time="7:30 PM" />
        <ui-itinerary-row icon="bed" title="Check in" time="4:00 PM" detail="1420 Ocean Dr" />
        <ui-itinerary-row icon="plane" title="Fly home" detail="Thomas · DL 1422" />
      </ui-card>

      <h3>ui-board · full</h3>
      <ui-board title="Round 2" [rows]="board" live />
      <h3>ui-board · mini</h3>
      <ui-board title="Leaders" [rows]="board.slice(0, 3)" valueLabel="Pts" mini />

      <h3>ui-game-card</h3>
      <ui-game-card title="Today's game" note="$20 a man" [rows]="game" />

      <h3>ui-stepper-row</h3>
      <ui-card>
        <ui-stepper-row name="Fritz" detail="1 stroke" [(value)]="scoreA" [par]="4" />
        <ui-stepper-row name="Ben" [(value)]="scoreB" [par]="4" />
      </ui-card>

      <h3>ui-name-button</h3>
      <div class="pair">
        <button ui-name-button name="Fritz" handicap="17"></button>
        <button ui-name-button name="Ben" handicap="9" state="selected"></button>
        <button ui-name-button name="Cal" handicap="12" state="target"></button>
        <button
          ui-name-button
          name="Thomas Featherstonehaugh"
          handicap="+1"
          state="target"
        ></button>
      </div>

      <h3>ui-alert-card</h3>
      <div class="stack">
        <ui-alert-card from="Fritz">Dinner is at 7:30 at Ocean Grill.</ui-alert-card>
        <ui-alert-card level="important" from="Fritz"
          >Tee times moved up 20 minutes tomorrow.</ui-alert-card
        >
        <ui-alert-card level="urgent" from="Fritz"
          >Lightning: play is suspended. Come in now.</ui-alert-card
        >
      </div>

      <h3>ui-toast</h3>
      <div class="frame toast">
        <ui-toast message="Swapped Ben and Thomas" action="Undo" />
      </div>
      <div class="frame toast">
        <ui-toast message="New version" action="Reload" />
      </div>

      <h3>ui-sheet</h3>
      <div class="frame sheet">
        <div class="filler">
          <button ui-button type="button" (click)="sheet.set(true)">Open the sheet</button>
          <p>
            Drag it down past a third, flick it, tap the dim or press Escape to close it. A shorter
            drag springs back, and the page behind stays still.
          </p>
        </div>
        <ui-sheet [(open)]="sheet" label="Publish">
          <h2>Publish Vero Beach 2027?</h2>
          <p class="detail">Player links start working straight away.</p>
          <button ui-button type="button" (click)="sheet.set(false)">Publish</button>
          <button ui-button type="button" variant="outline" (click)="sheet.set(false)">
            Not yet
          </button>
        </ui-sheet>
      </div>

      <h3>ui-skeleton</h3>
      <ui-card pad>
        <div class="actions">
          <ui-skeleton shape="circle" />
          <div class="stack grow">
            <ui-skeleton width="60%" />
            <ui-skeleton width="35%" />
          </div>
        </div>
        <ui-skeleton shape="block" />
      </ui-card>

      <h3>ui-live-dot</h3>
      <p class="actions"><ui-live-dot /> Live</p>

      <h3>ui-icon</h3>
      <div class="actions icons">
        @for (name of icons; track name) {
          <ui-icon [name]="name" />
        }
      </div>
    </ng-template>
  `,
  styles: `
    .band-swatch {
      padding: 6px 12px;
      border-radius: var(--radius-chip);
      background: var(--band);
    }
    .halves {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
    }
    .half {
      min-width: 0;
      padding: var(--s4);
      padding-top: calc(var(--s4) + env(safe-area-inset-top));
      display: flex;
      flex-direction: column;
      gap: var(--s3);
      background: var(--bg);
      color: var(--ink);
    }
    .mode {
      font: 700 32px var(--font-heading);
    }
    h3 {
      margin-top: var(--s4);
      font: 600 13px var(--font-body);
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: var(--muted);
    }
    /* A transformed box keeps position: fixed and sticky children inside itself. */
    .frame {
      position: relative;
      transform: translateZ(0);
      overflow: hidden;
      border-radius: var(--radius-card);
      background: var(--bg);
      outline: 1px solid var(--line);
    }
    .frame.scroll {
      height: 190px;
      overflow-y: auto;
    }
    .filler {
      height: 420px;
      padding: var(--s4);
      font-size: 14px;
      font-weight: 500;
      color: var(--muted);
    }
    .frame.bar {
      height: 66px;
    }
    .frame.toast {
      height: 150px;
    }
    .frame.sheet {
      height: 420px;
    }
    .frame.sheet .filler {
      display: flex;
      flex-direction: column;
      gap: var(--s3);
    }
    .grow {
      flex: 1;
    }
    .icons {
      color: var(--ink-2);
    }
  `,
})
export class UiGallery {
  protected readonly photo = PHOTO;

  protected readonly reminder = signal<string | null>('day');
  protected readonly remind: Choice[] = [
    { value: '3h', label: '3 hours' },
    { value: 'day', label: 'End of day' },
    { value: 'tomorrow', label: 'Tomorrow' },
    { value: 'never', label: 'Never', disabled: true },
  ];
  protected readonly mode = signal<string | null>('auto');
  protected readonly modes: Choice[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
  protected readonly hole = signal<string | null>('18');
  protected readonly holes: Choice[] = [
    { value: '18', label: '18 holes' },
    { value: '9', label: 'Front 9' },
  ];
  protected readonly sheet = signal(false);
  protected readonly editing = signal(false);
  protected readonly open = signal(false);
  protected readonly picking = signal(false);
  protected readonly indexing = signal(false);
  protected readonly confirming = signal(false);
  protected readonly switching = signal(false);
  protected readonly course = signal<string | null>('palmer');
  protected readonly teeA = signal<string | null>('silver');
  protected readonly teeB = signal<string | null>('white');
  protected readonly tees: TeeOption[] = [
    { id: 'gold', name: 'Gold', yards: 6640, rating: 72.4, slope: 134 },
    { id: 'silver', name: 'Silver', yards: 6180, rating: 70.3, slope: 128 },
    { id: 'white', name: 'White', yards: 5720, rating: 68.1, slope: 121 },
    { id: 'red', name: 'Red', yards: 5050, rating: 64.9, slope: 112 },
  ];
  protected readonly courses: PickerOption[] = [
    {
      value: 'palmer',
      title: 'PGA National Resort Palmer Course',
      detail: 'Palm Beach Gardens, FL',
    },
    { value: 'dunes', title: 'Palmetto Dunes · Arthur Hills', detail: 'Hilton Head Island, SC' },
    { value: 'par3', title: 'Palm Beach Par 3', detail: 'Palm Beach, FL' },
  ];
  protected readonly switcherTrips: SwitcherTrip[] = [
    { id: 'sp', name: 'Southern Pines 2026', detail: 'Oct 8–12 · now' },
    { id: 'vero', name: 'Vero Beach 2027', detail: 'Jan 14–17' },
  ];
  protected readonly strokes: BoardRow[] = [
    { pos: '', name: 'Von', detail: '4.2 HCI', cells: ['4', '4', '0'] },
    { pos: '', name: 'Fritz', detail: '15.8 HCI', cells: ['17', '15', '11'] },
    { pos: '', name: 'Matt', detail: '27.0 HCI · White tees', cells: ['29', '26', '22'] },
  ];
  protected readonly on = signal(true);
  protected readonly ticked = signal(true);
  protected readonly scoreA = signal(3);
  protected readonly scoreB = signal(5);

  protected readonly playerTabs: Tab[] = [
    { key: 'home', label: 'Home', icon: 'home', link: '/dev/ui' },
    { key: 'score', label: 'Scorecard', icon: 'card', link: '/dev/ui' },
    { key: 'board', label: 'Board', icon: 'board', link: '/dev/ui' },
    { key: 'trip', label: 'Trip', icon: 'trip', link: '/dev/ui' },
  ];
  protected readonly liveTabs: Tab[] = this.playerTabs.map((tab) =>
    tab.key === 'board' ? { ...tab, live: true } : tab,
  );
  protected readonly spectatorTabs: Tab[] = this.playerTabs.filter(
    (tab) => tab.key === 'home' || tab.key === 'board',
  );

  protected readonly board: BoardRow[] = [
    { pos: '1', name: 'Ben', value: '-3', thru: '14', under: true },
    { pos: 'T2', name: 'Fritz', value: '-1', thru: '14', under: true, me: true },
    { pos: 'T2', name: 'Cal', value: '-1', thru: '12', under: true },
    { pos: '4', name: 'Dom', value: 'E', thru: '12' },
    { pos: '5', name: 'Thomas', value: '+4', thru: 'F' },
  ];
  protected readonly game: GameRow[] = [
    { label: 'Format', value: 'Sixes' },
    { label: 'Holes 1–6', value: 'Fritz + Ben' },
    { label: 'Holes 7–12', value: 'Fritz + Cal' },
    { label: 'Pot', value: '$160' },
  ];

  protected readonly icons = [
    'home',
    'card',
    'board',
    'trip',
    'overview',
    'flag',
    'people',
    'calendar',
    'chevron-left',
    'chevron-right',
    'chevron-down',
    'search',
    'bell',
    'check',
    'x',
    'plus',
    'minus',
    'more',
    'car',
    'bed',
    'food',
    'plane',
    'clock',
    'message',
    'share',
    'paste',
    'note',
    'tv',
    'money',
  ] as const;
}
