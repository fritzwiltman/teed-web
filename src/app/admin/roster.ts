import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { AuthService } from '../core/auth';
import { Role } from '../core/session';
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
  UiButton,
  UiCard,
  UiChip,
  UiField,
  UiIcon,
  UiListRow,
  UiSectionHead,
  UiSegmented,
  UiSheet,
  UiSkeleton,
} from '../core/ui';
import { AdminData, AdminError, MemberFields, RosterPlayer, Trip, TripRole } from './data';
import { OrganizerHeader } from './organizer-header';

type Form = {
  name: string;
  initials: string;
  email: string;
  phone: string;
  index: string;
  role: Role;
};
const EMPTY: Form = { name: '', initials: '', email: '', phone: '', index: '', role: 'player' };

const ROLE_NAME: Record<Role, string> = {
  organizer: 'Organizer',
  co_organizer: 'Co-organizer',
  player: 'Player',
};

/**
 * People: everyone on the trip, inviting them, their roles, and the spectator link.
 * The organizer and co-organizers both run this screen; only the organizer (or the app admin)
 * chooses co-organizers and removes them.
 */
@Component({
  selector: 'app-roster',
  imports: [
    NgTemplateOutlet,
    OrganizerHeader,
    UiButton,
    UiCard,
    UiChip,
    UiField,
    UiIcon,
    UiListRow,
    UiSectionHead,
    UiSegmented,
    UiSheet,
    UiSkeleton,
  ],
  template: `
    <app-organizer-header title="People" [trip]="trip()" />
    <main class="content">
      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }

      @if (sendingTo(); as p) {
        <ui-card pad aria-label="Text everyone their invite">
          <ui-section-head
            title="Text invites"
            [note]="sending()! + 1 + ' of ' + toInvite().length"
          />
          <p>{{ p.name }}</p>
          <div class="actions">
            <button ui-button size="small" type="button" [disabled]="busy()" (click)="text(p)">
              {{ p.phone ? 'Text' : 'Share with' }} {{ p.name }}
            </button>
            <button ui-button size="small" variant="outline" type="button" (click)="nextSend()">
              {{ sending()! + 1 < toInvite().length ? 'Next' : 'Done' }}
            </button>
          </div>
        </ui-card>
      } @else if (toInvite().length > 1 && !readOnly()) {
        <button ui-button variant="outline" type="button" (click)="sending.set(0)">
          Text everyone their invite
        </button>
      }

      @if (players(); as list) {
        <ui-card aria-label="Players">
          @for (p of list; track p.id) {
            <ui-list-row [title]="p.name" [detail]="detail(p)">
              @if (p.role !== 'player') {
                <ui-chip after-title>{{ roleName(p.role) }}</ui-chip>
              }
              @for (flag of flags(p); track flag) {
                <span below class="warn-text">{{ flag }}</span>
              }
              @if (p.claimed === false && !readOnly()) {
                <button ui-button size="small" type="button" [disabled]="busy()" (click)="text(p)">
                  {{ copied() === p.id ? 'Copied' : 'Text invite' }}
                </button>
              }
              @if (!readOnly()) {
                <button
                  ui-button
                  size="small"
                  variant="outline"
                  type="button"
                  [attr.aria-label]="'More for ' + p.name"
                  (click)="toggle(p)"
                >
                  <ui-icon name="more" />
                </button>
              }
            </ui-list-row>
          }
          @if (!readOnly()) {
            <button
              ui-list-row
              type="button"
              icon="plus"
              title="Add a player"
              (click)="startAdd()"
            ></button>
          }
        </ui-card>
      } @else if (!error()) {
        <ui-skeleton shape="block" height="230px" />
      }

      @if (players() && trip()?.status !== 'draft') {
        <ui-card aria-label="Spectators">
          <ui-section-head title="Spectators" />
          @if (spectator(); as token) {
            <ui-list-row title="Spectator link">
              <button ui-button size="small" type="button" (click)="shareSpectator(token)">
                {{ copied() === 'spectator' ? 'Copied' : 'Share link' }}
              </button>
              @if (!readOnly()) {
                <button
                  ui-button
                  size="small"
                  variant="outline"
                  type="button"
                  [disabled]="busy()"
                  (click)="resetting.set(true)"
                >
                  Reset
                </button>
              }
            </ui-list-row>
          } @else if (!readOnly()) {
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
    </main>

    <ui-sheet [open]="!!menuFor()" (openChange)="closeSheet()" [label]="menuFor()?.name">
      @if (menuFor(); as p) {
        @switch (mode()) {
          @case ('menu') {
            <h2>{{ p.name }}</h2>
            <button ui-button variant="outline" type="button" (click)="startEdit(p)">Edit</button>
            @if (canRemove(p)) {
              <button ui-button variant="outline" type="button" (click)="mode.set('remove')">
                Remove from trip
              </button>
            }
          }
          @case ('edit') {
            <h2>Edit {{ p.name }}</h2>
            <form class="stack" (submit)="saveEdit($event, p)" novalidate>
              <ng-container *ngTemplateOutlet="fields; context: { member: p }" />
              <button ui-button type="submit" [busy]="busy()">Save</button>
              <button ui-button variant="outline" type="button" (click)="mode.set('menu')">
                Cancel
              </button>
            </form>
          }
          @case ('remove') {
            <h2>Remove {{ p.name }}?</h2>
            <p class="detail">
              They come off the trip and out of every group. Scores they already entered stay on the
              scorecards.
            </p>
            @if (formError(); as text) {
              <p class="error-text" role="alert">{{ text }}</p>
            }
            <button ui-button type="button" class="danger" [busy]="busy()" (click)="remove(p)">
              Remove {{ p.name }}
            </button>
            <button ui-button variant="outline" type="button" (click)="mode.set('menu')">
              Cancel
            </button>
          }
        }
      }
    </ui-sheet>

    <ui-sheet [open]="adding()" (openChange)="adding.set(false)" label="Add a player">
      <h2>Add a player</h2>
      <form class="stack" (submit)="saveNew($event)" novalidate>
        <ng-container *ngTemplateOutlet="fields; context: { member: null }" />
        <button ui-button type="submit" [busy]="busy()">Save and text invite</button>
        <button ui-button variant="outline" type="button" (click)="adding.set(false)">
          Cancel
        </button>
      </form>
    </ui-sheet>

    <ui-sheet [(open)]="resetting" label="Reset spectator link">
      <h2>Reset the spectator link?</h2>
      <p class="detail">The link people have now stops working. This can't be undone.</p>
      <button ui-button type="button" class="danger" [busy]="busy()" (click)="resetSpectator()">
        Reset link
      </button>
      <button ui-button variant="outline" type="button" (click)="resetting.set(false)">
        Cancel
      </button>
    </ui-sheet>

    <ng-template #fields let-member="member">
      <div class="pair wide">
        <ui-field label="Name">
          <input name="name" autocomplete="off" [value]="form().name" (input)="setName($event)" />
        </ui-field>
        <ui-field label="Initials">
          <input
            name="initials"
            autocomplete="off"
            autocapitalize="characters"
            maxlength="4"
            [value]="form().initials"
            (input)="setForm('initials', $event)"
          />
        </ui-field>
      </div>
      <ui-field label="Email">
        <input
          name="email"
          type="email"
          inputmode="email"
          autocomplete="off"
          autocapitalize="none"
          [value]="form().email"
          [disabled]="!!member?.claimed"
          (input)="setForm('email', $event)"
        />
      </ui-field>
      <div class="pair wide">
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
      </div>
      @if (owner() && member?.role !== 'organizer') {
        <ui-segmented
          label="Role"
          [options]="roles"
          [value]="form().role"
          (valueChange)="setRole($event)"
        />
      }
      @if (formError(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }
    </ng-template>
  `,
  styles: `
    .danger {
      background: var(--red);
      border-color: var(--red);
      color: #fff;
    }
  `,
})
export class Roster {
  readonly id = input.required<string>();
  /** ?send=all opens "Text everyone their invite" (where Overview sends you after publishing). */
  readonly send = input<string>();

