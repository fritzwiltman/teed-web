import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SignInForm } from '../auth/sign-in-form';
import { SessionService } from '../core/session';

/** Sign in: the same screen for players and organizers. */
@Component({
  selector: 'app-login',
  imports: [SignInForm],
  template: `
    <main class="content">
      <p class="wordmark">teed</p>
      <app-sign-in-form (done)="signedIn()" (stageChange)="stage.set($event)">
        <h1>Sign in</h1>
      </app-sign-in-form>
    </main>
  `,
  styles: `
    .content {
      min-height: 100dvh;
      padding: calc(96px + env(safe-area-inset-top)) var(--s5)
        calc(var(--s5) + env(safe-area-inset-bottom));
      gap: var(--s5);
    }
    .wordmark {
      font: 700 40px/1 var(--font-heading);
      color: var(--accent);
    }
    h1 {
      font-size: 30px;
    }
  `,
})
export class Login {
  private readonly sessions = inject(SessionService);
  private readonly router = inject(Router);
  protected readonly stage = signal<'email' | 'code'>('email');

  protected async signedIn(): Promise<void> {
    await this.router.navigateByUrl(await this.sessions.startUrl());
  }
}
