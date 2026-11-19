import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { looksLikeCode, tidyCode } from '../core/code';
import { formatCountdown } from '../core/format';
import { RedeemOutcome, SessionService } from '../core/session';
import { InstallCard } from './install-card';

/** Login: one field for the player or spectator code. */
@Component({
  selector: 'app-login',
  imports: [InstallCard],
  template: `
    <main class="page">
      <header>
        <h1 class="wordmark">Teed</h1>
        <p class="label">Live scoring for golf trips</p>
      </header>

      <form class="card" (submit)="join($event)" novalidate>
        <label class="label" for="code">Trip code</label>
        <input
          id="code"
          class="code"
          name="code"
          type="text"
          inputmode="text"
          autocapitalize="characters"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          enterkeyhint="go"
          placeholder="VERO-FW27-K4M9"
          [value]="code()"
          (input)="typed($event)"
          [attr.aria-invalid]="message() ? 'true' : null"
          aria-describedby="code-note"
        />
        @if (message(); as text) {
          <p id="code-note" class="error" role="alert">{{ text }}</p>
        } @else {
          <p id="code-note" class="muted note">
            The code your organiser sent you. Capitals and dashes don't matter.
          </p>
        }
        <button class="button" type="submit" [disabled]="busy() || locked() || !code()">
          {{ busy() ? 'Joining…' : 'Join trip' }}
        </button>
      </form>

      <app-install-card />
    </main>
  `,
  styles: `
    .page {
      min-height: 100dvh;
      padding-top: calc(3rem + env(safe-area-inset-top));
      padding-bottom: calc(2rem + env(safe-area-inset-bottom));
      gap: 1.25rem;
    }
    header {
      text-align: center;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      margin-bottom: 0.5rem;
    }
    .wordmark {
      font-size: 3.5rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: var(--brand);
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .code {
      width: 100%;
      min-height: 3.5rem;
      padding: 0 0.75rem;
      border: 2px solid var(--frame);
      border-radius: var(--radius);
      background: var(--field);
      color: var(--ink);
      font: 600 1.3rem var(--font-mono);
      letter-spacing: 0.04em;
      text-align: center;
      text-transform: uppercase;
    }
    .code::placeholder {
      color: var(--muted);
      opacity: 0.55;
      font-weight: 400;
    }
    .code[aria-invalid='true'] {
      border-color: var(--red);
    }
    .note {
      font-size: 0.875rem;
    }
    .error {
      color: var(--red);
      font-weight: 600;
      font-size: 0.95rem;
    }
    .button {
      margin-top: 0.4rem;
      min-height: 3.5rem;
      font-size: 1.15rem;
    }
  `,
})
export class Login {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly code = signal('');
  protected readonly busy = signal(false);
  private readonly outcome = signal<
    Exclude<RedeemOutcome, { status: 'ok' }> | { status: 'too_short' } | null
  >(null);

  // Lockout countdown after too many tries.
  private readonly lockedUntil = signal(0);
  private readonly now = signal(Date.now());
  protected readonly locked = computed(() => this.lockedUntil() > this.now());

  protected readonly message = computed(() => {
    if (this.locked()) {
      const left = formatCountdown((this.lockedUntil() - this.now()) / 1000);
      return `Too many tries. You can try again in ${left}.`;
    }
    const outcome = this.outcome();
    switch (outcome?.status) {
      case 'too_short':
        return 'That looks too short. A code looks like VERO-FW27-K4M9.';
      case 'invalid_code':
        return "That code didn't work. Check it against the one you were sent and try again.";
      case 'trip_not_live':
        return outcome.tripStatus === 'final'
          ? 'That trip has finished, so its codes no longer log in.'
          : "That trip isn't open yet. Your organiser will tell you when it's live.";
      case 'rate_limited':
        return 'Too many tries. Wait a few minutes and try again.';
      case 'offline':
        return "Can't reach Teed. Check your signal and try again.";
      case 'error':
        return 'Something went wrong on our side. Try again in a moment.';
      default:
        return null;
    }
  });

  constructor() {
    const timer = setInterval(() => {
      if (this.lockedUntil()) this.now.set(Date.now());
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected typed(event: Event): void {
    const input = event.target as HTMLInputElement;
    const tidy = tidyCode(input.value);
    if (input.value !== tidy) input.value = tidy;
    this.code.set(tidy);
    if (!this.locked()) this.outcome.set(null);
  }

  protected async join(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy() || this.locked()) return;
    if (!looksLikeCode(this.code())) {
      this.outcome.set({ status: 'too_short' });
      return;
    }

    this.busy.set(true);
    const outcome = await this.session.redeem(this.code());
    this.busy.set(false);

    if (outcome.status === 'ok') {
      await this.router.navigateByUrl('/home');
      return;
    }
    if (outcome.status === 'rate_limited') {
      this.now.set(Date.now());
      this.lockedUntil.set(Date.now() + outcome.retryAfter * 1000);
    }
    this.outcome.set(outcome);
  }
}
