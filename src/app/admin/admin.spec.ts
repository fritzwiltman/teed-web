import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService, Me } from '../core/auth';
import { MyTrip, SessionService } from '../core/session';
import { AdminData, AdminError, RosterPlayer, Trip, TripCreator, TripRole } from './data';
import { ADMIN_ROUTES } from './routes';
import { slugFor } from './trip-details';

const VERO: Trip = {
  id: 'vero',
  name: 'Vero Beach 2027',
  slug: 'VERO',
  location: 'Vero Beach, FL',
  start_date: '2027-01-11',
  end_date: '2027-01-15',
  status: 'draft',
  theme: 'tour',
  handicap_allowance: 0.9,
  strokes_off_low: true,
  pickup_net_double: true,
  spectators_see_money: false,
  handicap_lock_date: null,
};
const PINES: Trip = {
  ...VERO,
  id: 'pines',
  name: 'Southern Pines 2026',
  slug: 'PINES',
  start_date: '2026-10-08',
  end_date: '2026-10-12',
  status: 'final',
};
const LIVE: Trip = { ...VERO, id: 'live', status: 'live' };

/** Someone on the roster, as the organizer and co-organizers get them. */
const player = (over: Partial<RosterPlayer>): RosterPlayer => ({
  id: 'p1',
  name: 'Fritz',
  initials: 'FW',
  role: 'player',
  handicap_index: 18.6,
  index_locked: false,
  buy_in_paid: false,
  sort_order: 1,
  is_me: false,
  email: 'fritz@example.com',
  phone: '+17725550101',
  claimed: true,
  invited_at: '2027-01-01',
  flags: { no_email: false, not_claimed: false, not_paid: false },
  ...over,
});

/**
 * Who is signed in:
 *   admin      the app admin (also a trip creator), on none of these trips
 *   organizer  the trips' organizer, and a trip creator
 *   co         a co-organizer of the trips: not a trip creator
 *   player     a player on the trips
 *   nobody     signed out
 */
type Who = 'admin' | 'organizer' | 'co' | 'player' | 'nobody';
const ROLE: Record<Who, TripRole | null> = {
  admin: 'admin',
  organizer: 'organizer',
  co: 'co_organizer',
  player: 'player',
  nobody: null,
};

/** Boots the organizer area at a URL as that person. `data` replaces what the database answers. */
async function boot(
  url: string,
  who: Who = 'organizer',
  data: Partial<Record<keyof AdminData, unknown>> = {},
) {
  const me = signal<Me | null>(
    who === 'nobody'
      ? null
      : {
          id: 'u1',
          display_name: who === 'co' ? 'Cal' : 'Fritz',
          email: `${who}@example.com`,
          handicap_index: null,
          is_admin: who === 'admin',
          is_trip_creator: who === 'admin' || who === 'organizer',
        },
  );
  const api = {
    tripRole: vi.fn(async () => ROLE[who]),
    trips: vi.fn(async () => [VERO, PINES, LIVE]),
    trip: vi.fn(async (id: string) => (id === 'pines' ? PINES : id === 'live' ? LIVE : VERO)),
    rounds: vi.fn(async () => []),
    roster: vi.fn(async () => [] as RosterPlayer[]),
    createTrip: vi.fn(async (fields: object) => ({ ...VERO, ...fields, id: 'new-trip' })),
    updateTrip: vi.fn(async (_id: string, fields: object) => ({ ...VERO, ...fields })),
    addMember: vi.fn(async () => ({ id: 'new-member', token: 'TOKEN-NEW' })),
    updateMember: vi.fn(async () => {}),
    removeMember: vi.fn(async () => {}),
    invite: vi.fn(async () => 'TOKEN-AGAIN'),
    spectatorToken: vi.fn(async () => null as string | null),
    creators: vi.fn(async () => [] as TripCreator[]),
    addCreator: vi.fn(async () => 'TOKEN-CREATOR'),
    inviteCreator: vi.fn(async () => 'TOKEN-CREATOR-AGAIN'),
    removeCreator: vi.fn(async () => {}),
    courses: vi.fn(async () => []),
    ...data,
  };
  // The app admin is on none of the trips; everyone else is on all three.
  const trips = signal(
    who === 'admin' || who === 'nobody'
      ? []
      : ([{ id: 'vero' }, { id: 'pines' }, { id: 'live' }] as MyTrip[]),
  );
  const session = signal<{ trip: { id: string } } | null>(null);
  const sessions = {
    trips,
    session,
    canManage: computed(() => false),
    open: vi.fn(async (id: string) => trips().some((t) => t.id === id)),
  };
  // Where a text goes: Messages for someone with a number, the share sheet otherwise.
  const share = vi.fn(async (_data: { text: string }) => {});
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });
  const original = window.location;
  const sms = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      origin: original.origin,
      get href() {
        return original.href;
      },
      set href(value: string) {
        sms(value);
      },
    },
  });

  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        [
          { path: 'admin', children: ADMIN_ROUTES },
          { path: 'login', children: [] },
          { path: 'you', children: [] },
          { path: 'home', children: [] },
        ],
        withComponentInputBinding(),
      ),
      { provide: AuthService, useValue: { me, ready: vi.fn(async () => {}) } },
      { provide: AdminData, useValue: api },
      { provide: SessionService, useValue: sessions },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  await harness.fixture.whenStable();
  const settle = async () => {
    await new Promise((r) => setTimeout(r));
    await harness.fixture.whenStable();
  };
  await settle();
  const page = () => harness.routeNativeElement as HTMLElement;
  const buttons = () =>
    [...page().querySelectorAll<HTMLElement>('button, a')].map(
      (b) => b.querySelector('.title')?.textContent?.trim() || b.textContent?.trim(),
    );
  const click = async (label: string) => {
    const target = [...page().querySelectorAll<HTMLElement>('button, a')].find(
      (b) =>
        b.textContent?.trim() === label || b.querySelector('.title')?.textContent?.trim() === label,
    );
    if (!target) throw new Error(`No button "${label}" in: ${page().textContent}`);
    target.click();
    await settle();
  };
  // Text fields report typing with 'input'; date fields report a chosen date with 'change'. Send both.
  const type = async (selector: string, value: string) => {
    const input = page().querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    await settle();
  };
  const submit = async () => {
    page()
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };
  /** The text of the message handed to Messages. */
  const texted = () => {
    const link = sms.mock.calls.at(-1)?.[0] as string | undefined;
    return link
      ? { to: link.slice(4).split('?')[0], body: decodeURIComponent(link.split('body=')[1]) }
      : null;
  };
  const router = TestBed.inject(Router);
  return {
    page,
    me,
    api,
    sessions,
    router,
    buttons,
    click,
    type,
    submit,
    settle,
    share,
    texted,
    origin: original.origin,
  };
}

