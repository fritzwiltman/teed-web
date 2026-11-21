import { Component, inject, signal } from '@angular/core';
import { AuthService } from '../core/auth';
import { creatorInviteMessage, formatPhone, sendText, tidyPhone } from '../core/sms';
import {
  UiButton,
  UiCard,
  UiField,
  UiHeaderBand,
  UiListRow,
  UiSectionHead,
  UiSheet,
  UiSkeleton,
} from '../core/ui';
import { AdminData, AdminError, TripCreator } from './data';

/**
 * Trip creators: who may create trips. The app admin adds a name and a phone number and texts
 * the invite; signing in from it makes that person a trip creator.
 */
@Component({
  selector: 'app-creators',
  imports: [UiButton, UiCard, UiField, UiHeaderBand, UiListRow, UiSectionHead, UiSheet, UiSkeleton],
  template: `
    <ui-header-band title="Trip creators" back="/you" [backLabel]="me()?.display_name || 'You'" />
    <main class="content">
      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }
      @if (creators(); as list) {
        <ui-card aria-label="Trip creators">
          <ui-section-head title="Trip creators" [note]="'' + list.length" />
          @for (c of list; track c.id) {
            <ui-list-row [title]="c.name" [detail]="detail(c)">
              @if (!c.claimed_at) {
                <button ui-button size="small" type="button" [disabled]="busy()" (click)="text(c)">
                  {{ copied() === c.id ? 'Copied' : 'Text invite' }}
                </button>
              }
              <button
                ui-button
                size="small"
                variant="outline"
                type="button"
                [disabled]="busy()"
                (click)="remove(c)"
              >
                Remove
              </button>
            </ui-list-row>
          }
          <button
            ui-list-row
            type="button"
            icon="plus"
            title="Add a trip creator"
            (click)="startAdd()"
          ></button>
        </ui-card>
      } @else if (!error()) {
        <ui-skeleton shape="block" height="130px" />
      }
    </main>

    <ui-sheet [(open)]="adding" label="Add a trip creator">
      <h2>Add a trip creator</h2>
      <form class="stack" (submit)="save($event)" novalidate>
        <ui-field label="Name">
          <input name="name" autocomplete="off" [value]="name()" (input)="type(name, $event)" />
        </ui-field>
        <ui-field label="Phone">
          <input
            name="phone"
            type="tel"
            inputmode="tel"
            autocomplete="off"
            [value]="phone()"
            (input)="type(phone, $event)"
          />
        </ui-field>
        @if (formError(); as text) {
          <p class="error-text" role="alert">{{ text }}</p>
        }
        <button ui-button type="submit" [busy]="busy()">
          Text {{ name().trim() || 'them' }} an invite
        </button>
      </form>
    </ui-sheet>
  `,
})
export class Creators {
  private readonly data = inject(AdminData);
  protected readonly me = inject(AuthService).me;

  protected readonly creators = signal<TripCreator[] | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly copied = signal<string | null>(null);

  protected readonly adding = signal(false);
  protected readonly name = signal('');
  protected readonly phone = signal('');
  protected readonly formError = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  /** Their email once they have signed in; until then, the number the invite goes to. */
  protected detail(creator: TripCreator): string {
    return creator.email ?? (creator.phone ? formatPhone(creator.phone) : '');
  }

  protected startAdd(): void {
    this.name.set('');
    this.phone.set('');
    this.formError.set(null);
    this.adding.set(true);
  }

  protected type(field: { set(value: string): void }, event: Event): void {
    field.set((event.target as HTMLInputElement).value);
    this.formError.set(null);
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.name().trim();
    const phone = this.phone().trim() ? tidyPhone(this.phone()) : null;
    const problem = !name
      ? 'Enter a name.'
      : this.phone().trim() && !phone
        ? "That doesn't look like a phone number."
        : null;
    this.formError.set(problem);
    if (problem || this.busy()) return;

    this.busy.set(true);
    try {
      const token = await this.data.addCreator(name, phone);
      this.adding.set(false);
      await this.load();
      await sendText(phone, this.message(token));
    } catch (e) {
      this.formError.set(e instanceof AdminError ? e.message : "That didn't save.");
    } finally {
      this.busy.set(false);
    }
  }

  /** Texts a fresh invite link (the one sent before stops working). */
  protected async text(creator: TripCreator): Promise<void> {
    await this.run(async () => {
      const token = await this.data.inviteCreator(creator.id);
      if ((await sendText(creator.phone, this.message(token))) === 'copied') {
        this.copied.set(creator.id);
        setTimeout(() => this.copied.set(null), 2500);
      }
    });
  }

  protected async remove(creator: TripCreator): Promise<void> {
    await this.run(async () => {
      await this.data.removeCreator(creator.id);
      await this.load();
    });
  }

  private message(token: string): string {
    return creatorInviteMessage(this.me()?.display_name ?? '', token);
  }

  private async run(change: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await change();
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "That didn't work.");
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.creators.set(await this.data.creators());
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't load the trip creators.");
    }
  }
}
