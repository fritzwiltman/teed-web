import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  BoardRow,
  Choice,
  Tab,
  UiBadge,
  UiBoard,
  UiButton,
  UiCheckbox,
  UiHeaderBand,
  UiNameButton,
  UiPaidStatus,
  UiSegmented,
  UiSheet,
  UiStepperRow,
  UiSwitch,
  UiTabBar,
  tripStage,
} from './index';

async function render<T>(host: new () => T) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(host);
  await fixture.whenStable();
  return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
}

describe('ui-button', () => {
  @Component({
    imports: [UiButton],
    template: `
      <button ui-button type="button" [busy]="busy()" (click)="taps.set(taps() + 1)">
        {{ busy() ? 'Publishing…' : 'Publish' }}
      </button>
      <a ui-button variant="outline" size="small" href="#">Small outline</a>
      <button ui-button variant="text" type="button">Text link</button>
    `,
  })
  class Host {
    busy = signal(false);
    taps = signal(0);
  }

  it('is a filled primary button by default', async () => {
    const { el } = await render(Host);
    const button = el.querySelector('button')!;
    expect(button.classList.contains('primary')).toBe(true);
    expect(button.querySelector('.spinner')).toBeNull();
    expect(button.getAttribute('aria-busy')).toBeNull();
  });

  it('when busy shows a spinner beside the label, which stays', async () => {
    const { el, host, fixture } = await render(Host);
    host.busy.set(true);
    await fixture.whenStable();
    const button = el.querySelector('button')!;
    expect(button.querySelector('.spinner')).toBeTruthy();
    expect(button.textContent?.trim()).toBe('Publishing…');
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.classList.contains('busy')).toBe(true);

    host.busy.set(false);
    await fixture.whenStable();
    expect(button.querySelector('.spinner')).toBeNull();
    expect(button.textContent?.trim()).toBe('Publish');
  });

  it('carries its variant and size as classes, on a link as well as a button', async () => {
    const { el } = await render(Host);
    expect([...el.querySelector('a')!.classList]).toEqual(
      expect.arrayContaining(['outline', 'small']),
    );
    expect(el.querySelectorAll('button')[1].classList.contains('text')).toBe(true);
  });
});

