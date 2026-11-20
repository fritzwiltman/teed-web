import {
  ChangeDetectionStrategy,
  Component,
  ViewEncapsulation,
  booleanAttribute,
  input,
  model,
} from '@angular/core';
import { UiIcon } from './icon';

/** An on/off switch, 52×32. */
@Component({
  selector: 'ui-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      role="switch"
      [class.on]="checked()"
      [attr.aria-checked]="checked()"
      [attr.aria-label]="label()"
      [disabled]="disabled()"
      (click)="checked.set(!checked())"
    >
      <span class="knob"></span>
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    button {
      position: relative;
      width: 52px;
      height: 32px;
      padding: 0;
      border: 0;
      border-radius: var(--radius-pill);
      background: var(--line-strong);
      cursor: pointer;
      transition: background 0.15s;
    }
    button.on {
      background: var(--fill);
    }
    button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .knob {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: #fff;
      box-shadow: 0 1px 2px rgb(0 0 0 / 25%);
      transition: transform 0.15s;
    }
    .on .knob {
      transform: translateX(20px);
    }
    @media (prefers-reduced-motion: reduce) {
      button,
      .knob {
        transition: none;
      }
    }
  `,
})
export class UiSwitch {
  readonly checked = model(false);
  readonly label = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
}

/** A checkbox, 30×30. */
@Component({
  selector: 'ui-checkbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  template: `
    <button
      type="button"
      role="checkbox"
      [class.on]="checked()"
      [attr.aria-checked]="checked()"
      [attr.aria-label]="label()"
      [disabled]="disabled()"
      (click)="checked.set(!checked())"
    >
      @if (checked()) {
        <ui-icon name="check" />
      }
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    button {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      padding: 0;
      border: 2px solid var(--line-strong);
      border-radius: 7px;
      background: var(--card);
      color: var(--on-fill);
      cursor: pointer;
    }
    button.on {
      border-color: var(--fill);
      background: var(--fill);
    }
    button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    ui-icon {
      width: 20px;
      height: 20px;
    }
  `,
})
export class UiCheckbox {
  readonly checked = model(false);
  readonly label = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
}

/**
 * A form field: the label above, then the <input>, <select> or <textarea> you put inside it,
 * 50 tall. Add a [hint] element for a line under the control. Wrap it in nothing else: the field
 * is the <label>, so tapping the label focuses the control.
 */
@Component({
  selector: 'ui-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <label class="ui-field-label">
      <span class="ui-field-name">{{ label() }}</span>
      <ng-content />
    </label>
    <ng-content select="[hint]" />
  `,
  styles: `
    ui-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .ui-field-label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .ui-field-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--ink-2);
    }
    ui-field [hint] {
      font-size: 14px;
      font-weight: 500;
      color: var(--muted);
    }
    ui-field input,
    ui-field select,
    ui-field textarea {
      display: block;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      min-height: 50px;
      margin: 0;
      padding: 0 var(--s3);
      border: 1.5px solid var(--line-strong);
      border-radius: var(--radius-button);
      background: var(--card);
      color: var(--ink);
      font: 600 17px var(--font-body); /* 16px or more, so iOS doesn't zoom on focus */
      appearance: none;
      -webkit-appearance: none;
      text-align: left;
    }
    ui-field textarea {
      min-height: 110px;
      padding: var(--s3);
      resize: vertical;
    }
    ui-field input::placeholder {
      color: var(--muted);
      opacity: 0.6;
      font-weight: 500;
    }
    ui-field input:focus-visible,
    ui-field select:focus-visible,
    ui-field textarea:focus-visible {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent);
    }
    ui-field input:disabled,
    ui-field select:disabled,
    ui-field textarea:disabled {
      opacity: 0.6;
    }
    ui-field input[aria-invalid='true'] {
      border-color: var(--red);
    }
    /* iOS sizes and centres date and time inputs its own way; make them sit like a text field. */
    ui-field input[type='date'],
    ui-field input[type='time'],
    ui-field input[type='datetime-local'] {
      display: flex;
      align-items: center;
      height: 50px;
    }
    ui-field input::-webkit-date-and-time-value {
      margin: 0;
      text-align: left;
    }
    ui-field.compact input {
      text-align: center;
      padding: 0 var(--s1);
    }
  `,
})
export class UiField {
  readonly label = input.required<string>();
}

/** "Paid" with a check in the accent colour, or "Not paid" with an X in red. */
@Component({
  selector: 'ui-paid-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  host: { '[class.paid]': 'paid()' },
  template: `
    <ui-icon [name]="paid() ? 'check' : 'x'" />
    <span>{{ paid() ? 'Paid' : 'Not paid' }}</span>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: var(--s1);
      color: var(--red);
      font-size: 15px;
      font-weight: 700;
      white-space: nowrap;
    }
    :host(.paid) {
      color: var(--accent);
    }
    ui-icon {
      width: 18px;
      height: 18px;
    }
  `,
})
export class UiPaidStatus {
  readonly paid = input(false, { transform: booleanAttribute });
}
