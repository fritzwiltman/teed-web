import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService } from './core/auth';
import { InstallService } from './core/install';
import { SessionService } from './core/session';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  private readonly auth = inject(AuthService);
  private readonly session = inject(SessionService);

  constructor() {
    inject(InstallService); // created now so it can catch Chrome's early install-prompt event

    // Check who is signed in and the open trip with the server at launch and whenever the app
    // comes back to the foreground, so someone taken off a trip stops seeing it.
    void this.auth.ready().then(() => this.session.revalidate());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible')
        void this.auth.refresh().then(() => this.session.revalidate());
    });
  }
}
