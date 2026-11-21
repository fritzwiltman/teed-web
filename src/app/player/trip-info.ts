import { Component, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AdminData,
  AdminError,
  ItineraryItem,
  RosterPlayer,
  Trip,
  TripFields,
  TripRole,
} from '../admin/data';
import { addDays } from '../admin/trip-details';
import { formatDay, formatTime } from '../core/format';
import { SessionService } from '../core/session';
import { ThemeChoice, ThemeService } from '../core/theme';
import {
  Choice,
  UiButton,
  UiCard,
  UiCheckbox,
  UiConfirmSheet,
  UiEditPill,
  UiField,
  UiListRow,
  UiPaidStatus,
  UiSectionHead,
  UiSegmented,
  UiSkeleton,
  UiSwitch,
} from '../core/ui';

interface Stay {
  name: string;
  address: string;
  checkInDay: string;
  checkInTime: string;
  checkOutDay: string;
  checkOutTime: string;
  url: string;
}

/**
 * Trip › Info: the stay, buy-ins and house rules, for everyone. Organizers get Edit beside
 * "Trip details": the trip's name and dates, the stay, the buy-in with a paid box per player, the
 * house rules and "Spectators see winnings"; the organizer (and the app admin) also gets Delete
 * trip. The stay is kept as the itinerary's lodging item.
 */
