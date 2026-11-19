import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { InstallService } from './core/install';
import { SessionService } from './core/session';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  private readonly session = inject(SessionService);

  constructor() {
    inject(InstallService); // created now so it can catch Chrome's early install-prompt event

    // Check the saved login with the server at launch and whenever the app comes back to the
    // foreground, so a revoked code logs the phone out.
    void this.session.revalidate();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.session.revalidate();
    });
  }
}
