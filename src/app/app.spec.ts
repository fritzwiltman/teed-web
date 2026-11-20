import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';
import { InstallPlatform, InstallService } from './core/install';
import { RedeemOutcome, SessionService, TripSession } from './core/session';

const SAVED: TripSession = {
  role: 'player',
  via: 'code',
  trip: {
    id: 't1',
    name: 'Southern Pines 2026',
    slug: 'PINES',
    status: 'live',
    location: 'Southern Pines, NC',
    start_date: '2026-10-08',
    end_date: '2026-10-12',
  },
  player: { id: 'p1', name: 'Fritz', initials: 'FW', role: 'player' },
};
const CO_ADMIN: TripSession = { ...SAVED, player: { ...SAVED.player!, role: 'co_admin' } };
const SPECTATOR: TripSession = { ...SAVED, role: 'spectator', player: null };

/** Boots the app at a URL with the given saved login and returns the page. */
async function boot(
  url: string,
  saved: TripSession | null,
  options: {
    rounds?: unknown[];
    platform?: InstallPlatform;
    canPrompt?: boolean;
    redeem?: RedeemOutcome;
  } = {},
) {
  const session = signal(saved);
  const revalidate = vi.fn(async () => {});
  // The rounds query on trip home.
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order']) query[method] = () => query;
  query['then'] = (resolve: (value: unknown) => void) =>
    resolve({ data: options.rounds ?? [], error: null });
  const db = {
    from: () => query,
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://photos.test/${path}` } }),
      }),
    },
  };
  const redeem = vi.fn(async () => {
    const outcome = options.redeem ?? { status: 'ok' };
    if (outcome.status === 'ok') session.set(SAVED);
    return outcome;
  });
  const logout = vi.fn(async () => session.set(null));
  const copied = vi.fn(async () => {});
  const promptInstall = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: copied, readText: vi.fn(async () => '') },
  });

  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      {
        provide: SessionService,
        useValue: {
          session,
          revalidate,
          redeem,
          logout,
          db: () => db,
          code: () => 'K4M9QT',
          exitUrl: signal('/login'),
          canManage: computed(() => {
            const s = session();
            return !!s && (s.via === 'owner' || s.player?.role === 'co_admin');
          }),
        },
      },
      {
        provide: InstallService,
        useValue: {
          platform: signal(options.platform ?? 'other'),
          canPrompt: signal(options.canPrompt ?? false),
          promptInstall,
        },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(App);
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  await fixture.whenStable();
  // Trip home swaps its loading skeleton for the round once the rounds query answers.
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  const el = fixture.nativeElement as HTMLElement;
  const click = async (label: string) => {
    const target = [...el.querySelectorAll<HTMLElement>('button, a')].find(
      (b) => b.textContent?.trim() === label,
    );
    expect(target, `a button or link labelled "${label}"`).toBeTruthy();
    target!.click();
    await fixture.whenStable();
  };
  return {
    fixture,
    router,
    session,
    revalidate,
    redeem,
    logout,
    copied,
    promptInstall,
    el,
    click,
  };
}

const tabs = (el: HTMLElement) =>
  [...el.querySelectorAll('ui-tab-bar a')].map((a) => a.textContent?.trim());
const pill = (el: HTMLElement) => el.querySelector<HTMLAnchorElement>('ui-header-band .action');

