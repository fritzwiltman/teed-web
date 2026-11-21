import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Line icons on a 24px grid. Add a name here before using it anywhere. */
const PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  card: 'M5 3h14v18H5zM9 8h6M9 12h6M9 16h3',
  board: 'M4 20V10h5v10M9 20V4h6v16M15 20v-7h5v7M2 20h20',
  trip: 'M3 8h18v12H3zM9 8V5h6v3',
  overview: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  flag: 'M6 21V4M6 4l11 3.5L6 11',
  people:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-3.3 2.9-6 6.5-6s6.5 2.7 6.5 6M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14.3c2.1.9 3.5 3 3.5 5.7',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-down': 'M6 9l6 6 6-6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  car: 'M4 16v-4l2-5h12l2 5v4M4 16h16M4 16v3M20 16v3M7.5 13h.01M16.5 13h.01',
  bed: 'M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5M7 11.5h.01',
  food: 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 1-3 3.5-3 6.5V13h3zM17 13v8',
  plane: 'M3 13l18-8-6 16-3-7z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  message: 'M4 5h16v11H9l-5 4z',
  share: 'M12 3v12M8 7l4-4 4 4M6 11H5v9h14v-9h-1',
  paste: 'M8 5H6v15h12V5h-2M9 3h6v4H9z',
  note: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7',
  tv: 'M3 6h18v12H3zM8 21h8',
  money:
    'M15 8.5C14.4 7.6 13.3 7 12 7c-1.7 0-3 1-3 2.5s1.3 2.2 3 2.5 3 1 3 2.5-1.3 2.5-3 2.5c-1.3 0-2.4-.6-3-1.5M12 5v14',
} as const;

export type IconName = keyof typeof PATHS;

@Component({
  selector: 'ui-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 24 24">
      <path
        [attr.d]="path()"
        fill="none"
        stroke="currentColor"
        [attr.stroke-width]="name() === 'more' ? 3 : 2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      width: 24px;
      height: 24px;
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `,
})
export class UiIcon {
  readonly name = input.required<IconName>();
  protected readonly path = computed(() => PATHS[this.name()]);
}
