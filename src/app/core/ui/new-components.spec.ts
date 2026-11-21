import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  PickerOption,
  SwitcherTrip,
  TeeOption,
  UiAttention,
  UiConfirmSheet,
  UiEditPill,
  UiHeaderBand,
  UiIndexSheet,
  UiListRow,
  UiLogo,
  UiPickerSheet,
  UiTeesChip,
  UiTripSwitcher,
  readIndex,
  teeDetail,
} from './index';

async function render<T>(host: new () => T) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(host);
  await fixture.whenStable();
  const settle = async () => {
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
  };
  return {
    fixture,
    host: fixture.componentInstance,
    el: fixture.nativeElement as HTMLElement,
    settle,
  };
}
const dialog = (el: HTMLElement) => el.querySelector<HTMLElement>('[role=dialog]');

describe('ui-logo', () => {
  @Component({
    imports: [UiLogo],
    template: `<ui-logo [size]="40" /><ui-logo tone="band" [size]="20" />`,
  })
  class Host {}

  it('is the tee and "teed", with the gap at 15% of the word', async () => {
    const { el } = await render(Host);
    const [light, band] = [...el.querySelectorAll<HTMLElement>('ui-logo')];
    expect(light.getAttribute('aria-label')).toBe('teed');
    expect(light.querySelector('svg')).toBeTruthy();
    expect(light.textContent?.trim()).toBe('teed');
    expect(light.style.fontSize).toBe('40px');
    expect(light.style.gap).toBe('6px');
    expect(band.style.gap).toBe('3px');
    // White tee on the green band; green on a light screen.
    expect(band.classList).toContain('on-band');
    expect(light.classList).not.toContain('on-band');
  });
});

describe('ui-confirm-sheet', () => {
  @Component({
    imports: [UiConfirmSheet],
    template: `
      <ui-confirm-sheet
        [(open)]="open"
        title="Remove Charlie?"
        line="Scores he already entered stay on the scorecards."
        action="Remove Charlie"
        (confirmed)="yes.set(yes() + 1)"
      />
    `,
  })
  class Host {
    open = signal(true);
    yes = signal(0);
  }

  it('asks the question, says one honest line, and has a red button and Cancel', async () => {
    const { el, host, settle } = await render(Host);
    const sheet = dialog(el)!;
    expect(sheet.querySelector('h2')?.textContent).toBe('Remove Charlie?');
    expect(sheet.textContent).toContain('Scores he already entered stay on the scorecards.');
    const [red, cancel] = [...sheet.querySelectorAll<HTMLButtonElement>('button[ui-button]')];
    expect(red.textContent?.trim()).toBe('Remove Charlie');
    expect(red.classList).toContain('danger');
    expect(cancel.textContent?.trim()).toBe('Cancel');
    red.click();
    expect(host.yes()).toBe(1);
    cancel.click();
    await settle();
    expect(host.open()).toBe(false);
  });
});