  private readonly data = inject(AdminData);
  private readonly me = inject(AuthService).me;

  protected readonly trip = signal<Trip | null>(null);
  protected readonly players = signal<RosterPlayer[] | null>(null);
  /** The caller's standing on this trip. */
  private readonly role = signal<TripRole | null>(null);
  /** Choosing and removing co-organizers is the organizer's (and the app admin's). */
  protected readonly owner = computed(() => this.role() === 'organizer' || this.role() === 'admin');
  /** The spectator link's token, once one has been made. */
  protected readonly spectator = signal<string | null>(null);
  protected readonly resetting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly readOnly = computed(() => this.trip()?.status === 'final');

  // Whose menu is open, and what it is showing.
  protected readonly open = signal<string | null>(null);
  protected readonly mode = signal<'menu' | 'edit' | 'remove'>('menu');
  protected readonly adding = signal(false);
  protected readonly form = signal<Form>(EMPTY);
  protected readonly formError = signal<string | null>(null);
  private initialsTouched = false;

  protected readonly roles: Choice<Role>[] = [
    { value: 'player', label: 'Player' },
    { value: 'co_organizer', label: 'Co-organizer' },
  ];

  // "Text everyone their invite": the index of the person being texted.
  protected readonly sending = signal<number | null>(null);
  protected readonly toInvite = computed(() =>
    (this.players() ?? []).filter((p) => p.claimed === false),
  );
  protected readonly menuFor = computed(
    () => (this.players() ?? []).find((p) => p.id === this.open()) ?? null,
  );
  protected readonly sendingTo = computed(() => {
    const i = this.sending();
    return i === null ? null : (this.toInvite()[i] ?? null);
  });
  protected readonly copied = signal<string | null>(null);

