import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  booleanAttribute,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconName, UiIcon } from './icon';

/**
 * The pine header band at the top of every screen.
 *
 *   main       label line + title
 *   sub-page   back link + title            (give `back`)
 *   trip       the trip line (with a down arrow when `switcher`) + title, and an optional pill
 *
 * It sticks to the top. Once the big title has scrolled away it becomes a compact bar: the title
 * alone, small and centred, with the back chevron and the action kept.
 *
 * `switcher` makes the label line a button with a down arrow ("SOUTHERN PINES · OCT 8–12 ⌄"):
 * it emits `switched`, and the page opens the trip switcher. Spectators get no arrow.
 * `action` is the small outlined pill at the top right: Alert on an organizer's Home.
 * `titleTap` makes the big title a button too ("Hole 7 ⌄" opens the hole picker).
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
        } @else if (label() && switcher()) {
          <button type="button" class="label switch" (click)="switched.emit()">
            <span>{{ label() }}</span>
            <ui-icon name="chevron-down" />
          </button>
        } @else if (label()) {
          <p class="label">{{ label() }}</p>
        }
        <p class="compact" aria-hidden="true">{{ title() }}</p>
        @if (action(); as text) {
          @if (actionLink(); as link) {
            <a class="action" [routerLink]="link">
              @if (actionIcon(); as icon) {
                <ui-icon [name]="icon" />
              }
              {{ text }}
            </a>
          } @else {
            <button type="button" class="action" (click)="acted.emit()">
              @if (actionIcon(); as icon) {
                <ui-icon [name]="icon" />
              }
              {{ text }}
            </button>
          }
        }
      </div>
    </div>
    <header class="large" #large>
      <div class="inner">
        @if (titleTap()) {
          <h1>
            <button type="button" class="title-tap" (click)="titleTapped.emit()">
              {{ title() }}<ui-icon name="chevron-down" />
            </button>
          </h1>
        } @else {
          <h1>{{ title() }}</h1>
        }
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
      min-height: 44px;
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
    .switch {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: var(--tap);
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font-family: inherit;
      cursor: pointer;
    }
    .switch span {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .switch ui-icon {
      width: 14px;
      height: 14px;
    }
    .title-tap {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .title-tap ui-icon {
      width: 22px;
      height: 22px;
      opacity: 0.8;
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
      min-height: 34px;
      padding: 0 14px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1.5px solid rgb(255 255 255 / 60%);
      border-radius: var(--radius-pill);
      background: transparent;
      color: inherit;
      font-size: 14px;
      font-weight: 700;
      text-decoration: none;
      cursor: pointer;
    }
    .action ui-icon {
      width: 16px;
      height: 16px;
    }
    .large .inner {
      padding-bottom: var(--s3);
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
  readonly actionIcon = input<IconName>();
  readonly acted = output<void>();
  /** The label line is the trip switcher's button. */
  readonly switcher = input(false, { transform: booleanAttribute });
  readonly switched = output<void>();
  /** The big title is a button with a down arrow. */
  readonly titleTap = input(false, { transform: booleanAttribute });
  readonly titleTapped = output<void>();

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
