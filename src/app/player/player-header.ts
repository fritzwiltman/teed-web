import { Component, computed, inject, input } from '@angular/core';
import { SessionService } from '../core/session';
import { UiHeaderBand } from '../core/ui';

/**
 * The header band on a player screen. The owner and co-admins get the "Manage" pill, which
 * switches to the organizer screens for this trip; players and spectators never see it.
 */
@Component({
  selector: 'app-player-header',
  imports: [UiHeaderBand],
  host: { style: 'display: contents' },
  template: `
    <ui-header-band
      [label]="label()"
      [title]="title()"
      [action]="sessions.canManage() ? 'Manage' : undefined"
      [actionLink]="manageLink()"
    />
  `,
})
export class PlayerHeader {
  readonly title = input.required<string>();
  readonly label = input<string>();

  protected readonly sessions = inject(SessionService);
  protected readonly manageLink = computed(() => {
    const trip = this.sessions.session()?.trip;
    return trip ? ['/admin/trips', trip.id] : undefined;
  });
}
