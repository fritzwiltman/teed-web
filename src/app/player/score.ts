import { Component, inject } from '@angular/core';
import { SessionService } from '../core/session';

/** Scorecard. Stub: built in M4. */
@Component({
  selector: 'app-score',
  template: `
    <main class="page">
      <header>
        <p class="label">Score</p>
        <h1>Scorecard</h1>
      </header>
      <section class="card">
        @if (session()?.role === 'spectator') {
          <p>Spectators can't enter scores. Follow along on the Board.</p>
        } @else {
          <p>Hole-by-hole scoring for your group will be here.</p>
        }
      </section>
    </main>
  `,
})
export class Score {
  protected readonly session = inject(SessionService).session;
}
