import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  signal,
  viewChildren,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CODE_LENGTH, codeChar, codeFromClipboard } from '../core/code';
import { formatCountdown } from '../core/format';
import { RedeemOutcome, SessionService } from '../core/session';
import { UiButton, UiIcon } from '../core/ui';

type Problem =
  | Exclude<RedeemOutcome, { status: 'ok' }>
  | { status: 'nothing_to_paste' }
  | { status: 'no_clipboard' };

/** What to say for each way logging in can fail. Shared with the join link screen. */
export function redeemMessage(outcome: Exclude<RedeemOutcome, { status: 'ok' }>): string {
  switch (outcome.status) {
    case 'invalid_code':
      return "That code didn't work. Check it against the one you were sent.";
    case 'trip_not_live':
      return outcome.tripStatus === 'final'
        ? 'That trip has finished, so its codes no longer log in.'
        : "That trip isn't open yet. Your organizer will tell you when it is.";
    case 'rate_limited':
      return 'Too many tries. Wait a few minutes and try again.';
    case 'offline':
      return "Can't reach Teed. Check your signal and try again.";
    default:
      return 'Something went wrong on our side. Try again in a moment.';
  }
}

/**
 * Signed out: "Welcome back". One big button pastes the code the player copied on the way in;
 * six boxes below take it by hand. Players normally never see this in Safari: their texted link
 * logs them straight in.
 */
@Component({
  selector: 'app-login',
  imports: [RouterLink, UiButton, UiIcon],
  template: `
    <main class="content">
      <p class="wordmark">teed</p>
      <h1>Welcome back</h1>

      <button ui-button type="button" [busy]="busy()" [disabled]="locked()" (click)="paste()">
        @if (!busy()) {
          <ui-icon name="paste" />
        }
        {{ busy() ? 'Logging in…' : 'Paste my code' }}
      </button>

      <div class="boxes" role="group" aria-label="Your code">
        @for (char of chars(); track $index) {
          <input
            #box
            class="box"
            type="text"
            inputmode="text"
            autocapitalize="characters"
            autocomplete="off"
            autocorrect="off"
            spellcheck="false"
            maxlength="2"
            [attr.aria-label]="'Character ' + ($index + 1) + ' of ' + chars().length"
            [attr.aria-invalid]="message() ? 'true' : null"
            [value]="char"
            [disabled]="busy() || locked()"
            (input)="typed($index, $event)"
            (keydown)="key($index, $event)"
            (paste)="pasted($event)"
          />
        }
      </div>

      @if (message(); as text) {
        <p class="error-text center" role="alert">{{ text }}</p>
      }

      <a ui-button variant="text" class="center organizer" routerLink="/admin">Organizer sign-in</a>
    </main>
  `,
  styles: `
    .content {
      min-height: 100dvh;
      padding-top: calc(48px + env(safe-area-inset-top));
      padding-bottom: calc(var(--s6) + env(safe-area-inset-bottom));
      gap: var(--s5);
    }
    .wordmark {
      text-align: center;
      font: 700 56px/1 var(--font-heading);
      color: var(--accent);
    }
    h1 {
      text-align: center;
      font-size: 32px;
    }
    .boxes {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: var(--s2);
    }
    .box {
      width: 100%;
      height: 56px;
      padding: 0;
      border: 1.5px solid var(--line-strong);
      border-radius: var(--radius-button);
      background: var(--card);
      color: var(--ink);
      font: 700 26px var(--font-heading);
      text-align: center;
      text-transform: uppercase;
    }
    .box:focus-visible {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent);
    }
    .box[aria-invalid='true'] {
      border-color: var(--red);
    }
    .organizer {
      margin-top: auto;
      color: var(--muted);
    }
  `,
})
export class Login {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly boxes = viewChildren<ElementRef<HTMLInputElement>>('box');

  protected readonly chars = signal<string[]>(Array<string>(CODE_LENGTH).fill(''));
  protected readonly busy = signal(false);
  private readonly problem = signal<Problem | null>(null);

  // Lockout countdown after too many tries.
  private readonly lockedUntil = signal(0);
  private readonly now = signal(Date.now());
  protected readonly locked = computed(() => this.lockedUntil() > this.now());

  protected readonly message = computed(() => {
    if (this.locked()) {
      const left = formatCountdown((this.lockedUntil() - this.now()) / 1000);
      return `Too many tries. You can try again in ${left}.`;
    }
    const problem = this.problem();
    if (!problem) return null;
    if (problem.status === 'nothing_to_paste')
      return 'There is no code to paste. Copy it from your text, or type it below.';
    if (problem.status === 'no_clipboard') return 'Type your code below.';
    return redeemMessage(problem);
  });

  constructor() {
    const timer = setInterval(() => {
      if (this.lockedUntil()) this.now.set(Date.now());
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** Reads the clipboard (allowed because this runs from a tap) and logs in with what it finds. */
  protected async paste(): Promise<void> {
    if (this.busy() || this.locked()) return;
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // No clipboard access (refused, or not offered by this browser): the boxes still work.
      this.problem.set({ status: 'no_clipboard' });
      this.boxes()[0]?.nativeElement.focus();
      return;
    }
    const code = codeFromClipboard(text);
    if (!code) {
      this.problem.set({ status: 'nothing_to_paste' });
      return;
    }
    await this.redeem(code);
  }

  /** One character typed in a box: keep it, move on, and log in once all six are there. */
  protected typed(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const char = codeChar(input.value);
    input.value = char;
    this.chars.update((chars) => chars.map((c, i) => (i === index ? char : c)));
    if (!this.locked()) this.problem.set(null);
    if (!char) return;
    if (index < CODE_LENGTH - 1) this.boxes()[index + 1]?.nativeElement.focus();
    if (this.chars().every(Boolean)) void this.redeem(this.chars().join(''));
  }

  /** Backspace in an empty box goes back one. */
  protected key(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.chars()[index] && index > 0) {
      event.preventDefault();
      this.chars.update((chars) => chars.map((c, i) => (i === index - 1 ? '' : c)));
      this.boxes()[index - 1]?.nativeElement.focus();
    }
  }

  /** Pasting into a box takes the whole code, old style or new. */
  protected pasted(event: ClipboardEvent): void {
    const code = codeFromClipboard(event.clipboardData?.getData('text') ?? '');
    if (!code) return;
    event.preventDefault();
    void this.redeem(code);
  }

  private async redeem(code: string): Promise<void> {
    if (this.busy() || this.locked()) return;
    this.busy.set(true);
    this.problem.set(null);
    const outcome = await this.session.redeem(code);
    this.busy.set(false);

    if (outcome.status === 'ok') {
      await this.router.navigateByUrl('/home');
      return;
    }
    if (outcome.status === 'rate_limited') {
      this.now.set(Date.now());
      this.lockedUntil.set(Date.now() + outcome.retryAfter * 1000);
    }
    this.problem.set(outcome);
    this.chars.set(Array<string>(CODE_LENGTH).fill(''));
    // Empty the boxes themselves too: a box typed into moments ago may not have been drawn yet.
    for (const box of this.boxes()) box.nativeElement.value = '';
  }
}
