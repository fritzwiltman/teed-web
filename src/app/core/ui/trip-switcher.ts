import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { UiSheet } from './feedback';
import { UiIcon } from './icon';

export interface SwitcherTrip {
  id: string;
  name: string;
  /** "Oct 8–12 · now" */
  detail: string;
}

/**
 * The trip switcher, opened from the trip line in a trip's header. The top row is you (your
 * trips, career, head to head: the You page); then current and upcoming trips, the open one
 * checked.
 */
@Component({
  selector: 'ui-trip-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon, UiSheet],
  template: `
    <ui-sheet [(open)]="open" label="Your trips">
      <div class="list">
        <button type="button" class="row" (click)="choose(null)">
          <span class="initial" aria-hidden="true">{{ initial() }}</span>
          <span class="text">
            <span class="title">{{ name() }}</span>
            <span class="detail">Your trips, career, head to head</span>
          </span>
          <ui-icon name="chevron-right" class="chevron" />
        </button>
        @if (trips().length) {
          <p class="label">Trips</p>
          @for (trip of trips(); track trip.id) {
            <button
              type="button"
              class="row"
              [attr.aria-current]="trip.id === current() ? 'true' : null"
              (click)="choose(trip.id)"
            >
              <span class="text">
                <span class="title">{{ trip.name }}</span>
                <span class="detail">{{ trip.detail }}</span>
              </span>
              @if (trip.id === current()) {
                <ui-icon name="check" class="check" />
              }
            </button>
          }
        }
      </div>
    </ui-sheet>
  `,
  styles: `
    .list {
      display: flex;
      flex-direction: column;
    }
    .row {
      display: flex;
      align-items: center;
      gap: var(--s3);
      min-height: 60px;
      padding: var(--s3) 0;
      border: 0;
      background: none;
      color: var(--ink);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .row + .row {
      border-top: 1px solid var(--line);
    }
    .initial {
      flex: none;
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--fill);
      color: var(--on-fill);
      font: 700 17px var(--font-heading);
    }
    .text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .detail {
      font-size: 14px;
      font-weight: 500;
      color: var(--muted);
    }
    .label {
      padding: var(--s3) 0 2px;
      border-top: 1px solid var(--line);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--muted);
    }
    .chevron {
      width: 18px;
      height: 18px;
      color: var(--muted);
    }
    .check {
      color: var(--accent);
    }
  `,
})
export class UiTripSwitcher {
  readonly open = model(false);
  readonly name = input.required<string>();
  readonly initial = input.required<string>();
  readonly trips = input.required<SwitcherTrip[]>();
  readonly current = input<string | null>(null);
  /** A trip's id, or null for You. */
  readonly chosen = output<string | null>();

  protected choose(id: string | null): void {
    this.open.set(false);
    this.chosen.emit(id);
  }
}