describe('ui-edit-pill', () => {
  @Component({
    imports: [UiEditPill],
    template: `<button
      ui-edit-pill
      [editing]="editing()"
      (click)="editing.set(!editing())"
    ></button>`,
  })
  class Host {
    editing = signal(false);
  }

  it('reads Edit, then a filled Done in the same spot', async () => {
    const { el, settle } = await render(Host);
    const pill = el.querySelector<HTMLButtonElement>('button')!;
    expect(pill.textContent?.trim()).toBe('Edit');
    expect(pill.classList).not.toContain('on');
    pill.click();
    await settle();
    expect(pill.textContent?.trim()).toBe('Done');
    expect(pill.classList).toContain('on');
    expect(pill.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('ui-attention', () => {
  @Component({
    imports: [UiAttention],
    template: `<p class="row">
      Charlie <ui-attention [reasons]="['No email yet', 'Not paid']" />
    </p>`,
  })
  class Host {}

  it('is one amber "!" whose tooltip floats beside it, leaving the row as it was', async () => {
    const { el, settle } = await render(Host);
    const mark = el.querySelector<HTMLButtonElement>('ui-attention button')!;
    expect(mark.textContent?.trim()).toBe('!');
    expect(mark.getAttribute('aria-label')).toBe('No email yet, Not paid');
    const height = el.querySelector<HTMLElement>('.row')!.getBoundingClientRect().height;
    mark.click();
    await settle();
    const tip = document.querySelector('.cdk-overlay-container [role=tooltip]');
    expect(tip?.textContent).toContain('No email yet');
    expect(tip?.textContent).toContain('Not paid');
    expect(el.querySelector('[role=tooltip]')).toBeNull(); // not inside the row
    expect(el.querySelector<HTMLElement>('.row')!.getBoundingClientRect().height).toBe(height);
    mark.click();
    await settle();
    expect(document.querySelector('.cdk-overlay-container [role=tooltip]')).toBeNull();
  });
});

describe('ui-picker-sheet', () => {
  const OPTIONS: PickerOption[] = [
    {
      value: 'palmer',
      title: 'PGA National Resort Palmer Course',
      detail: 'Palm Beach Gardens, FL',
    },
    { value: 'dunes', title: 'Palmetto Dunes · Arthur Hills', detail: 'Hilton Head Island, SC' },
    { value: 'par3', title: 'Palm Beach Par 3', detail: 'Palm Beach, FL' },
  ];
  @Component({
    imports: [UiPickerSheet],
    template: `
      <ui-picker-sheet
        [(open)]="open"
        title="Course"
        searchable
        addLabel="+ Add a course"
        [options]="options"
        [value]="value()"
        (picked)="value.set($event)"
        (added)="added.set(added() + 1)"
      />
    `,
  })
  class Host {
    open = signal(true);
    options = OPTIONS;
    value = signal<string | null>('palmer');
    added = signal(0);
  }
  const titles = (el: HTMLElement) =>
    [...el.querySelectorAll('.row .title')].map((t) => t.textContent?.trim());

  it('lists the options with the current one checked, and "+ Add a course" last', async () => {
    const { el } = await render(Host);
    expect(titles(el)).toEqual(OPTIONS.map((o) => o.title));
    expect(el.querySelector('.row[aria-selected=true] .title')?.textContent?.trim()).toBe(
      OPTIONS[0].title,
    );
    expect(el.querySelectorAll('.row')[3].textContent?.trim()).toBe('+ Add a course');
  });

  it('searches by name or place as you type, from a field focused as it opens', async () => {
    const { el, settle } = await render(Host);
    await settle();
    const search = el.querySelector<HTMLInputElement>('input[type=search]')!;
    expect(document.activeElement).toBe(search);
    search.value = 'palm beach';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(titles(el)).toEqual(['PGA National Resort Palmer Course', 'Palm Beach Par 3']);
    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(el.querySelector('.none')?.textContent).toContain('Nothing matches "zzz"');
  });

  it('picking closes it; "+ Add a course" too', async () => {
    const { el, host, settle } = await render(Host);
    el.querySelectorAll<HTMLButtonElement>('.row')[2].click();
    await settle();
    expect(host.value()).toBe('par3');
    expect(host.open()).toBe(false);
    host.open.set(true);
    await settle();
    el.querySelectorAll<HTMLButtonElement>('.row')[3].click();
    expect(host.added()).toBe(1);
  });
});

describe('ui-tees-chip', () => {
  const TEES: TeeOption[] = [
    { id: 'gold', name: 'Gold', yards: 6640, rating: 72.4, slope: 134 },
    { id: 'silver', name: 'Silver', yards: 6180, rating: 70.3, slope: 128 },
    { id: 'red', name: 'Red', yards: null, rating: null, slope: null },
  ];
  @Component({
    imports: [UiTeesChip],
    template: `<ui-tees-chip
      [tees]="tees"
      label="Matt's tees"
      [(value)]="value"
      [changed]="value() !== 'silver'"
    />`,
  })
  class Host {
    tees = TEES;
    value = signal<string | null>('silver');
  }

  it('reads like a dropdown, and opens a sheet of the tees with yards and rating / slope', async () => {
    const { el, host, settle } = await render(Host);
    const chip = el.querySelector<HTMLButtonElement>('.chip')!;
    expect(chip.textContent?.trim()).toBe('Silver');
    expect(chip.querySelector('ui-icon')).toBeTruthy();
    expect(chip.classList).not.toContain('changed');
    chip.click();
    await settle();
    const sheet = dialog(el)!;
    expect(sheet.querySelector('h2')?.textContent).toBe("Matt's tees");
    expect([...sheet.querySelectorAll('.row .detail')].map((d) => d.textContent)).toEqual([
      '6,640 yds · 72.4 / 134',
      '6,180 yds · 70.3 / 128',
      'No rating',
    ]);
    sheet.querySelectorAll<HTMLButtonElement>('.row')[0].click();
    await settle();
    expect(host.value()).toBe('gold');
    expect(chip.textContent?.trim()).toBe('Gold');
    expect(chip.classList).toContain('changed');
  });

  it('words a tee the same everywhere', () => {
    expect(teeDetail(TEES[1])).toBe('6,180 yds · 70.3 / 128');
  });
});

describe('ui-index-sheet', () => {
  @Component({
    imports: [UiIndexSheet],
    template: `<ui-index-sheet
      [(open)]="open"
      name="Charlie"
      [value]="value"
      (saved)="saved.set($event)"
    />`,
  })
  class Host {
    open = signal(true);
    value: number | null = null;
    saved = signal<number | null | undefined>(undefined);
  }

  it('asks for one number on the decimal keypad, checks it, and hands it back', async () => {
    const { el, host, settle } = await render(Host);
    await settle();
    const sheet = dialog(el)!;
    expect(sheet.querySelector('h2')?.textContent).toBe("Charlie's handicap index");
    const input = sheet.querySelector<HTMLInputElement>('input')!;
    expect(input.getAttribute('inputmode')).toBe('decimal');
    const submit = async (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input'));
      sheet.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle();
    };
    await submit('60');
    expect(sheet.querySelector('[role=alert]')?.textContent).toContain('up to 54.0');
    expect(host.saved()).toBeUndefined();
    await submit('16.94');
    expect(host.saved()).toBe(16.9);
    await submit('+1.2');
    expect(host.saved()).toBe(-1.2);
  });

  it('reads an index as typed', () => {
    expect(readIndex('')).toBeNull();
    expect(readIndex(' 18.6 ')).toBe(18.6);
    expect(readIndex('+2')).toBe(-2);
    expect(readIndex('abc')).toBe('invalid');
    expect(readIndex('55')).toBe('invalid');
  });
});

describe('ui-trip-switcher', () => {
  const TRIPS: SwitcherTrip[] = [
    { id: 'sp', name: 'Southern Pines 2026', detail: 'Oct 8–12 · now' },
    { id: 'vero', name: 'Vero Beach 2027', detail: 'Jan 14–17' },
  ];
  @Component({
    imports: [UiTripSwitcher],
    template: `
      <ui-trip-switcher
        [(open)]="open"
        name="Fritz"
        initial="F"
        [trips]="trips"
        current="sp"
        (chosen)="chosen.set($event)"
      />
    `,
  })
  class Host {
    open = signal(true);
    trips = TRIPS;
    chosen = signal<string | null | undefined>(undefined);
  }

  it('has you at the top, then the trips with the open one checked', async () => {
    const { el, host, settle } = await render(Host);
    const rows = [...el.querySelectorAll<HTMLButtonElement>('.row')];
    expect(rows[0].querySelector('.initial')?.textContent?.trim()).toBe('F');
    expect(rows[0].textContent).toContain('Your trips, career, head to head');
    expect(rows.slice(1).map((r) => r.querySelector('.title')?.textContent?.trim())).toEqual([
      'Southern Pines 2026',
      'Vero Beach 2027',
    ]);
    expect(rows[1].getAttribute('aria-current')).toBe('true');
    expect(rows[1].querySelector('.check')).toBeTruthy();
    rows[0].click();
    await settle();
    expect(host.chosen()).toBeNull();
    expect(host.open()).toBe(false);
    host.open.set(true);
    await settle();
    el.querySelectorAll<HTMLButtonElement>('.row')[2].click();
    expect(host.chosen()).toBe('vero');
  });
});

describe('ui-header-band: the trip line and a tappable title', () => {
  @Component({
    imports: [UiHeaderBand],
    template: `
      <ui-header-band
        [switcher]="switcher()"
        label="Round 4 · Mon, Oct 12"
        title="Hole 7"
        titleTap
        (switched)="switched.set(switched() + 1)"
        (titleTapped)="tapped.set(tapped() + 1)"
      />
    `,
  })
  class Host {
    switcher = signal(true);
    switched = signal(0);
    tapped = signal(0);
  }

  it('makes the label line the switcher, with its down arrow; a spectator gets plain text', async () => {
    const { el, host, fixture } = await render(Host);
    const line = el.querySelector<HTMLButtonElement>('.switch')!;
    expect(line.textContent?.trim()).toBe('Round 4 · Mon, Oct 12');
    expect(line.querySelector('ui-icon')).toBeTruthy();
    line.click();
    expect(host.switched()).toBe(1);
    el.querySelector<HTMLButtonElement>('h1 button')!.click();
    expect(host.tapped()).toBe(1);
    host.switcher.set(false);
    await fixture.whenStable();
    expect(el.querySelector('.switch')).toBeNull();
    expect(el.querySelector('p.label')?.textContent).toBe('Round 4 · Mon, Oct 12');
  });
});

describe('ui-list-row: disclosure', () => {
  @Component({
    imports: [UiListRow],
    template: `<button
      ui-list-row
      type="button"
      title="Blue tees"
      [expanded]="open()"
      (click)="open.set(!open())"
    ></button>`,
  })
  class Host {
    open = signal(false);
  }

  it('points right while closed and turns down when open', async () => {
    const { el, settle } = await render(Host);
    const row = el.querySelector<HTMLButtonElement>('button')!;
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(row.querySelector('.chevron')?.classList).not.toContain('open');
    row.click();
    await settle();
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(row.querySelector('.chevron')?.classList).toContain('open');
  });
});
