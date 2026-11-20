import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, scan, startWith } from 'rxjs';
import { Tab, UiTabBar } from '../core/ui';

export type OrganizerTab = 'overview' | 'rounds' | 'people' | 'itinerary';

interface Place {
  /** Which tab is lit. None on My trips and in the course library. */
  tab: OrganizerTab | null;
  /** The trip in hand, if any. It stays in hand while you look at the course library. */
  tripId: string | null;
}

const TAB_FOR: Record<string, OrganizerTab> = {
  rounds: 'rounds',
  roster: 'people',
  itinerary: 'itinerary',
};

/** Works out where we are from the address. `previous` carries the trip into the course library. */
export function placeFor(url: string, previous: Place | null): Place {
  const path = url.split(/[?#]/)[0];
  const trip = /^\/admin\/trips\/([^/]+)(?:\/([^/]+))?/.exec(path);
  if (trip && trip[1] !== 'new')
    return { tab: TAB_FOR[trip[2] ?? ''] ?? 'overview', tripId: trip[1] };
  if (path.startsWith('/admin/courses')) return { tab: null, tripId: previous?.tripId ?? null };
  return { tab: null, tripId: null };
}

/**
 * The organizer frame: the current screen and, with a trip in hand, the organizer tab bar
 * (Overview · Rounds · People · Itinerary). My trips has no tab bar.
 */
@Component({
  selector: 'app-admin-shell',
  imports: [RouterOutlet, UiTabBar],
  template: `
    <div class="screen" [class.with-tabs]="tabs().length"><router-outlet /></div>
    @if (tabs().length) {
      <ui-tab-bar [tabs]="tabs()" [active]="place().tab" label="Organizer" />
    }
  `,
})
export class AdminShell {
  private readonly router = inject(Router);

  protected readonly place = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
      scan((previous: Place | null, url) => placeFor(url, previous), null),
      map((place) => place!),
    ),
    { initialValue: placeFor(this.router.url, null) },
  );

  protected readonly tabs = computed<Tab[]>(() => {
    const id = this.place().tripId;
    if (!id) return [];
    const base = ['/admin/trips', id];
    return [
      { key: 'overview', label: 'Overview', icon: 'overview', link: base },
      { key: 'rounds', label: 'Rounds', icon: 'flag', link: [...base, 'rounds'] },
      { key: 'people', label: 'People', icon: 'people', link: [...base, 'roster'] },
      { key: 'itinerary', label: 'Itinerary', icon: 'calendar', link: [...base, 'itinerary'] },
    ];
  });
}
