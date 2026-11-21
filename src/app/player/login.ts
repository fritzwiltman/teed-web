import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SignInForm } from '../auth/sign-in-form';
import { SessionService } from '../core/session';
import { UiLogo } from '../core/ui';

/** Sign in: the same screen for players and organizers. */
@Component({
  selector: 'app-login',
  imports: [SignInForm, UiLogo],
  template: `
    <main class="content">
      <ui-logo class="lockup" [size]="40" />
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
    .lockup {
      align-self: flex-start;
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
