import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * The logo lockup: the cropped tee mark and "teed". The gap is 15% of the word's size. On the
 * green header band the tee is white; on light screens it is green. (The rounded tile is only for
 * the app icon, never here.)
 */
@Component({
  selector: 'ui-logo',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    'aria-label': 'teed',
    '[class.on-band]': "tone() === 'band'",
    '[style.font-size.px]': 'size()',
    '[style.gap.px]': 'gap()',
  },
  template: `
    <svg viewBox="350 170 324 690" aria-hidden="true">
      <circle cx="512" cy="292" r="118" class="ball" />
      <path
        class="tee"
        d="M 362 400 Q 512 446 662 400 L 662 418 Q 582 464 556 492 L 528 820 L 512 852 L 496 820 L 468 492 Q 442 464 362 418 Z"
      />
    </svg>
    <span aria-hidden="true">teed</span>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      color: var(--accent);
      font-family: var(--font-heading);
      font-weight: 700;
      letter-spacing: -0.015em;
      line-height: 1;
    }
    :host(.on-band) {
      color: var(--on-band);
    }
    svg {
      height: 1.15em;
      width: auto;
    }
    .ball {
      fill: var(--live);
    }
    .tee {
      fill: currentColor;
    }
  `,
})
export class UiLogo {
  /** The word's size in px. */
  readonly size = input(20);
  /** 'band' on the green header; 'light' on a light screen. */
  readonly tone = input<'band' | 'light'>('light');
  protected readonly gap = computed(() => Math.round(this.size() * 0.15 * 10) / 10);
}

/** "Syncing 2 scores", with the one spinner allowed outside a button. */
@Component({
  selector: 'ui-sync-line',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status' },
  template: `<span class="spinner" aria-hidden="true"></span><ng-content />`,
  styles: `
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--s2);
      font-size: 14px;
      font-weight: 600;
      color: var(--muted);
    }
    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: ui-spin 0.8s linear infinite;
    }
    @media (prefers-reduced-motion: reduce) {
      .spinner {
        animation-duration: 2.4s;
      }
    }
  `,
})
export class UiSyncLine {}
