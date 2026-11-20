import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
  model,
  output,
} from '@angular/core';

/** The live dot: 8px, pulsing every 1.6s. Still when the phone asks for reduced motion. */
@Component({
  selector: 'ui-live-dot',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'img', 'aria-label': 'Live' },
  template: '',
  styles: `
    :host {
      display: inline-block;
      flex: none;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--live);
      animation: ui-live 1.6s ease-in-out infinite;
    }
    @keyframes ui-live {
      50% {
        opacity: 0.25;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      :host {
        animation: none;
      }
    }
  `,
})
export class UiLiveDot {}

/**
 * A shimmer block that holds the place of content while it loads.
 * bar: a line of text · block: a card-sized area · circle: an avatar or icon.
 */
@Component({
  selector: 'ui-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'shape()',
    '[style.width]': 'width()',
    '[style.height]': 'height()',
    'aria-hidden': 'true',
  },
  template: '',
  styles: `
    :host {
      display: block;
      border-radius: var(--radius-chip);
      background: linear-gradient(90deg, var(--chip) 25%, var(--line) 50%, var(--chip) 75%);
      background-size: 200% 100%;
      animation: ui-shimmer 1.4s linear infinite;
    }
    :host(.bar) {
      height: 16px;
    }
    :host(.block) {
      height: 96px;
      border-radius: var(--radius-card);
    }
    :host(.circle) {
      width: 40px;
      height: 40px;
      border-radius: 50%;
    }
    @keyframes ui-shimmer {
      from {
        background-position: 200% 0;
      }
      to {
        background-position: -200% 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      :host {
        animation: none;
        background: var(--chip);
      }
    }
  `,
})
export class UiSkeleton {
  readonly shape = input<'bar' | 'block' | 'circle'>('bar');
  readonly width = input<string>();
  readonly height = input<string>();
}

/** A dark bar above the tab bar with one action: "Swapped Ben and Thomas · Undo". */
@Component({
  selector: 'ui-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status' },
  template: `
    <span class="message">{{ message() }}</span>
    @if (action(); as text) {
      <button type="button" (click)="acted.emit()">{{ text }}</button>
    }
  `,
  styles: `
    :host {
      position: fixed;
      left: var(--s4);
      right: var(--s4);
      bottom: calc(var(--tab-bar) + env(safe-area-inset-bottom) + var(--s3));
      z-index: 40;
      max-width: calc(var(--column) - 2 * var(--s4));
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: var(--s3);
      min-height: 52px;
      padding: 0 var(--s2) 0 var(--s4);
      border-radius: var(--radius-button);
      background: var(--toast);
      color: var(--on-toast);
      box-shadow: var(--shadow-raised);
      font-size: 15px;
    }
    .message {
      flex: 1;
      min-width: 0;
      padding: var(--s3) 0;
    }
    button {
      min-height: var(--tap);
      padding: 0 var(--s3);
      border: 0;
      background: none;
      color: inherit;
      font-weight: 700;
      text-decoration: underline;
      text-underline-offset: 3px;
      cursor: pointer;
    }
  `,
})
export class UiToast {
  readonly message = input.required<string>();
  readonly action = input<string>();
  readonly acted = output<void>();
}

/** A sheet that rises from the bottom over a dimmed screen. Tapping the dim closes it. */
@Component({
  selector: 'ui-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="dim" (click)="close()"></div>
      <section role="dialog" aria-modal="true" [attr.aria-label]="label()">
        <button type="button" class="handle" aria-label="Close" (click)="close()"></button>
        <div class="body"><ng-content /></div>
      </section>
    }
  `,
  styles: `
    .dim {
      position: fixed;
      inset: 0;
      z-index: 50;
      background: rgb(0 0 0 / 45%);
    }
    section {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 51;
      max-width: var(--column);
      max-height: 85dvh;
      margin: 0 auto;
      overflow-y: auto;
      border-radius: 18px 18px 0 0;
      background: var(--card);
      color: var(--ink);
      box-shadow: var(--shadow-raised);
      padding-bottom: env(safe-area-inset-bottom);
      animation: ui-rise 0.2s ease-out;
    }
    .handle {
      display: block;
      width: 100%;
      height: 28px;
      padding: 0;
      border: 0;
      background: none;
      cursor: pointer;
    }
    .handle::before {
      content: '';
      display: block;
      width: 40px;
      height: 5px;
      margin: 0 auto;
      border-radius: var(--radius-pill);
      background: var(--line-strong);
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: var(--s3);
      padding: var(--s1) var(--s4) var(--s5);
    }
    @keyframes ui-rise {
      from {
        transform: translateY(100%);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      section {
        animation: none;
      }
    }
  `,
})
export class UiSheet {
  readonly open = model(false);
  readonly label = input<string>();
  /** Set to keep the sheet up when the dim is tapped (a step that must be answered). */
  readonly sticky = input(false, { transform: booleanAttribute });

  protected close(): void {
    if (!this.sticky()) this.open.set(false);
  }
}
