import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChildren,
} from '@angular/core';
import { AuthService, RESEND_SECONDS, SendOutcome, VerifyOutcome } from '../core/auth';
import { formatCountdown } from '../core/format';
import { UiButton, UiField } from '../core/ui';

const DIGITS = 6;

const SEND_MESSAGE: Partial<Record<SendOutcome, string>> = {
  bad_email: "That doesn't look like an email address.",
  rate_limited: 'Too many codes sent. Wait a few minutes and try again.',
  offline: "Can't reach Teed. Check your signal and try again.",
  error: 'Something went wrong on our side. Try again in a moment.',
};

const VERIFY_MESSAGE: Partial<Record<VerifyOutcome, string>> = {
  wrong: "That code didn't work",
  expired: 'That code expired',
  rate_limited: 'Too many tries. Wait a few minutes and try again.',
  offline: "Can't reach Teed. Check your signal and try again.",
  error: 'Something went wrong on our side. Try again in a moment.',
};

/**
 * Signing in: an email, then the 6-digit code that was emailed to it, typed into six boxes.
 * Used on the Sign in screen and under an invite. Emits `done` once the person is signed in.
 */
@Component({
  selector: 'app-sign-in-form',
  imports: [UiButton, UiField],
  template: `
    @if (stage() === 'email') {
      <ng-content />
      <form class="stack" (submit)="send($event)" novalidate>
        <ui-field label="Email">
          <input
            name="email"
            type="email"
            inputmode="email"
            autocomplete="email"
            autocapitalize="none"
            autocorrect="off"
            spellcheck="false"
            [value]="address()"
            [attr.aria-invalid]="problem() ? 'true' : null"
            (input)="typeEmail($event)"
          />
        </ui-field>
        @if (problem(); as text) {
          <p class="error-text" role="alert">{{ text }}</p>
        }
        <button ui-button type="submit" [busy]="busy()">
          {{ busy() ? 'Sending…' : 'Email me a code' }}
        </button>
      </form>
    } @else {
      <div>
        <h1>Enter your code</h1>
        <p class="sent">Sent to {{ address() }}</p>
      </div>

      <div class="stack">
        <div class="boxes" role="group" aria-label="6-digit code">
          @for (digit of digits(); track $index) {
            <input
              #box
              class="box"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength="6"
              autocomplete="one-time-code"
              [attr.aria-label]="'Digit ' + ($index + 1) + ' of 6'"
              [attr.aria-invalid]="refused() ? 'true' : null"
              [value]="digit"
              [disabled]="busy()"
              (input)="typed($index, $event)"
              (keydown)="key($index, $event)"
              (paste)="pasted($event)"
            />
          }
        </div>
        @if (problem(); as text) {
          <p class="error-text" role="alert">{{ text }}</p>
        }
      </div>

      @if (outcome() === 'expired') {
        <button ui-button type="button" [busy]="busy()" (click)="resend()">
          Email me a new code
        </button>
      } @else {
        <div class="links">
          <button
            ui-button
            variant="text"
            type="button"
            [disabled]="busy() || wait() > 0"
            (click)="resend()"
          >
            {{ wait() > 0 ? 'Send a new code in ' + countdown() : 'Send a new code' }}
          </button>
          <button ui-button variant="text" type="button" class="quiet" (click)="changeEmail()">
            Change email
          </button>
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--s5);
    }
    h1 {
      font-size: 30px;
    }
    .sent {
      margin-top: 6px;
      font-size: 16px;
      font-weight: 500;
      color: var(--ink-2);
    }
    .boxes {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: var(--s2);
    }
    .box {
      width: 100%;
      height: 58px;
      padding: 0;
      border: 1.5px solid var(--line-strong);
      border-radius: var(--radius-button);
      background: var(--card);
      color: var(--ink);
      font: 700 28px var(--font-heading);
      text-align: center;
    }
    .box:focus-visible {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 1px var(--accent);
    }
    .box[aria-invalid='true'] {
      border: 2px solid var(--red);
    }
    .links {
      display: flex;
      justify-content: space-between;
      gap: var(--s3);
    }
    .quiet {
      color: var(--muted);
    }
  `,
})
export class SignInForm {
  /** An address to start with (an invite the organizer entered an email for). */
  readonly email = input<string | null>();
  /** Signed in. */
  readonly done = output<void>();
  /** Which step is showing, so the page can drop its own heading on the code step. */
  readonly stageChange = output<'email' | 'code'>();

  private readonly auth = inject(AuthService);
  private readonly boxes = viewChildren<ElementRef<HTMLInputElement>>('box');

