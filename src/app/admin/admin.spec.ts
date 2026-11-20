import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { SessionService, TripSession } from '../core/session';
import { AdminAuth } from './auth';
import { AdminData, AdminError, RosterPlayer, Trip } from './data';
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
  owner_player_id: null,
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

const player = (over: Partial<RosterPlayer>): RosterPlayer => ({
  id: 'p1',
  name: 'Fritz',
  initials: 'FW',
  role: 'player',
  handicap_index: 18.6,
  index_entered_at: '2027-01-01',
  sort_order: 1,
  code: 'K4M-9QT',
  phone: '+17725550101',
  ...over,
});

const LIVE: Trip = { ...VERO, id: 'live', status: 'live', owner_player_id: 'p1' };

/** Cal, a co-admin of the live trip, on the phone he logged in on with his code. */
const CAL: TripSession = {
  role: 'player',
  via: 'code',
  trip: {
    id: 'live',
    name: 'Vero Beach 2027',
    slug: 'VERO',
    status: 'live',
    location: 'Vero Beach, FL',
    start_date: '2027-01-11',
    end_date: '2027-01-15',
  },
  player: { id: 'p3', name: 'Cal', initials: 'CM', role: 'co_admin' },
};

/**
 * Boots the organizer area at a URL. `who` is the email sign-in: an organizer, someone else, or
 * nobody. `session` is the phone's player login, if any (a co-admin gets in on theirs).
 */
