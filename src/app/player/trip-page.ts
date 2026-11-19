import { Component, inject, signal } from '@angular/core';
import { SessionService } from '../core/session';
import { ThemeChoice, ThemeService } from '../core/theme';

/** Trip info (itinerary, courses, logistics, players). Stub, plus appearance and log out. */
@Component({
  selector: 'app-trip-info',
  template: `
    <main class="page">
      <header>
        <p class="label">Trip</p>
        <h1>{{ session()?.trip?.name }}</h1>
      </header>

      <section class="card">
        <p>The itinerary, courses, logistics and players will be here.</p>
      </section>

      <section class="card" aria-label="Appearance">
        <div class="row">
          <span class="label">Appearance</span>
          <span class="choices" role="group" aria-label="Appearance">
            @for (option of themes; track option.value) {
              <button
                type="button"
                [class.on]="theme.choice() === option.value"
                [attr.aria-pressed]="theme.choice() === option.value"
                (click)="theme.set(option.value)"
              >
                {{ option.label }}
              </button>
            }
          </span>
        </div>
      </section>

      <footer>
        @if (confirming()) {
          <p class="muted">
            Log out of {{ session()?.trip?.name }} on this phone? You'll need your code to get back
            in.
          </p>
          <div class="confirm">
            <button type="button" class="button" (click)="logout()">Log out</button>
            <button type="button" class="button quiet" (click)="confirming.set(false)">
              Cancel
            </button>
          </div>
        } @else {
          <button type="button" class="link" (click)="confirming.set(true)">
            Switch trip / log out
          </button>
        }
      </footer>
    </main>
  `,
  styles: `
    .choices {
      display: inline-flex;
      border: 1px solid var(--frame);
      border-radius: 999px;
      overflow: hidden;
    }
    .choices button {
      min-height: 2.5rem;
      padding: 0 0.9rem;
      border: 0;
      background: transparent;
      color: var(--ink);
      font: 500 0.85rem var(--font-body);
      cursor: pointer;
    }
    .choices button.on {
      background: var(--pine);
      color: var(--on-pine);
    }
    footer {
      margin-top: 1rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      text-align: center;
    }
    .confirm {
      display: flex;
      gap: 0.6rem;
      width: 100%;
    }
    .link {
      min-height: var(--tap);
      padding: 0 1rem;
      border: 0;
      background: none;
      color: var(--muted);
      font: 500 0.9rem var(--font-body);
      text-decoration: underline;
      text-underline-offset: 3px;
      cursor: pointer;
    }
  `,
})
export class TripPage {
  protected readonly session = inject(SessionService).session;
  private readonly sessions = inject(SessionService);
  protected readonly theme = inject(ThemeService);

  protected readonly confirming = signal(false);
  protected readonly themes: { value: ThemeChoice; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  protected async logout(): Promise<void> {
    await this.sessions.logout(); // the shell sends us to the login screen once the session is gone
  }
}
