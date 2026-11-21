import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { AdminData, AdminError, MemberFields, RosterPlayer, Trip, TripRole } from '../admin/data';
import { AuthService } from '../core/auth';
import { Role, SessionService } from '../core/session';
import {
  formatPhone,
  initialsFor,
  inviteMessage,
  sendText,
  spectatorMessage,
  tidyPhone,
} from '../core/sms';
import {
  Choice,
  UiAttention,
  UiButton,
  UiCard,
  UiConfirmSheet,
  UiEditPill,
  UiField,
  UiListRow,
  UiSectionHead,
  UiSegmented,
  UiSheet,
  UiSkeleton,
  readIndex,
} from '../core/ui';

type Form = { name: string; email: string; phone: string; index: string; role: Role };
const EMPTY: Form = { name: '', email: '', phone: '', index: '', role: 'player' };

const ROLE_NAME: Record<Role, string> = {
  organizer: 'Organizer',
  co_organizer: 'Co-organizer',
  player: 'Player',
};

/**
 * Trip › People: everyone on the trip, the role under each name and the handicap index on the
 * right. Organizers see one amber "!" for anything to act on (no email, hasn't joined, not paid),
 * and Edit beside "Players · 4": rows open the player sheet, "+ Add a player" sits at the bottom,
 * and the spectator link and "Text invites" appear. Only the organizer (or the app admin) picks
 * co-organizers, hands the trip off, and removes a co-organizer.
 */
