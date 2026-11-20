import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  booleanAttribute,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
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

/** How many sheets are open: the page behind stays still while any is. */
let sheetsOpen = 0;

function lockPage(lock: boolean): void {
  sheetsOpen = Math.max(0, sheetsOpen + (lock ? 1 : -1));
  document.documentElement.classList.toggle('ui-sheet-open', sheetsOpen > 0);
}

/**
 * A sheet that rises from the bottom over a dimmed screen. It closes on a tap of the dim, on
 * Escape, and when dragged down past about a third of its height or flicked down; a shorter drag
 * springs back. The page behind does not scroll while it is open.
 */
@Component({
  selector: 'ui-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'close()' },
  template: `
    @if (open()) {
      <div
        #dim
        class="dim"
        [class.leaving]="leaving()"
        [style.opacity]="dimmed()"
        (click)="close()"
      ></div>
      <section
        #sheet
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="label()"
        [class.dragging]="dragging()"
        [class.leaving]="leaving()"
        [style.transform]="shift()"
      >
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
      touch-action: none;
      animation: ui-dim 0.2s ease-out;
      transition: opacity 0.2s ease-out;
    }
    .dim.leaving {
      opacity: 0;
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
      overscroll-behavior: contain;
      border-radius: 18px 18px 0 0;
      background: var(--card);
      color: var(--ink);
      box-shadow: var(--shadow-raised);
      padding-bottom: env(safe-area-inset-bottom);
      animation: ui-rise 0.2s ease-out;
      transition: transform 0.2s ease-out;
    }
    section.dragging {
      transition: none;
    }
    section.leaving {
      transform: translateY(100%);
    }
    .handle {
      display: block;
      width: 100%;
      height: 28px;
      padding: 0;
      border: 0;
      background: none;
      cursor: grab;
      touch-action: none;
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
    @keyframes ui-dim {
      from {
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .dim,
      section {
        animation: none;
        transition: none;
      }
    }
  `,
})
export class UiSheet {
  readonly open = model(false);
  readonly label = input<string>();
  /** Set to keep the sheet up until one of its buttons is tapped (a step that must be answered). */
  readonly sticky = input(false, { transform: booleanAttribute });

  private readonly sheet = viewChild<ElementRef<HTMLElement>>('sheet');
  private readonly dim = viewChild<ElementRef<HTMLElement>>('dim');

  /** How far the sheet has been dragged down, in px. */
  private readonly offset = signal(0);
  protected readonly dragging = signal(false);
  /** Sliding away, just before it goes. */
  protected readonly leaving = signal(false);
  protected readonly shift = computed(() =>
    this.offset() > 0 && !this.leaving() ? `translateY(${this.offset()}px)` : null,
  );
  /** The dim lightens as the sheet is dragged away. */
  protected readonly dimmed = computed(() => {
    const height = this.height;
    return this.offset() > 0 && height && !this.leaving()
      ? Math.max(0, 1 - this.offset() / height)
      : null;
  });

