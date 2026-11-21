import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

/**
 * A button. Put it on a <button>, an <a>, or the <label> around a hidden file input.
 *
 *   primary   filled, 56 tall (the default)
 *   outline   52 tall
 *   text      a text link
 *   size="small" makes primary or outline 40 tall and only as wide as its label.
 *
 * `tone="danger"` is red: a filled red button (the confirm sheet's) or red text ("Delete trip").
 *
 * `busy` shows a spinner beside the label, which stays ("Publishing…"), and ignores taps.
 */
@Component({
  selector: 'button[ui-button], a[ui-button], label[ui-button]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'variant() + " " + size()',
    '[class.busy]': 'busy()',
    '[class.danger]': "tone() === 'danger'",
    '[attr.aria-busy]': 'busy() ? "true" : null',
  },
  template: `
    @if (busy()) {
      <span class="spinner" aria-hidden="true"></span>
    }
    <ng-content />
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--s2);
      width: 100%;
      min-height: 56px;
      padding: 0 var(--s5);
      border: 2px solid var(--fill);
      border-radius: var(--radius-button);
      background: var(--fill);
      color: var(--on-fill);
      font: 700 17px var(--font-body);
      text-align: center;
      text-decoration: none;
      cursor: pointer;
      touch-action: manipulation;
    }
    :host(.outline) {
      min-height: 52px;
      background: transparent;
      border-color: var(--line-strong);
      color: var(--ink);
    }
    :host(.small) {
      width: auto;
      min-height: 40px;
      padding: 0 var(--s4);
      font-size: 15px;
    }
    :host(.text) {
      width: auto;
      min-height: var(--tap);
      padding: 0 var(--s1);
      border: 0;
      background: none;
      color: var(--accent);
      font-size: 15px;
    }
    :host(.danger) {
      background: var(--red);
      border-color: var(--red);
      color: #fff;
    }
    :host(.text.danger) {
      background: none;
      color: var(--red);
    }
    :host(:disabled),
    :host(.busy) {
      cursor: default;
    }
    :host(:disabled) {
      opacity: 0.45;
    }
    :host(.busy) {
      pointer-events: none;
    }
    .spinner {
      flex: none;
      width: 18px;
      height: 18px;
      border: 2.5px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: ui-spin 0.8s linear infinite;
    }
  `,
})
export class UiButton {
  readonly variant = input<'primary' | 'outline' | 'text'>('primary');
  readonly size = input<'large' | 'small'>('large');
  readonly busy = input(false, { transform: booleanAttribute });
  readonly tone = input<'normal' | 'danger'>('normal');
}
