import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Choice, UiSegmented } from '../core/ui';
import { TripHeader } from './trip-header';

type Segment = 'itinerary' | 'courses' | 'people' | 'info';

/** Trip overview: Itinerary · Courses · People · Info, each its own page under /trip. */
@Component({
  selector: 'app-trip-page',
  imports: [RouterOutlet, TripHeader, UiSegmented],
  template: `
    <app-trip-header title="Trip overview" />
    <main class="content">
      <ui-segmented
        label="Trip overview"
        [options]="segments"
        [value]="active()"
        (valueChange)="go($event)"
      />
      <router-outlet />
    </main>
  `,
})
export class TripPage {
  private readonly router = inject(Router);

  protected readonly segments: Choice<Segment>[] = [
    { value: 'itinerary', label: 'Itinerary' },
    { value: 'courses', label: 'Courses' },
    { value: 'people', label: 'People' },
    { value: 'info', label: 'Info' },
  ];

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );
  protected readonly active = computed<Segment>(() => {
    const part = this.url().split(/[?#]/)[0].split('/')[2] as Segment | undefined;
    return part && this.segments.some((s) => s.value === part) ? part : 'itinerary';
  });

  protected go(segment: Segment | null): void {
    if (segment) void this.router.navigate(['/trip', segment], { replaceUrl: true });
  }
}
