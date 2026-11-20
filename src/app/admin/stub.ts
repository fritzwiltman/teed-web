import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { UiHeaderBand } from '../core/ui';
import { AdminData, Trip } from './data';
import { OrganizerHeader } from './organizer-header';

/** A screen that arrives in a later milestone (rounds in M3b, the itinerary in M3c). */
@Component({
  selector: 'app-admin-stub',
  imports: [OrganizerHeader, UiHeaderBand],
  template: `
    @if (back(); as to) {
      <ui-header-band [title]="heading()" [back]="backLink()" [backLabel]="backLabel() ?? to" />
    } @else {
      <app-organizer-header [title]="heading()" [trip]="trip()" />
    }
  `,
})
export class Stub {
  readonly id = input.required<string>();
  readonly heading = input.required<string>();
  /** For a sub-page: the path under the trip to go back to, and what to call it. */
  readonly back = input<string>();
  readonly backLabel = input<string>();

  protected readonly backLink = computed(() => ['/admin/trips', this.id(), this.back() ?? '']);
  protected readonly trip = signal<Trip | null>(null);

  constructor() {
    const data = inject(AdminData);
    effect(() => {
      data.trip(this.id()).then(
        (trip) => this.trip.set(trip),
        () => {},
      );
    });
  }
}