describe('ui-segmented', () => {
  @Component({
    imports: [UiSegmented],
    template: `<ui-segmented label="Appearance" [options]="options" [(value)]="value" />`,
  })
  class Host {
    value = signal<string | null>('auto');
    options: Choice[] = [
      { value: 'auto', label: 'Auto' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark', disabled: true },
    ];
  }

  const state = (el: HTMLElement) =>
    [...el.querySelectorAll('button')].map(
      (b) => `${b.textContent?.trim()}:${b.getAttribute('aria-checked')}`,
    );

  it('marks the selected option, and only that one', async () => {
    const { el } = await render(Host);
    expect(el.querySelector('ui-segmented')?.getAttribute('role')).toBe('radiogroup');
    expect(state(el)).toEqual(['Auto:true', 'Light:false', 'Dark:false']);
    expect(el.querySelectorAll('button.on')).toHaveLength(1);
  });

  it('selects on tap and tells the screen', async () => {
    const { el, host, fixture } = await render(Host);
    el.querySelectorAll('button')[1].click();
    await fixture.whenStable();
    expect(host.value()).toBe('light');
    expect(state(el)).toEqual(['Auto:false', 'Light:true', 'Dark:false']);
  });

  it('follows a value set from outside', async () => {
    const { el, host, fixture } = await render(Host);
    host.value.set('light');
    await fixture.whenStable();
    expect(el.querySelector('button.on')?.textContent?.trim()).toBe('Light');
  });

  it('will not select a disabled option', async () => {
    const { el, host, fixture } = await render(Host);
    el.querySelectorAll('button')[2].click();
    await fixture.whenStable();
    expect(host.value()).toBe('auto');
  });
});

describe('ui-name-button', () => {
  @Component({
    imports: [UiNameButton],
    template: `<button ui-name-button name="Ben" [handicap]="9" [state]="state()"></button>`,
  })
  class Host {
    state = signal<'idle' | 'target' | 'selected'>('idle');
  }

  it('shows the name and handicap', async () => {
    const { el } = await render(Host);
    expect(el.querySelector('.name')?.textContent).toBe('Ben');
    expect(el.querySelector('.handicap')?.textContent).toBe('9');
    expect(el.querySelector('button')?.getAttribute('type')).toBe('button');
  });

  it.each([
    ['idle', 'false'],
    ['target', 'false'],
    ['selected', 'true'],
  ] as const)('in the %s state carries that class, pressed=%s', async (state, pressed) => {
    const { el, host, fixture } = await render(Host);
    host.state.set(state);
    await fixture.whenStable();
    const button = el.querySelector('button')!;
    expect([...button.classList].filter((c) => ['idle', 'target', 'selected'].includes(c))).toEqual(
      [state],
    );
    expect(button.getAttribute('aria-pressed')).toBe(pressed);
  });
});

describe('ui-header-band', () => {
  @Component({
    imports: [UiHeaderBand],
    template: `
      <ui-header-band
        [label]="label()"
        title="Overview"
        [back]="back()"
        backLabel="My trips"
        [action]="action()"
        (acted)="acted.set(acted() + 1)"
      />
    `,
  })
  class Host {
    label = signal<string | undefined>('Organizer · Vero Beach 2027');
    back = signal<string | undefined>(undefined);
    action = signal<string | undefined>(undefined);
    acted = signal(0);
  }

  it('main: a label line over the title, and no pill', async () => {
    const { el } = await render(Host);
    expect(el.querySelector('.label')?.textContent).toBe('Organizer · Vero Beach 2027');
    expect(el.querySelector('h1')?.textContent).toBe('Overview');
    expect(el.querySelector('.compact')?.textContent).toBe('Overview');
    expect(el.querySelector('.action')).toBeNull();
    expect(el.querySelector('.back')).toBeNull();
  });

  it('sub-page: a back link in place of the label', async () => {
    const { el, host, fixture } = await render(Host);
    host.back.set('/admin');
    await fixture.whenStable();
    expect(el.querySelector('.back')?.getAttribute('href')).toBe('/admin');
    expect(el.querySelector('.back')?.textContent).toContain('My trips');
    expect(el.querySelector('.label')).toBeNull();
  });

  it('with an action: the pill at the top right, which reports a tap', async () => {
    const { el, host, fixture } = await render(Host);
    host.action.set('Player view');
    await fixture.whenStable();
    const pill = el.querySelector<HTMLButtonElement>('.action')!;
    expect(pill.textContent).toBe('Player view');
    pill.click();
    expect(host.acted()).toBe(1);
  });
});

describe('ui-tab-bar', () => {
  const TABS: Tab[] = [
    { key: 'home', label: 'Home', icon: 'home', link: '/home' },
    { key: 'board', label: 'Board', icon: 'board', link: '/board', live: true },
  ];

  @Component({
    imports: [UiTabBar],
    template: `<ui-tab-bar [tabs]="tabs" [active]="active()" />`,
  })
  class Host {
    tabs = TABS;
    active = signal<string | null>('home');
  }

  it('lights only the active tab', async () => {
    const { el, host, fixture } = await render(Host);
    const lit = () => [...el.querySelectorAll('a.on')].map((a) => a.textContent?.trim());
    expect(lit()).toEqual(['Home']);
    expect(el.querySelector('a.on')?.getAttribute('aria-current')).toBe('page');
    host.active.set(null);
    await fixture.whenStable();
    expect(lit()).toEqual([]);
  });

  it('puts the live dot on a tab with a live round', async () => {
    const { el } = await render(Host);
    const [home, board] = [...el.querySelectorAll('a')];
    expect(home.querySelector('ui-live-dot')).toBeNull();
    expect(board.querySelector('ui-live-dot')).toBeTruthy();
  });
});

describe('ui-switch and ui-checkbox', () => {
  @Component({
    imports: [UiSwitch, UiCheckbox],
    template: `
      <ui-switch label="Money" [(checked)]="on" [disabled]="locked()" />
      <ui-checkbox label="Paid" [(checked)]="paid" />
    `,
  })
  class Host {
    on = signal(false);
    paid = signal(false);
    locked = signal(false);
  }

  it('toggle on tap and say so to screen readers', async () => {
    const { el, host, fixture } = await render(Host);
    const toggle = el.querySelector<HTMLButtonElement>('[role=switch]')!;
    const box = el.querySelector<HTMLButtonElement>('[role=checkbox]')!;
    toggle.click();
    box.click();
    await fixture.whenStable();
    expect(host.on()).toBe(true);
    expect(host.paid()).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Money');
    expect(box.querySelector('ui-icon')).toBeTruthy();
  });

  it('do nothing when disabled', async () => {
    const { el, host, fixture } = await render(Host);
    host.locked.set(true);
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('[role=switch]')!.click();
    expect(host.on()).toBe(false);
  });
});

describe('ui-stepper-row', () => {
  @Component({
    imports: [UiStepperRow],
    template: `<ui-stepper-row name="Fritz" [(value)]="score" [par]="4" [min]="1" [max]="6" />`,
  })
  class Host {
    score = signal(4);
  }

  it('steps the score, shows under par in red, and stops at its limits', async () => {
    const { el, host, fixture } = await render(Host);
    const [minus, plus] = [...el.querySelectorAll('button')];
    const score = () => el.querySelector('.score')!;
    expect(score().classList.contains('under')).toBe(false);
    minus.click();
    await fixture.whenStable();
    expect(host.score()).toBe(3);
    expect(score().textContent?.trim()).toBe('3');
    expect(score().classList.contains('under')).toBe(true);
    for (let i = 0; i < 5; i++) plus.click();
    await fixture.whenStable();
    expect(host.score()).toBe(6);
    expect(plus.disabled).toBe(true);
  });
});

describe('ui-board', () => {
  const ROWS: BoardRow[] = [
    { pos: '1', name: 'Ben', value: '-3', thru: '14', under: true },
    { pos: '2', name: 'Fritz', value: '+1', thru: '14', me: true },
  ];

  @Component({
    imports: [UiBoard],
    template: `<ui-board title="Round 2" [rows]="rows" live />`,
  })
  class Host {
    rows = ROWS;
  }

  it('draws the rows it is given: under par in red, my row tinted, the live dot by the title', async () => {
    const { el } = await render(Host);
    const rows = [...el.querySelectorAll('tbody tr')];
    const cells = (row: Element) =>
      [...row.querySelectorAll('td')].map((c) => c.textContent?.trim());
    expect(rows.map(cells)).toEqual([
      ['1', 'Ben', '-3', '14'],
      ['2', 'Fritz', '+1', '14'],
    ]);
    expect(rows[0].querySelector('.value')?.classList.contains('under')).toBe(true);
    expect(rows[1].querySelector('.value')?.classList.contains('under')).toBe(false);
    expect(rows[1].classList.contains('me')).toBe(true);
    expect(el.querySelector('caption ui-live-dot')).toBeTruthy();
  });
});

describe('ui-paid-status', () => {
  @Component({
    imports: [UiPaidStatus],
    template: `<ui-paid-status [paid]="paid()" />`,
  })
  class Host {
    paid = signal(false);
  }

  it('says Not paid, then Paid', async () => {
    const { el, host, fixture } = await render(Host);
    expect(el.textContent?.trim()).toBe('Not paid');
    expect(el.querySelector('ui-paid-status')?.classList.contains('paid')).toBe(false);
    host.paid.set(true);
    await fixture.whenStable();
    expect(el.textContent?.trim()).toBe('Paid');
    expect(el.querySelector('ui-paid-status')?.classList.contains('paid')).toBe(true);
  });
});

describe('ui-sheet', () => {
  @Component({
    imports: [UiSheet],
    template: `<ui-sheet [(open)]="open" label="Publish" [sticky]="sticky()"
      ><p>Sure?</p></ui-sheet
    >`,
  })
  class Host {
    open = signal(false);
    sticky = signal(false);
  }

  async function opened(sticky = false) {
    const t = await render(Host);
    t.host.sticky.set(sticky);
    t.host.open.set(true);
    await t.fixture.whenStable();
    const sheet = t.el.querySelector<HTMLElement>('[role=dialog]')!;
    sheet.getBoundingClientRect = () => ({ height: 400 }) as DOMRect;
    const touch = (type: string, y?: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: y === undefined ? [] : [{ clientY: y }] });
      sheet.dispatchEvent(event);
      return event;
    };
    return { ...t, sheet, touch };
  }
  const locked = () => document.documentElement.classList.contains('ui-sheet-open');

  afterEach(() => vi.useRealTimers());

  it('is not there until opened, and closes when the dim is tapped', async () => {
    const { el, host, fixture } = await render(Host);
    expect(el.querySelector('[role=dialog]')).toBeNull();
    host.open.set(true);
    await fixture.whenStable();
    expect(el.querySelector('[role=dialog]')?.textContent).toContain('Sure?');
    el.querySelector<HTMLElement>('.dim')!.click();
    await fixture.whenStable();
    expect(host.open()).toBe(false);
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('closes on Escape', async () => {
    const { host, fixture } = await opened();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(host.open()).toBe(false);
  });

  it('keeps the page behind still while it is open', async () => {
    const { host, fixture, el } = await opened();
    expect(locked()).toBe(true);
    const move = new Event('touchmove', { cancelable: true });
    el.querySelector('.dim')!.dispatchEvent(move);
    expect(move.defaultPrevented).toBe(true);
    host.open.set(false);
    await fixture.whenStable();
    expect(locked()).toBe(false);
  });

  it('unlocks the page if it is removed while open', async () => {
    const { fixture } = await opened();
    fixture.destroy();
    expect(locked()).toBe(false);
  });

  it('follows the finger down and closes past about a third of its height', async () => {
    const { host, fixture, sheet, touch } = await opened();
    touch('touchstart', 300);
    const move = touch('touchmove', 440);
    await fixture.whenStable();
    expect(move.defaultPrevented).toBe(true);
    expect(sheet.style.transform).toBe('translateY(140px)');
    touch('touchend');
    await fixture.whenStable();
    expect(host.open()).toBe(false);
  });

  it('springs back from a short, slow drag', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const { host, fixture, sheet, touch } = await opened();
    touch('touchstart', 300);
    vi.advanceTimersByTime(400);
    touch('touchmove', 360);
    await fixture.whenStable();
    expect(sheet.style.transform).toBe('translateY(60px)');
    touch('touchend');
    await fixture.whenStable();
    expect(host.open()).toBe(true);
    expect(sheet.style.transform).toBe('');
  });

  it('closes on a short flick down', async () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const { host, fixture, touch } = await opened();
    touch('touchstart', 300);
    vi.advanceTimersByTime(40);
    touch('touchmove', 350);
    touch('touchend');
    await fixture.whenStable();
    expect(host.open()).toBe(false);
  });

  it('does not move when pushed up, and stops the page scrolling instead', async () => {
    const { host, fixture, sheet, touch } = await opened();
    touch('touchstart', 300);
    const move = touch('touchmove', 200);
    await fixture.whenStable();
    expect(move.defaultPrevented).toBe(true);
    expect(sheet.style.transform).toBe('');
    touch('touchend');
    expect(host.open()).toBe(true);
  });

  it('lets its own content scroll before it drags', async () => {
    const { host, sheet, touch } = await opened();
    Object.defineProperties(sheet, {
      scrollHeight: { value: 900 },
      clientHeight: { value: 400 },
      scrollTop: { value: 120 },
    });
    touch('touchstart', 300);
    const move = touch('touchmove', 500);
    expect(move.defaultPrevented).toBe(false);
    touch('touchend');
    expect(host.open()).toBe(true);
  });

  it('stays up when sticky: no dim tap, Escape or drag closes it', async () => {
    const { el, host, fixture, touch } = await opened(true);
    el.querySelector<HTMLElement>('.dim')!.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    touch('touchstart', 300);
    touch('touchmove', 600);
    touch('touchend');
    await fixture.whenStable();
    expect(host.open()).toBe(true);
  });
});

describe('ui-badge', () => {
  it('names where a trip stands from its status and first day', () => {
    const trip = (status: 'draft' | 'live' | 'final') => ({ status, start_date: '2027-01-11' });
    expect(tripStage(trip('draft'), '2027-01-12')).toBe('draft');
    expect(tripStage(trip('live'), '2027-01-10')).toBe('upcoming');
    expect(tripStage(trip('live'), '2027-01-11')).toBe('in-progress');
    expect(tripStage(trip('live'), '2027-02-01')).toBe('in-progress');
    expect(tripStage(trip('final'), '2027-01-12')).toBe('final');
  });

  it('reads Draft, Upcoming, In progress or Final, never Live', async () => {
    @Component({
      imports: [UiBadge],
      template: `@for (s of stages; track s) {
        <ui-badge [stage]="s" />
      }`,
    })
    class Host {
      stages = ['draft', 'upcoming', 'in-progress', 'final'] as const;
    }
    const { el } = await render(Host);
    expect([...el.querySelectorAll('ui-badge')].map((b) => b.textContent?.trim())).toEqual([
      'Draft',
      'Upcoming',
      'In progress',
      'Final',
    ]);
  });
});
