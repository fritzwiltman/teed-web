import { Component, inject } from '@angular/core';
import { SessionService } from '../core/session';
import { UiCard } from '../core/ui';
import { PlayerHeader } from './player-header';

/** Leaderboard. Stub: built in M6. */
@Component({
  selector: 'app-board',
  imports: [PlayerHeader, UiCard],
  template: `
    <app-player-header [label]="session()?.trip?.name" title="Leaderboard" />
    <main class="content">
      <ui-card pad>
        <p>Live round and trip standings will be here.</p>
      </ui-card>
    </main>
  `,
})
export class Board {
  protected readonly session = inject(SessionService).session;
}
