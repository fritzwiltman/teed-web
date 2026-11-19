import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AdminAuth } from './auth';

/** Organizer sign-in: email, then the link or the 6-digit code from that email. */
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
      } @else if (step() === 'email') {
        <form class="card pad stack" (submit)="send($event)" novalidate>
          <label class="field">
            <span class="label">Email</span>
            <input
              class="input"
              id="email"
              type="email"
              inputmode="email"
              autocomplete="email"
              autocapitalize="none"
              spellcheck="false"
              [value]="email()"
              (input)="email.set(value($event).trim())"
            />
          </label>
          @if (message(); as text) {
            <p class="error-text" role="alert">{{ text }}</p>
          }
          <button class="button" type="submit" [disabled]="busy() || !validEmail()">
            {{ busy() ? 'Sending…' : 'Email me a sign-in link' }}
          </button>
        </form>
      } @else {
        <form class="card pad stack" (submit)="verify($event)" novalidate>
          <p>
            Check <strong>{{ email() }}</strong>. Tap the link in the email, or enter the code from
            it here.
          </p>
          <label class="field">
            <span class="label">Code from the email</span>
            <input
              class="input mono code"
              id="otp"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              [value]="code()"
              (input)="code.set(digits($event))"
            />
          </label>
          @if (message(); as text) {
            <p class="error-text" role="alert">{{ text }}</p>
          }
          <button class="button" type="submit" [disabled]="busy() || code().length < 6">
            {{ busy() ? 'Signing in…' : 'Sign in' }}
          </button>
          <button type="button" class="link-button" (click)="restart()">
            Use a different email
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
    .code {
      font-size: 1.3rem;
      letter-spacing: 0.2em;
      text-align: center;
    }
  `,
})
export class SignIn {
  protected readonly auth = inject(AdminAuth);
  private readonly router = inject(Router);

  protected readonly step = signal<'email' | 'code'>('email');
  protected readonly email = signal('');
  protected readonly code = signal('');
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly validEmail = computed(() => /^\S+@\S+\.\S+$/.test(this.email()));

  constructor() {
    // Already signed in (or arriving from the magic link): straight through.
    void this.auth.ready().then(() => {
      if (this.auth.isOrganizer()) void this.router.navigateByUrl('/admin');
    });
  }

  protected value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected digits(event: Event): string {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/\D/g, '').slice(0, 10);
    return input.value;
  }

  protected async send(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy() || !this.validEmail()) return;
    this.busy.set(true);
    this.message.set(null);
    const outcome = await this.auth.send(this.email());
    this.busy.set(false);
    if (outcome === 'sent') {
      this.step.set('code');
    } else if (outcome === 'rate_limited') {
      this.message.set('Too many sign-in emails. Wait a few minutes and try again.');
    } else if (outcome === 'offline') {
      this.message.set("Can't reach Teed. Check your signal and try again.");
    } else {
      this.message.set('Something went wrong on our side. Try again in a moment.');
    }
  }

  protected async verify(event: Event): Promise<void> {
    event.preventDefault();
    if (this.busy()) return;
    this.busy.set(true);
    this.message.set(null);
    const outcome = await this.auth.verify(this.email(), this.code());
    this.busy.set(false);
    if (outcome === 'ok') {
      if (this.auth.isOrganizer()) await this.router.navigateByUrl('/admin');
    } else if (outcome === 'wrong_code') {
      this.message.set("That code didn't work. Check the latest email and try again.");
    } else if (outcome === 'offline') {
      this.message.set("Can't reach Teed. Check your signal and try again.");
    } else {
      this.message.set('Something went wrong on our side. Try again in a moment.');
    }
  }

  protected restart(): void {
    this.step.set('email');
    this.code.set('');
    this.message.set(null);
  }
}
