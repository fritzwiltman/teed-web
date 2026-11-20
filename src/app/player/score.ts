import { Component, inject } from '@angular/core';
import { SessionService } from '../core/session';
import { UiCard } from '../core/ui';
import { PlayerHeader } from './player-header';

/** Scorecard. Stub: built in M4. */
@Component({
  selector: 'app-score',
  imports: [PlayerHeader, UiCard],
  template: `
    <app-player-header [label]="session()?.trip?.name" title="Scorecard" />
    <main class="content">
      <ui-card pad>
        @if (session()?.role === 'spectator') {
          <p>Spectators can't enter scores. Follow along on the Board.</p>
        } @else {
          <p>Hole-by-hole scoring for your group will be here.</p>
        }
      </ui-card>
    </main>
  `,
})
export class Score {
  protected readonly session = inject(SessionService).session;
}
