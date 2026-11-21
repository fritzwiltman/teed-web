import { ChangeDetectionStrategy, Component, booleanAttribute, input, model } from '@angular/core';

export interface Choice<T = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/** Pick one from a row of pills: "3 hours · End of day · Tomorrow". */
@Component({
  selector: 'ui-choice-pills',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'radiogroup', '[attr.aria-label]': 'label()' },
  template: `
    @for (option of options(); track option.value) {
      <button
        type="button"
        role="radio"
        [class.on]="value() === option.value"
        [attr.aria-checked]="value() === option.value"
        [disabled]="disabled() || option.disabled"
        (click)="value.set(option.value)"
      >
        {{ option.label }}
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      gap: var(--s2);
    }
    button {
      min-height: var(--tap);
      padding: 0 var(--s4);
      border: 1.5px solid var(--line-strong);
      border-radius: var(--radius-pill);
      background: transparent;
      color: var(--ink);
      font-size: 15px;
      cursor: pointer;
    }
    button.on {
      border-color: var(--fill);
      background: var(--fill);
      color: var(--on-fill);
      font-weight: 700;
    }
    button:disabled {
      opacity: 0.45;
      cursor: default;
    }
  `,
})
export class UiChoicePills<T = string> {
  readonly options = input.required<Choice<T>[]>();
  readonly value = model<T | null>(null);
  readonly label = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
}

/** Two or three options side by side, one of them on: "Auto · Light · Dark". */
@Component({
  selector: 'ui-segmented',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'radiogroup', '[attr.aria-label]': 'label()' },
  template: `
    @for (option of options(); track option.value) {
      <button
        type="button"
        role="radio"
        [class.on]="value() === option.value"
        [attr.aria-checked]="value() === option.value"
        [disabled]="disabled() || option.disabled"
        (click)="value.set(option.value)"
      >
        {{ option.label }}
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      padding: 3px;
      border-radius: var(--radius-button);
      background: var(--chip);
    }
    button {
      flex: 1 1 0;
      min-width: 0;
      min-height: 38px;
      padding: 0 var(--s3);
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--ink-2);
      font-size: 15px;
      white-space: nowrap;
      cursor: pointer;
    }
    button.on {
      background: var(--card);
      color: var(--ink);
      font-weight: 700;
      box-shadow: var(--shadow-card);
    }
    button:disabled {
      opacity: 0.45;
      cursor: default;
    }
  `,
})
export class UiSegmented<T = string> {
  readonly options = input.required<Choice<T>[]>();
  readonly value = model<T | null>(null);
  readonly label = input<string>();
  readonly disabled = input(false, { transform: booleanAttribute });
}
