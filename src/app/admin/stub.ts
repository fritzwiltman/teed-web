import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** A screen that arrives in a later milestone (rounds in M3b, trip info in M3c). */
@Component({
  selector: 'app-admin-stub',
  imports: [RouterLink],
  template: `
    <main class="page">
      <a class="back" [routerLink]="['/admin/trips', id()]">‹ Trip</a>
      <h1>{{ heading() }}</h1>
    </main>
  `,
})
export class Stub {
  readonly id = input.required<string>();
  readonly heading = input.required<string>();
}
