import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminData, AdminError, ItemType, ItineraryItem, Proposal, TripRole } from '../admin/data';
import { dayHeader, formatTime, gameLine, localDate } from '../core/format';
import { RoundView, RoundsService } from '../core/rounds';
import { SessionService } from '../core/session';
import {
  Choice,
  IconName,
  PickerOption,
  UiButton,
  UiCard,
  UiChoicePills,
  UiConfirmSheet,
  UiEditPill,
  UiField,
  UiItineraryRow,
  UiListRow,
  UiPickerSheet,
  UiSectionHead,
  UiSheet,
  UiSkeleton,
} from '../core/ui';

const ICON: Record<ItemType, IconName> = {
  lodging: 'bed',
  meal: 'food',
  activity: 'flag',
  tv: 'tv',
  travel: 'car',
  cost: 'money',
  note: 'note',
};
const KIND: Record<ItemType, string> = {
  lodging: 'Stay',
  meal: 'Meal',
  activity: 'Activity',
  tv: 'On TV',
  travel: 'Travel',
  cost: 'Cost',
  note: 'Note',
};

interface Form {
  id: string | null;
  type: ItemType;
  title: string;
  day: string;
  time: string;
  details: string;
  sortOrder: number;
}

interface Row {
  key: string;
  icon: IconName;
  title: string;
  time: string;
  detail: string;
  round?: RoundView;
  item?: ItineraryItem;
}