async function boot(
  url: string,
  who: 'organizer' | 'stranger' | 'nobody' = 'organizer',
  data: Partial<Record<keyof AdminData, unknown>> = {},
  session: TripSession | null = null,
) {
  const auth = {
    email: signal(who === 'nobody' ? null : `${who}@example.com`),
    isOrganizer: signal(who === 'organizer'),
    ready: vi.fn(async () => {}),
    send: vi.fn(async () => 'sent'),
    signIn: vi.fn(async () => 'ok'),
    setPassword: vi.fn(async () => true),
    signOut: vi.fn(async () => {
      auth.email.set(null);
      auth.isOrganizer.set(false);
    }),
  };
  const api = {
    trips: vi.fn(async () => [VERO, PINES, LIVE]),
    trip: vi.fn(async (id: string) => (id === 'pines' ? PINES : id === 'live' ? LIVE : VERO)),
    rounds: vi.fn(async () => []),
    roster: vi.fn(async () => [] as RosterPlayer[]),
    player: vi.fn(async () => ({ id: 'p1', name: 'Fritz', initials: 'FW', role: 'player' })),
    spectatorCode: vi.fn(async () => null),
    createTrip: vi.fn(async (fields: object) => ({ ...VERO, ...fields, id: 'new-trip' })),
    updateTrip: vi.fn(async (_id: string, fields: object) => ({ ...VERO, ...fields })),
    addPlayer: vi.fn(async () => {}),
    updatePlayer: vi.fn(async () => {}),
    courses: vi.fn(async () => []),
    ...data,
  };
  const sessions = {
    session: signal(session),
    enterAsOwner: vi.fn(),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        [
          { path: 'admin', children: ADMIN_ROUTES },
          { path: 'login', children: [] },
          { path: 'home', children: [] },
        ],
        withComponentInputBinding(),
      ),
      { provide: AdminAuth, useValue: auth },
      { provide: AdminData, useValue: api },
      { provide: SessionService, useValue: sessions },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  await harness.fixture.whenStable();
  const settle = () => harness.fixture.whenStable();
  const page = () => harness.routeNativeElement as HTMLElement;
  const buttons = () =>
    [...page().querySelectorAll<HTMLElement>('button, a')].map((b) => b.textContent?.trim());
  const click = async (label: string) => {
    const target = [...page().querySelectorAll<HTMLElement>('button, a')].find(
      (b) => b.textContent?.trim() === label,
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
  const router = TestBed.inject(Router);
  return { page, auth, api, sessions, router, buttons, click, type, submit, settle };
}

const title = (page: HTMLElement) => page.querySelector('h1')?.textContent;
const pill = (page: HTMLElement) => page.querySelector('ui-header-band .action');
const tabs = (page: HTMLElement) =>
  [...page.querySelectorAll('ui-tab-bar a')].map(
    (a) => a.textContent?.trim() + (a.classList.contains('on') ? '*' : ''),
  );

describe('organizer area', () => {
  describe('who gets in', () => {
    it('sends someone who is not signed in to the sign-in screen', async () => {
      const { router, page } = await boot('/admin', 'nobody');
      expect(router.url).toBe('/admin/sign-in');
      expect(title(page())).toBe('Organizer sign-in');
    });

    it('lets an organizer in', async () => {
      const { router, page } = await boot('/admin');
      expect(router.url).toBe('/admin');
      expect(title(page())).toBe('My trips');
    });

    it('gives a signed-in non-organizer nothing but a way to sign out', async () => {
      const { router, page, api, click, auth } = await boot('/admin/trips/vero/roster', 'stranger');
      expect(router.url).toBe('/admin/sign-in');
      expect(page().textContent).toContain("stranger@example.com isn't an organizer account");
      expect(api.roster).not.toHaveBeenCalled();
      await click('Sign out');
      expect(auth.signOut).toHaveBeenCalled();
    });

    it("lets a co-admin into their own trip's screens on their code login", async () => {
      const { router, page } = await boot('/admin/trips/live', 'nobody', {}, CAL);
      expect(router.url).toBe('/admin/trips/live');
      expect(title(page())).toBe('Overview');
    });

    it('keeps a co-admin out of other trips, My trips, new trips and the course library', async () => {
      for (const url of ['/admin/trips/vero', '/admin', '/admin/trips/new', '/admin/courses']) {
        const { router } = await boot(url, 'nobody', {}, CAL);
        expect(router.url, url).toBe('/admin/sign-in');
        TestBed.resetTestingModule();
      }
    });

    it('keeps an ordinary player out', async () => {
      const player = { ...CAL, player: { ...CAL.player!, role: 'player' as const } };
      const { router } = await boot('/admin/trips/live', 'nobody', {}, player);
      expect(router.url).toBe('/admin/sign-in');
    });
  });

  describe('sign-in', () => {
    it('signs in with email and password', async () => {
      const t = await boot('/admin/sign-in', 'nobody');
      t.auth.signIn.mockImplementation(async () => {
        t.auth.email.set('me@example.com');
        t.auth.isOrganizer.set(true);
        return 'ok';
      });
      await t.type('#email', ' me@example.com ');
      await t.type('#password', 'correct horse');
      await t.submit();
      expect(t.auth.signIn).toHaveBeenCalledWith('me@example.com', 'correct horse');
      expect(t.router.url).toBe('/admin');
    });

    it('says so when the email and password do not match', async () => {
      const t = await boot('/admin/sign-in', 'nobody');
      t.auth.signIn.mockResolvedValue('wrong');
      await t.type('#email', 'me@example.com');
      await t.type('#password', 'nope');
      await t.submit();
      expect(t.page().querySelector('[role=alert]')?.textContent).toContain("don't match");
      expect(t.router.url).toBe('/admin/sign-in');
    });

    it('emails a link instead, as the second option', async () => {
      const t = await boot('/admin/sign-in', 'nobody');
      await t.type('#email', 'me@example.com');
      await t.click('Email me a link instead');
      expect(t.auth.send).toHaveBeenCalledWith('me@example.com');
      expect(t.auth.signIn).not.toHaveBeenCalled();
      expect(t.page().textContent).toContain('Check me@example.com and tap the link');
    });

    it('says so when there have been too many tries', async () => {
      const t = await boot('/admin/sign-in', 'nobody');
      t.auth.send.mockResolvedValue('rate_limited');
      await t.type('#email', 'me@example.com');
      await t.click('Email me a link instead');
      expect(t.page().querySelector('[role=alert]')?.textContent).toContain('Too many tries');
    });
  });

  describe('tab bar', () => {
    it('is not on My trips or the sign-in screen', async () => {
      expect((await boot('/admin')).page().querySelector('ui-tab-bar')).toBeNull();
      TestBed.resetTestingModule();
      const signIn = await boot('/admin/sign-in', 'nobody');
      expect(signIn.page().querySelector('ui-tab-bar')).toBeNull();
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

    it('stays, with nothing lit, in the course library, and goes on My trips', async () => {
      const t = await boot('/admin/trips/vero');
      await t.click('Course library');
      expect(t.router.url).toBe('/admin/courses');
      expect(tabs(t.page())).toEqual(['Overview', 'Rounds', 'People', 'Itinerary']);
      await t.router.navigateByUrl('/admin');
      await t.settle();
      expect(t.page().querySelector('ui-tab-bar')).toBeNull();
    });
  });

  describe('header and mode switch', () => {
    it('labels a trip\'s screens "Organizer · <trip name>"', async () => {
      const { page } = await boot('/admin/trips/vero/roster');
      expect(page().querySelector('ui-header-band .label')?.textContent).toBe(
        'Organizer · Vero Beach 2027',
      );
      expect(title(page())).toBe('People');
    });

    it('hides Player view while the trip is a draft', async () => {
      expect(pill((await boot('/admin/trips/vero')).page())).toBeNull();
    });

    it('hides Player view when the owner has not said which player they are', async () => {
      const trip = vi.fn(async () => ({ ...LIVE, owner_player_id: null }));
      expect(pill((await boot('/admin/trips/live', 'organizer', { trip })).page())).toBeNull();
    });

    it('Player view puts the owner in player mode as their own player, with no code', async () => {
      const t = await boot('/admin/trips/live');
      expect(pill(t.page())?.textContent).toBe('Player view');
      await t.click('Player view');
      expect(t.api.player).toHaveBeenCalledWith('p1');
      expect(t.sessions.enterAsOwner).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'live', status: 'live', owner_player_id: 'p1' }),
        expect.objectContaining({ id: 'p1', name: 'Fritz' }),
      );
      expect(t.router.url).toBe('/home');
    });

    it('Player view takes a co-admin back to the login they already have', async () => {
      const t = await boot('/admin/trips/live', 'nobody', {}, CAL);
      await t.click('Player view');
      expect(t.sessions.enterAsOwner).not.toHaveBeenCalled();
      expect(t.router.url).toBe('/home');
    });
  });

  describe('My trips', () => {
    it('lists upcoming trips with their status, and past trips as final', async () => {
      const { page } = await boot('/admin');
      const upcoming = page().querySelector('[aria-label=Upcoming]')!;
      const past = page().querySelector('[aria-label=Past]')!;
      expect(upcoming.textContent).toContain('Vero Beach 2027');
      expect([...upcoming.querySelectorAll('ui-badge')].map((b) => b.textContent?.trim())).toEqual([
        'draft',
        'live',
      ]);
      expect(past.textContent).toContain('Southern Pines 2026');
      expect(past.querySelector('ui-badge')?.textContent?.trim()).toBe('final');
      expect(page().querySelector('a[ui-button]')?.textContent).toContain('New trip');
    });

    it('opens a draft in organizer mode', async () => {
      const t = await boot('/admin');
      t.page().querySelector<HTMLElement>('[aria-label=Upcoming] button')!.click();
      await t.settle();
      expect(t.router.url).toBe('/admin/trips/vero');
      expect(t.sessions.enterAsOwner).not.toHaveBeenCalled();
    });

    it('opens a live trip in player mode, as the player marked "This is me"', async () => {
      const t = await boot('/admin');
      t.page().querySelectorAll<HTMLElement>('[aria-label=Upcoming] button')[1].click();
      await t.settle();
      expect(t.sessions.enterAsOwner).toHaveBeenCalled();
      expect(t.router.url).toBe('/home');
    });

    it('opens a live trip in organizer mode when "This is me" is not set', async () => {
      const t = await boot('/admin', 'organizer', {
        trips: vi.fn(async () => [{ ...LIVE, owner_player_id: null }]),
      });
      t.page().querySelector<HTMLElement>('[aria-label=Upcoming] button')!.click();
      await t.settle();
      expect(t.sessions.enterAsOwner).not.toHaveBeenCalled();
      expect(t.router.url).toBe('/admin/trips/live');
    });

    it('lets the organizer set a password', async () => {
      const t = await boot('/admin');
      await t.click('Set password');
      await t.type('[name=new-password]', 'short');
      await t.submit();
      expect(t.page().querySelector('[role=alert]')?.textContent).toContain('at least 8');
      await t.type('[name=new-password]', 'long enough now');
      await t.submit();
      expect(t.auth.setPassword).toHaveBeenCalledWith('long enough now');
      expect(t.page().textContent).toContain('Password saved');
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
      expect(card.querySelector('ui-badge')?.textContent?.trim()).toBe('draft');
      expect(card.querySelector('a')?.getAttribute('href')).toBe('/admin/trips/vero/details');
    });

    it('goes live only after a confirm step, then separately offers to text everyone their link', async () => {
      const t = await boot('/admin/trips/vero');
      await t.click('Go live');
      expect(t.api.updateTrip).not.toHaveBeenCalled();
      expect(t.page().querySelector('[role=dialog]')?.textContent).toContain(
        'Set Vero Beach 2027 live?',
      );
      // The sheet's own button (the first "Go live" is the one that opened it).
      t.page().querySelector<HTMLElement>('[role=dialog] button[ui-button]')!.click();
      await t.settle();
      expect(t.api.updateTrip).toHaveBeenCalledWith('vero', { status: 'live' });
      expect(t.router.url).toBe('/admin/trips/vero'); // not sent anywhere yet
      await t.click('Text everyone their link');
      expect(t.router.url).toBe('/admin/trips/vero/roster?send=all');
    });

    it('can go live without texting anyone', async () => {
      const t = await boot('/admin/trips/vero');
      await t.click('Go live');
      t.page().querySelector<HTMLElement>('[role=dialog] button[ui-button]')!.click();
      await t.settle();
      await t.click('Not now');
      expect(t.page().querySelector('[role=dialog]')).toBeNull();
      expect(t.router.url).toBe('/admin/trips/vero');
    });

    it('has no Go live for a trip that is live or finished', async () => {
      expect((await boot('/admin/trips/pines')).buttons()).not.toContain('Go live');
      TestBed.resetTestingModule();
      expect((await boot('/admin/trips/live')).buttons()).not.toContain('Go live');
    });

    it('gives the organizer the course library and their other trips, but not a co-admin', async () => {
      const mine = await boot('/admin/trips/live');
      expect(mine.buttons()).toEqual(expect.arrayContaining(['Course library', 'All trips']));
      TestBed.resetTestingModule();
      const cal = await boot('/admin/trips/live', 'nobody', {}, CAL);
      expect(cal.buttons()).toContain('Trip details');
      expect(cal.buttons()).not.toContain('Course library');
      expect(cal.buttons()).not.toContain('All trips');
      expect(cal.buttons()).not.toContain('Go live');
    });
  });

  describe('Rounds', () => {
    const round = (n: number, status: string, tbd: boolean) => ({
      id: `r${n}`,
      round_number: n,
      play_date: '2027-01-12',
      tee_time: n === 1 ? '08:10:00' : null,
      status,
      pairings_tbd: tbd,
      courses: { name: `Course ${n}`, short_name: null },
    });

    it('lists rounds with their day and status', async () => {
      const { page } = await boot('/admin/trips/vero/rounds', 'organizer', {
        rounds: vi.fn(async () => [
          round(1, 'final', false),
          round(2, 'live', false),
          round(3, 'scheduled', false),
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
    const roster = [
      player({}),
      player({
        id: 'p2',
        name: 'Ben',
        initials: 'BK',
        code: 'Q2X7RD',
        phone: null,
        handicap_index: null,
        index_entered_at: null,
        sort_order: 2,
        role: 'co_admin',
      }),
    ];
    const withRoster = { roster: vi.fn(async () => roster) };
    const rows = (page: HTMLElement) =>
      [...page.querySelectorAll('[aria-label=Players] ui-list-row')].map(
        (r) => r.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      );
    const menu = async (t: Awaited<ReturnType<typeof boot>>, name: string) => {
      t.page().querySelector<HTMLElement>(`[aria-label="More for ${name}"]`)!.click();
      await t.settle();
      return [...t.page().querySelectorAll('[role=dialog] button[ui-button]')].map((b) =>
        b.textContent?.trim(),
      );
    };

    it('shows each player with code and index, and warns about an unconfirmed index', async () => {
      const { page } = await boot('/admin/trips/vero/roster', 'organizer', withRoster);
      const [fritz, ben] = rows(page());
      expect(fritz).toContain('Fritz');
      expect(fritz).toContain('K4M9QT · Index 18.6');
      expect(fritz).not.toContain('not confirmed');
      expect(fritz).toContain('Text link');
      expect(ben).toContain('Ben');
      expect(ben).toContain('Co-admin');
      expect(ben).toContain('Index not confirmed');
    });

    it('Text link opens Messages with the join link, always on the production address', async () => {
      const t = await boot('/admin/trips/vero/roster', 'organizer', withRoster);
      const href = vi.fn();
      const original = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: {
          ...original,
          set href(value: string) {
            href(value);
          },
        },
      });
      try {
        t.page().querySelector<HTMLElement>('[aria-label=Players] button[ui-button]')!.click();
        await t.settle();
      } finally {
        Object.defineProperty(window, 'location', { configurable: true, value: original });
      }
      const link = href.mock.calls[0][0] as string;
      expect(link.startsWith('sms:+17725550101?&body=')).toBe(true);
      expect(decodeURIComponent(link.split('body=')[1])).toBe(
        'You’re in for Vero Beach 2027. Tap to open Teed: https://teed.fgwilt1.workers.dev/join/K4M9QT',
      );
    });

    it('with no phone saved, Text link uses the share sheet', async () => {
      const share = vi.fn(async () => {});
      Object.defineProperty(navigator, 'share', { configurable: true, value: share });
      const t = await boot('/admin/trips/vero/roster', 'organizer', withRoster);
      t.page().querySelectorAll<HTMLElement>('[aria-label=Players] button[ui-button]')[2].click();
      await t.settle();
      expect(share).toHaveBeenCalledWith({
        text: 'You’re in for Vero Beach 2027. Tap to open Teed: https://teed.fgwilt1.workers.dev/join/Q2X7RD',
      });
    });

    it('offers edit, replace, new code, co-admin and This is me from the ⋯ menu', async () => {
      const t = await boot('/admin/trips/vero/roster', 'organizer', withRoster);
      expect(await menu(t, 'Fritz')).toEqual([
        'Edit',
        'Replace player',
        'New code',
        'Make co-admin',
        'This is me',
      ]);
    });

    it('"This is me" marks the player as the owner, and the row then says so', async () => {
      const updateTrip = vi.fn(async () => ({ ...VERO, owner_player_id: 'p1' }));
      const t = await boot('/admin/trips/vero/roster', 'organizer', { ...withRoster, updateTrip });
      await menu(t, 'Fritz');
      await t.click('This is me');
      expect(updateTrip).toHaveBeenCalledWith('vero', { owner_player_id: 'p1' });
      expect(rows(t.page())[0]).toContain('Owner');
      expect(await menu(t, 'Fritz')).not.toContain('This is me');
    });

    it('adds a player, suggesting initials and tidying the phone number', async () => {
      const t = await boot('/admin/trips/vero/roster', 'organizer', withRoster);
      await t.click('Add player');
      await t.type('[name=name]', 'Cal Morgan');
      expect(t.page().querySelector<HTMLInputElement>('[name=initials]')!.value).toBe('CM');
      await t.type('[name=phone]', '(772) 555-0199');
      await t.type('[name=index]', '12.4');
      await t.submit();
      expect(t.api.addPlayer).toHaveBeenCalledWith(
        'vero',
        { name: 'Cal Morgan', initials: 'CM', phone: '+17725550199', handicap_index: 12.4 },
        3,
      );
    });

    it('refuses a phone number that is not one', async () => {
      const t = await boot('/admin/trips/vero/roster', 'organizer', withRoster);
      await t.click('Add player');
      await t.type('[name=name]', 'Cal');
      await t.type('[name=phone]', '555');
      await t.submit();
      expect(t.page().querySelector('[role=alert]')?.textContent).toContain(
        "doesn't look like a mobile number",
      );
      expect(t.api.addPlayer).not.toHaveBeenCalled();
    });

    it('steps through the players for "Text everyone their link"', async () => {
      const t = await boot('/admin/trips/vero/roster?send=all', 'organizer', withRoster);
      const panel = () =>
        t
          .page()
          .querySelector('[aria-label="Text everyone their link"]')
          ?.textContent?.replace(/\s+/g, ' ') ?? '';
      expect(panel()).toContain('1 of 2');
      expect(panel()).toContain('Text Fritz');
      await t.click('Next');
      expect(panel()).toContain('2 of 2');
      expect(panel()).toContain('Share with Ben'); // no phone number: the share sheet
      await t.click('Done');
      expect(t.page().querySelector('[aria-label="Text everyone their link"]')).toBeNull();
    });

    it('offers to create the spectator link, then shows it with Share and an on/off switch', async () => {
      const none = await boot('/admin/trips/vero/roster', 'organizer', withRoster);
      expect(none.page().querySelector('[aria-label=Spectators]')?.textContent).toContain(
        'Create spectator link',
      );
      TestBed.resetTestingModule();
      const some = await boot('/admin/trips/vero/roster', 'organizer', {
        ...withRoster,
        spectatorCode: vi.fn(async () => ({ id: 's1', code: 'W7Q-3DX', enabled: true })),
      });
      const card = some.page().querySelector('[aria-label=Spectators]')!;
      expect(card.textContent).toContain('W7Q3DX');
      expect(card.textContent).toContain('Share link');
      expect(card.querySelector('[role=switch]')?.getAttribute('aria-checked')).toBe('true');
    });

    describe('for a co-admin', () => {
      // What the database gives a co-admin: the roster, with no codes or phone numbers.
      const seen = {
        roster: vi.fn(async () => roster.map((p) => ({ ...p, code: null, phone: null }))),
      };

      it('hides what the database denies: codes, links, adding players, the spectator link', async () => {
        const t = await boot('/admin/trips/live/roster', 'nobody', seen, CAL);
        expect(rows(t.page())[0]).toContain('Fritz');
        expect(rows(t.page())[0]).toContain('Index 18.6');
        expect(t.page().textContent).not.toContain('K4M9QT');
        expect(t.buttons()).not.toContain('Text link');
        expect(t.buttons()).not.toContain('Text everyone their link');
        expect(t.buttons()).not.toContain('Add player');
        expect(t.page().querySelector('[aria-label=Spectators]')).toBeNull();
        expect(t.api.spectatorCode).not.toHaveBeenCalled();
      });

      it('keeps what they are allowed: editing a player, without the phone number', async () => {
        const t = await boot('/admin/trips/live/roster', 'nobody', seen, CAL);
        expect(await menu(t, 'Fritz')).toEqual(['Edit']);
        await t.click('Edit');
        expect(t.page().querySelector('[name=phone]')).toBeNull();
        await t.type('[name=index]', '17.2');
        await t.submit();
        expect(t.api.updatePlayer).toHaveBeenCalledWith(
          'p1',
          expect.objectContaining({ name: 'Fritz', handicap_index: 17.2 }),
        );
      });
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
