import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiIcon } from './icon';

/**
 * The pine header band at the top of every screen.
 *
 *   main       label line + title
 *   sub-page   back link + title            (give `back`)
 *   organizer  label line + title + action  (give `action`)
 *
 * It sticks to the top. Once the big title has scrolled away it becomes a compact bar: the title
 * alone, small and centred, with the back chevron and the action kept.
 *
 * `action` is the small outlined pill at the top right. It is also the player / organizer mode
 * switch: "Manage" on player screens, "Player view" on organizer screens.
 *
 * Put it straight inside the screen's outer element, so it stays stuck for the whole page.
 */
@Component({
  selector: 'ui-header-band',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiIcon],
  template: `
    <div class="bar" [class.stuck]="stuck()">
      <div class="inner">
        @if (back(); as link) {
          <a class="back" [routerLink]="link">
            <ui-icon name="chevron-left" />
            <span>{{ backLabel() }}</span>
          </a>
        } @else if (label()) {
          <p class="label">{{ label() }}</p>
        }
        <p class="compact" aria-hidden="true">{{ title() }}</p>
        @if (action(); as text) {
          @if (actionLink(); as link) {
            <a class="action" [routerLink]="link">{{ text }}</a>
          } @else {
            <button type="button" class="action" (click)="acted.emit()">{{ text }}</button>
          }
        }
      </div>
    </div>
    <header class="large" #large>
      <div class="inner">
        <h1>{{ title() }}</h1>
      </div>
    </header>
  `,
  styles: `
    :host {
      display: contents;
    }
    .bar,
    .large {
      background: var(--band);
      color: var(--on-band);
    }
    .bar {
      position: sticky;
      top: 0;
      z-index: 20;
      padding-top: env(safe-area-inset-top);
      transition: box-shadow 0.2s;
    }
    .bar.stuck {
      box-shadow: 0 2px 8px rgb(0 0 0 / 25%);
    }
    .inner {
      max-width: var(--column);
      margin: 0 auto;
      padding: 0 var(--s4);
    }
    .bar .inner {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--s3);
      min-height: 48px;
    }
    .label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      opacity: 0.85;
      transition: opacity 0.2s;
    }
    .stuck .label {
      opacity: 0;
    }
    .back {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      min-height: var(--tap);
      margin-left: -6px;
      color: inherit;
      font-size: 15px;
      text-decoration: none;
    }
    .back span {
      transition: opacity 0.2s;
    }
    .stuck .back span {
      opacity: 0;
    }
    .compact {
      position: absolute;
      left: 50%;
      max-width: 55%;
      transform: translate(-50%, 6px);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font: 700 18px var(--font-heading);
      opacity: 0;
      pointer-events: none;
      transition:
        opacity 0.2s,
        transform 0.2s;
    }
    .stuck .compact {
      opacity: 1;
      transform: translate(-50%, 0);
    }
    .action {
      flex: none;
      margin-left: auto;
      min-height: 32px;
      padding: 0 14px;
      display: inline-flex;
      align-items: center;
      border: 1.5px solid rgb(255 255 255 / 60%);
      border-radius: var(--radius-pill);
      background: transparent;
      color: inherit;
      font-size: 14px;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
    }
    .large .inner {
      padding-bottom: var(--s4);
    }
    h1 {
      font-size: 32px;
      overflow-wrap: anywhere;
    }
    @media (prefers-reduced-motion: reduce) {
      .bar,
      .label,
      .back span,
      .compact {
        transition: none;
      }
    }
  `,
})
export class UiHeaderBand {
  readonly title = input.required<string>();
  /** Small caps line above the title, e.g. "Organizer · Vero Beach 2027". */
  readonly label = input<string>();
  /** Where the back link goes. Giving this makes it the sub-page variant. */
  readonly back = input<string | readonly unknown[]>();
  readonly backLabel = input('Back');
  /** Text of the pill at the top right. */
  readonly action = input<string>();
  /** Where the pill goes. Without it the pill is a button and emits `acted`. */
  readonly actionLink = input<string | readonly unknown[]>();
  readonly acted = output<void>();

  protected readonly stuck = signal(false);
  private readonly large = viewChild.required<ElementRef<HTMLElement>>('large');

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      if (typeof IntersectionObserver !== 'function') return;
      // Compact once the big title has gone under the bar.
      const observer = new IntersectionObserver(
        ([entry]) => this.stuck.set(!entry.isIntersecting),
        { rootMargin: '-56px 0px 0px 0px' },
      );
      observer.observe(this.large().nativeElement);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }
}