describe('App', () => {
  it('opens on Welcome back when nobody is logged in', async () => {
    const { router, el } = await boot('/', null);
    expect(router.url).toBe('/login');
    expect(el.querySelector('.wordmark')?.textContent).toBe('teed');
    expect(el.querySelector('h1')?.textContent).toBe('Welcome back');
    expect(el.textContent).toContain('Paste my code');
    expect(el.querySelectorAll('input.box')).toHaveLength(6);
    expect(el.querySelector('ui-tab-bar')).toBeNull();
  });

  it('opens on trip home when a login is saved, and checks it with the server', async () => {
    const { router, el, revalidate } = await boot('/', SAVED);
    expect(router.url).toBe('/home');
    expect(el.querySelector('h1')?.textContent).toContain('Southern Pines 2026');
    expect(el.querySelector('ui-header-band .label')?.textContent).toBe(
      'Southern Pines, NC · Oct 8–12, 2026',
    );
    expect(revalidate).toHaveBeenCalled();
  });

  describe('tab bar', () => {
    it('has Home, Scorecard, Board and Trip, with the current one lit', async () => {
      const { el, router, fixture } = await boot('/home', SAVED);
      expect(tabs(el)).toEqual(['Home', 'Scorecard', 'Board', 'Trip']);
      expect(el.querySelector('ui-tab-bar a.on')?.textContent).toContain('Home');
      await router.navigateByUrl('/board');
      await fixture.whenStable();
      expect(el.querySelector('ui-tab-bar a[aria-current=page]')?.textContent).toContain('Board');
    });

    it('has no Scorecard for a spectator', async () => {
      expect(tabs((await boot('/home', SPECTATOR)).el)).toEqual(['Home', 'Board', 'Trip']);
    });
  });

  describe('Manage pill', () => {
    it('is there for a co-admin and goes to that trip in organizer mode', async () => {
      const { el } = await boot('/home', CO_ADMIN);
      expect(pill(el)?.textContent).toBe('Manage');
      expect(pill(el)?.getAttribute('href')).toBe('/admin/trips/t1');
    });

    it('is there for the owner on their organizer sign-in, on every player screen', async () => {
      const { el, router, fixture } = await boot('/home', { ...SAVED, via: 'owner' });
      expect(pill(el)?.textContent).toBe('Manage');
      for (const url of ['/score', '/board', '/trip']) {
        await router.navigateByUrl(url);
        await fixture.whenStable();
        expect(pill(el)?.textContent, url).toBe('Manage');
      }
    });

    it('is never shown to a player or a spectator', async () => {
      expect(pill((await boot('/home', SAVED)).el)).toBeNull();
      TestBed.resetTestingModule();
      expect(pill((await boot('/home', SPECTATOR)).el)).toBeNull();
    });
  });

  const round = (round_number: number, play_date: string) => ({
    round_number,
    play_date,
    tee_time: '08:00:00',
    status: 'scheduled',
    courses: { name: `Course ${round_number}`, photo_path: null as string | null },
    tees: { name: 'White' },
    round_formats: [{ format_key: 'nassau' }],
    groups: [] as unknown[],
  });
  const iso = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  describe('round card', () => {
    const card = (el: HTMLElement) => el.querySelector('ui-course-card');
    const label = (el: HTMLElement) => card(el)?.querySelector('.label')?.textContent?.trim();
    const chips = (el: HTMLElement) =>
      [...el.querySelectorAll('ui-course-card ui-chip')].map((c) => c.textContent?.trim());

    it("shows today's round ahead of the next one", async () => {
      const { el } = await boot('/home', SAVED, {
        rounds: [round(1, iso(-1)), round(2, iso(0)), round(3, iso(1))],
      });
      expect(card(el)?.querySelector('h2')?.textContent).toBe('Course 2');
    });

    it('heads the card "Round N · Ddd, Mon D", for the next round or else the last', async () => {
      const next = await boot('/home', SAVED, {
        rounds: [round(1, iso(-1)), round(2, '2099-10-09')],
      });
      expect(label(next.el)).toBe('Round 2 · Fri, Oct 9');
      TestBed.resetTestingModule();
      const past = await boot('/home', SAVED, {
        rounds: [round(3, '2026-10-11'), round(4, '2026-10-12')],
      });
      expect(label(past.el)).toBe('Round 4 · Mon, Oct 12');
    });

    it('has chips for tee time, format and tees, and drops the empty ones', async () => {
      const full = await boot('/home', SAVED, { rounds: [round(1, iso(0))] });
      expect(chips(full.el)).toEqual(['8:00 AM', 'Nassau', 'White tees']);
      TestBed.resetTestingModule();
      const sparse = await boot('/home', SAVED, {
        rounds: [{ ...round(1, iso(0)), tee_time: null, round_formats: [] }],
      });
      expect(chips(sparse.el)).toEqual(['White tees']);
    });

    it("lists the players in my group, in order, and not other groups'", async () => {
      const gp = (position: number, id: string, name: string) => ({
        position,
        players: { id, name },
      });
      const groups = [
        { group_players: [gp(1, 'p8', 'Jack'), gp(2, 'p9', 'Tom')] },
        { group_players: [gp(2, 'p2', 'Von'), gp(1, 'p1', 'Fritz')] },
      ];
      const { el } = await boot('/home', SAVED, { rounds: [{ ...round(1, iso(0)), groups }] });
      expect(card(el)?.textContent).toContain('Fritz · Von');
      expect(el.textContent).not.toContain('Jack');
    });

    const scored = [{ group_players: [{ position: 1, players: null, scores: [{ count: 3 }] }] }];

    it('shows the course photo when there is one, and the LIVE pill once a score is in', async () => {
      const live = {
        ...round(1, iso(0)),
        groups: scored,
        courses: { name: 'Sandridge', photo_path: 'abc.jpg' },
      };
      const { el } = await boot('/home', SAVED, { rounds: [live] });
      expect(card(el)?.querySelector('img')?.getAttribute('src')).toBe(
        'https://photos.test/abc.jpg',
      );
      expect(card(el)?.querySelector('.live')?.textContent).toContain('Live');
    });

    it('has no LIVE pill before the first score, or once the round is final', async () => {
      const none = [{ group_players: [{ position: 1, players: null, scores: [{ count: 0 }] }] }];
      const before = await boot('/home', SAVED, {
        rounds: [{ ...round(1, iso(0)), status: 'live', groups: none }],
      });
      expect(card(before.el)?.querySelector('.live')).toBeNull();
      TestBed.resetTestingModule();
      const after = await boot('/home', SAVED, {
        rounds: [{ ...round(1, iso(0)), status: 'final', groups: scored }],
      });
      expect(card(after.el)?.querySelector('.live')).toBeNull();
    });

    it('ends with one button into scoring, worded for where the round is', async () => {
      const button = (el: HTMLElement) => card(el)?.querySelector('a[ui-button]');
      const before = await boot('/home', SAVED, { rounds: [round(1, iso(0))] });
      expect(button(before.el)?.textContent?.trim()).toBe('Start scoring');
      expect(button(before.el)?.getAttribute('href')).toBe('/score');
      TestBed.resetTestingModule();
      const during = await boot('/home', SAVED, {
        rounds: [{ ...round(1, iso(0)), groups: scored }],
      });
      expect(button(during.el)?.textContent?.trim()).toBe('Continue scoring');
      TestBed.resetTestingModule();
      const after = await boot('/home', SAVED, {
        rounds: [{ ...round(1, iso(0)), status: 'final' }],
      });
      expect(button(after.el)).toBeFalsy();
      TestBed.resetTestingModule();
      const watching = await boot('/home', SPECTATOR, { rounds: [round(1, iso(0))] });
      expect(button(watching.el)).toBeFalsy();
    });

    it('is not shown at all when there is no round to show', async () => {
      expect(card((await boot('/home', SAVED)).el)).toBeNull();
    });
  });

  describe('role', () => {
    const role = (el: HTMLElement) =>
      el.querySelector('[aria-label=You] ui-chip')?.textContent?.trim() ?? null;

    it('is absent for a regular player', async () => {
      expect(role((await boot('/home', SAVED)).el)).toBeNull();
    });

    it('says Co-admin for a co-admin', async () => {
      expect(role((await boot('/home', CO_ADMIN)).el)).toBe('Co-admin');
    });

    it("says Owner for the trip's owner player, whatever their player role", async () => {
      const owner = { ...SAVED, trip: { ...SAVED.trip, owner_player_id: 'p1' } };
      expect(role((await boot('/home', owner)).el)).toBe('Owner');
    });

    it('says Spectator for a spectator', async () => {
      expect(role((await boot('/home', SPECTATOR)).el)).toBe('Spectator');
    });
  });

  it('tells a spectator they are read-only', async () => {
    const { el } = await boot('/score', SPECTATOR);
    expect(el.textContent).toContain("can't enter scores");
  });

  it('skips the login screen when already logged in', async () => {
    const { router } = await boot('/login', SAVED);
    expect(router.url).toBe('/home');
  });

  describe('leaving', () => {
    it('asks a player before logging out, then returns to the login screen', async () => {
      const { router, click, fixture, logout } = await boot('/trip', SAVED);
      await click('Switch trip / log out');
      expect(logout).not.toHaveBeenCalled();
      await click('Log out');
      await fixture.whenStable();
      expect(router.url).toBe('/login');
    });

    it('takes the owner back to their trips without asking', async () => {
      const { click, logout, el } = await boot('/trip', { ...SAVED, via: 'owner' });
      expect(el.textContent).not.toContain('Switch trip / log out');
      await click('All trips');
      expect(logout).toHaveBeenCalled();
    });
  });

  describe('join link', () => {
    const buttons = (el: HTMLElement) =>
      [...el.querySelectorAll('button[ui-button]')].map((b) => b.textContent?.trim());

    it('logs straight in and, with nothing to install, goes home', async () => {
      const { router, redeem } = await boot('/join/K4M9QT', null);
      expect(redeem).toHaveBeenCalledWith('K4M9QT');
      expect(router.url).toBe('/home');
    });

    it('on an iPhone goes on to the Add to Home Screen step', async () => {
      const { router, el } = await boot('/join/K4M9QT', null, { platform: 'ios-safari' });
      expect(router.url).toBe('/install');
      expect(el.querySelector('h1')?.textContent).toBe("You're in, Fritz");
      expect(el.querySelectorAll('ol li')).toHaveLength(3);
      expect(el.textContent).toContain('Tap Share in Safari’s toolbar.');
      expect(el.textContent).toContain('Leader alerts only work from the Home Screen app.');
      expect(el.querySelector('ui-tab-bar')).toBeNull();
    });

    it('gives the steps for the browser in use', async () => {
      const chrome = await boot('/install', SAVED, { platform: 'ios-chrome' });
      expect(chrome.el.textContent).toContain('Chrome’s address bar');
      TestBed.resetTestingModule();
      const android = await boot('/install', SAVED, { platform: 'android' });
      expect(android.el.textContent).toContain('Tap the ⋮ menu');
    });

    it('on an iPhone shows the code in large type and only "Not now"', async () => {
      const { el } = await boot('/install', SAVED, { platform: 'ios-safari' });
      expect(el.querySelector('.chars')?.textContent).toBe('K4M9QT');
      expect(buttons(el)).toEqual(['Not now']);
    });

    it('"Not now" copies the code from the tap, then goes home', async () => {
      const { router, click, copied } = await boot('/install', SAVED, { platform: 'ios-safari' });
      await click('Not now');
      expect(copied).toHaveBeenCalledWith('K4M9QT');
      expect(router.url).toBe('/home');
    });

    it('on Android adds "Install Teed", which opens the system install prompt', async () => {
      const plain = await boot('/install', SAVED, { platform: 'android' });
      expect(buttons(plain.el)).toEqual(['Not now']);
      TestBed.resetTestingModule();
      const { el, click, router, promptInstall } = await boot('/install', SAVED, {
        platform: 'android',
        canPrompt: true,
      });
      expect(buttons(el)).toEqual(['Install Teed', 'Not now']);
      await click('Install Teed');
      expect(promptInstall).toHaveBeenCalled();
      expect(router.url).toBe('/home');
    });

    it('never offers "Install Teed" on an iPhone', async () => {
      const { el } = await boot('/install', SAVED, { platform: 'ios-safari', canPrompt: true });
      expect(buttons(el)).toEqual(['Not now']);
    });

    it('skips the step when already running from the Home Screen', async () => {
      const { router } = await boot('/install', SAVED, { platform: 'standalone' });
      expect(router.url).toBe('/home');
    });

    it('says why a link did not work, and offers the code screen', async () => {
      const { router, el } = await boot('/join/NOPE22', null, {
        redeem: { status: 'invalid_code' },
      });
      expect(router.url).toBe('/join/NOPE22');
      expect(el.querySelector('[role=alert]')?.textContent).toContain("didn't work");
      expect(el.querySelector('a[href="/login"]')).toBeTruthy();
    });
  });

  describe('home reminder to install', () => {
    const reminder = (el: HTMLElement) => el.querySelector('[aria-label=Install] a');

    it('is shown in the browser until the app is installed', async () => {
      const { el } = await boot('/home', SAVED, { platform: 'ios-safari' });
      expect(reminder(el)?.textContent).toContain('Add Teed to your Home Screen');
      expect(reminder(el)?.getAttribute('href')).toBe('/install');
    });

    it('is gone in the Home Screen app, and where there is nothing to install', async () => {
      expect(reminder((await boot('/home', SAVED, { platform: 'standalone' })).el)).toBeNull();
      TestBed.resetTestingModule();
      expect(reminder((await boot('/home', SAVED, { platform: 'other' })).el)).toBeNull();
    });
  });
});