  constructor() {
    effect(() => void this.load(this.id(), this.send() === 'all'));
  }

  // ── Inviting ───────────────────────────────────────────────────────────────

  /** Texts someone a fresh invite link (the one sent before stops working). */
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

  private inviteText(token: string): string {
    return inviteMessage(this.me()?.display_name ?? '', this.trip()?.name ?? 'a golf trip', token);
  }

  private async deliver(id: string, phone: string | null, message: string): Promise<void> {
    if ((await sendText(phone, message)) === 'copied') {
      this.copied.set(id);
      setTimeout(() => this.copied.set(null), 2500);
    }
  }

  protected nextSend(): void {
    const next = (this.sending() ?? 0) + 1;
    this.sending.set(next < this.toInvite().length ? next : null);
  }

  protected async shareSpectator(token: string): Promise<void> {
    await this.deliver('spectator', null, spectatorMessage(this.trip()?.name ?? 'the trip', token));
  }

  /** Makes the spectator link, or replaces it: the old link stops working. */
  protected async resetSpectator(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.spectator.set(await this.data.spectatorToken(this.id(), 'reset'));
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't reset the link.");
    } finally {
      this.busy.set(false);
      this.resetting.set(false);
    }
  }

  // ── Rows ───────────────────────────────────────────────────────────────────

  protected roleName(role: Role): string {
    return ROLE_NAME[role];
  }

  /** "Index 18.6" */
  protected detail(player: RosterPlayer): string {
    return player.handicap_index === null ? '' : `Index ${player.handicap_index}`;
  }

  /** The "!" flags, from the data: only the organizer, co-organizers and the app admin get them. */
  protected flags(player: RosterPlayer): string[] {
    const f = player.flags;
    if (!f) return [];
    return [
      f.not_claimed && (f.no_email ? 'No email yet' : 'Not joined yet'),
      f.not_paid && 'Buy-in not paid',
    ].filter((text): text is string => !!text);
  }

  /** Players by anyone running the trip; co-organizers by the organizer; the organizer never. */
  protected canRemove(player: RosterPlayer): boolean {
    return player.role === 'player' || (player.role === 'co_organizer' && this.owner());
  }

  // ── Menu and forms ─────────────────────────────────────────────────────────

  protected closeSheet(): void {
    this.open.set(null);
    this.mode.set('menu');
  }

  protected toggle(player: RosterPlayer): void {
    this.open.set(this.open() === player.id ? null : player.id);
    this.mode.set('menu');
    this.adding.set(false);
    this.formError.set(null);
  }

  protected startAdd(): void {
    this.open.set(null);
    this.resetForm(EMPTY);
    this.adding.set(true);
  }

  protected startEdit(player: RosterPlayer): void {
    this.resetForm({
      name: player.name,
      initials: player.initials,
      email: player.email ?? '',
      phone: player.phone ? formatPhone(player.phone) : '',
      index: player.handicap_index === null ? '' : String(player.handicap_index),
      role: player.role,
    });
    this.initialsTouched = true;
    this.mode.set('edit');
  }

  private resetForm(form: Form): void {
    this.form.set(form);
    this.formError.set(null);
    this.initialsTouched = false;
  }

  protected setName(event: Event): void {
    const name = (event.target as HTMLInputElement).value;
    // Suggest initials until they are typed by hand.
    this.form.update((f) => ({
      ...f,
      name,
      initials: this.initialsTouched ? f.initials : initialsFor(name),
    }));
    this.formError.set(null);
  }

  protected setForm(key: Exclude<keyof Form, 'role'>, event: Event): void {
    const input = event.target as HTMLInputElement;
    if (key === 'initials') {
      input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '');
      this.initialsTouched = true;
    }
    this.form.update((f) => ({ ...f, [key]: input.value }));
    this.formError.set(null);
  }

  protected setRole(role: Role | null): void {
    this.form.update((f) => ({ ...f, role: role ?? 'player' }));
  }

  /** Checks the form. Returns the fields to save, or null after setting the message. */
  private read(): MemberFields | null {
    const f = this.form();
    const name = f.name.trim();
    const email = f.email.trim().toLowerCase() || null;
    const phone = f.phone.trim() ? tidyPhone(f.phone) : null;
    const index = f.index.trim() === '' ? null : Number(f.index.replace('+', '-'));
    const problem = !name
      ? 'Enter a name.'
      : !/^[A-Z]{1,4}$/.test(f.initials)
        ? 'Initials are 1 to 4 letters.'
        : email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)
          ? "That doesn't look like an email address."
          : f.phone.trim() && !phone
            ? "That doesn't look like a mobile number."
            : index !== null && (Number.isNaN(index) || index < -9.9 || index > 54)
              ? 'A handicap index is a number up to 54.0.'
              : null;
    this.formError.set(problem);
    return problem
      ? null
      : {
          name,
          initials: f.initials,
          email,
          phone,
          handicap_index: index === null ? null : Math.round(index * 10) / 10,
          role: f.role,
        };
  }

  /** "Save and text invite": adds them, then opens the text with their link. */
  protected async saveNew(event: Event): Promise<void> {
    event.preventDefault();
    const fields = this.read();
    if (!fields) return;
    let added: { id: string; token: string | null } | null = null;
    const done = await this.run(async () => {
      added = await this.data.addMember(this.id(), fields);
    });
    if (!done) return;
    this.adding.set(false);
    // No link to send when their email already had an account: they are on the trip already.
    const invite = added as { id: string; token: string | null } | null;
    if (invite?.token) await this.deliver(invite.id, fields.phone, this.inviteText(invite.token));
  }

  protected async saveEdit(event: Event, player: RosterPlayer): Promise<void> {
    event.preventDefault();
    const fields = this.read();
    if (!fields) return;
    if (await this.run(() => this.data.updateMember(player, fields))) this.open.set(null);
  }

  protected async remove(player: RosterPlayer): Promise<void> {
    if (await this.run(() => this.data.removeMember(player.id))) this.closeSheet();
  }

  /** Runs a change, then reloads the people. Returns whether it worked. */
  private async run(change: () => Promise<unknown>): Promise<boolean> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await change();
      await this.reload(this.id());
      return true;
    } catch (e) {
      const message =
        e instanceof AdminError
          ? e.message.replace(
              'That is already in use',
              'Someone on the trip already has that name or email',
            )
          : "That didn't save.";
      if (this.adding() || this.mode() !== 'menu') this.formError.set(message);
      else this.error.set(message);
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async load(id: string, sendAll: boolean): Promise<void> {
    try {
      const [trip, role] = await Promise.all([this.data.trip(id), this.data.tripRole(id)]);
      this.trip.set(trip);
      this.role.set(role);
      await this.reload(id);
      if (sendAll && this.toInvite().length) this.sending.set(0);
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

  private async reload(id: string): Promise<void> {
    this.players.set(await this.data.roster(id));
  }
}