/** Every day of a trip, 'YYYY-MM-DD'. */
function tripDays(start: string, end: string): string[] {
  const days: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (let i = 0; i < 31 && d.toISOString().slice(0, 10) <= end; i++) {
    days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

/**
 * Trip › Itinerary: one day at a time, picked from the trip's days. Each day's title reads
 * "Travel day · Thu, Oct 8" or "Round 2 · Sat, Oct 10"; organizers get Edit beside it, which
 * edits that day only (rows open a sheet; "+ Add to Thursday" at the bottom). Suggested changes
 * show as a Review card above the days, for organizers.
 */
@Component({
  selector: 'app-trip-itinerary',
  imports: [
    RouterLink,
    UiButton,
    UiCard,
    UiChoicePills,
    UiConfirmSheet,
    UiEditPill,
    UiField,
    UiItineraryRow,
    UiListRow,
    UiPickerSheet,
    UiSectionHead,
    UiSheet,
    UiSkeleton,
  ],
  template: `
    @if (error(); as text) {
      <p class="error-text" role="alert">{{ text }}</p>
    }
    @if (proposals().length && canEdit()) {
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

    @if (days().length) {
      <ui-choice-pills
        label="Day"
        [options]="dayChoices()"
        [value]="day()"
        (valueChange)="pickDay($event)"
      />
    }

    @if (loading()) {
      <ui-skeleton shape="block" height="200px" />
    } @else {
      <ui-card [attr.aria-label]="header()">
        <ui-section-head [title]="header()">
          @if (canEdit()) {
            <button
              ui-edit-pill
              action
              [editing]="editing()"
              (click)="editing.set(!editing())"
            ></button>
          }
        </ui-section-head>
        @for (row of rows(); track row.key) {
          @if (row.round) {
            <a
              ui-itinerary-row
              round
              icon="flag"
              [routerLink]="['/trip/rounds', row.round.row.id]"
              [title]="row.title"
              [time]="row.time"
              [detail]="row.detail"
            ></a>
          } @else if (editing() && row.item) {
            <button
              ui-itinerary-row
              type="button"
              chevron
              [icon]="row.icon"
              [title]="row.title"
              [time]="row.time"
              [detail]="row.detail"
              (click)="openItem(row.item)"
            ></button>
          } @else {
            <ui-itinerary-row
              [icon]="row.icon"
              [title]="row.title"
              [time]="row.time"
              [detail]="row.detail"
            />
          }
        } @empty {
          @if (!editing()) {
            <ui-list-row title="Nothing planned" />
          }
        }
        @if (editing()) {
          <button
            ui-list-row
            type="button"
            icon="plus"
            [title]="'Add to ' + weekday()"
            (click)="openItem(null)"
          ></button>
        }
      </ui-card>
    }

    <ui-sheet
      [open]="!!form()"
      (openChange)="!$event && form.set(null)"
      [label]="form()?.id ? 'Edit item' : 'Add an item'"
    >
      @if (form(); as f) {
        <form class="stack" (submit)="save($event)" novalidate>
          <h2>{{ f.id ? 'Edit item' : 'Add to ' + weekday() }}</h2>
          <button
            ui-list-row
            type="button"
            title="Kind"
            [value]="kindName(f.type)"
            chevron
            (click)="pickingKind.set(true)"
          ></button>
          <ui-field label="What">
            <input
              name="title"
              autocomplete="off"
              [value]="f.title"
              (input)="setForm('title', text($event))"
            />
          </ui-field>
          <div class="pair">
            <ui-field label="Day">
              <input
                name="day"
                type="date"
                [min]="trip()?.start_date ?? ''"
                [max]="trip()?.end_date ?? ''"
                [value]="f.day"
                (change)="setForm('day', text($event))"
              />
            </ui-field>
            <ui-field label="Time">
              <input
                name="time"
                type="time"
                [value]="f.time"
                (change)="setForm('time', text($event))"
              />
            </ui-field>
          </div>
          <ui-field label="Details">
            <input
              name="details"
              autocomplete="off"
              [value]="f.details"
              (input)="setForm('details', text($event))"
            />
          </ui-field>
          @if (formError(); as text) {
            <p class="error-text" role="alert">{{ text }}</p>
          }
          <button ui-button type="submit" [busy]="busy()">Save</button>
          @if (f.id) {
            <button
              ui-button
              type="button"
              variant="text"
              class="center"
              tone="danger"
              (click)="deleting.set(true)"
            >
              Delete
            </button>
          }
        </form>
      }
    </ui-sheet>
    <ui-picker-sheet
      [(open)]="pickingKind"
      title="Kind"
      [options]="kinds"
      [value]="form()?.type ?? null"
      (picked)="setForm('type', $any($event))"
    />
    <ui-confirm-sheet
      [(open)]="deleting"
      [title]="'Delete ' + (form()?.title || 'this item') + '?'"
      line="It comes off the itinerary for everyone."
      action="Delete"
      [busy]="busy()"
      (confirmed)="remove()"
    />
  `,
  styles: ``,
})
export class TripItinerary {
  private readonly data = inject(AdminData);
  private readonly sessions = inject(SessionService);
  private readonly live = inject(RoundsService);
  protected readonly trip = computed(() => this.sessions.session()?.trip ?? null);

  protected readonly items = signal<ItineraryItem[]>([]);
  protected readonly proposals = signal<Proposal[]>([]);
  private readonly role = signal<TripRole | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly canEdit = computed(
    () => this.role() !== null && this.role() !== 'player' && this.trip()?.status !== 'final',
  );
  protected readonly editing = signal(false);
  protected readonly picked = signal<string | null>(null);

  protected readonly form = signal<Form | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly pickingKind = signal(false);
  protected readonly deleting = signal(false);

  protected readonly kinds: PickerOption[] = (Object.keys(KIND) as ItemType[])
    .filter((t) => t !== 'lodging')
    .map((t) => ({ value: t, title: KIND[t] }));

  protected readonly days = computed(() => {
    const t = this.trip();
    return t ? tripDays(t.start_date, t.end_date) : [];
  });
  /** Today during the trip, else its first day; or the day picked. */
  protected readonly day = computed(() => {
    const days = this.days();
    const picked = this.picked();
    if (picked && days.includes(picked)) return picked;
    const today = localDate();
    return days.includes(today) ? today : (days[0] ?? today);
  });
  protected readonly dayChoices = computed<Choice<string>[]>(() =>
    this.days().map((d) => {
      const date = new Date(`${d}T00:00:00Z`);
      const weekday = date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
      return { value: d, label: `${weekday} ${date.getUTCDate()}` };
    }),
  );
  protected readonly weekday = computed(() =>
    new Date(`${this.day()}T00:00:00Z`).toLocaleDateString('en-US', {
      weekday: 'long',
      timeZone: 'UTC',
    }),
  );

  private readonly roundsOfDay = computed(() =>
    this.live.for(this.trip()?.id).filter((r) => r.row.play_date === this.day()),
  );

  /** "Round 2 · Sat, Oct 10" on a round's day; "Travel day · Thu, Oct 8" first and last; else "Day 3". */
  protected readonly header = computed(() => {
    const day = this.day();
    const round = this.roundsOfDay()[0];
    const days = this.days();
    const label = round
      ? `Round ${round.row.round_number}`
      : day === days[0] || day === days.at(-1)
        ? 'Travel day'
        : `Day ${days.indexOf(day) + 1}`;
    return dayHeader(label, day);
  });

  protected readonly rows = computed<Row[]>(() => {
    const day = this.day();
    const rounds: Row[] = this.roundsOfDay().map((r) => ({
      key: `round-${r.row.id}`,
      icon: 'flag',
      title: r.row.courses?.name ?? `Round ${r.row.round_number}`,
      time: formatTime(r.row.tee_time),
      detail: gameLine(r.row.round_formats.map((f) => f.format_key)),
      round: r,
    }));
    const items: Row[] = this.items()
      .filter((i) => i.day === day)
      .map((i) => ({
        key: i.id,
        icon: ICON[i.type],
        title: i.type === 'lodging' ? `Check in · ${i.title}` : i.title,
        time: formatTime(i.start_time),
        detail: this.detailOf(i),
        item: i,
      }));
    return [...rounds, ...items].sort((a, b) =>
      (a.time ? sortable(a.time) : '99') < (b.time ? sortable(b.time) : '99') ? -1 : 1,
    );
  });

  constructor() {
    effect(() => {
      const id = this.trip()?.id;
      if (id) void this.load(id);
    });
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected kindName(type: ItemType): string {
    return KIND[type];
  }

  protected pickDay(day: string | null): void {
    this.picked.set(day);
    this.editing.set(false);
  }

  private detailOf(i: ItineraryItem): string {
    const d = i.details;
    const text = (v: unknown) => (typeof v === 'string' ? v : '');
    if (i.type === 'lodging') return text(d['address']);
    if (i.type === 'meal' && typeof d['reservation'] === 'boolean')
      return [d['reservation'] ? 'Reservation' : 'No reservation', text(d['note'])]
        .filter(Boolean)
        .join(' · ');
    return text(d['note']) || text(d['details']);
  }

  protected openItem(item: ItineraryItem | null): void {
    this.formError.set(null);
    this.form.set(
      item
        ? {
            id: item.id,
            type: item.type,
            title: item.title,
            day: item.day,
            time: item.start_time?.slice(0, 5) ?? '',
            details: this.detailOf(item),
            sortOrder: item.sort_order,
          }
        : {
            id: null,
            type: 'activity',
            title: '',
            day: this.day(),
            time: '',
            details: '',
            sortOrder: this.items().length + 1,
          },
    );
  }

  protected setForm<K extends keyof Form>(key: K, value: Form[K]): void {
    this.form.update((f) => (f ? { ...f, [key]: value } : f));
    this.formError.set(null);
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const f = this.form();
    const tripId = this.trip()?.id;
    if (!f || !tripId || this.busy()) return;
    if (!f.title.trim()) return this.formError.set('Say what it is.');
    const existing = this.items().find((i) => i.id === f.id);
    const details: Record<string, unknown> = { ...(existing?.details ?? {}) };
    if (f.type === 'lodging') details['address'] = f.details.trim() || undefined;
    else details['note'] = f.details.trim() || undefined;
    await this.run(() =>
      this.data.saveItem(tripId, f.id, {
        day: f.day,
        start_time: f.time || null,
        type: f.type,
        title: f.title.trim(),
        details,
        sort_order: f.sortOrder,
      }),
    );
  }

  protected async remove(): Promise<void> {
    const f = this.form();
    if (!f?.id) return;
    await this.run(() => this.data.deleteItem(f.id!));
    this.deleting.set(false);
  }

  private async run(change: () => Promise<void>): Promise<void> {
    const tripId = this.trip()?.id;
    if (!tripId) return;
    this.busy.set(true);
    try {
      await change();
      this.items.set(await this.data.itinerary(tripId));
      this.form.set(null);
    } catch (e) {
      this.formError.set(e instanceof AdminError ? e.message : "That didn't save.");
    } finally {
      this.busy.set(false);
    }
  }

  private async load(id: string): Promise<void> {
    try {
      const [items, role] = await Promise.all([this.data.itinerary(id), this.data.tripRole(id)]);
      this.items.set(items);
      this.role.set(role);
      if (role && role !== 'player')
        this.proposals.set(await this.data.proposals(id).catch(() => []));
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't load the itinerary.");
    } finally {
      this.loading.set(false);
    }
  }
}

/** '7:33 AM' → '07:33' for ordering a day's rows. */
function sortable(time: string): string {
  const m = /^(\d+):(\d+) (AM|PM)$/.exec(time);
  if (!m) return time;
  const h = (Number(m[1]) % 12) + (m[3] === 'PM' ? 12 : 0);
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}