@Component({
  selector: 'app-trip-info',
  imports: [
    UiButton,
    UiCard,
    UiCheckbox,
    UiConfirmSheet,
    UiEditPill,
    UiField,
    UiListRow,
    UiPaidStatus,
    UiSectionHead,
    UiSegmented,
    UiSkeleton,
    UiSwitch,
  ],
  template: `
    @if (error(); as text) {
      <p class="error-text" role="alert">{{ text }}</p>
    }
    @if (trip(); as t) {
      @if (editing()) {
        <ui-card pad aria-label="Trip details">
          <ui-section-head title="Trip details">
            <button ui-edit-pill action editing [disabled]="busy()" (click)="save()"></button>
          </ui-section-head>
          <ui-field label="Trip name">
            <input
              name="name"
              autocomplete="off"
              [value]="f().name"
              (input)="set('name', text($event))"
            />
          </ui-field>
          <div class="pair">
            <ui-field label="Starts">
              <input
                name="start"
                type="date"
                [value]="f().start_date"
                (change)="setStart(text($event))"
              />
            </ui-field>
            <ui-field label="Ends">
              <input
                name="end"
                type="date"
                [min]="f().start_date"
                [value]="f().end_date"
                (change)="set('end_date', text($event))"
              />
            </ui-field>
          </div>
        </ui-card>

        <ui-card pad aria-label="Stay">
          <ui-section-head title="Stay" />
          <ui-field label="Name">
            <input
              name="stay"
              autocomplete="off"
              [value]="stay().name"
              (input)="setStay('name', text($event))"
            />
          </ui-field>
          <ui-field label="Address">
            <input
              name="address"
              autocomplete="off"
              [value]="stay().address"
              (input)="setStay('address', text($event))"
            />
          </ui-field>
          <div class="pair">
            <ui-field label="Check in">
              <input
                type="date"
                name="in-day"
                [value]="stay().checkInDay"
                (change)="setStay('checkInDay', text($event))"
              />
            </ui-field>
            <ui-field label="Time">
              <input
                type="time"
                name="in-time"
                [value]="stay().checkInTime"
                (change)="setStay('checkInTime', text($event))"
              />
            </ui-field>
          </div>
          <div class="pair">
            <ui-field label="Check out">
              <input
                type="date"
                name="out-day"
                [value]="stay().checkOutDay"
                (change)="setStay('checkOutDay', text($event))"
              />
            </ui-field>
            <ui-field label="Time">
              <input
                type="time"
                name="out-time"
                [value]="stay().checkOutTime"
                (change)="setStay('checkOutTime', text($event))"
              />
            </ui-field>
          </div>
          <ui-field label="Listing">
            <input
              name="url"
              type="url"
              inputmode="url"
              autocomplete="off"
              placeholder="https://"
              [value]="stay().url"
              (input)="setStay('url', text($event))"
            />
          </ui-field>
        </ui-card>

        <ui-card aria-label="Buy-ins">
          <ui-section-head title="Buy-ins" />
          <div class="inset">
            <ui-field label="Buy-in, each ($)">
              <input
                name="buy-in"
                inputmode="decimal"
                autocomplete="off"
                placeholder="120"
                [value]="buyIn()"
                (input)="buyIn.set(text($event))"
              />
            </ui-field>
          </div>
          @for (p of players(); track p.id) {
            <label ui-list-row [title]="p.name">
              <ui-checkbox
                [label]="p.name + ' paid'"
                [checked]="paid()[p.id] ?? false"
                (checkedChange)="setPaid(p.id, $event)"
              />
            </label>
          }
        </ui-card>

        <ui-card aria-label="House rules">
          <ui-section-head title="House rules" />
          <div class="inset">
            <ui-field label="Handicap allowance (%)">
              <input
                name="allowance"
                type="number"
                inputmode="numeric"
                min="1"
                max="100"
                [value]="percent()"
                (input)="percent.set(text($event))"
              />
            </ui-field>
          </div>
          <label ui-list-row title="Strokes off the low man">
            <ui-switch
              [checked]="f().strokes_off_low"
              (checkedChange)="set('strokes_off_low', $event)"
            />
          </label>
          <label ui-list-row title="Pick up at net double bogey">
            <ui-switch
              [checked]="f().pickup_net_double"
              (checkedChange)="set('pickup_net_double', $event)"
            />
          </label>
          <label ui-list-row title="Spectators see winnings">
            <ui-switch
              [checked]="f().spectators_see_money"
              (checkedChange)="set('spectators_see_money', $event)"
            />
          </label>
        </ui-card>

        @if (formError(); as text) {
          <p class="error-text" role="alert">{{ text }}</p>
        }
        @if (owner()) {
          <button
            ui-button
            type="button"
            variant="text"
            class="center danger"
            (click)="deleting.set(true)"
          >
            Delete trip
          </button>
        }
        <ui-confirm-sheet
          [(open)]="deleting"
          [title]="'Delete ' + t.name + '?'"
          [line]="deleteLine()"
          action="Delete trip"
          [busy]="busy()"
          (confirmed)="deleteTrip()"
        />
      } @else {
        <ui-card aria-label="Trip details">
          <ui-section-head title="Trip details">
            @if (canEdit()) {
              <button ui-edit-pill action (click)="startEdit()"></button>
            }
          </ui-section-head>
          <ui-list-row [title]="t.name" [detail]="dates(t)" />
        </ui-card>

        @if (lodging(); as l) {
          <ui-card aria-label="Stay">
            <ui-section-head title="Stay" />
            <ui-list-row [title]="l.title" [detail]="str(l.details['address'])" />
            <ui-list-row title="Check in" [value]="checkIn(l)" />
            @if (checkOut(l); as out) {
              <ui-list-row title="Check out" [value]="out" />
            }
            @if (str(l.details['address']); as address) {
              <a
                ui-list-row
                [href]="maps(address)"
                target="_blank"
                rel="noopener"
                title="Directions"
                chevron
              ></a>
            }
            @if (str(l.details['url']); as url) {
              <a
                ui-list-row
                [href]="url"
                target="_blank"
                rel="noopener"
                title="Listing"
                chevron
              ></a>
            }
          </ui-card>
        }

        @if (t.buy_in_amount) {
          <ui-card aria-label="Buy-ins">
            <ui-section-head
              [title]="'Buy-ins · $' + t.buy_in_amount + ' each'"
              [note]="paidCount()"
            />
            @for (p of players(); track p.id) {
              <ui-list-row [title]="p.name">
                <ui-paid-status [paid]="p.buy_in_paid" />
              </ui-list-row>
            }
          </ui-card>
        }

        <ui-card aria-label="House rules">
          <ui-section-head title="House rules" />
          <ui-list-row title="Handicap allowance" [value]="allowance(t)" />
          <ui-list-row title="Strokes off the low man" [value]="t.strokes_off_low ? 'On' : 'Off'" />
          <ui-list-row
            title="Pick up at"
            [value]="t.pickup_net_double ? 'Net double bogey' : 'Hole out'"
          />
        </ui-card>

        <ui-card pad aria-label="Appearance">
          <ui-section-head title="Appearance" />
          <ui-segmented
            label="Appearance"
            [options]="themes"
            [value]="theme.choice()"
            (valueChange)="theme.set($event ?? 'auto')"
          />
        </ui-card>
      }
    } @else if (!error()) {
      <ui-skeleton shape="block" height="230px" />
    }
  `,
  styles: `
    .inset {
      padding: 0 var(--s4) var(--s3);
    }
    .danger {
      color: var(--red);
    }
  `,
})
export class TripInfo {
  private readonly data = inject(AdminData);
  private readonly sessions = inject(SessionService);
  private readonly router = inject(Router);
  protected readonly theme = inject(ThemeService);
  private readonly tripId = computed(() => this.sessions.session()?.trip.id ?? null);

