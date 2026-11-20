import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconName, UiIcon } from './icon';
import { UiLiveDot } from './feedback';

export interface Tab {
  key: string;
  label: string;
  icon: IconName;
  link: string | readonly unknown[];
  /** A live round: the blinking dot beside the icon. */
  live?: boolean;
}

/**
 * The docked bottom bar: up to four tabs, icon over label. The active tab's icon sits on a tinted
 * pill and its label is bold. The frame decides which tab is active (a sub-page keeps its tab lit).
 */
@Component({
  selector: 'ui-tab-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, UiIcon, UiLiveDot],
  template: `
    <nav [attr.aria-label]="label()">
      @for (tab of tabs(); track tab.key) {
        <a
          [routerLink]="tab.link"
          [class.on]="tab.key === active()"
          [attr.aria-current]="tab.key === active() ? 'page' : null"
        >
          <span class="pill">
            <ui-icon [name]="tab.icon" />
            @if (tab.live) {
              <ui-live-dot />
            }
          </span>
          <span class="name">{{ tab.label }}</span>
        </a>
      }
    </nav>
  `,
  styles: `
    :host {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 30;
      background: var(--card);
      border-top: 1px solid var(--line);
      padding-bottom: env(safe-area-inset-bottom);
    }
    nav {
      display: flex;
      max-width: var(--column);
      height: var(--tab-bar);
      margin: 0 auto;
    }
    a {
      flex: 1 1 0;
      min-width: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      color: var(--muted);
      font-size: 12px;
      text-decoration: none;
      touch-action: manipulation;
    }
    .pill {
      position: relative;
      display: grid;
      place-items: center;
      width: 60px;
      height: 32px;
      border-radius: var(--radius-pill);
    }
    a.on {
      color: var(--accent);
      font-weight: 700;
    }
    a.on .pill {
      background: var(--tab-on);
    }
    ui-live-dot {
      position: absolute;
      top: 4px;
      right: 12px;
    }
  `,
})
export class UiTabBar {
  readonly tabs = input.required<Tab[]>();
  readonly active = input<string | null>(null);
  readonly label = input('Main');
}
