import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconName, UiIcon } from './icon';

/** A small fact on a tinted tile: "8:10 AM", "Sixes", "White tees". */
@Component({
  selector: 'ui-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  template: `
    @if (icon(); as name) {
      <ui-icon [name]="name" />
    }
    <ng-content />
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--s1);
      min-height: 28px;
      padding: 2px var(--s2);
      border-radius: var(--radius-chip);
      background: var(--chip);
      color: var(--ink-2);
      font-size: 14px;
      white-space: nowrap;
    }
    :host(.warn) {
      background: var(--warn-bg);
      color: var(--warn-text);
    }
    ui-icon {
      width: 16px;
      height: 16px;
    }
  `,
})
export class UiChip {
  readonly icon = input<IconName>();
}

/** A trip's stage, and two of a round's: live (in play) and complete (all scores in, not final). */
export type TripStage = 'draft' | 'upcoming' | 'in-progress' | 'final' | 'live' | 'complete';

const STAGE_TEXT: Record<TripStage, string> = {
  draft: 'Draft',
  upcoming: 'Upcoming',
  'in-progress': 'In progress',
  final: 'Final',
  live: 'Live',
  complete: 'Complete',
};

/**
 * Where a trip stands: a published trip is Upcoming until its first day, then In progress until
 * the organizer makes it final.
 */
export function tripStage(
  trip: { status: 'draft' | 'live' | 'final'; start_date: string },
  today: string,
): TripStage {
  if (trip.status !== 'live') return trip.status;
  return today < trip.start_date ? 'upcoming' : 'in-progress';
}

/** Draft amber · Upcoming neutral · In progress (and Live) green · Final dark · Complete neutral. */
@Component({
  selector: 'ui-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'stage()' },
  template: `{{ text() }}`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 0 var(--s2);
      border-radius: var(--radius-chip);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      white-space: nowrap;
    }
    :host(.draft) {
      background: var(--warn-bg);
      color: var(--warn-text);
    }
    :host(.upcoming),
    :host(.complete) {
      background: var(--chip);
      color: var(--ink-2);
    }
    :host(.in-progress),
    :host(.live) {
      background: var(--fill);
      color: var(--on-fill);
    }
    :host(.final) {
      background: var(--ink);
      color: var(--bg);
    }
  `,
})
export class UiBadge {
  readonly stage = input.required<TripStage>();
  protected readonly text = computed(() => STAGE_TEXT[this.stage()]);
}
