import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { UiButton } from './button';
import { UiSheet } from './feedback';

/**
 * The one amber "!" beside a name, for anything an organizer must act on ("No email yet",
 * "Hasn't joined", "Not paid"). Tapping it shows the reasons in a small tooltip right next to
 * the icon, with a pointer. The tooltip floats over the page, so the row never changes height.
 */
@Component({
  selector: 'ui-attention',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkOverlayOrigin, CdkConnectedOverlay],
  template: `
    <button
      type="button"
      class="mark"
      cdkOverlayOrigin
      #origin="cdkOverlayOrigin"
      [attr.aria-label]="reasons().join(', ')"
      [attr.aria-expanded]="open()"
      (click)="toggle($event)"
    >
      !
    </button>
    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayPositions]="positions"
      [cdkConnectedOverlayPush]="true"
      [cdkConnectedOverlayViewportMargin]="12"
      (overlayOutsideClick)="open.set(false)"
      (detach)="open.set(false)"
    >
      <div class="tip" role="tooltip">
        @for (reason of reasons(); track reason) {
          <span>{{ reason }}</span>
        }
      </div>
    </ng-template>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    .mark {
      position: relative;
      display: inline-grid;
      place-items: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border: 1.5px solid var(--warn-edge);
      border-radius: 50%;
      background: var(--warn-bg);
      color: var(--warn-edge);
      font: 800 13px/1 var(--font-body);
      cursor: pointer;
    }
    /* A bigger target than it looks. */
    .mark::after {
      content: '';
      position: absolute;
      inset: -12px;
    }
    .tip {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-left: 10px;
      padding: var(--s2) var(--s3);
      border-radius: var(--radius-chip);
      background: var(--toast);
      color: var(--on-toast);
      box-shadow: var(--shadow-raised);
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
    }
    .tip::before {
      content: '';
      position: absolute;
      top: 50%;
      left: -6px;
      margin-top: -6px;
      border: 6px solid transparent;
      border-left: 0;
      border-right-color: var(--toast);
    }
  `,
})
export class UiAttention {
  readonly reasons = input.required<string[]>();
  protected readonly open = signal(false);
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center' },
  ];

  protected toggle(event: Event): void {
    event.stopPropagation(); // a row around it must not open too
    this.open.update((open) => !open);
  }
}

/**
 * Confirming something that can't be undone: the question as the title, one honest line, a red
 * button and Cancel. "Delete Southern Pines 2026?", "Remove Charlie?", "Make Von the organizer?"
 */
@Component({
  selector: 'ui-confirm-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiSheet],
  template: `
    <ui-sheet [(open)]="open" [label]="title()">
      <h2>{{ title() }}</h2>
      <p class="line">{{ line() }}</p>
      <ng-content />
      <button ui-button type="button" class="danger" [busy]="busy()" (click)="confirmed.emit()">
        {{ action() }}
      </button>
      <button ui-button type="button" variant="outline" (click)="open.set(false)">Cancel</button>
    </ui-sheet>
  `,
  styles: `
    h2 {
      font-size: 24px;
    }
    .line {
      font-size: 16px;
      font-weight: 500;
      color: var(--ink-2);
    }
    .danger {
      background: var(--red);
      border-color: var(--red);
      color: #fff;
    }
  `,
})
export class UiConfirmSheet {
  readonly open = model(false);
  readonly title = input.required<string>();
  readonly line = input.required<string>();
  /** The red button: "Delete trip", "Remove Charlie". */
  readonly action = input.required<string>();
  readonly busy = input(false, { transform: booleanAttribute });
  readonly confirmed = output<void>();
}

/**
 * The Edit pill beside the title of what it edits. Tapping it turns that section into edit mode;
 * it then reads Done, filled, in the same spot.
 */
@Component({
  selector: 'button[ui-edit-pill]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    type: 'button',
    '[class.on]': 'editing()',
    '[attr.aria-pressed]': 'editing()',
  },
  template: `{{ editing() ? 'Done' : 'Edit' }}`,
  styles: `
    :host {
      flex: none;
      min-height: 32px;
      min-width: 64px;
      padding: 0 14px;
      border: 1.5px solid var(--line-strong);
      border-radius: var(--radius-pill);
      background: transparent;
      color: var(--accent);
      font: 700 15px var(--font-body);
      cursor: pointer;
      touch-action: manipulation;
    }
    :host(.on) {
      border-color: var(--fill);
      background: var(--fill);
      color: var(--on-fill);
    }
  `,
})
export class UiEditPill {
  readonly editing = input(false, { transform: booleanAttribute });
}
