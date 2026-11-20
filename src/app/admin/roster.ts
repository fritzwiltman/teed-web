import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  UiButton,
  UiCard,
  UiChip,
  UiField,
  UiIcon,
  UiListRow,
  UiSectionHead,
  UiSheet,
  UiSkeleton,
  UiSwitch,
} from '../core/ui';
import { displayCode } from '../core/code';
import { AdminAuth } from './auth';
import { OrganizerHeader } from './organizer-header';
import {
  linkMessage,
  formatPhone,
  initialsFor,
  smsLink,
  spectatorMessage,
  tidyPhone,
} from '../core/sms';
import { AdminData, AdminError, PlayerFields, RosterPlayer, SpectatorCode, Trip } from './data';

type Form = { name: string; initials: string; phone: string; index: string };
const EMPTY: Form = { name: '', initials: '', phone: '', index: '' };

/** People: the players, texting each their link, and the spectator link. */
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
    UiSheet,
    UiSkeleton,
    UiSwitch,
  ],
  template: `
    <app-organizer-header title="People" [trip]="trip()" />
    <main class="content">
      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }

      @if (sendingTo(); as p) {
        <ui-card pad aria-label="Text everyone their link">
          <ui-section-head
            title="Text links"
            [note]="sending()! + 1 + ' of ' + withCodes().length"
          />
          <p>{{ p.name }}</p>
          <div class="actions">
            <button ui-button size="small" type="button" (click)="text(p)">
              {{ p.phone ? 'Text' : 'Share with' }} {{ p.name }}
            </button>
            <button ui-button size="small" variant="outline" type="button" (click)="nextSend()">
              {{ sending()! + 1 < withCodes().length ? 'Next' : 'Done' }}
            </button>
          </div>
        </ui-card>
      } @else if (owner() && withCodes().length > 1 && !readOnly()) {
        <button ui-button variant="outline" type="button" (click)="sending.set(0)">
          Text everyone their link
        </button>
      }

      @if (players(); as list) {
        <ui-card aria-label="Players">
          @for (p of list; track p.id) {
            <ui-list-row [title]="p.name" [detail]="detail(p)">
              @if (trip()?.owner_player_id === p.id) {
                <ui-chip after-title>Owner</ui-chip>
              }
              @if (p.role === 'co_admin') {
                <ui-chip after-title>Co-admin</ui-chip>
              }
              @if (!p.index_entered_at) {
                <span below class="warn-text">Index not confirmed</span>
              }
              @if (p.code) {
                <button ui-button size="small" type="button" (click)="text(p)">
                  {{ copied() === p.id ? 'Copied' : 'Text link' }}
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
          @if (owner() && !readOnly()) {
            <button
              ui-list-row
              type="button"
              icon="plus"
              title="Add player"
              (click)="startAdd()"
            ></button>
          }
        </ui-card>
      } @else if (!error()) {
        <ui-skeleton shape="block" height="230px" />
      }

      @if (owner() && players()) {
        <ui-card aria-label="Spectators">
          <ui-section-head title="Spectators" />
          @if (spectator(); as s) {
            <ui-list-row [title]="shown(s.code)">
              @if (s.enabled) {
                <button ui-button size="small" type="button" (click)="shareSpectator(s)">
                  {{ copied() === s.id ? 'Copied' : 'Share link' }}
                </button>
              }
              @if (!readOnly()) {
                <ui-switch
                  label="Spectator link"
                  [checked]="s.enabled"
                  [disabled]="busy()"
                  (checkedChange)="setSpectator(s, $event)"
                />
              }
            </ui-list-row>
          } @else if (!readOnly()) {
            <button
              ui-list-row
              type="button"
              icon="plus"
              title="Create spectator link"
              [disabled]="busy()"
              (click)="createSpectator()"
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
            @if (owner()) {
              <button ui-button variant="outline" type="button" (click)="startReplace()">
                Replace player
              </button>
              <button
                ui-button
                variant="outline"
                type="button"
                [disabled]="busy()"
                (click)="regenerate(p)"
              >
                New code
              </button>
              <button
                ui-button
                variant="outline"
                type="button"
                [disabled]="busy()"
                (click)="toggleCoAdmin(p)"
              >
                {{ p.role === 'co_admin' ? 'Remove co-admin' : 'Make co-admin' }}
              </button>
              @if (trip()?.owner_player_id !== p.id) {
                <button
                  ui-button
                  variant="outline"
                  type="button"
                  [disabled]="busy()"
                  (click)="thisIsMe(p)"
                >
                  This is me
                </button>
              }
            }
          }
          @case ('edit') {
            <h2>Edit {{ p.name }}</h2>
            <form class="stack" (submit)="saveEdit($event, p)" novalidate>
              <ng-container *ngTemplateOutlet="fields; context: { full: true }" />
              <button ui-button type="submit" [busy]="busy()">Save</button>
              <button ui-button variant="outline" type="button" (click)="mode.set('menu')">
                Cancel
              </button>
            </form>
          }
          @case ('replace') {
            <h2>Replace {{ p.name }}</h2>
            <form class="stack" (submit)="saveReplace($event, p)" novalidate>
              <ng-container *ngTemplateOutlet="fields; context: { full: false }" />
              <button ui-button type="submit" [busy]="busy()">Replace</button>
              <button ui-button variant="outline" type="button" (click)="mode.set('menu')">
                Cancel
              </button>
            </form>
          }
        }
      }
    </ui-sheet>

    <ui-sheet [open]="adding()" (openChange)="adding.set(false)" label="Add player">
      <h2>Add player</h2>
      <form class="stack" (submit)="saveNew($event)" novalidate>
        <ng-container *ngTemplateOutlet="fields; context: { full: true }" />
        <button ui-button type="submit" [busy]="busy()">Add player</button>
        <button ui-button variant="outline" type="button" (click)="adding.set(false)">
          Cancel
        </button>
      </form>
    </ui-sheet>

    <ng-template #fields let-full="full">
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
      @if (full) {
        <div class="pair wide">
          @if (owner()) {
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
          }
          <ui-field label="Index">
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
      }
      @if (formError(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }
    </ng-template>
  `,
})
export class Roster {
  readonly id = input.required<string>();
  /** ?send=all opens "Text everyone their link" (where Overview sends you after going live). */
  readonly send = input<string>();

