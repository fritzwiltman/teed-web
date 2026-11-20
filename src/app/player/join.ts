import { Component, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { InstallService } from '../core/install';
import { SessionService } from '../core/session';
import { UiButton, UiSkeleton } from '../core/ui';
import { redeemMessage } from './login';

/**
 * /join/<code>: the link a player is texted. Logs the phone in, then goes to the Add to Home
 * Screen step (or straight home when there is nothing to install).
 */
@Component({
  selector: 'app-join',
  imports: [RouterLink, UiButton, UiSkeleton],
  template: `
    <main class="content">
      <p class="wordmark">teed</p>
      @if (message(); as text) {
        <p class="error-text center" role="alert">{{ text }}</p>
        <button ui-button type="button" (click)="redeem()">Try again</button>
        <a ui-button variant="text" class="center" routerLink="/login">Enter a code</a>
      } @else {
        <ui-skeleton shape="block" height="56px" />
        <ui-skeleton width="60%" />
      }
    </main>
  `,
  styles: `
    .content {
      padding-top: calc(48px + env(safe-area-inset-top));
      gap: var(--s5);
    }
    .wordmark {
      text-align: center;
      font: 700 56px/1 var(--font-heading);
      color: var(--accent);
    }
  `,
})
export class Join {
  readonly code = input.required<string>();

  private readonly session = inject(SessionService);
  private readonly install = inject(InstallService);
  private readonly router = inject(Router);

  protected readonly message = signal<string | null>(null);

  constructor() {
    effect(() => {
      this.code();
      void this.redeem();
    });
  }

  protected async redeem(): Promise<void> {
    this.message.set(null);
    const outcome = await this.session.redeem(this.code());
    if (outcome.status !== 'ok') {
      this.message.set(redeemMessage(outcome));
      return;
    }
    const platform = this.install.platform();
    const installable = platform !== 'standalone' && platform !== 'other';
    // replaceUrl: Back from home must not land on the link again.
    await this.router.navigateByUrl(installable ? '/install' : '/home', { replaceUrl: true });
  }
}
