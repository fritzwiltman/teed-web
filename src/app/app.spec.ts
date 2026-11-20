import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';
import { InstallService } from './core/install';
import { SessionService, TripSession } from './core/session';
import { SUPABASE } from './core/supabase';

const SAVED: TripSession = {
  role: 'player',
  trip: {
    id: 't1',
    name: 'Southern Pines 2026',
    slug: 'PINES',
    status: 'live',
    location: 'Southern Pines, NC',
    start_date: '2026-10-08',
    end_date: '2026-10-12',
  },
  player: { id: 'p1', name: 'Fritz', initials: 'FW', role: 'co_admin' },
};

/** Boots the app at a URL with the given saved login and returns the page. */
async function boot(url: string, saved: TripSession | null, rounds: unknown[] = []) {
  const session = signal(saved);
  const revalidate = vi.fn(async () => {});
  // The rounds query on trip home: answers with no rounds.
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order']) query[method] = () => query;
  query['then'] = (resolve: (value: unknown) => void) => resolve({ data: rounds, error: null });

  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideRouter(routes),
      {
        provide: SessionService,
        useValue: {
          session,
          revalidate,
          redeem: vi.fn(),
          logout: vi.fn(async () => session.set(null)),
        },
      },
      {
        provide: InstallService,
        useValue: { platform: signal('other'), canPrompt: signal(false) },
      },
      { provide: SUPABASE, useValue: { from: () => query } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(App);
  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);
  await fixture.whenStable();
  return { fixture, router, session, revalidate, el: fixture.nativeElement as HTMLElement };
}

describe('App', () => {
  it('opens on the login screen when nobody is logged in', async () => {
    const { router, el } = await boot('/', null);
    expect(router.url).toBe('/login');
    expect(el.querySelector('#code')).toBeTruthy();
    expect(el.querySelector('nav')).toBeNull();
  });

  it('opens on trip home when a login is saved, and checks it with the server', async () => {
    const { router, el, revalidate } = await boot('/', SAVED);
    expect(router.url).toBe('/home');
    expect(el.querySelector('h1')?.textContent).toContain('Southern Pines 2026');
    expect(el.textContent).toContain('Fritz');
    expect(revalidate).toHaveBeenCalled();
  });

  it('shows the pill nav with Home, Score, Board and Trip', async () => {
    const { el } = await boot('/home', SAVED);
    const tabs = [...el.querySelectorAll('nav a')].map((a) => a.textContent?.trim());
    expect(tabs).toEqual(['Home', 'Score', 'Board', 'Trip']);
    expect(el.querySelector('nav a.active')?.textContent).toContain('Home');
  });

  const round = (round_number: number, play_date: string) => ({
    round_number,
    play_date,
    tee_time: '08:00:00',
    status: 'scheduled',
    courses: { name: `Course ${round_number}` },
    tees: { name: 'White' },
    round_formats: [{ format_key: 'nassau' }],
    groups: [] as unknown[],
  });
  const iso = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const roundLabel = (el: HTMLElement) =>
    el.querySelector('[aria-label=Round] .label')?.textContent?.trim();

  describe('round card', () => {
    const cells = (el: HTMLElement) =>
      [...el.querySelectorAll('.strip .cell')].map((c) => c.textContent?.trim());

    it("labels today's round with Today in place of the date", async () => {
      const { el } = await boot('/home', SAVED, [
        round(1, iso(-1)),
        round(2, iso(0)),
        round(3, iso(1)),
      ]);
      expect(roundLabel(el)).toBe('Round 2 · Today');
      expect(el.textContent).toContain('Course 2');
    });

    it('labels any other round with its number and date only', async () => {
      const next = await boot('/home', SAVED, [round(1, iso(-1)), round(2, '2099-10-09')]);
      expect(roundLabel(next.el)).toBe('Round 2 · Fri, Oct 9');
      TestBed.resetTestingModule();
      const past = await boot('/home', SAVED, [round(3, '2026-10-11'), round(4, '2026-10-12')]);
      expect(roundLabel(past.el)).toBe('Round 4 · Mon, Oct 12');
    });

    it('has a strip of time, format and tees, and drops the cells that are empty', async () => {
      const full = await boot('/home', SAVED, [round(1, iso(0))]);
      expect(cells(full.el)).toEqual(['8:00 AM', 'Nassau', 'White']);
      TestBed.resetTestingModule();
      const sparse = await boot('/home', SAVED, [
        { ...round(1, iso(0)), tee_time: null, round_formats: [] },
      ]);
      expect(cells(sparse.el)).toEqual(['White']);
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
      const { el } = await boot('/home', SAVED, [{ ...round(1, iso(0)), groups }]);
      expect(el.querySelector('[aria-label=Round]')?.textContent).toContain('Fritz · Von');
      expect(el.textContent).not.toContain('Jack');
    });

    it('is not shown at all when there is no round to show', async () => {
      const { el } = await boot('/home', SAVED, []);
      expect(el.querySelector('[aria-label=Round]')).toBeNull();
    });
  });

  describe('role row', () => {
    const roleRow = (el: HTMLElement) =>
      [...el.querySelectorAll('.row')]
        .find((r) => r.querySelector('.label')?.textContent?.trim() === 'Role')
        ?.lastElementChild?.textContent?.trim() ?? null;
    const player = (role: 'player' | 'co_admin') => ({
      ...SAVED,
      player: { ...SAVED.player!, role },
    });

    it('is absent for a regular player', async () => {
      expect(roleRow((await boot('/home', player('player'))).el)).toBeNull();
    });

    it('says Co-admin for a co-admin', async () => {
      expect(roleRow((await boot('/home', player('co_admin'))).el)).toBe('Co-admin');
    });

    it("says Owner for the trip's owner player, whatever their player role", async () => {
      const owner = { ...player('player'), trip: { ...SAVED.trip, owner_player_id: 'p1' } };
      expect(roleRow((await boot('/home', owner)).el)).toBe('Owner');
    });

    it('says Spectator for a spectator', async () => {
      expect(roleRow((await boot('/home', { ...SAVED, role: 'spectator', player: null })).el)).toBe(
        'Spectator',
      );
    });
  });

  it('tells a spectator they are read-only', async () => {
    const { el, router, fixture } = await boot('/home', {
      ...SAVED,
      role: 'spectator',
      player: null,
    });
    expect(el.textContent).toContain('Spectator');
    await router.navigateByUrl('/score');
    await fixture.whenStable();
    expect(el.textContent).toContain("can't enter scores");
  });

  it('skips the login screen when already logged in', async () => {
    const { router } = await boot('/login', SAVED);
    expect(router.url).toBe('/home');
  });

  it('returns to the login screen after logging out from the Trip page', async () => {
    const { el, router, fixture } = await boot('/trip', SAVED);
    const click = async (label: string) => {
      [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!.click();
      await fixture.whenStable();
    };
    await click('Switch trip / log out');
    await click('Log out');
    await fixture.whenStable();
    expect(router.url).toBe('/login');
  });
});