  private readonly data = inject(AdminData);
  private readonly auth = inject(AdminAuth);

  /** Codes, links, phone numbers, adding and replacing players are the owner's; a co-admin edits. */
  protected readonly owner = this.auth.isOrganizer;

  protected readonly trip = signal<Trip | null>(null);
  protected readonly players = signal<RosterPlayer[] | null>(null);
  protected readonly spectator = signal<SpectatorCode | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly readOnly = computed(() => this.trip()?.status === 'final');

  // Which player's menu is open, and what it is showing.
  protected readonly open = signal<string | null>(null);
  protected readonly mode = signal<'menu' | 'edit' | 'replace'>('menu');
  protected readonly adding = signal(false);
  protected readonly form = signal<Form>(EMPTY);
  protected readonly formError = signal<string | null>(null);
  private initialsTouched = false;

  // "Text all codes": the index of the player being texted.
  protected readonly sending = signal<number | null>(null);
  protected readonly withCodes = computed(() => (this.players() ?? []).filter((p) => p.code));
  protected readonly menuFor = computed(
    () => (this.players() ?? []).find((p) => p.id === this.open()) ?? null,
  );
  protected readonly sendingTo = computed(() => {
    const i = this.sending();
    return i === null ? null : (this.withCodes()[i] ?? null);
  });
  protected readonly copied = signal<string | null>(null);

  constructor() {
    effect(() => void this.load(this.id(), this.send() === 'all'));
  }

  // ── Sending codes ──────────────────────────────────────────────────────────

  protected async text(player: RosterPlayer): Promise<void> {
    if (!player.code) return;
    const message = linkMessage(this.trip()?.name ?? 'the trip', player.code);
    if (player.phone) {
      location.href = smsLink(player.phone, message);
    } else {
      await this.share(message, player.id);
    }
  }

  protected async shareSpectator(code: SpectatorCode): Promise<void> {
    await this.share(spectatorMessage(this.trip()?.name ?? 'the trip', code.code), code.id);
  }