  protected readonly stage = signal<'email' | 'code'>('email');
  protected readonly address = signal('');
  protected readonly digits = signal<string[]>(Array<string>(DIGITS).fill(''));
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  /** How the last code went, when it was refused. */
  protected readonly outcome = signal<VerifyOutcome | null>(null);
  protected readonly refused = computed(
    () => this.outcome() === 'wrong' || this.outcome() === 'expired',
  );

  // "Send a new code" rests for 30 seconds after each send.
  private readonly sentAt = signal(0);
  private readonly now = signal(Date.now());
  protected readonly wait = computed(() =>
    Math.max(0, Math.ceil((this.sentAt() + RESEND_SECONDS * 1000 - this.now()) / 1000)),
  );
  protected readonly countdown = computed(() => formatCountdown(this.wait()));

  constructor() {
    effect(() => {
      const given = this.email();
      if (given && !this.address()) this.address.set(given);
    });
    effect(() => this.stageChange.emit(this.stage()));
    const timer = setInterval(() => {
      if (this.sentAt()) this.now.set(Date.now());
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected typeEmail(event: Event): void {
    this.address.set((event.target as HTMLInputElement).value);
    this.problem.set(null);
  }

  protected async send(event?: Event): Promise<void> {
    event?.preventDefault();
    if (this.busy()) return;
    this.busy.set(true);
    this.problem.set(null);
    const outcome = await this.auth.sendCode(this.address());
    this.busy.set(false);
    if (outcome !== 'sent') {
      this.problem.set(SEND_MESSAGE[outcome] ?? null);
      return;
    }
    this.address.update((a) => a.trim().toLowerCase());
    this.now.set(Date.now());
    this.sentAt.set(Date.now());
    this.outcome.set(null);
    this.clearBoxes();
    this.stage.set('code');
    setTimeout(() => this.boxes()[0]?.nativeElement.focus());
  }

  protected async resend(): Promise<void> {
    if (this.wait() > 0 && this.outcome() !== 'expired') return;
    await this.send();
  }

  protected changeEmail(): void {
    this.stage.set('email');
    this.problem.set(null);
    this.outcome.set(null);
  }

  /** One digit typed in a box: keep it, move on, and check the code once all six are there. */
  protected typed(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const typed = input.value.replace(/\D/g, '');
    // A refused code stays on show until the next digit, which starts a fresh one.
    if (this.refused() || this.problem()) {
      this.outcome.set(null);
      this.problem.set(null);
      if (this.digits().every(Boolean)) {
        this.clearBoxes();
        index = 0;
      }
    }
    if (typed.length >= DIGITS) return this.fill(typed.slice(0, DIGITS)); // autofill from the email
    const digit = typed.slice(-1);
    this.digits.update((digits) => digits.map((d, i) => (i === index ? digit : d)));
    this.draw();
    if (!digit) return;
    if (index < DIGITS - 1) this.boxes()[index + 1]?.nativeElement.focus();
    if (this.digits().every(Boolean)) void this.verify();
  }

  /** Backspace in an empty box goes back one. */
  protected key(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.digits()[index] && index > 0) {
      event.preventDefault();
      this.digits.update((digits) => digits.map((d, i) => (i === index - 1 ? '' : d)));
      this.draw();
      this.boxes()[index - 1]?.nativeElement.focus();
    }
  }

  /** Pasting into a box takes the whole code. */
  protected pasted(event: ClipboardEvent): void {
    const code = /\d{6}/.exec((event.clipboardData?.getData('text') ?? '').replace(/\s/g, ''))?.[0];
    if (!code) return;
    event.preventDefault();
    this.fill(code);
  }

  private fill(code: string): void {
    this.outcome.set(null);
    this.problem.set(null);
    this.digits.set([...code]);
    this.draw();
    void this.verify();
  }

  private async verify(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    const outcome = await this.auth.verify(this.address(), this.digits().join(''));
    this.busy.set(false);
    if (outcome === 'ok') {
      this.done.emit();
      return;
    }
    this.outcome.set(outcome);
    this.problem.set(VERIFY_MESSAGE[outcome] ?? null);
    if (outcome !== 'wrong' && outcome !== 'expired') this.clearBoxes();
    setTimeout(() => this.boxes()[0]?.nativeElement.focus());
  }

  private clearBoxes(): void {
    this.digits.set(Array<string>(DIGITS).fill(''));
    this.draw();
  }

  /** Puts the digits in the boxes themselves: a box typed into moments ago may not have been drawn yet. */
  private draw(): void {
    const digits = this.digits();
    this.boxes().forEach((box, i) => (box.nativeElement.value = digits[i] ?? ''));
  }
}
