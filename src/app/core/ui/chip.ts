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

export type TripStatusName = 'draft' | 'live' | 'final';

/** Draft / Live / Final. */
@Component({
  selector: 'ui-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'status()' },
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
    :host(.live) {
      background: var(--fill);
      color: var(--on-fill);
    }
    :host(.final) {
      background: var(--chip);
      color: var(--muted);
    }
  `,
})
export class UiBadge {
  readonly status = input.required<TripStatusName>();
  protected readonly text = computed(() => this.status());
}