  /** The phone's share sheet; where there isn't one, the message is copied instead. */
  private async share(message: string, id: string): Promise<void> {
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ text: message });
      } else {
        await navigator.clipboard.writeText(message);
        this.copied.set(id);
        setTimeout(() => this.copied.set(null), 2500);
      }
    } catch {
      // they closed the share sheet
    }
  }

  protected nextSend(): void {
    const next = (this.sending() ?? 0) + 1;
    this.sending.set(next < this.withCodes().length ? next : null);
  }

  // ── Menu and forms ─────────────────────────────────────────────────────────

  /** "K4M9QT · Index 18.6": the code (owner only) and the handicap index. */
  protected detail(player: RosterPlayer): string {
    return [
      player.code && displayCode(player.code),
      player.handicap_index === null ? null : `Index ${player.handicap_index}`,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  protected readonly shown = displayCode;

  protected closeSheet(): void {
    this.open.set(null);
    this.mode.set('menu');
  }

  protected toggle(player: RosterPlayer): void {
    this.open.set(this.open() === player.id ? null : player.id);
    this.mode.set('menu');
    this.adding.set(false);
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
      phone: player.phone ? formatPhone(player.phone) : '',
      index: player.handicap_index === null ? '' : String(player.handicap_index),
    });
    this.initialsTouched = true;
    this.mode.set('edit');
  }

  protected startReplace(): void {
    this.resetForm(EMPTY);
    this.mode.set('replace');
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

  protected setForm(key: keyof Form, event: Event): void {
    const input = event.target as HTMLInputElement;
    if (key === 'initials') {
      input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '');
      this.initialsTouched = true;
    }
    this.form.update((f) => ({ ...f, [key]: input.value }));
    this.formError.set(null);
  }

  /** Checks the form. Returns the fields to save, or null after setting the message. */
  private read(full: boolean): PlayerFields | null {
    const f = this.form();
    const name = f.name.trim();
    const phone = f.phone.trim() ? tidyPhone(f.phone) : null;
    const index = f.index.trim() === '' ? null : Number(f.index.replace('+', '-'));
    const problem = !name
      ? 'Enter a name.'
      : !/^[A-Z]{1,4}$/.test(f.initials)
        ? 'Initials are 1 to 4 letters.'
        : full && f.phone.trim() && !phone
          ? "That doesn't look like a mobile number."
          : full && index !== null && (Number.isNaN(index) || index < -9.9 || index > 54)
            ? 'A handicap index is a number up to 54.0.'
            : null;
    this.formError.set(problem);
    return problem
      ? null
      : {
          name,
          initials: f.initials,
          phone,
          handicap_index: index === null ? null : Math.round(index * 10) / 10,
        };
  }

  protected async saveNew(event: Event): Promise<void> {
    event.preventDefault();
    const fields = this.read(true);
    if (!fields) return;
    const order = Math.max(0, ...(this.players() ?? []).map((p) => p.sort_order)) + 1;
    if (await this.run(() => this.data.addPlayer(this.id(), fields, order))) this.adding.set(false);
  }

  protected async saveEdit(event: Event, player: RosterPlayer): Promise<void> {
    event.preventDefault();
    const fields = this.read(true);
    if (!fields) return;
    if (await this.run(() => this.data.updatePlayer(player.id, fields))) this.open.set(null);
  }

  protected async saveReplace(event: Event, player: RosterPlayer): Promise<void> {
    event.preventDefault();
    const fields = this.read(false);
    if (!fields) return;
    if (await this.run(() => this.data.replacePlayer(player.id, fields.name, fields.initials)))
      this.open.set(null);
  }

  protected async regenerate(player: RosterPlayer): Promise<void> {
    if (await this.run(() => this.data.regenerateCode(player.id))) this.open.set(null);
  }

  protected async toggleCoAdmin(player: RosterPlayer): Promise<void> {
    if (
      await this.run(() =>
        this.data.setRole(player.id, player.role === 'co_admin' ? 'player' : 'co_admin'),
      )
    )
      this.open.set(null);
  }

  /** Marks this player as the organizer's own: on their sign-in, they are this player. */
  protected async thisIsMe(player: RosterPlayer): Promise<void> {
    const done = await this.run(async () =>
      this.trip.set(await this.data.updateTrip(this.id(), { owner_player_id: player.id })),
    );
    if (done) this.open.set(null);
  }

  protected async createSpectator(): Promise<void> {
    await this.run(() => this.data.issueSpectatorCode(this.id()));
  }

  protected async setSpectator(code: SpectatorCode, enabled: boolean): Promise<void> {
    await this.run(() => this.data.setSpectatorEnabled(code.id, enabled));
  }

  /** Runs a change, then reloads the roster. Returns whether it worked. */
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
          ? e.message.replace('That is already in use', 'Another player already has that name')
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
      this.trip.set(await this.data.trip(id));
      await this.reload(id);
      if (sendAll && this.withCodes().length) this.sending.set(0);
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't load the roster.");
    }
  }

  private async reload(id: string): Promise<void> {
    const [players, spectator] = await Promise.all([
      this.data.roster(id),
      this.owner() ? this.data.spectatorCode(id) : null,
    ]);
    this.players.set(players);
    this.spectator.set(spectator);
  }
}