@Component({
  selector: 'app-trip-people',
  imports: [
    UiAttention,
    UiButton,
    UiCard,
    UiConfirmSheet,
    UiEditPill,
    UiField,
    UiListRow,
    UiSectionHead,
    UiSegmented,
    UiSheet,
    UiSkeleton,
  ],
  template: `
    @if (error(); as text) {
      <p class="error-text" role="alert">{{ text }}</p>
    }

    @if (players(); as list) {
      <ui-card aria-label="Players">
        <ui-section-head [title]="'Players · ' + list.length">
          @if (canEdit()) {
            <button
              ui-edit-pill
              action
              [editing]="editing()"
              (click)="editing.set(!editing())"
            ></button>
          }
        </ui-section-head>
        <div class="columns" aria-hidden="true"><span>Player</span><span>HCI</span></div>
        @for (p of list; track p.id) {
          @if (editing()) {
            <button
              ui-list-row
              type="button"
              [title]="p.name"
              [detail]="roleName(p.role)"
              [value]="index(p)"
              chevron
              (click)="openPlayer(p)"
            >
              @if (reasons(p).length) {
                <ui-attention after-title [reasons]="reasons(p)" />
              }
            </button>
          } @else {
            <ui-list-row [title]="p.name" [detail]="roleName(p.role)" [value]="index(p)">
              @if (reasons(p).length) {
                <ui-attention after-title [reasons]="reasons(p)" />
              }
            </ui-list-row>
          }
        }
        @if (editing()) {
          <button
            ui-list-row
            type="button"
            icon="plus"
            title="Add a player"
            (click)="openPlayer(null)"
          ></button>
        }
      </ui-card>
    } @else if (!error()) {
      <ui-skeleton shape="block" height="230px" />
    }

    @if (players() && trip()?.status !== 'draft' && (spectator() || editing())) {
      <ui-card aria-label="Spectators">
        <ui-section-head title="Spectators" />
        @if (spectator(); as token) {
          <ui-list-row title="Read-only link" detail="No sign-in needed">
            <button
              ui-button
              size="small"
              variant="outline"
              type="button"
              (click)="shareSpectator(token)"
            >
              {{ copied() === 'spectator' ? 'Copied' : 'Share' }}
            </button>
          </ui-list-row>
          @if (editing()) {
            <button
              ui-list-row
              type="button"
              title="Reset the link"
              [disabled]="busy()"
              (click)="resetting.set(true)"
            ></button>
          }
        } @else {
          <button
            ui-list-row
            type="button"
            icon="plus"
            title="Create spectator link"
            [disabled]="busy()"
            (click)="resetSpectator()"
          ></button>
        }
      </ui-card>
    }

    @if (editing() && toInvite().length) {
      @if (sendingTo(); as p) {
        <ui-card pad aria-label="Text invites">
          <ui-section-head
            title="Text invites"
            [note]="sending()! + 1 + ' of ' + toInvite().length"
          />
          <div class="actions">
            <button ui-button size="small" type="button" [disabled]="busy()" (click)="text(p)">
              {{ p.phone ? 'Text' : 'Share with' }} {{ p.name }}
            </button>
            <button ui-button size="small" variant="outline" type="button" (click)="nextSend()">
              {{ sending()! + 1 < toInvite().length ? 'Next' : 'Done' }}
            </button>
          </div>
        </ui-card>
      } @else {
        <button ui-button type="button" (click)="sending.set(0)">
          Text invites to {{ toInvite().length }}
          {{ toInvite().length === 1 ? 'player' : 'players' }}
        </button>
      }
    }

    <ui-sheet [open]="sheetOpen()" (openChange)="!$event && closeSheet()" [label]="sheetTitle()">
      <form class="stack" (submit)="save($event)" novalidate>
        <h2>{{ sheetTitle() }}</h2>
        <ui-field label="Name">
          <input
            name="name"
            autocomplete="off"
            [value]="form().name"
            (input)="setForm('name', $event)"
          />
        </ui-field>
        <ui-field label="Email">
          <input
            name="email"
            type="email"
            inputmode="email"
            autocomplete="off"
            autocapitalize="none"
            placeholder="Add an email"
            [value]="form().email"
            [disabled]="!!current()?.claimed"
            (input)="setForm('email', $event)"
          />
        </ui-field>
        <div class="pair">
          <ui-field label="Handicap index">
            <input
              name="index"
              inputmode="decimal"
              autocomplete="off"
              placeholder="18.6"
              [value]="form().index"
              (input)="setForm('index', $event)"
            />
          </ui-field>
          <ui-field label="Mobile">
            <input
              name="phone"
              type="tel"
              inputmode="tel"
              autocomplete="off"
              [value]="form().phone"
              (input)="setForm('phone', $event)"
            />
          </ui-field>
        </div>
        @if (roleChoices().length > 1) {
          <ui-segmented
            label="Role"
            [options]="roleChoices()"
            [value]="form().role"
            (valueChange)="setRole($event)"
          />
        }
        @if (formError(); as text) {
          <p class="error-text" role="alert">{{ text }}</p>
        }
        <button ui-button type="submit" [busy]="busy()">
          {{ !current() || current()?.claimed === false ? 'Save and text invite' : 'Save' }}
        </button>
        @if (current(); as p) {
          @if (canRemove(p)) {
            <button
              ui-button
              type="button"
              variant="text"
              class="center"
              tone="danger"
              (click)="removing.set(true)"
            >
              Remove from trip
            </button>
          }
        }
      </form>
    </ui-sheet>

    <ui-confirm-sheet
      [(open)]="removing"
      [title]="'Remove ' + (current()?.name ?? '') + '?'"
      [line]="removeLine()"
      [action]="'Remove ' + (current()?.name ?? '')"
      [busy]="busy()"
      (confirmed)="remove()"
    />
    <ui-confirm-sheet
      [(open)]="handingOff"
      [title]="'Make ' + (current()?.name ?? '') + ' the organizer?'"
      [line]="
        (current()?.name ?? '') +
        ' gets full control of the trip, including deleting it. You stay on as a co-organizer.'
      "
      [action]="'Make ' + (current()?.name ?? '') + ' organizer'"
      [busy]="busy()"
      (confirmed)="handOff()"
    />
    <ui-confirm-sheet
      [(open)]="resetting"
      title="Reset the spectator link?"
      line="The link people have now stops working."
      action="Reset link"
      [busy]="busy()"
      (confirmed)="resetSpectator()"
    />
  `,
  styles: `
    .columns {
      display: flex;
      justify-content: space-between;
      padding: 0 var(--s4) var(--s1);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--muted);
    }
  `,
})
export class TripPeople {
  /** ?send=all opens "Text invites" (where publishing a trip sends you). */
  readonly send = input<string>();

  private readonly data = inject(AdminData);
  private readonly sessions = inject(SessionService);
  private readonly me = inject(AuthService).me;
  private readonly tripId = computed(() => this.sessions.session()?.trip.id ?? null);

  protected readonly trip = signal<Trip | null>(null);
  protected readonly players = signal<RosterPlayer[] | null>(null);
  private readonly role = signal<TripRole | null>(null);
  /** The organizer (or the app admin): picks co-organizers, hands off, removes co-organizers. */
  protected readonly owner = computed(() => this.role() === 'organizer' || this.role() === 'admin');
  protected readonly canEdit = computed(
    () => this.role() !== null && this.role() !== 'player' && this.trip()?.status !== 'final',
  );
  protected readonly editing = signal(false);
  protected readonly spectator = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly copied = signal<string | null>(null);

