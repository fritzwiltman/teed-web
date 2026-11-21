import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { IconName, UiIcon } from './icon';

/**
 * One row in a card: a title, an optional detail line under it, an optional icon at the left, and
 * at the right a value or whatever is put inside the row, then an optional chevron.
 * Use it on an <a> or <button> to make the whole row tappable.
 *
 * `expanded` makes it a disclosure row (one that opens more below it): the chevron points right
 * while closed and turns to point down when open, in 150ms (no turn under Reduce Motion).
 */
@Component({
  selector: 'ui-list-row, a[ui-list-row], button[ui-list-row], label[ui-list-row]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.aria-expanded]': 'expanded()' },
  imports: [UiIcon],
  template: `
    @if (icon(); as name) {
      <ui-icon class="lead" [name]="name" />
    }
    <span class="text">
      @if (eyebrow()) {
        <span class="eyebrow">{{ eyebrow() }}</span>
      }
      <span class="title">{{ title() }}<ng-content select="[after-title]" /></span>
      @if (detail()) {
        <span class="detail">{{ detail() }}</span>
      }
      <ng-content select="[below]" />
    </span>
    <span class="end">
      @if (value()) {
        <span class="value">{{ value() }}</span>
      }
      <ng-content />
      @if (chevron() || expanded() !== null) {
        <ui-icon class="chevron" name="chevron-right" [class.open]="expanded() === true" />
      }
    </span>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--s3);
      width: 100%;
      min-height: 56px;
      padding: var(--s3) var(--s4);
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      text-decoration: none;
    }
    :host(:not(:first-child)) {
      border-top: 1px solid var(--line);
    }
    :host(a),
    :host(button),
    :host(label) {
      cursor: pointer;
    }
    :host(button:disabled) {
      opacity: 0.5;
      cursor: default;
    }
    .lead {
      color: var(--accent);
    }
    .text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .title {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--s2);
      overflow-wrap: anywhere;
    }
    .eyebrow {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--muted);
    }
    .detail {
      font-size: 14px;
      font-weight: 500;
      color: var(--muted);
    }
    .end {
      flex: none;
      display: flex;
      align-items: center;
      gap: var(--s2);
    }
    .end:empty {
      display: none;
    }
    .value {
      color: var(--ink-2);
    }
    .chevron {
      width: 20px;
      height: 20px;
      color: var(--muted);
      transition: transform 150ms ease;
    }
    .chevron.open {
      transform: rotate(90deg);
    }
    @media (prefers-reduced-motion: reduce) {
      .chevron {
        transition: none;
      }
    }
  `,
})
export class UiListRow {
  readonly title = input<string>();
  /** A small-caps line above the title: "R1 · Fri, Oct 9 · 10:50 AM". */
  readonly eyebrow = input<string | null>();
  readonly detail = input<string | null>();
  readonly icon = input<IconName>();
  readonly value = input<string | null>();
  readonly chevron = input(false, { transform: booleanAttribute });
  /** A disclosure row: true open, false closed; null (the default) is an ordinary row. */
  readonly expanded = input<boolean | null>(null);
}
