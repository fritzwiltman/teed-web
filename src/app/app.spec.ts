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
async function boot(url: string, saved: TripSession | null) {
  const session = signal(saved);
  const revalidate = vi.fn(async () => {});
  // The rounds query on trip home: answers with no rounds.
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order']) query[method] = () => query;
  query['then'] = (resolve: (value: unknown) => void) => resolve({ data: [], error: null });

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