  // The player sheet: someone on the trip, or a new player.
  protected readonly current = signal<RosterPlayer | null>(null);
  protected readonly adding = signal(false);
  protected readonly sheetOpen = computed(() => this.adding() || !!this.current());
  protected readonly sheetTitle = computed(() => this.current()?.name || 'Add a player');
  protected readonly form = signal<Form>(EMPTY);
  protected readonly formError = signal<string | null>(null);
  protected readonly removing = signal(false);
  protected readonly handingOff = signal(false);
  protected readonly resetting = signal(false);

  /** Player · Co-organizer for the organizer to choose; plus Organizer, to hand the trip off. */
  protected readonly roleChoices = computed<Choice<Role>[]>(() => {
    const p = this.current();
    if (!this.owner() || p?.role === 'organizer') return [];
    return [
      { value: 'player', label: 'Player' },
      { value: 'co_organizer', label: 'Co-organizer' },
      ...(p ? [{ value: 'organizer' as Role, label: 'Organizer' }] : []),
    ];
  });

  // "Text invites": the index of the person being texted.
  protected readonly sending = signal<number | null>(null);
  protected readonly toInvite = computed(() =>
    (this.players() ?? []).filter((p) => p.claimed === false),
  );
  protected readonly sendingTo = computed(() => {
    const i = this.sending();
    return i === null ? null : (this.toInvite()[i] ?? null);
  });

  constructor() {
    effect(() => {
      const id = this.tripId();
      if (id) void this.load(id, this.send() === 'all');
    });
  }

  protected roleName(role: Role): string {
    return ROLE_NAME[role];
  }

  protected index(p: RosterPlayer): string {
    return p.handicap_index === null ? '–' : p.handicap_index.toFixed(1);
  }

  /** What the "!" says. The flags come only to organizers, so players never see one. */
  protected reasons(p: RosterPlayer): string[] {
    const f = p.flags;
    if (!f) return [];
    return [
      f.no_email && 'No email yet',
      f.not_claimed && !f.no_email && "Hasn't joined",
      f.not_paid && 'Not paid',
    ].filter((text): text is string => !!text);
  }

  protected removeLine(): string {
    const name = this.current()?.name ?? 'They';
    return `${name} comes off the trip and out of every group. Scores already entered stay on the scorecards.`;
  }

  /** Players by anyone running the trip; co-organizers by the organizer; the organizer never. */
  protected canRemove(p: RosterPlayer): boolean {
    return p.role === 'player' || (p.role === 'co_organizer' && this.owner());
  }

  // ── The sheet ──────────────────────────────────────────────────────────────

  protected openPlayer(p: RosterPlayer | null): void {
    this.formError.set(null);
    if (!p) {
      this.form.set(EMPTY);
      this.current.set(null);
      this.adding.set(true);
      return;
    }
    this.form.set({
      name: p.name,
      email: p.email ?? '',
      phone: p.phone ? formatPhone(p.phone) : '',
      index: p.handicap_index === null ? '' : String(p.handicap_index),
      role: p.role,
    });
    this.adding.set(false);
    this.current.set(p);
  }

  protected closeSheet(): void {
    this.current.set(null);
    this.adding.set(false);
  }

  protected setForm(key: Exclude<keyof Form, 'role'>, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.form.update((f) => ({ ...f, [key]: value }));
    this.formError.set(null);
  }

  /** Picking Organizer is a hand-off, so it asks first; the role in the form doesn't change. */
  protected setRole(role: Role | null): void {
    if (role === 'organizer') {
      this.handingOff.set(true);
      return;
    }
    this.form.update((f) => ({ ...f, role: role ?? 'player' }));
  }

  /** Checks the form. Returns the fields to save, or null after setting the message. */
  private read(): MemberFields | null {
    const f = this.form();
    const name = f.name.trim();
    const email = f.email.trim().toLowerCase() || null;
    const phone = f.phone.trim() ? tidyPhone(f.phone) : null;
    const index = readIndex(f.index);
    const problem = !name
      ? 'Enter a name.'
      : email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
        ? "That doesn't look like an email address."
        : f.phone.trim() && !phone
          ? "That doesn't look like a mobile number."
          : index === 'invalid'
            ? 'A handicap index is a number up to 54.0.'
            : null;
    this.formError.set(problem);
    if (problem || index === 'invalid') return null;
    const p = this.current();
    return {
      name,
      // Initials follow the name unless they were set before.
      initials: p && p.name === name ? p.initials : initialsFor(name) || 'X',
      email,
      phone,
      handicap_index: index,
      role: f.role,
    };
  }