  protected readonly trip = signal<Trip | null>(null);
  protected readonly players = signal<RosterPlayer[]>([]);
  protected readonly lodging = signal<ItineraryItem | null>(null);
  private readonly role = signal<TripRole | null>(null);
  protected readonly owner = computed(() => this.role() === 'organizer' || this.role() === 'admin');
  protected readonly canEdit = computed(
    () => this.role() !== null && this.role() !== 'player' && this.trip()?.status !== 'final',
  );
  protected readonly error = signal<string | null>(null);

  // Edit mode.
  protected readonly editing = signal(false);
  protected readonly busy = signal(false);
  protected readonly formError = signal<string | null>(null);
  protected readonly deleting = signal(false);
  protected readonly f = signal<TripFields>({} as TripFields);
  protected readonly percent = signal('100');
  protected readonly buyIn = signal('');
  protected readonly paid = signal<Record<string, boolean>>({});
  protected readonly stay = signal<Stay>({
    name: '',
    address: '',
    checkInDay: '',
    checkInTime: '',
    checkOutDay: '',
    checkOutTime: '',
    url: '',
  });

  protected readonly themes: Choice<ThemeChoice>[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  /** "3 of 4 paid" */
  protected readonly paidCount = computed(() => {
    const list = this.players();
    return `${list.filter((p) => p.buy_in_paid).length} of ${list.length} paid`;
  });

  constructor() {
    effect(() => {
      const id = this.tripId();
      if (id) void this.load(id);
    });
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected str(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  protected dates(t: Trip): string {
    return `${formatDay(t.start_date)} – ${formatDay(t.end_date)}`;
  }

  protected allowance(t: Trip): string {
    return `${Math.round(Number(t.handicap_allowance) * 100)}%`;
  }

  /** "Thu, Oct 8 · 4:00 PM" */
  protected checkIn(l: ItineraryItem): string {
    return [formatDay(l.day), formatTime(l.start_time)].filter(Boolean).join(' · ');
  }

  protected checkOut(l: ItineraryItem): string {
    const day = this.str(l.details['check_out']);
    return day
      ? [formatDay(day), formatTime(this.str(l.details['check_out_time']) || null)]
          .filter(Boolean)
          .join(' · ')
      : '';
  }

  protected maps(address: string): string {
    return `https://maps.apple.com/?q=${encodeURIComponent(address)}`;
  }

  protected deleteLine(): string {
    const n = this.players().length;
    return `Scores, results, itinerary and photos go away for all ${n} ${n === 1 ? 'player' : 'players'}. This can't be undone.`;
  }

  // ── Edit mode ──────────────────────────────────────────────────────────────

  protected startEdit(): void {
    const t = this.trip();
    if (!t) return;
    const { id: _id, status: _status, ...fields } = t;
    this.f.set(fields);
    this.percent.set(String(Math.round(Number(t.handicap_allowance) * 100)));
    this.buyIn.set(t.buy_in_amount ? String(t.buy_in_amount) : '');
    this.paid.set(Object.fromEntries(this.players().map((p) => [p.id, p.buy_in_paid])));
    const l = this.lodging();
    this.stay.set({
      name: l?.title ?? '',
      address: this.str(l?.details['address']),
      checkInDay: l?.day ?? t.start_date,
      checkInTime: l?.start_time?.slice(0, 5) ?? '',
      checkOutDay: this.str(l?.details['check_out']) || t.end_date,
      checkOutTime: this.str(l?.details['check_out_time']),
      url: this.str(l?.details['url']),
    });
    this.formError.set(null);
    this.editing.set(true);
  }

  protected set<K extends keyof TripFields>(key: K, value: TripFields[K]): void {
    this.f.update((f) => ({ ...f, [key]: value }));
    this.formError.set(null);
  }

  /** A first day after the last day moves the last day with it. */
  protected setStart(start: string): void {
    this.set('start_date', start);
    if (start && this.f().end_date < start) this.set('end_date', addDays(start, 3));
  }

  protected setStay<K extends keyof Stay>(key: K, value: Stay[K]): void {
    this.stay.update((s) => ({ ...s, [key]: value }));
  }

  protected setPaid(id: string, paid: boolean): void {
    this.paid.update((p) => ({ ...p, [id]: paid }));
  }

  /** Done: saves the trip, the stay and who has paid, then shows them. */
  protected async save(): Promise<void> {
    const t = this.trip();
    if (!t || this.busy()) return;
    const f = { ...this.f(), name: this.f().name.trim() };
    const percent = Number(this.percent());
    const buyIn = this.buyIn().trim() === '' ? null : Number(this.buyIn());
    const problem = !f.name
      ? 'Give the trip a name.'
      : !f.start_date || !f.end_date || f.end_date < f.start_date
        ? 'Set the first and last day.'
        : !Number.isInteger(percent) || percent < 1 || percent > 100
          ? 'The handicap allowance is a whole number from 1 to 100.'
          : buyIn !== null && (Number.isNaN(buyIn) || buyIn < 0)
            ? 'The buy-in is an amount in dollars.'
            : null;
    if (problem) return this.formError.set(problem);
    f.handicap_allowance = percent / 100;
    f.buy_in_amount = buyIn;

    this.busy.set(true);
    try {
      this.trip.set(await this.data.updateTrip(t.id, f));
      await this.saveStay(t.id);
      for (const p of this.players())
        if ((this.paid()[p.id] ?? false) !== p.buy_in_paid)
          await this.data.setPaid(p.id, !p.buy_in_paid);
      await this.load(t.id);
      this.editing.set(false);
    } catch (e) {
      this.formError.set(e instanceof AdminError ? e.message : "Couldn't save the trip.");
    } finally {
      this.busy.set(false);
    }
  }

  /** The stay is the itinerary's lodging item: made, changed, or (with no name) removed. */
  private async saveStay(tripId: string): Promise<void> {
    const s = this.stay();
    const l = this.lodging();
    if (!s.name.trim()) {
      if (l) await this.data.deleteItem(l.id);
      return;
    }
    await this.data.saveItem(tripId, l?.id ?? null, {
      day: s.checkInDay || this.f().start_date,
      start_time: s.checkInTime || null,
      type: 'lodging',
      title: s.name.trim(),
      details: {
        ...(l?.details ?? {}),
        address: s.address.trim() || undefined,
        check_out: s.checkOutDay || undefined,
        check_out_time: s.checkOutTime || undefined,
        url: s.url.trim() || undefined,
      },
      sort_order: l?.sort_order ?? 0,
    });
  }

  protected async deleteTrip(): Promise<void> {
    const t = this.trip();
    if (!t || this.busy()) return;
    this.busy.set(true);
    try {
      await this.data.deleteTrip(t.id);
      this.deleting.set(false);
      this.sessions.leave();
      await this.sessions.loadTrips();
      await this.router.navigateByUrl('/you');
    } catch (e) {
      this.deleting.set(false);
      this.formError.set(e instanceof AdminError ? e.message : "Couldn't delete the trip.");
    } finally {
      this.busy.set(false);
    }
  }

  private async load(id: string): Promise<void> {
    try {
      const [trip, role, players, items] = await Promise.all([
        this.data.trip(id),
        this.data.tripRole(id),
        this.data.roster(id),
        this.data.itinerary(id),
      ]);
      this.trip.set(trip);
      this.role.set(role);
      this.players.set(players);
      this.lodging.set(items.find((i) => i.type === 'lodging') ?? null);
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't load the trip.");
    }
  }
}
