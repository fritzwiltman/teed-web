import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from '../core/session';
import { UiHeaderBand } from '../core/ui';
import { Trip } from './data';

/**
 * The header band on a trip's organizer screens: "Organizer · <trip>" over the title, and the
 * "Player view" pill, which opens the trip's own screens. The pill is hidden while the trip is a
 * draft, and for the app admin on a trip they aren't on.
 */
@Component({
  selector: 'app-organizer-header',
  imports: [UiHeaderBand],
  host: { style: 'display: contents' },
  template: `
    <ui-header-band
      [label]="label()"
      [title]="title()"
      [action]="canSwitch() ? 'Player view' : undefined"
      (acted)="playerView()"
    />
  `,
})
export class OrganizerHeader {
  readonly title = input.required<string>();
  readonly trip = input.required<Trip | null>();

  private readonly sessions = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly label = computed(() => {
    const trip = this.trip();
    return trip ? `Organizer · ${trip.name}` : 'Organizer';
  });

  protected readonly canSwitch = computed(() => {
    const trip = this.trip();
    if (!trip || trip.status === 'draft') return false;
    return this.sessions.trips().some((t) => t.id === trip.id);
  });

  protected async playerView(): Promise<void> {
    const trip = this.trip();
    if (trip && (await this.sessions.open(trip.id))) await this.router.navigateByUrl('/home');
  }
}