  /** Save (and text the invite to someone who hasn't joined). */
  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const tripId = this.tripId();
    const fields = this.read();
    if (!fields || !tripId) return;
    const p = this.current();
    if (!p) {
      let added: { id: string; token: string | null } | null = null;
      const done = await this.run(async () => {
        added = await this.data.addMember(tripId, fields);
      });
      if (!done) return;
      this.closeSheet();
      const invite = added as { id: string; token: string | null } | null;
      if (invite?.token) await this.deliver(invite.id, fields.phone, this.inviteText(invite.token));
      return;
    }
    if (!(await this.run(() => this.data.updateMember(p, fields)))) return;
    this.closeSheet();
    if (p.claimed === false) await this.text({ ...p, phone: fields.phone });
  }

  protected async remove(): Promise<void> {
    const p = this.current();
    if (!p) return;
    if (await this.run(() => this.data.removeMember(p.id))) {
      this.removing.set(false);
      this.closeSheet();
    } else {
      this.removing.set(false);
    }
  }

  protected async handOff(): Promise<void> {
    const p = this.current();
    const tripId = this.tripId();
    if (!p || !tripId) return;
    const done = await this.run(async () => {
      await this.data.handOff(tripId, p.id);
      this.role.set(await this.data.tripRole(tripId));
      await this.sessions.revalidate();
    });
    this.handingOff.set(false);
    if (done) this.closeSheet();
  }

  // ── Inviting and the spectator link ────────────────────────────────────────

  protected async text(player: RosterPlayer): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const token = await this.data.invite(player.id);
      await this.deliver(player.id, player.phone ?? null, this.inviteText(token));
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't make the invite link.");
    } finally {
      this.busy.set(false);
    }
  }

  protected nextSend(): void {
    const next = (this.sending() ?? 0) + 1;
    this.sending.set(next < this.toInvite().length ? next : null);
  }

  private inviteText(token: string): string {
    return inviteMessage(this.me()?.display_name ?? '', this.trip()?.name ?? 'a golf trip', token);
  }

  private async deliver(id: string, phone: string | null, message: string): Promise<void> {
    if ((await sendText(phone, message)) === 'copied') {
      this.copied.set(id);
      setTimeout(() => this.copied.set(null), 2500);
    }
  }

  protected async shareSpectator(token: string): Promise<void> {
    await this.deliver('spectator', null, spectatorMessage(this.trip()?.name ?? 'the trip', token));
  }

  /** Makes the spectator link, or replaces it: the old link stops working. */
  protected async resetSpectator(): Promise<void> {
    const tripId = this.tripId();
    if (!tripId) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.spectator.set(await this.data.spectatorToken(tripId, 'reset'));
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't reset the link.");
    } finally {
      this.busy.set(false);
      this.resetting.set(false);
    }
  }

  /** Runs a change, then reloads the people. Returns whether it worked. */
  private async run(change: () => Promise<unknown>): Promise<boolean> {
    const tripId = this.tripId();
    if (!tripId) return false;
    this.busy.set(true);
    this.error.set(null);
    try {
      await change();
      this.players.set(await this.data.roster(tripId));
      return true;
    } catch (e) {
      const message =
        e instanceof AdminError
          ? e.message.replace(
              'That is already in use',
              'Someone on the trip already has that name or email',
            )
          : "That didn't save.";
      if (this.sheetOpen()) this.formError.set(message);
      else this.error.set(message);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async load(id: string, sendAll: boolean): Promise<void> {
    try {
      const [trip, role, players] = await Promise.all([
        this.data.trip(id),
        this.data.tripRole(id),
        this.data.roster(id),
      ]);
      this.trip.set(trip);
      this.role.set(role);
      this.players.set(players);
      if (sendAll && this.toInvite().length) {
        this.editing.set(true);
        this.sending.set(0);
      }
      if (trip.status !== 'draft') {
        // The link is a convenience here: the page works without it.
        this.spectator.set(await this.data.spectatorToken(id, 'get').catch(() => null));
      }
    } catch (e) {
      this.error.set(
        e instanceof AdminError ? e.message : "Couldn't load the people on this trip.",
      );
    }
  }
}
