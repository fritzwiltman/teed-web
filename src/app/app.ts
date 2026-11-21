import { Component, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth';
import { InstallService } from './core/install';
import { SessionService } from './core/session';
import { UiToast } from './core/ui';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, UiToast],
  template: `
    <router-outlet />
    @if (updateReady()) {
      <ui-toast message="New version" action="Reload" (acted)="reload()" />
    }
  `,
})
export class App {
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionService);
  /** The service worker. Absent in development and in a browser without one. */
  private readonly updates = inject(SwUpdate, { optional: true });

  /** A new build has been downloaded and is waiting for a reload. */
  protected readonly updateReady = signal(false);

  constructor() {
    inject(InstallService); // created now so it can catch Chrome's early install-prompt event

    // Check who is signed in and the open trip with the server at launch and whenever the app
    // comes back to the foreground, so someone taken off a trip stops seeing it.
    void this.auth.ready().then(() => this.session.revalidate());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      void this.auth.refresh().then(() => this.session.revalidate());
      void this.checkForUpdate();
    });

    // A Home Screen app can stay open for days: say when a new build is ready rather than
    // leaving it on the old one until iOS happens to restart it.
    if (this.updates?.isEnabled)
      this.updates.versionUpdates.subscribe((event) => {
        if (event.type === 'VERSION_READY') this.updateReady.set(true);
      });
  }

  /** Looks for a new build. Called whenever the app comes back to the foreground. */
  private async checkForUpdate(): Promise<void> {
    if (!this.updates?.isEnabled) return;
    try {
      if (await this.updates.checkForUpdate()) this.updateReady.set(true);
    } catch {
      // no signal: try again next time
    }
  }

  /** Switches to the new build. Scores still syncing are safe: they are saved on the phone. */
  protected async reload(): Promise<void> {
    try {
      await this.updates?.activateUpdate();
    } catch {
      // reloading picks the new build up anyway
    }
    location.reload();
  }
}
