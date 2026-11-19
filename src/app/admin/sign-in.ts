import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AdminAuth } from './auth';

/** Organizer sign-in: email and password, with an emailed link as the other way in. */
@Component({
  selector: 'app-sign-in',
  imports: [RouterLink],
  template: `
    <main class="page">
      <a class="back" routerLink="/login">‹ Player login</a>
      <h1>Organizer sign-in</h1>

      @if (auth.email() && !auth.isOrganizer()) {
        <section class="card pad stack">
          <p>
            <strong>{{ auth.email() }}</strong> isn't an organizer account.
          </p>
          <button type="button" class="button quiet" (click)="auth.signOut()">Sign out</button>
        </section>
      } @else if (linkSentTo(); as address) {
        <section class="card pad stack">
          <p>
            Check <strong>{{ address }}</strong> and tap the link in the email.
          </p>
          <button type="button" class="link-button" (click)="linkSentTo.set(null)">
            Back to sign-in
          </button>
        </section>
      } @else {
        <form class="card pad stack" (submit)="signIn($event)" novalidate>
          <label class="field">
            <span class="label">Email</span>
            <input
              class="input"
              id="email"
              name="email"
              type="email"
              inputmode="email"
              autocomplete="username"
              autocapitalize="none"
              spellcheck="false"
              [value]="email()"
              (input)="set(email, $event, true)"
            />
          </label>
          <label class="field">
            <span class="label">Password</span>
            <input
              class="input"
              id="password"
              name="password"
              type="password"
              autocomplete="current-password"
              [value]="password()"
              (input)="set(password, $event)"
            />
          </label>
          @if (message(); as text) {
            <p class="error-text" role="alert">{{ text }}</p>
          }
          <button
            class="button"
            type="submit"
            [disabled]="!!busy() || !validEmail() || !password()"
          >
            {{ busy() === 'password' ? 'Signing in…' : 'Sign in' }}
          </button>
          <button
            type="button"
            class="link-button"
            [disabled]="!!busy() || !validEmail()"
            (click)="sendLink()"
          >
            {{ busy() === 'link' ? 'Sending…' : 'Email me a link instead' }}
          </button>
        </form>
      }
    </main>
  `,
  styles: `
    .stack {
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
    }
    .link-button:disabled {
      opacity: 0.5;
    }
  `,
})
export class SignIn {
  protected readonly auth = inject(AdminAuth);
  private readonly router = inject(Router);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal<'password' | 'link' | null>(null);
  protected readonly message = signal<string | null>(null);
  protected readonly linkSentTo = signal<string | null>(null);
  protected readonly validEmail = computed(() => /^\S+@\S+\.\S+$/.test(this.email()));

  constructor() {
    // Already signed in (or arriving from the emailed link): straight through.
    void this.auth.ready().then(() => {
      if (this.auth.isOrganizer()) void this.router.navigateByUrl('/admin');
    });
  }

  protected set(target: { set(value: string): void }, event: Event, trim = false): void {
    const value = (event.target as HTMLInputElement).value;
    target.set(trim ? value.trim() : value);
    this.message.set(null);
  }

  protected async signIn(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy() || !this.validEmail() || !this.password()) return;
    this.busy.set('password');
    this.message.set(null);
    const outcome = await this.auth.signIn(this.email(), this.password());
    this.busy.set(null);
    if (outcome === 'ok') {
      if (this.auth.isOrganizer()) await this.router.navigateByUrl('/admin');
    } else if (outcome === 'wrong') {
      this.message.set("That email and password don't match.");
    } else {
      this.fail(outcome);
    }
  }

  protected async sendLink(): Promise<void> {
    if (this.busy() || !this.validEmail()) return;
    this.busy.set('link');
    this.message.set(null);
    const outcome = await this.auth.send(this.email());
    this.busy.set(null);
    if (outcome === 'sent') this.linkSentTo.set(this.email());
    else this.fail(outcome);
  }

  private fail(outcome: 'rate_limited' | 'offline' | 'error'): void {
    this.message.set(
      outcome === 'rate_limited'
        ? 'Too many tries. Wait a few minutes and try again.'
        : outcome === 'offline'
          ? "Can't reach Teed. Check your signal and try again."
          : 'Something went wrong on our side. Try again in a moment.',
    );
  }
}
