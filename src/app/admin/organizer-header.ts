import { Component, computed, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { SessionService } from '../core/session';
import { UiHeaderBand } from '../core/ui';
import { AdminAuth } from './auth';
import { AdminData, Trip } from './data';

/**
 * Opens a trip's player screens for whoever is using the organizer screens. The owner needs no
 * code: on their email sign-in the database treats them as the player marked "This is me".
 * A co-admin is already logged in as their player. Returns false when there is no player to be.
 */
export async function enterPlayerMode(
  trip: Trip,
  auth: AdminAuth,
  data: AdminData,
  sessions: SessionService,
  router: Router,
): Promise<boolean> {
  if (trip.status === 'draft') return false;
  if (auth.isOrganizer()) {
    if (!trip.owner_player_id) return false;
    sessions.enterAsOwner(
      {
        id: trip.id,
        name: trip.name,
        slug: trip.slug,
        status: trip.status,
        location: trip.location,
        start_date: trip.start_date,
        end_date: trip.end_date,
        owner_player_id: trip.owner_player_id,
      },
      await data.player(trip.owner_player_id),
    );
  } else if (sessions.session()?.trip.id !== trip.id) {
    return false;
  }
  return router.navigateByUrl('/home');
}

/**
 * The header band on a trip's organizer screens: "Organizer · <trip>" over the title, and the
 * "Player view" pill. The pill is hidden while the trip is a draft (players can't get in yet)
 * and when the owner hasn't said which player they are.
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

  private readonly auth = inject(AdminAuth);
  private readonly data = inject(AdminData);
  private readonly sessions = inject(SessionService);
  private readonly router = inject(Router);

  protected readonly label = computed(() => {
    const trip = this.trip();
    return trip ? `Organizer · ${trip.name}` : 'Organizer';
  });

  protected readonly canSwitch = computed(() => {
    const trip = this.trip();
    if (!trip || trip.status === 'draft') return false;
    return this.auth.isOrganizer() ? !!trip.owner_player_id : true;
  });

  protected async playerView(): Promise<void> {
    const trip = this.trip();
    if (!trip) return;
    try {
      await enterPlayerMode(trip, this.auth, this.data, this.sessions, this.router);
    } catch {
      // couldn't load the player: stay where we are
    }
  }
}
