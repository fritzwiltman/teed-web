import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  codeMessage,
  formatPhone,
  initialsFor,
  smsLink,
  spectatorMessage,
  tidyPhone,
} from '../core/sms';
import { AdminData, AdminError, PlayerFields, RosterPlayer, SpectatorCode, Trip } from './data';

type Form = { name: string; initials: string; phone: string; index: string };
const EMPTY: Form = { name: '', initials: '', phone: '', index: '' };

/** Roster and codes: players, their login codes, texting them, and the spectator code. */
@Component({
  selector: 'app-roster',
  imports: [RouterLink, NgTemplateOutlet],
  template: `
    <main class="page">
      <a class="back" [routerLink]="['/admin/trips', id()]">‹ Trip</a>
      <h1>Roster and codes</h1>

      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }

      @if (sendingTo(); as p) {
        <section class="card" aria-label="Text all codes">
          <div class="row">
            <span class="label">Text codes · {{ sending()! + 1 }} of {{ withCodes().length }}</span>
          </div>
          <div class="row">
            <span class="who">
              <strong>{{ p.name }}</strong>
              <span class="mono">{{ p.code }}</span>
            </span>
          </div>
          <div class="row actions">
            <button type="button" class="button small" (click)="text(p)">
              {{ p.phone ? 'Text' : 'Share' }} {{ p.name }}
            </button>
            <button type="button" class="button small quiet" (click)="nextSend()">
              {{ sending()! + 1 < withCodes().length ? 'Next' : 'Done' }}
            </button>
          </div>
        </section>
      } @else if (withCodes().length > 1 && !readOnly()) {
        <button type="button" class="button" (click)="sending.set(0)">Text all codes</button>
      }

      <section class="card" aria-label="Players">
        @for (p of players(); track p.id) {
          <div class="row player">
            <span class="who">
              <strong>
                {{ p.name }}
                @if (trip()?.owner_player_id === p.id) {
                  <span class="label"> · Owner</span>
                }
                @if (p.role === 'co_admin') {
                  <span class="label"> · Co-admin</span>
                }
              </strong>
              <span class="mono">{{ p.code ?? '–' }}</span>
              <span class="label">
                @if (p.handicap_index !== null) {
                  Index {{ p.handicap_index }}
                }
                @if (!p.index_entered_at) {
                  <span class="warn"
                    >{{ p.handicap_index !== null ? ' · ' : '' }}Index not confirmed</span
                  >
                }
              </span>
            </span>
            <span class="actions">
              @if (p.code) {
                <button type="button" class="button small" (click)="text(p)">
                  {{ copied() === p.id ? 'Copied' : 'Text code' }}
                </button>
              }
              @if (!readOnly()) {
                <button
                  type="button"
                  class="button small quiet"
                  [attr.aria-expanded]="open() === p.id"
                  [attr.aria-label]="'More for ' + p.name"
                  (click)="toggle(p)"
                >
                  ⋯
                </button>
              }
            </span>
          </div>

          @if (open() === p.id) {
            <div class="row stack">
              @switch (mode()) {
                @case ('menu') {
                  <div class="actions">
                    <button type="button" class="button small quiet" (click)="startEdit(p)">
                      Edit
                    </button>
                    <button type="button" class="button small quiet" (click)="startReplace()">
                      Replace player
                    </button>
                    <button
                      type="button"
                      class="button small quiet"
                      [disabled]="busy()"
                      (click)="regenerate(p)"
                    >
                      New code
                    </button>
                    <button
                      type="button"
                      class="button small quiet"
                      [disabled]="busy()"
                      (click)="toggleCoAdmin(p)"
                    >
                      {{ p.role === 'co_admin' ? 'Remove co-admin' : 'Make co-admin' }}
                    </button>
                    @if (trip()?.owner_player_id !== p.id) {
                      <button
                        type="button"
                        class="button small quiet"
                        [disabled]="busy()"
                        (click)="thisIsMe(p)"
                      >
                        This is me
                      </button>
                    }
                  </div>
                }
                @case ('edit') {
                  <form class="form" (submit)="saveEdit($event, p)" novalidate>
                    <ng-container *ngTemplateOutlet="fields; context: { full: true }" />
                    <div class="actions">
                      <button class="button small" type="submit" [disabled]="busy()">Save</button>
                      <button type="button" class="button small quiet" (click)="mode.set('menu')">
                        Cancel
                      </button>
                    </div>
                  </form>
                }
                @case ('replace') {
                  <form class="form" (submit)="saveReplace($event, p)" novalidate>
                    <p>
                      {{ p.name }}'s code stops working. The new player gets a new code and keeps
                      this spot in the groups.
                    </p>
                    <ng-container *ngTemplateOutlet="fields; context: { full: false }" />
                    <div class="actions">
                      <button class="button small" type="submit" [disabled]="busy()">
                        Replace
                      </button>
                      <button type="button" class="button small quiet" (click)="mode.set('menu')">
                        Cancel
                      </button>
                    </div>
                  </form>
                }
              }
            </div>
          }
        }

        @if (!readOnly()) {
          @if (adding()) {
            <div class="row stack">
              <form class="form" (submit)="saveNew($event)" novalidate>
                <ng-container *ngTemplateOutlet="fields; context: { full: true }" />
                <div class="actions">
                  <button class="button small" type="submit" [disabled]="busy()">Add player</button>
                  <button type="button" class="button small quiet" (click)="adding.set(false)">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          } @else {
            <button type="button" class="row" (click)="startAdd()">
              <span>+ Add player</span>
            </button>
          }
        }
      </section>

      <section class="card" aria-label="Spectator code">
        <div class="row"><span class="label">Spectator code</span></div>
        @if (spectator(); as s) {
          <div class="row player">
            <span class="who">
              <span class="mono" [class.off]="!s.enabled">{{ s.code }}</span>
            </span>
            <span class="actions">
              @if (s.enabled) {
                <button type="button" class="button small" (click)="shareSpectator(s)">
                  {{ copied() === s.id ? 'Copied' : 'Share' }}
                </button>
              }
              @if (!readOnly()) {
                <label class="switch">
                  <input
                    type="checkbox"
                    [checked]="s.enabled"
                    [disabled]="busy()"
                    (change)="setSpectator(s, $event)"
                  />
                  <span class="label">{{ s.enabled ? 'On' : 'Off' }}</span>
                </label>
              }
            </span>
          </div>
        } @else if (!readOnly()) {
          <button type="button" class="row" [disabled]="busy()" (click)="createSpectator()">
            <span>+ Create spectator code</span>
          </button>
        }
      </section>

      <ng-template #fields let-full="full">
        <div class="pair wide">
          <label class="field">
            <span class="label">Name</span>
            <input
              class="input"
              name="name"
              autocomplete="off"
              [value]="form().name"
              (input)="setName($event)"
            />
          </label>
          <label class="field">
            <span class="label">Initials</span>
            <input
              class="input mono"
              name="initials"
              autocomplete="off"
              autocapitalize="characters"
              maxlength="4"
              [value]="form().initials"
              (input)="setForm('initials', $event)"
            />
          </label>
        </div>
        @if (full) {
          <div class="pair wide">
            <label class="field">
              <span class="label">Mobile</span>
              <input
                class="input"
                name="phone"
                type="tel"
                inputmode="tel"
                autocomplete="off"
                [value]="form().phone"
                (input)="setForm('phone', $event)"
              />
            </label>
            <label class="field">
              <span class="label">Index</span>
              <input
                class="input mono"
                name="index"
                inputmode="decimal"
                autocomplete="off"
                placeholder="18.6"
                [value]="form().index"
                (input)="setForm('index', $event)"
              />
            </label>
          </div>
        }
        @if (formError(); as text) {
          <p class="error-text" role="alert">{{ text }}</p>
        }
      </ng-template>
    </main>
  `,
  styles: `
    .player {
      align-items: center;
    }
    .who {
      display: flex;
      flex-direction: column;
      gap: 0.1rem;
      min-width: 0;
    }
    .who strong {
      font-family: var(--font-heading);
      font-size: 1.1rem;
    }
    .who .mono {
      font-weight: 500;
      letter-spacing: 0.03em;
    }
    .who .off {
      text-decoration: line-through;
      color: var(--muted);
    }
    .warn {
      color: var(--amber);
    }
    .actions {
      flex-wrap: nowrap;
      align-items: center;
    }
    .stack .actions {
      flex-wrap: wrap;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: 0.7rem;
    }
    .pair.wide {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 0.6rem;
    }
    .switch {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      min-height: 2.75rem;
    }
    .switch input {
      width: 1.5rem;
      height: 1.5rem;
      accent-color: var(--pine);
    }
  `,
})
export class Roster {
  readonly id = input.required<string>();
  /** ?send=all opens "Text all codes" (where Admin home sends you after setting the trip live). */
  readonly send = input<string>();

  private readonly data = inject(AdminData);

  protected readonly trip = signal<Trip | null>(null);
  protected readonly players = signal<RosterPlayer[]>([]);
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
  protected readonly withCodes = computed(() => this.players().filter((p) => p.code));
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
    const message = codeMessage(this.trip()?.name ?? 'the trip', player.code);
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
    const order = Math.max(0, ...this.players().map((p) => p.sort_order)) + 1;
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

  /** Marks this player as the organizer's own, so their trip home says Owner. It grants nothing. */
  protected async thisIsMe(player: RosterPlayer): Promise<void> {
    const done = await this.run(async () =>
      this.trip.set(await this.data.updateTrip(this.id(), { owner_player_id: player.id })),
    );
    if (done) this.open.set(null);
  }

  protected async createSpectator(): Promise<void> {
    await this.run(() => this.data.issueSpectatorCode(this.id()));
  }

  protected async setSpectator(code: SpectatorCode, event: Event): Promise<void> {
    await this.run(() =>
      this.data.setSpectatorEnabled(code.id, (event.target as HTMLInputElement).checked),
    );
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
      this.data.spectatorCode(id),
    ]);
    this.players.set(players);
    this.spectator.set(spectator);
  }
}
