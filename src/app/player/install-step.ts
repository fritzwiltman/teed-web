import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { InstallPlatform, InstallService } from '../core/install';
import { SessionService } from '../core/session';
import { UiButton, UiCard } from '../core/ui';

const STEPS: Partial<Record<InstallPlatform, string[]>> = {
  'ios-safari': [
    'Tap Share in Safari’s toolbar.',
    'Scroll down and tap Add to Home Screen.',
    'Tap Add, then open Teed from your Home Screen.',
  ],
  'ios-chrome': [
    'Tap Share at the right of Chrome’s address bar.',
    'Scroll down and tap Add to Home Screen.',
    'Tap Add, then open Teed from your Home Screen.',
  ],
  'ios-other': [
    'Open this page in Safari.',
    'Tap Share, then Add to Home Screen.',
    'Tap Add, then open Teed from your Home Screen.',
  ],
  android: [
    'Tap the ⋮ menu in your browser.',
    'Tap Add to Home screen or Install app.',
    'Tap Install, then open Teed from your Home screen.',
  ],
};

/**
 * The Add to Home Screen step, after an invite link and from the reminder on trip home. Always
 * skippable. On an iPhone nothing can add the app for you, so there are only the steps and
 * "Not now" (the Home Screen app has its own storage: the person signs in there once more, with
 * a new emailed code). Android gets a real "Install Teed" button when the browser offers its
 * install prompt.
 */
@Component({
  selector: 'app-install-step',
  imports: [UiButton, UiCard],
  template: `
    <main class="content">
      <h1>You're in, {{ name() }}</h1>

      <!-- Placeholder for the short looping demo of these steps. -->
      <div class="clip" role="img" aria-label="A short demo of these steps will go here"></div>

      <ui-card pad>
        <h2>Add Teed to your Home Screen</h2>
        <ol>
          @for (step of steps(); track $index) {
            <li>
              <span class="n">{{ $index + 1 }}</span><span>{{ step }}</span>
            </li>
          }
        </ol>
        <p class="detail">Leader alerts only work from the Home Screen app.</p>
      </ui-card>

      @if (canInstall()) {
        <button ui-button type="button" (click)="installNow()">Install Teed</button>
      }
      <button ui-button type="button" variant="outline" (click)="carryOn()">Not now</button>
    </main>
  `,
  styles: `
    .content {
      padding-top: calc(var(--s6) + env(safe-area-inset-top));
      padding-bottom: calc(var(--s6) + env(safe-area-inset-bottom));
    }
    h1 {
      font-size: 32px;
    }
    .clip {
      aspect-ratio: 16 / 9;
      border-radius: var(--radius-card);
      background: var(--chip);
    }
    ol {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--s3);
    }
    li {
      display: flex;
      align-items: flex-start;
      gap: var(--s3);
    }
    .n {
      flex: none;
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--fill);
      color: var(--on-fill);
      font: 700 16px var(--font-heading);
    }
  `,
})
export class InstallStep {
  private readonly sessions = inject(SessionService);
  private readonly router = inject(Router);
  protected readonly install = inject(InstallService);

  protected readonly name = computed(() => {
    const s = this.sessions.session();
    return s?.player.name ?? '';
  });
  protected readonly steps = computed(() => STEPS[this.install.platform()] ?? []);
  /** Android only, once the browser has offered its own install prompt. */
  protected readonly canInstall = computed(
    () => this.install.platform() === 'android' && this.install.canPrompt(),
  );

  constructor() {
    // Already on the Home Screen, or nowhere to install to: nothing to do here.
    if (!this.steps().length) void this.router.navigateByUrl('/home', { replaceUrl: true });
  }

  protected async installNow(): Promise<void> {
    await this.install.promptInstall();
    await this.router.navigateByUrl('/home');
  }

  protected async carryOn(): Promise<void> {
    await this.router.navigateByUrl('/home');
  }
}
