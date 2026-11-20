import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map, scan, startWith } from 'rxjs';

interface Place {
  /** Which tab is lit. */
  tab: 'trips' | 'trip' | 'roster' | 'courses';
  /** The trip in hand, if any. It stays selected while you look at the course library. */
  tripId: string | null;
}

/** Works out where we are from the address. `previous` carries the selected trip into the course library. */
export function placeFor(url: string, previous: Place | null): Place {
  const path = url.split(/[?#]/)[0];
  const trip = /^\/admin\/trips\/([^/]+)(?:\/([^/]+))?/.exec(path);
  if (trip && trip[1] !== 'new')
    return { tab: trip[2] === 'roster' ? 'roster' : 'trip', tripId: trip[1] };
  if (path.startsWith('/admin/courses'))
    return { tab: 'courses', tripId: previous?.tripId ?? null };
  return { tab: 'trips', tripId: null };
}

/** The organizer frame: the current screen with the floating pill nav over it. */
@Component({
  selector: 'app-admin-shell',
  imports: [RouterOutlet, RouterLink],
  template: `
    <div class="with-nav"><router-outlet /></div>
    <nav class="pill-nav" aria-label="Organizer">
      <a
        routerLink="/admin"
        [class.active]="place().tab === 'trips'"
        [attr.aria-current]="place().tab === 'trips' ? 'page' : null"
        >Trips</a
      >
      @if (place().tripId; as id) {
        <a
          [routerLink]="['/admin/trips', id]"
          [class.active]="place().tab === 'trip'"
          [attr.aria-current]="place().tab === 'trip' ? 'page' : null"
          >Trip</a
        >
        <a
          [routerLink]="['/admin/trips', id, 'roster']"
          [class.active]="place().tab === 'roster'"
          [attr.aria-current]="place().tab === 'roster' ? 'page' : null"
          >Roster</a
        >
      }
      <a
        routerLink="/admin/courses"
        [class.active]="place().tab === 'courses'"
        [attr.aria-current]="place().tab === 'courses' ? 'page' : null"
        >Courses</a
      >
    </nav>
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

  protected readonly hasTrip = computed(() => !!this.place().tripId);
}
