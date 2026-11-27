import { NgTemplateOutlet } from '@angular/common';
import { Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SignInForm } from '../auth/sign-in-form';
import { AuthService } from '../core/auth';
import { formatDateRange } from '../core/format';
import { InstallService } from '../core/install';
import { SessionService } from '../core/session';
import { SUPABASE } from '../core/supabase';
import { UiButton, UiLogo, UiSkeleton } from '../core/ui';

/** What the `invite` function says about a link before the person has signed in. */
export type InvitePreview =
  | {
      kind: 'trip';
      inviter: string | null;
      name: string;
      email: string | null;
      trip: { name: string; start_date: string; end_date: string; players: number };
    }
  | { kind: 'creator'; inviter: string | null; name: string };

/** Shown once the invite is taken up: "You're in", and the way on to the trip. */
interface Joined {
  next: string;
  label: string;
  /** The trip's name, when a player can't open it yet because it isn't published. */
  waiting?: string;
}

/**
 * The texted invite link: "Fritz invited you to Southern Pines 2026", the email field (filled in
 * if the organizer knew it), then the code. Once signed in, the invite is claimed: the person is
 * on the trip ("You're in", then its Home), or may now create trips.
 */
@Component({
  selector: 'app-invite',
  imports: [NgTemplateOutlet, RouterLink, SignInForm, UiButton, UiLogo, UiSkeleton],
  template: `
    <main class="content">
      <ui-logo class="lockup" [size]="40" />
      @if (problem(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
        <a ui-button variant="outline" routerLink="/">Open Teed</a>
      } @else if (joined(); as j) {
        <div>
          <h1>You're in{{ auth.me()?.display_name ? ', ' + auth.me()?.display_name : '' }}</h1>
          @if (j.waiting) {
            <p class="facts">{{ j.waiting }} opens once it's published.</p>
          }
        </div>
        <a ui-button [routerLink]="j.next">{{ j.label }}</a>
      } @else if (preview(); as p) {
        @if (auth.me(); as me) {
          <ng-container *ngTemplateOutlet="heading" />
          <button ui-button type="button" [busy]="busy()" (click)="claim()">
            Continue as {{ me.display_name || me.email }}
          </button>
        } @else {
          <app-sign-in-form [email]="p.kind === 'trip' ? p.email : null" (done)="claim()">
            <ng-container *ngTemplateOutlet="heading" />
          </app-sign-in-form>
        }
        <ng-template #heading>
          <div>
            <p class="lead">
              {{ p.inviter ? p.inviter + ' invited you to' : "You're invited to" }}
            </p>
            @if (p.kind === 'trip') {
              <h1>{{ p.trip.name }}</h1>
              <p class="facts">{{ facts(p) }}</p>
            } @else {
              <h1>Plan golf trips on Teed</h1>
            }
          </div>
        </ng-template>
      } @else {
        <ui-skeleton shape="block" height="150px" />
      }
    </main>
  `,
  styles: `
    .content {
      min-height: 100dvh;
      padding: calc(96px + env(safe-area-inset-top)) var(--s5)
        calc(var(--s5) + env(safe-area-inset-bottom));
      gap: var(--s5);
    }
    .lockup {
      align-self: flex-start;
    }
    .lead {
      font-size: 15px;
      color: var(--muted);
    }
    h1 {
      font-size: 32px;
    }
    .facts {
      margin-top: var(--s1);
      font-size: 16px;
      font-weight: 500;
      color: var(--ink-2);
    }
  `,
})
export class Invite {
  readonly token = input.required<string>();

  private readonly supabase = inject(SUPABASE);
  private readonly sessions = inject(SessionService);
  private readonly install = inject(InstallService);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  protected readonly preview = signal<InvitePreview | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly joined = signal<Joined | null>(null);

  constructor() {
    effect(() => void this.load(this.token()));
  }

  /** "Oct 8–12, 2026 · 4 players" */
  protected facts(p: Extract<InvitePreview, { kind: 'trip' }>): string {
    return `${formatDateRange(p.trip.start_date, p.trip.end_date)} · ${p.trip.players} ${p.trip.players === 1 ? 'player' : 'players'}`;
  }

  private async load(token: string): Promise<void> {
    await this.auth.ready();
    try {
      const { data, error } = await this.supabase.functions.invoke('invite', { body: { token } });
      if (error || !data?.kind) {
        const gone = (error as { context?: unknown } | null)?.context instanceof Response;
        this.problem.set(
          gone || !error
            ? 'This invite link has been used or replaced. Ask for a new one.'
            : "Can't reach Teed. Check your signal and try again.",
        );
        return;
      }
      this.preview.set(data as InvitePreview);
    } catch {
      this.problem.set("Can't reach Teed. Check your signal and try again.");
    }
  }

  /** Signed in: take up the invite, then go where it leads. */
  protected async claim(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const { data, error } = await this.supabase.rpc('claim_invite', { p_token: this.token() });
      const result = data as { status: string; kind?: string; trip_id?: string } | null;
      // 'ok' also when this person already holds the spot: their email claimed it as the code
      // was verified, or they opened their own link again. Only someone else's link is "used".
      if (error || !result || !['ok', 'already_on_trip'].includes(result.status)) {
        this.problem.set('This invite link has been used or replaced. Ask for a new one.');
        return;
      }
      await this.auth.refresh(); // a new trip creator, or a name taken from the invite
      await this.sessions.loadTrips();
      if (!result.trip_id) {
        await this.router.navigateByUrl('/you');
        return;
      }
      const mine = this.sessions.trips().find((t) => t.id === result.trip_id);
      if (!mine) {
        // A player can't see a trip until it is published.
        const preview = this.preview();
        const waiting = preview?.kind === 'trip' ? preview.trip.name : 'Your trip';
        this.joined.set({ next: '/you', label: 'Continue', waiting });
      } else if (mine.stage === 'draft') {
        // A co-organizer's draft opens where it is set up.
        this.joined.set({ next: `/admin/trips/${mine.id}`, label: `Open ${mine.name}` });
      } else if (!(await this.sessions.open(mine.id))) {
        this.joined.set({ next: '/you', label: 'Continue' });
      } else if (['standalone', 'other'].includes(this.install.platform())) {
        this.joined.set({ next: '/home', label: `Open ${mine.name}` });
      } else {
        await this.router.navigateByUrl('/install'); // "You're in", Add to Home Screen, then Home
      }
    } catch {
      this.problem.set("Can't reach Teed. Check your signal and try again.");
    } finally {
      this.busy.set(false);
    }
  }
}