  private height = 0;
  private locked = false;
  private leaveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // The page behind stays put while the sheet is up.
    effect(() => this.lock(this.open()));
    // A sheet closed from outside (its own buttons) starts clean next time.
    effect(() => {
      if (!this.open()) this.reset();
    });
    // Touches are listened to directly: they must be able to stop the page scrolling.
    effect((onCleanup) => {
      const sheet = this.sheet()?.nativeElement;
      const dim = this.dim()?.nativeElement;
      if (!sheet || !dim) return;
      const stop = (event: Event) => event.preventDefault();
      const drag = this.dragFrom(sheet);
      dim.addEventListener('touchmove', stop, { passive: false });
      sheet.addEventListener('touchstart', drag.start, { passive: true });
      sheet.addEventListener('touchmove', drag.move, { passive: false });
      sheet.addEventListener('touchend', drag.end);
      sheet.addEventListener('touchcancel', drag.end);
      const handle = sheet.querySelector<HTMLElement>('.handle')!;
      handle.addEventListener('pointerdown', drag.mouseDown);
      onCleanup(() => {
        dim.removeEventListener('touchmove', stop);
        sheet.removeEventListener('touchstart', drag.start);
        sheet.removeEventListener('touchmove', drag.move);
        sheet.removeEventListener('touchend', drag.end);
        sheet.removeEventListener('touchcancel', drag.end);
        handle.removeEventListener('pointerdown', drag.mouseDown);
      });
    });
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.leaveTimer);
      this.lock(false);
    });
  }

  /** Dim tap, Escape, the handle, or a drag far enough: slide away, then close. */
  protected close(): void {
    if (!this.open() || this.sticky() || this.leaving()) return;
    const still =
      typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      this.open.set(false);
      return;
    }
    this.leaving.set(true);
    this.leaveTimer = setTimeout(() => this.open.set(false), 200);
  }

  private reset(): void {
    clearTimeout(this.leaveTimer);
    this.offset.set(0);
    this.dragging.set(false);
    this.leaving.set(false);
  }

  private lock(lock: boolean): void {
    if (lock === this.locked) return;
    this.locked = lock;
    lockPage(lock);
  }

  /**
   * Dragging the sheet down with a finger (anywhere on it, once its own content is scrolled to
   * the top) or with the mouse (by the handle).
   */
  private dragFrom(sheet: HTMLElement) {
    let startY = 0;
    let lastY = 0;
    let lastAt = 0;
    let speed = 0; // px per ms, downwards
    let active = false;

    const begin = (y: number) => {
      startY = lastY = y;
      lastAt = performance.now();
      speed = 0;
      active = false;
      this.height = sheet.getBoundingClientRect().height;
    };
    const track = (y: number) => {
      const now = performance.now();
      if (now > lastAt) speed = (y - lastY) / (now - lastAt);
      lastY = y;
      lastAt = now;
      this.offset.set(Math.max(0, y - startY));
    };
    const release = () => {
      if (!active) return;
      active = false;
      this.dragging.set(false);
      const far = this.offset() > this.height * 0.3;
      const flicked = speed > 0.5 && this.offset() > 10;
      if ((far || flicked) && !this.sticky()) {
        this.close(); // slides out from where it was let go
      } else {
        this.offset.set(0);
      }
    };

    return {
      start: (event: TouchEvent) => {
        if (event.touches.length === 1) begin(event.touches[0].clientY);
      },
      move: (event: TouchEvent) => {
        if (event.touches.length !== 1 || this.leaving()) return;
        const y = event.touches[0].clientY;
        const down = y > startY;
        if (!active) {
          const canScroll = sheet.scrollHeight > sheet.clientHeight + 1;
          if (down && sheet.scrollTop <= 0 && !this.sticky()) {
            active = true;
            this.dragging.set(true);
          } else if (
            canScroll &&
            (down || sheet.scrollTop + sheet.clientHeight < sheet.scrollHeight - 1)
          ) {
            return; // the sheet's own content scrolls
          }
        }
        // Ours to handle, or nowhere to scroll: either way the page behind must not move.
        if (event.cancelable) event.preventDefault();
        if (active) track(y);
      },
      end: () => release(),
      mouseDown: (event: PointerEvent) => {
        if (event.pointerType !== 'mouse' || this.sticky()) return;
        begin(event.clientY);
        const move = (e: PointerEvent) => {
          if (!active && Math.abs(e.clientY - startY) < 4) return;
          active = true;
          this.dragging.set(true);
          track(e.clientY);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          if (active) {
            // The click that follows a drag must not also close the sheet.
            const swallow = (e: Event) => e.stopPropagation();
            sheet.addEventListener('click', swallow, { capture: true });
            setTimeout(() => {
              sheet.removeEventListener('click', swallow, { capture: true });
              release();
            });
          }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      },
    };
  }
}