const realLocation = window.location;
afterEach(() =>
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation }),
);

const title = (page: HTMLElement) => page.querySelector('h1')?.textContent;
const pill = (page: HTMLElement) => page.querySelector('ui-header-band .action');
const tabs = (page: HTMLElement) =>
  [...page.querySelectorAll('ui-tab-bar a')].map(
    (a) => a.textContent?.trim() + (a.classList.contains('on') ? '*' : ''),
  );

describe('organizer area', () => {
  describe('who gets in', () => {
    it('sends someone who is not signed in to Sign in', async () => {
      for (const url of [
        '/admin',
        '/admin/trips/vero',
        '/admin/trips/new',
        '/admin/courses',
        '/admin/creators',
      ]) {
        expect((await boot(url, 'nobody')).router.url, url).toBe('/login');
        TestBed.resetTestingModule();
      }
    });

    it("lets the organizer, a co-organizer and the app admin into a trip's screens", async () => {
      for (const who of ['organizer', 'co', 'admin'] as const) {
        const { router, page, api } = await boot('/admin/trips/vero', who);
        expect(router.url, who).toBe('/admin/trips/vero');
        expect(title(page())).toBe('Overview');
        expect(api.tripRole).toHaveBeenCalledWith('vero');
        TestBed.resetTestingModule();
      }
    });

    it('keeps a player out, and anyone the trip is not theirs to see', async () => {
      for (const url of [
        '/admin/trips/vero',
        '/admin/trips/vero/roster',
        '/admin/trips/vero/details',
      ]) {
        expect((await boot(url, 'player')).router.url, url).toBe('/you');
        TestBed.resetTestingModule();
      }
      const stranger = await boot('/admin/trips/vero', 'organizer', {
        tripRole: vi.fn(async () => null),
      });
      expect(stranger.router.url).toBe('/you');
    });

    it('with no signal, goes by the role saved with the open trip', async () => {
      const offline = { tripRole: vi.fn(async () => Promise.reject(new AdminError('offline'))) };
      expect((await boot('/admin/trips/vero', 'co', offline)).router.url).toBe('/you');
    });

    it('keeps New trip and the course library for trip creators', async () => {
      for (const url of ['/admin/trips/new', '/admin/courses']) {
        expect((await boot(url, 'organizer')).router.url, url).toBe(url);
        TestBed.resetTestingModule();
        expect((await boot(url, 'co')).router.url, url).toBe('/you');
        TestBed.resetTestingModule();
      }
    });

    it('keeps All trips and Trip creators for the app admin', async () => {
      for (const url of ['/admin', '/admin/creators']) {
        expect((await boot(url, 'admin')).router.url, url).toBe(url);
        TestBed.resetTestingModule();
        expect((await boot(url, 'organizer')).router.url, url).toBe('/you');
        TestBed.resetTestingModule();
      }
    });

    it('sends the old organizer sign-in address to Sign in', async () => {
      expect((await boot('/admin/sign-in', 'nobody')).router.url).toBe('/login');
    });
  });

  describe('tab bar', () => {
    it('is not on All trips or Trip creators', async () => {
      expect((await boot('/admin', 'admin')).page().querySelector('ui-tab-bar')).toBeNull();
      TestBed.resetTestingModule();
      expect(
        (await boot('/admin/creators', 'admin')).page().querySelector('ui-tab-bar'),
      ).toBeNull();
    });

    it('has Overview, Rounds, People and Itinerary for the trip in hand', async () => {
      const t = await boot('/admin/trips/vero');
      expect(tabs(t.page())).toEqual(['Overview*', 'Rounds', 'People', 'Itinerary']);
      await t.click('People');
      expect(t.router.url).toBe('/admin/trips/vero/roster');
      expect(tabs(t.page())).toEqual(['Overview', 'Rounds', 'People*', 'Itinerary']);
      await t.click('Rounds');
      expect(title(t.page())).toBe('Rounds');
      expect(tabs(t.page())).toEqual(['Overview', 'Rounds*', 'People', 'Itinerary']);
      await t.click('Itinerary');
      expect(title(t.page())).toBe('Itinerary');
      expect(tabs(t.page())).toEqual(['Overview', 'Rounds', 'People', 'Itinerary*']);
    });

    it('keeps the tab lit on a sub-page', async () => {
      expect(tabs((await boot('/admin/trips/vero/details')).page())[0]).toBe('Overview*');
      TestBed.resetTestingModule();
      expect(tabs((await boot('/admin/trips/vero/rounds/new')).page())[1]).toBe('Rounds*');
    });

    it('stays, with nothing lit, in the course library, and goes on All trips', async () => {
      const t = await boot('/admin/trips/vero', 'admin');
      await t.click('Course library');
      expect(t.router.url).toBe('/admin/courses');
      expect(tabs(t.page())).toEqual(['Overview', 'Rounds', 'People', 'Itinerary']);
      await t.router.navigateByUrl('/admin');
      await t.settle();
      expect(t.page().querySelector('ui-tab-bar')).toBeNull();
    });
  });

  describe('header and Player view', () => {
    it('labels a trip\'s screens "Organizer · <trip name>"', async () => {
      const { page } = await boot('/admin/trips/live/roster');
      expect(page().querySelector('ui-header-band .label')?.textContent).toBe(
        'Organizer · Vero Beach 2027',
      );
      expect(title(page())).toBe('People');
    });

    it('hides Player view while the trip is a draft', async () => {
      expect(pill((await boot('/admin/trips/vero')).page())).toBeNull();
    });

    it("hides Player view from the app admin on a trip they aren't on", async () => {
      expect(pill((await boot('/admin/trips/live', 'admin')).page())).toBeNull();
    });

    it('Player view opens the trip itself, for the organizer and a co-organizer alike', async () => {
      for (const who of ['organizer', 'co'] as const) {
        const t = await boot('/admin/trips/live', who);
        expect(pill(t.page())?.textContent).toBe('Player view');
        await t.click('Player view');
        expect(t.sessions.open).toHaveBeenCalledWith('live');
        expect(t.router.url).toBe('/home');
        TestBed.resetTestingModule();
      }
    });
  });

  describe('All trips (app admin)', () => {
    it('lists every trip, upcoming with where it stands and past as final', async () => {
      const { page } = await boot('/admin', 'admin');
      expect(title(page())).toBe('All trips');
      const upcoming = page().querySelector('[aria-label=Upcoming]')!;
      const past = page().querySelector('[aria-label=Past]')!;
      expect(upcoming.textContent).toContain('Vero Beach 2027');
      expect([...upcoming.querySelectorAll('ui-badge')].map((b) => b.textContent?.trim())).toEqual([
        'Draft',
        // Published, and Vero starts on Jan 11, 2027.
        new Date() < new Date(2027, 0, 11) ? 'Upcoming' : 'In progress',
      ]);
      expect(past.textContent).toContain('Southern Pines 2026');
      expect(past.querySelector('ui-badge')?.textContent?.trim()).toBe('Final');
      expect(page().querySelector('a[ui-button]')?.textContent).toContain('New trip');
    });

    it("opens a trip on its organizer screens: the admin needn't be on it", async () => {
      const t = await boot('/admin', 'admin');
      await t.click('Southern Pines 2026');
      expect(t.router.url).toBe('/admin/trips/pines');
      expect(t.sessions.open).not.toHaveBeenCalled();
    });

    it('has no password or sign-out of its own: those live on You', async () => {
      const { page, buttons } = await boot('/admin', 'admin');
      expect(page().querySelector('input[type=password]')).toBeNull();
      expect(buttons()).not.toContain('Sign out');
    });
  });

  describe('New trip', () => {
    it('creates a draft trip and opens its overview', async () => {
      const t = await boot('/admin/trips/new');
      await t.type('[name=name]', 'Vero Beach 2027');
      await t.type('[name=start]', '2027-01-11');
      await t.type('[name=end]', '2027-01-15');
      await t.type('[name=allowance]', '85');
      await t.submit();
      expect(t.api.createTrip).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Vero Beach 2027',
          slug: 'VEROBEACH202',
          start_date: '2027-01-11',
          end_date: '2027-01-15',
          handicap_allowance: 0.85,
          strokes_off_low: true,
        }),
      );
      expect(t.router.url).toBe('/admin/trips/new-trip');
    });

    it('asks for nothing about codes: no prefix field, no theme picker', async () => {
      const { page } = await boot('/admin/trips/new');
      expect(page().querySelector('[name=slug]')).toBeNull();
      expect(page().querySelector('[name=theme]')).toBeNull();
      expect(page().textContent).not.toContain('prefix');
    });

    it('checks the form before saving', async () => {
      const t = await boot('/admin/trips/new');
      await t.type('[name=name]', 'Vero Beach 2027');
      await t.submit();
      expect(t.page().querySelector('[role=alert]')?.textContent).toContain(
        'Set the first and last day',
      );
      expect(t.api.createTrip).not.toHaveBeenCalled();
    });

    it('quietly picks another handle when a trip of the same name exists', async () => {
      const createTrip = vi
        .fn()
        .mockRejectedValueOnce(new AdminError('That is already in use. Pick a different one.'))
        .mockImplementation(async (fields: object) => ({ ...VERO, ...fields, id: 'new-trip' }));
      const t = await boot('/admin/trips/new', 'organizer', { createTrip });
      await t.type('[name=name]', 'Vero Beach 2027');
      await t.type('[name=start]', '2027-01-11');
      await t.type('[name=end]', '2027-01-15');
      await t.submit();
      expect(createTrip).toHaveBeenCalledTimes(2);
      expect(createTrip.mock.calls[1][0].slug).toMatch(/^VEROBEACH2[A-HJ-NP-Z2-9]{2}$/);
      expect(t.page().querySelector('[role=alert]')).toBeNull();
      expect(t.router.url).toBe('/admin/trips/new-trip');
    });

    it("leaves an existing trip's handle alone when saving", async () => {
      const t = await boot('/admin/trips/vero/details');
      await t.type('[name=name]', 'Vero Beach, renamed');
      await t.submit();
      expect(t.api.updateTrip).toHaveBeenCalledWith(
        'vero',
        expect.objectContaining({ name: 'Vero Beach, renamed', slug: 'VERO' }),
      );
    });

    it('fills in the last day three days after the first, and opens its picker', async () => {
      const t = await boot('/admin/trips/new');
      const end = t.page().querySelector<HTMLInputElement>('[name=end]')!;
      end.showPicker = vi.fn();
      await t.type('[name=start]', '2027-01-11');
      expect(end.value).toBe('2027-01-14');
      await new Promise((r) => setTimeout(r));
      expect(end.showPicker).toHaveBeenCalled();
    });

    it('moves the last day forward when the first day passes it, and never lets it sit before the first', async () => {
      const t = await boot('/admin/trips/new');
      const end = t.page().querySelector<HTMLInputElement>('[name=end]')!;
      end.showPicker = vi.fn();
      await t.type('[name=start]', '2027-01-11');
      await t.type('[name=end]', '2027-01-15');
      await t.type('[name=start]', '2027-01-13'); // still before the last day: left alone
      expect(end.value).toBe('2027-01-15');
      await t.type('[name=start]', '2027-01-20'); // past it: moved forward
      expect(end.value).toBe('2027-01-23');
      await t.type('[name=end]', '2027-01-18'); // before the first day: pulled up to it
      expect(end.value).toBe('2027-01-20');
    });

    it('sets the house rules with switches', async () => {
      const t = await boot('/admin/trips/new');
      const money = t.page().querySelector<HTMLElement>('[aria-label="House rules"]')!;
      const switches = [...money.querySelectorAll<HTMLButtonElement>('[role=switch]')];
      expect(switches.map((s) => s.getAttribute('aria-checked'))).toEqual([
        'true',
        'true',
        'false',
      ]);
      switches[2].click();
      await t.settle();
      await t.type('[name=name]', 'Vero');
      await t.type('[name=start]', '2027-01-11');
      await t.submit();
      expect(t.api.createTrip).toHaveBeenCalledWith(
        expect.objectContaining({ spectators_see_money: true }),
      );
    });
  });

  describe('Overview', () => {
    it('shows the trip with its status, and the way to its details', async () => {
      const { page } = await boot('/admin/trips/vero');
      const card = page().querySelector('[aria-label=Trip]')!;
      expect(card.textContent).toContain('Vero Beach 2027');
      expect(card.textContent).toContain('Vero Beach, FL · Jan 11–15, 2027');
      expect(card.querySelector('ui-badge')?.textContent?.trim()).toBe('Draft');
      expect(card.querySelector('a')?.getAttribute('href')).toBe('/admin/trips/vero/details');
    });

    it('publishes only after a confirm step, then separately offers to text everyone their invite', async () => {
      const t = await boot('/admin/trips/vero');
      await t.click('Publish');
      expect(t.api.updateTrip).not.toHaveBeenCalled();
      expect(t.page().querySelector('[role=dialog]')?.textContent).toContain(
        'Publish Vero Beach 2027?',
      );
      // The sheet's own button (the first "Publish" is the one that opened it).
      t.page().querySelector<HTMLElement>('[role=dialog] button[ui-button]')!.click();
      await t.settle();
      expect(t.api.updateTrip).toHaveBeenCalledWith('vero', { status: 'live' });
      expect(t.router.url).toBe('/admin/trips/vero'); // not sent anywhere yet
      const sheet = t.page().querySelector('[role=dialog]')!;
      expect(sheet.querySelector('h2')?.textContent).toBe('Vero Beach 2027 is published');
      expect(sheet.textContent).toContain('Text everyone their invite now?');
      await t.click('Text invites');
      expect(t.router.url).toBe('/admin/trips/vero/roster?send=all');
    });

    it('can publish without texting anyone', async () => {
      const t = await boot('/admin/trips/vero');
      await t.click('Publish');
      t.page().querySelector<HTMLElement>('[role=dialog] button[ui-button]')!.click();
      await t.settle();
      await t.click('Not now');
      expect(t.page().querySelector('[role=dialog]')).toBeNull();
      expect(t.router.url).toBe('/admin/trips/vero');
    });

    it('lets a co-organizer publish too', async () => {
      const t = await boot('/admin/trips/vero', 'co');
      await t.click('Publish');
      t.page().querySelector<HTMLElement>('[role=dialog] button[ui-button]')!.click();
      await t.settle();
      expect(t.api.updateTrip).toHaveBeenCalledWith('vero', { status: 'live' });
    });

    it('has no Publish for a trip that is published or finished', async () => {
      expect((await boot('/admin/trips/pines')).buttons()).not.toContain('Publish');
      TestBed.resetTestingModule();
      expect((await boot('/admin/trips/live')).buttons()).not.toContain('Publish');
    });

    it('offers the course library to trip creators only, and the way back to You to everyone', async () => {
      const mine = await boot('/admin/trips/live');
      expect(mine.buttons()).toEqual(expect.arrayContaining(['Course library', 'All my trips']));
      TestBed.resetTestingModule();
      const cal = await boot('/admin/trips/live', 'co');
      expect(cal.buttons()).toContain('Trip details');
      expect(cal.buttons()).toContain('All my trips');
      expect(cal.buttons()).not.toContain('Course library');
    });
  });

  describe('Rounds', () => {
    const round = (n: number, status: string, tbd: boolean, scored = false) => ({
      id: `r${n}`,
      round_number: n,
      play_date: '2027-01-12',
      tee_time: n === 1 ? '08:10:00' : null,
      status,
      pairings_tbd: tbd,
      courses: { name: `Course ${n}`, short_name: null },
      scored,
    });

    it('lists rounds with their day and status, Live only once a score is in', async () => {
      const { page } = await boot('/admin/trips/vero/rounds', 'organizer', {
        rounds: vi.fn(async () => [
          round(1, 'final', false),
          round(2, 'scheduled', false, true),
          round(3, 'live', false),
          round(4, 'scheduled', true),
        ]),
      });
      const rows = [...page().querySelectorAll('[aria-label=Rounds] ui-list-row')];
      expect(rows.map((r) => r.querySelector('ui-chip')?.textContent?.trim())).toEqual([
        'Final',
        'Live',
        'Ready',
        'Pairings TBD',
      ]);
      expect(rows[0].textContent).toContain('Course 1');
      expect(rows[0].textContent).toContain('Round 1 · Tue, Jan 12 · 8:10 AM');
      expect(rows[1].textContent).toContain('Round 2 · Tue, Jan 12');
    });

    it('offers Add round, except on a finished trip', async () => {
      expect((await boot('/admin/trips/vero/rounds')).buttons()).toContain('Add round');
      TestBed.resetTestingModule();
      expect((await boot('/admin/trips/pines/rounds')).buttons()).not.toContain('Add round');
    });
  });

  describe('People', () => {
    const FRITZ = player({ role: 'organizer', is_me: true });
    const VON = player({
      id: 'p2',
      name: 'Von',
      initials: 'V',
      role: 'co_organizer',
      handicap_index: 8.1,
      email: 'von@example.com',
      phone: null,
      sort_order: 2,
    });
    const MATT = player({
      id: 'p3',
      name: 'Matt',
      initials: 'M',
      handicap_index: 28.7,
      email: 'matt@example.com',
      sort_order: 3,
      phone: '+17725550103',
      claimed: false,
      flags: { no_email: false, not_claimed: true, not_paid: true },
    });
    const CHARLIE = player({
      id: 'p4',
      name: 'Charlie',
      initials: 'C',
      handicap_index: null,
      email: null,
      phone: null,
      sort_order: 4,
      claimed: false,
      flags: { no_email: true, not_claimed: true, not_paid: false },
    });
    const withRoster = { roster: vi.fn(async () => [FRITZ, VON, MATT, CHARLIE]) };
    const row = (page: HTMLElement, name: string) =>
      [...page.querySelectorAll('[aria-label=Players] ui-list-row')].find((r) =>
        r.querySelector('.title')?.textContent?.trim().startsWith(name),
      )!;
    const inRow = (page: HTMLElement, name: string, label: string) =>
      [...row(page, name).querySelectorAll<HTMLElement>('button')].find(
        (b) => b.textContent?.trim() === label || b.getAttribute('aria-label') === label,
      );
    /** Opens someone's ⋯ menu and returns its buttons. */
    async function menu(t: Awaited<ReturnType<typeof boot>>, name: string): Promise<string[]> {
      inRow(t.page(), name, `More for ${name}`)!.click();
      await t.settle();
      return [...t.page().querySelectorAll('[role=dialog] button[ui-button]')].map((b) =>
        b.textContent!.trim(),
      );
    }

    it('shows everyone with their role and index, and the "!" flags from the data', async () => {
      const { page } = await boot('/admin/trips/live/roster', 'organizer', withRoster);
      const text = (name: string) => row(page(), name).textContent;
      expect(row(page(), 'Fritz').querySelector('ui-chip')?.textContent).toBe('Organizer');
      expect(row(page(), 'Von').querySelector('ui-chip')?.textContent).toBe('Co-organizer');
      expect(row(page(), 'Matt').querySelector('ui-chip')).toBeNull();
      expect(text('Fritz')).toContain('Index 18.6');
      expect(text('Fritz')).not.toContain('yet');
      expect(text('Matt')).toContain('Not joined yet');
      expect(text('Matt')).toContain('Buy-in not paid');
      expect(text('Charlie')).toContain('No email yet');
      expect(text('Charlie')).not.toContain('Buy-in');
    });

    it('offers "Text invite" only for people who have not joined', async () => {
      const { page } = await boot('/admin/trips/live/roster', 'organizer', withRoster);
      expect(inRow(page(), 'Fritz', 'Text invite')).toBeUndefined();
      expect(inRow(page(), 'Von', 'Text invite')).toBeUndefined();
      expect(inRow(page(), 'Matt', 'Text invite')).toBeTruthy();
      expect(inRow(page(), 'Charlie', 'Text invite')).toBeTruthy();
    });

    it('Text invite makes a fresh link and opens Messages with it, on the site in use', async () => {
      const t = await boot('/admin/trips/live/roster', 'organizer', withRoster);
      inRow(t.page(), 'Matt', 'Text invite')!.click();
      await t.settle();
      expect(t.api.invite).toHaveBeenCalledWith('p3');
      expect(t.texted()).toEqual({
        to: '+17725550103',
        body: `Fritz added you to Vero Beach 2027 on Teed. Tap to join: ${t.origin}/invite/TOKEN-AGAIN`,
      });
    });

    it('with no phone saved, Text invite uses the share sheet', async () => {
      const t = await boot('/admin/trips/live/roster', 'organizer', withRoster);
      inRow(t.page(), 'Charlie', 'Text invite')!.click();
      await t.settle();
      expect(t.share).toHaveBeenCalledWith({
        text: `Fritz added you to Vero Beach 2027 on Teed. Tap to join: ${t.origin}/invite/TOKEN-AGAIN`,
      });
    });

    it('adds a player with name, email and role, then texts the invite: "Save and text invite"', async () => {
      const t = await boot('/admin/trips/live/roster', 'organizer', withRoster);
      await t.click('Add a player');
      await t.type('[name=name]', 'Ryan Hall');
      expect(t.page().querySelector<HTMLInputElement>('[name=initials]')?.value).toBe('RH');
      await t.type('[name=email]', ' Ryan@Example.com ');
      await t.type('[name=phone]', '(772) 555-0199');
      await t.type('[name=index]', '9.84');
      await t.click('Co-organizer');
      await t.click('Save and text invite');
      expect(t.api.addMember).toHaveBeenCalledWith('live', {
        name: 'Ryan Hall',
        initials: 'RH',
        email: 'ryan@example.com',
        phone: '+17725550199',
        handicap_index: 9.8,
        role: 'co_organizer',
      });
      expect(t.texted()).toEqual({
        to: '+17725550199',
        body: `Fritz added you to Vero Beach 2027 on Teed. Tap to join: ${t.origin}/invite/TOKEN-NEW`,
      });
    });

    it('needs only a name to add someone, and sends no text when they are on the trip at once', async () => {
      const t = await boot('/admin/trips/live/roster', 'organizer', {
        ...withRoster,
        addMember: vi.fn(async () => ({ id: 'new-member', token: null })),
      });
      await t.click('Add a player');
      await t.type('[name=name]', 'Sean');
      await t.click('Save and text invite');
      expect(t.api.addMember).toHaveBeenCalledWith(
        'live',
        expect.objectContaining({
          name: 'Sean',
          email: null,
          phone: null,
          handicap_index: null,
          role: 'player',
        }),
      );
      expect(t.texted()).toBeNull();
      expect(t.share).not.toHaveBeenCalled();
    });

    it('checks the form before saving', async () => {
      const t = await boot('/admin/trips/live/roster', 'organizer', withRoster);
      await t.click('Add a player');
      const problem = () => t.page().querySelector('[role=dialog] [role=alert]')?.textContent;
      await t.click('Save and text invite');
      expect(problem()).toContain('Enter a name');
      await t.type('[name=name]', 'Sean');
      await t.type('[name=email]', 'sean at example');
      await t.click('Save and text invite');
      expect(problem()).toContain('email address');
      await t.type('[name=email]', '');
      await t.type('[name=phone]', '12345');
      await t.click('Save and text invite');
      expect(problem()).toContain('mobile number');
      expect(t.api.addMember).not.toHaveBeenCalled();
    });

    it('edits someone, with the email fixed once they have signed in', async () => {
      const t = await boot('/admin/trips/live/roster', 'organizer', withRoster);
      expect(await menu(t, 'Matt')).toEqual(['Edit', 'Remove from trip']);
      await t.click('Edit');
      expect(t.page().querySelector<HTMLInputElement>('[name=email]')?.disabled).toBe(false);
      await t.type('[name=index]', '27.3');
      await t.click('Save');
      expect(t.api.updateMember).toHaveBeenCalledWith(
        MATT,
        expect.objectContaining({ name: 'Matt', handicap_index: 27.3 }),
      );
      TestBed.resetTestingModule();

      const joined = await boot('/admin/trips/live/roster', 'organizer', withRoster);
      await menu(joined, 'Von');
      await joined.click('Edit');
      expect(joined.page().querySelector<HTMLInputElement>('[name=email]')?.disabled).toBe(true);
    });

    it('removes a player only after a confirm step that says what goes', async () => {
      const t = await boot('/admin/trips/live/roster', 'organizer', withRoster);
      await menu(t, 'Charlie');
      await t.click('Remove from trip');
      expect(t.api.removeMember).not.toHaveBeenCalled();
      const sheet = t.page().querySelector('[role=dialog]')!;
      expect(sheet.querySelector('h2')?.textContent).toBe('Remove Charlie?');
      expect(sheet.textContent).toContain('out of every group');
      await t.click('Remove Charlie');
      expect(t.api.removeMember).toHaveBeenCalledWith('p4');
      expect(t.page().querySelector('[role=dialog]')).toBeNull();
    });

    it('never offers to remove the organizer or change their role', async () => {
      const t = await boot('/admin/trips/live/roster', 'organizer', withRoster);
      expect(await menu(t, 'Fritz')).toEqual(['Edit']);
      await t.click('Edit');
      expect(t.page().querySelector('[role=dialog] ui-segmented')).toBeNull();
    });

    it('steps through the people who have not joined for "Text everyone their invite"', async () => {
      const t = await boot('/admin/trips/live/roster?send=all', 'organizer', withRoster);
      const card = () => t.page().querySelector('[aria-label="Text everyone their invite"]');
      expect(card()?.textContent).toContain('1 of 2');
      expect(card()?.textContent).toContain('Text Matt');
      await t.click('Text Matt');
      expect(t.api.invite).toHaveBeenCalledWith('p3');
      await t.click('Next');
      expect(card()?.textContent).toContain('2 of 2');
      expect(card()?.textContent).toContain('Share with Charlie');
      await t.click('Done');
      expect(card()).toBeNull();
    });

    it('creates the spectator link, shares it, and resets it only after a confirm step', async () => {
      const spectatorToken = vi.fn(async (_id: string, action: string) =>
        action === 'reset' ? 'SPEC-1' : null,
      );
      const t = await boot('/admin/trips/live/roster', 'organizer', {
        ...withRoster,
        spectatorToken,
      });
      const card = () => t.page().querySelector('[aria-label=Spectators]')!;
      expect(spectatorToken).toHaveBeenCalledWith('live', 'get');
      expect(card().textContent).toContain('Create spectator link');
      await t.click('Create spectator link');
      expect(spectatorToken).toHaveBeenCalledWith('live', 'reset');

      await t.click('Share link');
      expect(t.share).toHaveBeenCalledWith({
        text: `Follow Vero Beach 2027. Tap to open Teed: ${t.origin}/watch/SPEC-1`,
      });

      spectatorToken.mockClear();
      await t.click('Reset');
      expect(spectatorToken).not.toHaveBeenCalled();
      expect(t.page().querySelector('[role=dialog]')?.textContent).toContain('stops working');
      await t.click('Reset link');
      expect(spectatorToken).toHaveBeenCalledWith('live', 'reset');
    });

    it('has no spectator link while the trip is a draft', async () => {
      const t = await boot('/admin/trips/vero/roster', 'organizer', withRoster);
      expect(t.page().querySelector('[aria-label=Spectators]')).toBeNull();
      expect(t.api.spectatorToken).not.toHaveBeenCalled();
    });

    describe('for a co-organizer', () => {
      it('keeps what they are allowed: inviting, adding and removing players, the spectator link', async () => {
        const t = await boot('/admin/trips/live/roster', 'co', withRoster);
        expect(inRow(t.page(), 'Matt', 'Text invite')).toBeTruthy();
        expect(t.buttons()).toContain('Add a player');
        expect(t.buttons()).toContain('Create spectator link');
        expect(await menu(t, 'Matt')).toEqual(['Edit', 'Remove from trip']);
      });

      it('hides what the database denies: choosing co-organizers and removing them', async () => {
        const t = await boot('/admin/trips/live/roster', 'co', withRoster);
        expect(await menu(t, 'Von')).toEqual(['Edit']);
        await t.click('Edit');
        expect(t.page().querySelector('[role=dialog] ui-segmented')).toBeNull();
        TestBed.resetTestingModule();

        const adding = await boot('/admin/trips/live/roster', 'co', withRoster);
        await adding.click('Add a player');
        expect(adding.page().querySelector('[role=dialog] ui-segmented')).toBeNull();
      });
    });

    it('gives the app admin, on a trip they are not on, everything the organizer has', async () => {
      const t = await boot('/admin/trips/live/roster', 'admin', withRoster);
      expect(await menu(t, 'Von')).toEqual(['Edit', 'Remove from trip']);
      await t.click('Edit');
      expect(t.page().querySelector('[role=dialog] ui-segmented')).toBeTruthy();
    });

    it('is read-only on a final trip', async () => {
      const t = await boot('/admin/trips/pines/roster', 'organizer', withRoster);
      expect(t.buttons()).not.toContain('Add a player');
      expect(inRow(t.page(), 'Matt', 'Text invite')).toBeUndefined();
      expect(inRow(t.page(), 'Matt', 'More for Matt')).toBeUndefined();
    });
  });

  describe('Trip creators (app admin)', () => {
    const CREATORS: TripCreator[] = [
      {
        id: 'c1',
        name: 'Charlie',
        phone: '+14125550100',
        claimed_at: '2026-11-01',
        email: 'charlie@example.com',
      },
      { id: 'c2', name: 'Brendan', phone: '+14125550148', claimed_at: null, email: null },
    ];
    const withCreators = { creators: vi.fn(async () => CREATORS) };

    it('lists who may create trips: their email once signed in, the invited number until then', async () => {
      const { page } = await boot('/admin/creators', 'admin', withCreators);
      const rows = [...page().querySelectorAll('[aria-label="Trip creators"] ui-list-row')];
      expect(rows.map((r) => r.querySelector('.title')?.textContent?.trim())).toEqual([
        'Charlie',
        'Brendan',
      ]);
      expect(rows[0].textContent).toContain('charlie@example.com');
      expect(rows[0].textContent).not.toContain('Text invite');
      expect(rows[1].textContent).toContain('(412) 555-0148');
      expect(rows[1].textContent).toContain('Text invite');
    });

    it('adds someone by name and phone, and texts them the invite to plan trips', async () => {
      const t = await boot('/admin/creators', 'admin', withCreators);
      await t.click('Add a trip creator');
      await t.type('[name=name]', 'Brendan');
      await t.type('[name=phone]', '(412) 555-0148');
      await t.click('Text Brendan an invite');
      expect(t.api.addCreator).toHaveBeenCalledWith('Brendan', '+14125550148');
      expect(t.texted()).toEqual({
        to: '+14125550148',
        body: `Fritz invited you to plan golf trips on Teed: ${t.origin}/invite/TOKEN-CREATOR`,
      });
    });

    it('texts a fresh invite to someone who has not signed in yet, and removes people', async () => {
      const t = await boot('/admin/creators', 'admin', withCreators);
      await t.click('Text invite');
      expect(t.api.inviteCreator).toHaveBeenCalledWith('c2');
      expect(t.texted()?.body).toContain('/invite/TOKEN-CREATOR-AGAIN');
      const remove = [...t.page().querySelectorAll<HTMLElement>('button')].filter(
        (b) => b.textContent?.trim() === 'Remove',
      );
      remove[0].click();
      await t.settle();
      expect(t.api.removeCreator).toHaveBeenCalledWith('c1');
    });
  });
});

describe('slugFor', () => {
  it("makes a trip's handle from its name", () => {
    expect(slugFor('Vero Beach 2027')).toBe('VEROBEACH202');
    expect(slugFor('Pines')).toBe('PINES');
  });

  it('always gives something the database accepts', () => {
    for (const name of ['', '!!', 'a', 'Élan', 'Vero Beach 2027'])
      for (const clash of [false, true])
        expect(slugFor(name, clash), `${name} ${clash}`).toMatch(/^[A-Z0-9]{2,12}$/);
  });

  it('ends differently after a clash', () => {
    expect(slugFor('Vero Beach 2027', true)).toMatch(/^VEROBEACH2[A-HJ-NP-Z2-9]{2}$/);
  });
});
