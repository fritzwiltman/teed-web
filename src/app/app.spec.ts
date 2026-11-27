import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SwUpdate } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { AdminData } from './admin/data';
import { App } from './app';
import { routes } from './app.routes';
import { AuthService, Me } from './core/auth';
import { InstallPlatform, InstallService } from './core/install';
import { RoundRow, RoundsService, TripRules, roundInput, safeResult } from './core/rounds';
import { roundRow } from './core/rounds.testing';
import { ScoreQueue } from './core/score-queue';
import { MyTrip, SessionService, TripSession } from './core/session';
import { SUPABASE } from './core/supabase';

const FRITZ: Me = {
  id: 'u1',
  display_name: 'Fritz',
  email: 'fritz@example.com',
  handicap_index: 18.6,
  is_admin: false,
  is_trip_creator: false,
};

const SAVED: TripSession = {
  trip: {
    id: 't1',
    name: 'Southern Pines 2026',
    status: 'live',
    location: 'Southern Pines, NC',
    start_date: '2026-10-08',
    end_date: '2026-10-12',
  },
  player: { id: 'p1', name: 'Fritz', initials: 'FW', role: 'player' },
};
const CO_ORGANIZER: TripSession = { ...SAVED, player: { ...SAVED.player, role: 'co_organizer' } };
const ORGANIZER: TripSession = { ...SAVED, player: { ...SAVED.player, role: 'organizer' } };

const mine = (over: Partial<MyTrip>): MyTrip => ({
  ...SAVED.trip,
  stage: 'in_progress',
  bucket: 'next',
  role: 'player',
  member_id: 'p1',
  player_count: 4,
  finish: null,
  winnings: null,
  ...over,
});

interface Options {
  /** Who is signed in. Null: nobody. */
  me?: Me | null;
  trips?: MyTrip[];
  rounds?: unknown[];
  platform?: InstallPlatform;
  canPrompt?: boolean;
  /** What each edge function answers: the data, or 'gone' for a refusal. */
  functions?: Record<string, unknown>;
  /** What claim_invite answers. */
  claim?: unknown;
  /** Signing in from the form: the person it signs in as. */
  signsInAs?: Me;
  /** The open trip's rounds as the live rounds service has them. */
  live?: RoundRow[];
  rules?: Partial<TripRules>;
  /** Scores still waiting to reach the server. */
  syncing?: number;
  /** The service worker: false for a browser without one. */
  worker?: boolean;
  /** What the organizer data layer answers, where a test needs more than the defaults. */
  dataOverrides?: Partial<Record<keyof AdminData, unknown>>;
}

/** Boots the app at a URL, signed in (or not) with the given open trip, and returns the page. */
async function boot(url: string, saved: TripSession | null, options: Options = {}) {
  const me = signal<Me | null>(options.me === undefined ? FRITZ : options.me);
  const session = signal(saved);
  const trips = signal(options.trips ?? (saved ? [mine({})] : []));

  // The rounds query on trip home.
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order']) query[method] = () => query;
  query['then'] = (resolve: (value: unknown) => void) =>
    resolve({ data: options.rounds ?? [], error: null });
  const invoke = vi.fn(async (name: string, _options?: unknown) => {
    const answer = options.functions?.[name];
    return answer === 'gone' || answer === undefined
      ? { data: null, error: { context: new Response('{}', { status: 404 }) } }
      : { data: answer, error: null };
  });
  const rpc = vi.fn(async (_name: string, _args?: unknown) => ({
    data: options.claim ?? null,
    error: null,
  }));
  const db = {
    from: () => query,
    rpc,
    functions: { invoke },
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://photos.test/${path}` } }),
      }),
    },
  };

  const auth = {
    me,
    signedIn: computed(() => !!me()),
    ready: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    sendCode: vi.fn(async () => 'sent' as const),
    verify: vi.fn(async () => {
      me.set(options.signsInAs ?? FRITZ);
      return 'ok' as const;
    }),
    saveProfile: vi.fn(async (fields: Partial<Me>) => {
      me.update((m) => (m ? { ...m, ...fields } : m));
      return true;
    }),
    signOut: vi.fn(async () => me.set(null)),
  };
  const sessions = {
    session,
    trips,
    canManage: computed(() => ['organizer', 'co_organizer'].includes(session()?.player.role ?? '')),
    db: () => db,
    loadTrips: vi.fn(async () => true),
    open: vi.fn(async (id: string) => {
      const trip = trips().find((t) => t.id === id);
      if (!trip) return false;
      session.set({ trip, player: { ...SAVED.player, id: trip.member_id, role: trip.role } });
      return true;
    }),
    startUrl: vi.fn(async () => {
      const now = trips().find((t) => t.stage === 'in_progress');
      return now && (await sessions.open(now.id)) ? '/home' : '/you';
    }),
    revalidate: vi.fn(async () => {}),
    leave: vi.fn(() => session.set(null)),
  };
  // The live rounds: real engine, no server. Entering a score lands in the round at once.
  const liveRows = signal(options.live ?? []);
  const rules: TripRules = {
    handicap_allowance: 1,
    strokes_off_low: true,
    pickup_net_double: true,
    ...options.rules,
  };
  const views = computed(() =>
    liveRows().map((row) => ({ row, result: safeResult(roundInput(row, rules, [])) })),
  );
  const setScore = vi.fn(
    (roundId: string, playerId: string, hole: number, strokes: number, pickedUp = false) =>
      liveRows.update((rows) =>
        rows.map((row) =>
          row.id !== roundId
            ? row
            : {
                ...row,
                groups: row.groups.map((g) => ({
                  ...g,
                  group_players: g.group_players.map((gp) =>
                    gp.player?.id !== playerId
                      ? gp
                      : {
                          ...gp,
                          scores: [
                            ...gp.scores.filter((x) => x.hole !== hole),
                            { hole, strokes, picked_up: pickedUp },
                          ],
                        },
                  ),
                })),
              },
        ),
      ),
  );
  const finalize = vi.fn(async (roundId: string) => {
    liveRows.update((rows) =>
      rows.map((r) => (r.id === roundId ? { ...r, status: 'final' as const } : r)),
    );
    return true;
  });
  const rounds = {
    tripId: computed(() => session()?.trip.id ?? null),
    rules: computed(() => rules),
    rounds: views,
    for: (tripId: string | undefined) => (tripId && tripId === session()?.trip.id ? views() : []),
    load: vi.fn(async () => true),
    watch: vi.fn(async () => {}),
    unwatch: vi.fn(),
    setScore,
    finalize,
  };
  const queue = { count: signal(options.syncing ?? 0), refused: signal(0) };
  // The service worker's updates: `ready()` is a new build arriving while the app is open.
  const versions = new Subject<{ type: string }>();
  const updates = {
    isEnabled: options.worker ?? true,
    versionUpdates: versions,
    checkForUpdate: vi.fn(async () => false),
    activateUpdate: vi.fn(async () => true),
  };
  // The organizer data layer (People, Info, Itinerary, a round's setup, alerts).
  const role = saved?.player.role ?? 'player';
  const data = {
    tripRole: vi.fn(async () => role),
    trip: vi.fn(async () => ({
      ...saved?.trip,
      handicap_allowance: 1,
      strokes_off_low: true,
      pickup_net_double: true,
      buy_in_amount: null,
    })),
    roster: vi.fn(async () => []),
    rounds: vi.fn(async () => []),
    itinerary: vi.fn(async () => []),
    proposals: vi.fn(async () => []),
    alerts: vi.fn(async () => []),
    sendAlert: vi.fn(async () => {}),
    updateTrip: vi.fn(async () => ({})),
    setIndex: vi.fn(async () => {}),
    spectatorToken: vi.fn(async () => null),
    courseChoices: vi.fn(async () => []),
    lastPointValue: vi.fn(async () => null),
    roundSetup: vi.fn(),
    ...options.dataOverrides,
  };
  const promptInstall = vi.fn(async () => {});
  const share = vi.fn(async (_data: { text: string }) => {});
  Object.defineProperty(navigator, 'share', { configurable: true, value: share });

  await TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideRouter(routes, withComponentInputBinding()),
      { provide: SUPABASE, useValue: db },
      { provide: AuthService, useValue: auth },
      { provide: SessionService, useValue: sessions },
      { provide: RoundsService, useValue: rounds },
      { provide: ScoreQueue, useValue: queue },
      { provide: SwUpdate, useValue: updates },
      { provide: AdminData, useValue: data },
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
  const settle = async () => {
    // Screens swap their loading skeleton for content once their request answers.
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
  };
  await settle();
  const el = fixture.nativeElement as HTMLElement;
  const click = async (label: string) => {
    const target = [...el.querySelectorAll<HTMLElement>('button, a')].find(
      (b) =>
        b.textContent?.trim() === label || b.querySelector('.title')?.textContent?.trim() === label,
    );
    expect(target, `a button or link labelled "${label}"`).toBeTruthy();
    target!.click();
    await settle();
  };
  /** Types into the form field with this name. */
  const type = async (name: string, value: string) => {
    const input = el.querySelector<HTMLInputElement>(`input[name=${name}]`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  /** Signs in through the form: an email, then the six digits. */
  const signIn = async (email: string | null, code = '482193') => {
    if (email !== null) await type('email', email);
    await click('Email me a code');
    const boxes = [...el.querySelectorAll<HTMLInputElement>('input.box')];
    for (const [i, digit] of [...code].entries()) {
      boxes[i].value = digit;
      boxes[i].dispatchEvent(new Event('input'));
    }
    await settle();
  };
  return {
    fixture,
    router,
    me,
    session,
    auth,
    sessions,
    rpc,
    invoke,
    share,
    promptInstall,
    setScore,
    finalize,
    updates,
    versions,
    queue,
    data,
    el,
    click,
    type,
    signIn,
    settle,
  };
}

const tabs = (el: HTMLElement) =>
  [...el.querySelectorAll('ui-tab-bar a')].map((a) => a.textContent?.trim());
const pill = (el: HTMLElement) => el.querySelector<HTMLAnchorElement>('ui-header-band .action');
const rows = (el: HTMLElement, card: string) =>
  [
    ...el.querySelectorAll(
      `[aria-label="${card}"] [ui-list-row], [aria-label="${card}"] ui-list-row`,
    ),
  ].map((row) => row.querySelector('.title')?.textContent?.trim());

describe('App', () => {
  describe('signed out', () => {
    it('opens on Sign in, whatever was asked for', async () => {
      for (const url of ['/', '/home', '/you', '/install', '/admin/trips/t1']) {
        const { router, el } = await boot(url, null, { me: null });
        expect(router.url, url).toBe('/login');
        expect(el.querySelector('ui-logo')).toBeTruthy();
        expect(el.querySelector('h1')?.textContent).toBe('Sign in');
        expect(el.querySelector('ui-tab-bar')).toBeNull();
        TestBed.resetTestingModule();
      }
    });

    it('signs in with an emailed code and starts at You when no trip is in progress', async () => {
      const { router, auth, signIn, el } = await boot('/login', null, {
        me: null,
        trips: [mine({ stage: 'upcoming' })],
      });
      await signIn('Fritz@Example.com');
      expect(auth.sendCode).toHaveBeenCalledWith('Fritz@Example.com');
      expect(auth.verify).toHaveBeenCalledWith('fritz@example.com', '482193');
      expect(router.url).toBe('/you');
      expect(el.querySelector('h1')?.textContent).toContain('Fritz');
    });

    it("signs in straight to a trip's Home when one is in progress", async () => {
      const { router, signIn } = await boot('/login', null, { me: null, trips: [mine({})] });
      await signIn('fritz@example.com');
      expect(router.url).toBe('/home');
    });
  });

  describe('where the app starts', () => {
    it('is the Home of a trip in progress, and it checks with the server who is on what', async () => {
      const { router, el, sessions, auth } = await boot('/', null, { trips: [mine({})] });
      expect(router.url).toBe('/home');
      expect(el.querySelector('h1')?.textContent).toContain('Southern Pines 2026');
      expect(el.querySelector('ui-header-band .label')?.textContent?.trim()).toBe(
        'Southern Pines · Oct 8–12',
      );
      expect(auth.ready).toHaveBeenCalled();
      expect(sessions.revalidate).toHaveBeenCalled();
    });

    it('is You otherwise, even with a trip left open from last time', async () => {
      const { router } = await boot('/', SAVED, { trips: [mine({ stage: 'upcoming' })] });
      expect(router.url).toBe('/you');
    });

    it('skips Sign in when already signed in', async () => {
      const { router } = await boot('/login', null, { trips: [] });
      expect(router.url).toBe('/you');
    });

    it('sends a trip screen with no trip open to You', async () => {
      expect((await boot('/board', null)).router.url).toBe('/you');
    });
  });

  describe('You', () => {
    const TRIPS = [
      mine({
        id: 't1',
        name: 'Vero Beach 2027',
        bucket: 'next',
        stage: 'upcoming',
        start_date: '2027-01-11',
        end_date: '2027-01-15',
      }),
      mine({
        id: 't2',
        name: 'Myrtle Beach 2027',
        bucket: 'upcoming',
        stage: 'upcoming',
        player_count: 8,
        start_date: '2027-05-13',
        end_date: '2027-05-16',
      }),
      mine({
        id: 't3',
        name: 'Bandon 2027',
        bucket: 'upcoming',
        stage: 'draft',
        role: 'organizer',
        player_count: 1,
        start_date: '2027-06-10',
        end_date: '2027-06-13',
      }),
      mine({
        id: 't4',
        name: 'Southern Pines 2026',
        bucket: 'past',
        stage: 'final',
        status: 'final',
      }),
    ];

    const trips = (el: HTMLElement) => el.querySelector('[aria-label=Trips]')!;
    const group = (el: HTMLElement, name: string) => {
      const label = [...trips(el).querySelectorAll('.group')].find(
        (g) => g.textContent?.trim() === name,
      );
      const out: string[] = [];
      for (
        let n = label?.nextElementSibling;
        n && !n.classList.contains('group');
        n = n.nextElementSibling
      )
        out.push(n.querySelector('.title')?.textContent?.trim() ?? '');
      return out;
    };

    it('has the name beside the logo, and one Trips card: Next big with its countdown, then Upcoming and Past', async () => {
      const { el } = await boot('/you', null, { trips: TRIPS });
      expect(el.querySelector('header h1')?.textContent).toBe('Fritz');
      expect(el.querySelector('header ui-logo')).toBeTruthy();
      const next = trips(el).querySelector('.next')!;
      expect(next.querySelector('h2')?.textContent).toBe('Vero Beach 2027');
      expect(next.querySelector('.facts')?.textContent?.trim()).toBe('Jan 11–15 · 4 players');
      expect(next.querySelector('.days')?.textContent).toMatch(/^\d+$/);
      expect([...next.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
        'Open trip',
      ]);
      expect(group(el, 'Upcoming')).toEqual(['Myrtle Beach 2027', 'Bandon 2027']);
      expect(group(el, 'Past')).toEqual(['Southern Pines 2026']);
      expect([...trips(el).querySelectorAll('ui-badge')].map((b) => b.textContent?.trim())).toEqual(
        ['Draft', 'Final'],
      );
      expect(el.querySelector('ui-tab-bar')).toBeNull();
    });

    it("shows a past trip's dates, and its finish and winnings once there are any", async () => {
      const { el } = await boot('/you', null, {
        trips: [mine({ bucket: 'past', stage: 'final', finish: '1st', winnings: 190 })],
      });
      expect(trips(el).textContent).toContain('Oct 8–12 · 1st · $190');
    });

    it('a first-time player sees Next and Your golf only; on no trip, "No trips yet"', async () => {
      const first = await boot('/you', null, { trips: [TRIPS[0]] });
      expect(first.el.querySelectorAll('ui-card').length).toBe(2);
      expect(first.el.querySelector('.fab')).toBeNull();
      TestBed.resetTestingModule();
      const none = await boot('/you', null, { trips: [] });
      expect(trips(none.el).textContent).toContain('No trips yet');
      expect(trips(none.el).textContent).toContain(
        'When an organizer adds you, the trip shows up here.',
      );
    });

    it('opens every trip at its Home, a draft too', async () => {
      const published = await boot('/you', null, { trips: TRIPS });
      await published.click('Myrtle Beach 2027');
      expect(published.sessions.open).toHaveBeenCalledWith('t2');
      expect(published.router.url).toBe('/home');
      TestBed.resetTestingModule();
      const draft = await boot('/you', null, { trips: TRIPS });
      await draft.click('Bandon 2027');
      expect(draft.sessions.open).toHaveBeenCalledWith('t3');
      expect(draft.router.url).toBe('/home');
    });

    it('closes any trip left open', async () => {
      const { sessions } = await boot('/you', SAVED, { trips: [mine({ stage: 'upcoming' })] });
      expect(sessions.leave).toHaveBeenCalled();
    });

    it('Your golf: the handicap index row opens a sheet to change it; email is shown', async () => {
      const { el, click, auth, settle } = await boot('/you', null);
      expect(el.querySelector('[aria-label="Your golf"]')?.textContent).toContain(
        'fritz@example.com',
      );
      await click('Handicap index');
      const sheet = el.querySelector('[role=dialog]')!;
      expect(sheet.querySelector('h2')?.textContent).toBe('Your handicap index');
      const input = sheet.querySelector<HTMLInputElement>('input[name=index]')!;
      expect(input.value).toBe('18.6');
      input.value = '17.24';
      input.dispatchEvent(new Event('input'));
      sheet.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle();
      expect(auth.saveProfile).toHaveBeenCalledWith({
        display_name: 'Fritz',
        handicap_index: 17.2,
      });
    });

    it('gives trip creators "+ New trip" floating; the admin also gets Trip creators', async () => {
      const plain = await boot('/you', null);
      expect(plain.el.querySelector('.fab')).toBeNull();
      expect(plain.el.querySelector('[aria-label=Admin]')).toBeNull();
      TestBed.resetTestingModule();
      const creator = await boot('/you', null, { me: { ...FRITZ, is_trip_creator: true } });
      expect(creator.el.querySelector('.fab')?.textContent?.trim()).toBe('+ New trip');
      expect(creator.el.querySelector('.fab')?.getAttribute('href')).toBe('/you/new-trip');
      expect(creator.el.querySelector('[aria-label=Admin]')).toBeNull();
      TestBed.resetTestingModule();
      const admin = await boot('/you', null, {
        me: { ...FRITZ, is_trip_creator: true, is_admin: true },
      });
      expect(rows(admin.el, 'Admin')).toEqual(['Trip creators']);
    });

    it('signs out to Sign in', async () => {
      const { click, auth, router } = await boot('/you', null);
      await click('Sign out');
      expect(auth.signOut).toHaveBeenCalled();
      expect(router.url).toBe('/login');
    });
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
  });

  describe('trip header', () => {
    it('has no Manage toggle anywhere: organizers get Alert on Home, players nothing', async () => {
      for (const who of [ORGANIZER, CO_ORGANIZER]) {
        const { el, router, fixture } = await boot('/home', who);
        expect(pill(el)?.textContent?.trim()).toBe('Alert');
        for (const url of ['/score', '/board', '/trip']) {
          await router.navigateByUrl(url);
          await fixture.whenStable();
          expect(pill(el), url).toBeNull();
        }
        TestBed.resetTestingModule();
      }
      expect(pill((await boot('/home', SAVED)).el)).toBeNull();
    });

    it('Alert opens the composer and sends to everyone', async () => {
      const { el, click, data, settle } = await boot('/home', ORGANIZER);
      await click('Alert');
      const sheet = el.querySelector('[role=dialog]')!;
      expect(sheet.querySelector('h2')?.textContent).toBe('Alert everyone');
      const box = sheet.querySelector<HTMLTextAreaElement>('textarea')!;
      box.value = 'Breakfast ends at 9:30.';
      box.dispatchEvent(new Event('input'));
      await settle();
      [...sheet.querySelectorAll<HTMLButtonElement>('ui-segmented button')]
        .find((b) => b.textContent?.trim() === 'Important')!
        .click();
      sheet.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle();
      expect(data.sendAlert).toHaveBeenCalledWith('t1', 'important', 'Breakfast ends at 9:30.');
    });

    it('the trip line opens the switcher, on every trip screen: You, then current and upcoming trips', async () => {
      const trips = [
        mine({}),
        mine({
          id: 't2',
          name: 'Vero Beach 2027',
          stage: 'upcoming',
          bucket: 'upcoming',
          start_date: '2027-01-14',
          end_date: '2027-01-17',
        }),
        mine({ id: 't3', name: 'Old trip', stage: 'final', bucket: 'past' }),
      ];
      for (const url of ['/home', '/score', '/board', '/trip/itinerary']) {
        const { el, settle } = await boot(url, SAVED, { trips });
        const line = el.querySelector<HTMLButtonElement>('ui-header-band .switch')!;
        expect(line.textContent?.trim(), url).toBe('Southern Pines · Oct 8–12');
        expect(line.querySelector('ui-icon')).toBeTruthy();
        line.click();
        await settle();
        const sheet = el.querySelector('[role=dialog]')!;
        expect(
          [...sheet.querySelectorAll('.row .title')].map((t) => t.textContent?.trim()),
        ).toEqual(['Fritz', 'Southern Pines 2026', 'Vero Beach 2027']);
        expect(sheet.querySelector('.initial')?.textContent?.trim()).toBe('F');
        expect(sheet.querySelector('.row[aria-current=true] .title')?.textContent?.trim()).toBe(
          'Southern Pines 2026',
        );
        TestBed.resetTestingModule();
      }
    });

    it('goes from a trip to You and back in two taps', async () => {
      const trips = [
        mine({}),
        mine({ id: 't2', name: 'Vero Beach 2027', stage: 'upcoming', bucket: 'upcoming' }),
      ];
      const { el, settle, router, sessions } = await boot('/home', SAVED, { trips });
      el.querySelector<HTMLButtonElement>('ui-header-band .switch')!.click();
      await settle();
      [...el.querySelectorAll<HTMLButtonElement>('[role=dialog] .row')][0].click();
      await settle();
      expect(sessions.leave).toHaveBeenCalled();
      expect(router.url).toBe('/you');
      [...el.querySelectorAll<HTMLButtonElement>('button')]
        .find((b) => b.textContent?.trim() === 'Open trip')!
        .click();
      await settle();
      expect(router.url).toBe('/home');
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

    it('titles Home "Round N · Ddd, Mon D", for the next round or else the last', async () => {
      const next = await boot('/home', SAVED, {
        rounds: [round(1, iso(-1)), round(2, '2099-10-09')],
      });
      expect(next.el.querySelector('h1')?.textContent?.trim()).toBe('Round 2 · Fri, Oct 9');
      expect(label(next.el)).toBeFalsy(); // not said twice
      TestBed.resetTestingModule();
      const past = await boot('/home', SAVED, {
        rounds: [round(3, '2026-10-11'), round(4, '2026-10-12')],
      });
      expect(past.el.querySelector('h1')?.textContent?.trim()).toBe('Round 4 · Mon, Oct 12');
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
    });

    it('is not shown at all when there is no round to show', async () => {
      expect(card((await boot('/home', SAVED)).el)).toBeNull();
    });
  });

  describe('Trip', () => {
    it('is "Trip overview" with Itinerary · Courses · People · Info', async () => {
      const { el, router } = await boot('/trip', SAVED);
      expect(router.url).toBe('/trip/itinerary');
      expect(el.querySelector('h1')?.textContent).toBe('Trip overview');
      expect(
        [...el.querySelectorAll('main > ui-segmented button')].map((b) => b.textContent?.trim()),
      ).toEqual(['Itinerary', 'Courses', 'People', 'Info']);
      expect(el.querySelector('main > ui-segmented button.on')?.textContent?.trim()).toBe(
        'Itinerary',
      );
    });

    it('lets anyone on the trip share the spectator link from People', async () => {
      const { click, share } = await boot('/trip/people', SAVED, {
        dataOverrides: { spectatorToken: vi.fn(async () => 'SPEC-TOKEN') },
      });
      await click('Share');
      expect(share).toHaveBeenCalledWith({
        text: `Follow Southern Pines 2026. Tap to open Teed: ${location.origin}/watch/SPEC-TOKEN`,
      });
    });

    it('has no spectator card for a player while there is no link', async () => {
      const { el } = await boot('/trip/people', SAVED);
      expect(el.querySelector('[aria-label=Spectators]')).toBeNull();
    });
  });

  // ── Scoring ────────────────────────────────────────────────────────────────
  // Fritz (10), Dad (20) and Brother (10) at 100% off the low man, par 4 everywhere, stroke index
  // = hole number: Dad gets a stroke on holes 1 to 10. SAVED's player is p1; here "me" is Fritz.

  const ME: TripSession = { ...SAVED, player: { ...SAVED.player, id: 'me' } };
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const playing = (scores: Record<string, number[]> = {}, over: Partial<RoundRow> = {}) =>
    roundRow({ play_date: today(), ...over }, scores);
  const all = (n: number, strokes: number) => Array<number>(n).fill(strokes);
  const cells = (el: HTMLElement, selector = 'ui-board') =>
    [...el.querySelectorAll(`${selector} tbody tr`)].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim()),
    );
  /** A list row's title, detail and value, in that order. */
  const rowText = (row: Element) =>
    ['.title', '.detail', '.value']
      .map((part) => row.querySelector(part)?.textContent?.trim())
      .filter(Boolean)
      .join(' ');
  /** A plain board's headings, and its rows as name, the line under it, then the cells. */
  const heads = (board: Element) =>
    [...board.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
  const sheet = (board: Element) =>
    [...board.querySelectorAll('tbody tr')].map((tr) => {
      const name = tr.querySelector('td.name')!;
      const sub = name.querySelector('.sub')?.textContent?.trim() ?? '';
      return [
        name.textContent!.replace(sub, '').trim(),
        sub,
        ...[...tr.querySelectorAll('td.num')].map((td) => td.textContent?.trim()),
      ];
    });
  const stepper = (el: HTMLElement, name: string) =>
    [...el.querySelectorAll('ui-stepper-row')].find(
      (row) => row.querySelector('.name')?.textContent?.trim() === name,
    )!;
  const game = (el: HTMLElement, title: string) =>
    [...el.querySelectorAll('ui-game-card')].find((c) => c.textContent?.includes(title));

  describe('Scorecard', () => {
    it('opens on the next unscored hole, every row at par', async () => {
      const { el } = await boot('/score', ME, {
        live: [playing({ me: [4, 5], dad: [6, 6], bro: [5] })],
      });
      expect(el.querySelector('ui-header-band .label')?.textContent).toContain('Round 1');
      expect(el.querySelector('[aria-label="Hole 2"]')).toBeTruthy();
      expect(el.querySelector('h1')?.textContent?.trim()).toBe('Hole 2');
      expect(el.querySelector('ui-header-band .switch')?.textContent?.trim()).toMatch(
        /^Round 1 · \w{3}, \w{3} \d+$/,
      );
      expect(el.querySelector('[aria-label="Hole 2"] h2')?.textContent).toBe('Par 4');
      expect(el.querySelector('[aria-label="Hole 2"] .note')?.textContent).toBe('Blue tees · SI 2');
      expect([...el.querySelectorAll('ui-stepper-row .name')].map((n) => n.textContent)).toEqual([
        'Fritz',
        'Dad',
        'Brother',
      ]);
      // Brother has no score on 2 yet: his row sits at par, marked not saved.
      expect(stepper(el, 'Brother').querySelector('output')?.textContent?.trim()).toBe('4');
      expect(stepper(el, 'Brother').textContent).toContain('not saved');
      // Dad gets a stroke here: a dot, and his 6 nets 5.
      expect(stepper(el, 'Dad').textContent).toContain('● · net 5');
    });

    it('+ and − save at once, for anyone in the group', async () => {
      const { el, setScore, settle } = await boot('/score', ME, { live: [playing()] });
      stepper(el, 'Dad').querySelector<HTMLButtonElement>('button.plus')!.click();
      await settle();
      expect(setScore).toHaveBeenCalledWith('r1', 'dad', 1, 5, false);
      stepper(el, 'Fritz').querySelector<HTMLButtonElement>('button.minus')!.click();
      await settle();
      expect(setScore).toHaveBeenCalledWith('r1', 'me', 1, 3, false);
      expect(stepper(el, 'Dad').querySelector('output')?.textContent?.trim()).toBe('5');
    });

    it('"Save" writes par for anyone not touched, moves on, and shows the 9-point split', async () => {
      const { el, setScore, click, settle } = await boot('/score', ME, { live: [playing()] });
      stepper(el, 'Brother').querySelector<HTMLButtonElement>('button.plus')!.click();
      await settle();
      await click('Save · Hole 2');
      // Brother's 5 was his own; Fritz and Dad are saved at par.
      expect(setScore.mock.calls).toEqual([
        ['r1', 'bro', 1, 5, false],
        ['r1', 'me', 1, 4, false],
        ['r1', 'dad', 1, 4, false],
      ]);
      expect(el.querySelector('[aria-label="Hole 2"]')).toBeTruthy();
      await click('Back');
      // Nets 4, 3 (Dad's stroke), 5: Dad 5, Fritz 3, Brother 1.
      const split = game(el, '9-point game')!;
      expect(
        [...split.querySelectorAll('.value, dd')].map((v) => v.textContent?.trim()).join(' '),
      ).toContain('3');
      expect(split.textContent).toMatch(/Fritz\s*3/);
      expect(split.textContent).toMatch(/Dad\s*5/);
      expect(split.textContent).toMatch(/Brother\s*1/);
    });

    it('shows Out, In and Total points, which add to 9 a hole', async () => {
      const { el } = await boot('/score', ME, {
        live: [playing({ me: all(9, 4), dad: all(9, 5), bro: all(9, 6) })],
      });
      // Dad nets 4 on every hole: he and Fritz tie for low, 4-4-1, nine times.
      const totals = game(el, 'points')!;
      expect(totals.textContent).toContain('9 holes');
      expect(totals.textContent).toMatch(/Fritz\s*Out 36 · In 0 · Total 36/);
      expect(totals.textContent).toMatch(/Brother\s*Out 9 · In 0 · Total 9/);
      expect(totals.textContent).toMatch(/All\s*Out 81 · In 0 · Total 81/);
      expect(game(el, 'Strokes')!.textContent).toMatch(/Dad\s*Gross 45 · Net 36/);
    });

    it('the hole picker jumps to any hole', async () => {
      const { el, click } = await boot('/score', ME, {
        live: [playing({ me: [4], dad: [5], bro: [4] })],
      });
      await click('All holes');
      const pills = [...el.querySelectorAll('ui-sheet ui-choice-pills button')].map((b) =>
        b.textContent?.trim(),
      );
      expect(pills).toHaveLength(18);
      expect(pills[0]).toBe('1 ✓');
      await click('14');
      expect(el.querySelector('[aria-label="Hole 14"]')).toBeTruthy();
      expect(el.querySelector('ui-sheet section')).toBeNull();
    });

    it('"Pick up" records net double bogey: par + 2 + strokes on the hole', async () => {
      const { el, click, setScore, settle } = await boot('/score', ME, { live: [playing()] });
      await click('Pick up');
      const rows = [...el.querySelectorAll('ui-sheet [ui-list-row]')].map((r) => rowText(r));
      expect(rows).toEqual(['Fritz 6', 'Dad 7', 'Brother 6']);
      await click('Dad');
      expect(setScore).toHaveBeenCalledWith('r1', 'dad', 1, 7, true);
      // The card marks it "PU".
      expect(stepper(el, 'Dad').textContent).toContain('PU');
      expect(stepper(el, 'Dad').querySelector('output')?.textContent?.trim()).toBe('7');
      // − afterwards is a played score again: the mark goes.
      stepper(el, 'Dad').querySelector<HTMLButtonElement>('button.minus')!.click();
      await settle();
      expect(setScore).toHaveBeenLastCalledWith('r1', 'dad', 1, 6, false);
      expect(stepper(el, 'Dad').textContent).not.toContain('PU');
    });

    it('a pickup ranks below a finisher with the same net', async () => {
      // Hole 1: Fritz holes out for 6; Dad picks up at 7 (net 6 too); Brother makes 4.
      const { el, click, settle } = await boot('/score', ME, { live: [playing()] });
      for (let i = 0; i < 2; i++) {
        stepper(el, 'Fritz').querySelector<HTMLButtonElement>('button.plus')!.click();
        await settle();
      }
      await click('Pick up');
      await click('Dad');
      await click('Save · Hole 2');
      await click('Back');
      const split = game(el, '9-point game')!;
      expect(split.textContent).toMatch(/Fritz\s*3/);
      expect(split.textContent).toMatch(/Dad\s*1/);
      expect(split.textContent).toMatch(/Brother\s*5/);
    });

    it('hides "Pick up" when the trip does not play that rule', async () => {
      const { el } = await boot('/score', ME, {
        live: [playing()],
        rules: { pickup_net_double: false },
      });
      expect(
        [...el.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Pick up'),
      ).toBe(false);
    });

    it('says how many scores are still syncing', async () => {
      const { el, queue, settle } = await boot('/score', ME, { live: [playing()], syncing: 2 });
      expect(el.querySelector('[role=status]')?.textContent?.trim()).toBe('Syncing 2 scores');
      queue.count.set(1);
      await settle();
      expect(el.querySelector('[role=status]')?.textContent?.trim()).toBe('Syncing 1 score');
      queue.count.set(0);
      await settle();
      expect(el.querySelector('[role=status]')).toBeNull();
    });

    it('a final round, and someone outside the group, can look but not change', async () => {
      const final = await boot('/score', ME, {
        live: [playing({ me: all(18, 4), dad: all(18, 5), bro: all(18, 5) }, { status: 'final' })],
      });
      expect(final.el.querySelector('ui-stepper-row')).toBeNull();
      expect(final.el.textContent).toContain('Final');
      expect(
        [...final.el.querySelectorAll('button')].some((b) =>
          /Save|Pick up/.test(b.textContent ?? ''),
        ),
      ).toBe(false);
      TestBed.resetTestingModule();
      // SAVED's player (p1) is on the trip but not in this group.
      const outsider = await boot('/score', SAVED, { live: [playing()] });
      expect(outsider.el.querySelector('ui-stepper-row')).toBeNull();
      TestBed.resetTestingModule();
      // The organizer can enter for a group they are not in.
      const organizer = await boot('/score', ORGANIZER, { live: [playing()] });
      expect(organizer.el.querySelectorAll('ui-stepper-row')).toHaveLength(3);
    });

    it('nobody scores until every player has a handicap index', async () => {
      const row = playing();
      row.groups[0].group_players.find((gp) => gp.player?.id === 'dad')!.player!.handicap_index =
        null;
      const player = await boot('/score', ME, { live: [row] });
      expect(player.el.querySelector('ui-stepper-row')).toBeNull();
      expect(player.el.querySelector('[role=alert]')?.textContent?.trim()).toBe(
        "Add Dad's handicap index",
      );
      expect(player.el.querySelector('[role=alert] a')).toBeNull();
      expect(
        [...player.el.querySelectorAll('button')].some((b) =>
          /Save|Pick up/.test(b.textContent ?? ''),
        ),
      ).toBe(false);
      TestBed.resetTestingModule();
      // The organizer adds it in place, from the same card.
      const organizer: TripSession = { ...ME, player: { ...ME.player, role: 'organizer' } };
      const { el, click, data, settle } = await boot('/score', organizer, { live: [row] });
      expect(el.querySelector('ui-stepper-row')).toBeNull();
      await click('Add it');
      const sheet = el.querySelector('[role=dialog]')!;
      expect(sheet.querySelector('h2')?.textContent).toBe("Dad's handicap index");
      const input = sheet.querySelector<HTMLInputElement>('input[name=index]')!;
      input.value = '22';
      input.dispatchEvent(new Event('input'));
      sheet.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle();
      expect(data.setIndex).toHaveBeenCalledWith('dad', 22);
    });

    it('with mixed tees, each row starts at that player’s own par', async () => {
      const row = playing();
      const gold = {
        ...row.tees!,
        id: 'gold',
        name: 'Gold',
        rating: 69,
        par: [3, ...Array<number>(17).fill(4)],
      };
      row.groups[0].group_players.find((gp) => gp.player?.id === 'bro')!.tee = gold;
      const { el, setScore, click } = await boot('/score', ME, { live: [row] });
      expect(stepper(el, 'Fritz').querySelector('output')?.textContent?.trim()).toBe('4');
      expect(stepper(el, 'Brother').querySelector('output')?.textContent?.trim()).toBe('3');
      expect(stepper(el, 'Brother').textContent).toContain('par 3');
      await click('Save · Hole 2');
      expect(setScore).toHaveBeenCalledWith('r1', 'bro', 1, 3, false);
      expect(setScore).toHaveBeenCalledWith('r1', 'me', 1, 4, false);
    });

    it('a draft trip cannot be scored yet', async () => {
      const draft: TripSession = { ...ME, trip: { ...ME.trip, status: 'draft' } };
      const { el } = await boot('/score', draft, { live: [playing()] });
      expect(el.querySelector('ui-stepper-row')).toBeNull();
      expect(el.textContent).toContain('Publish the trip to start scoring.');
    });

    it('with no rounds, says so', async () => {
      const { el } = await boot('/score', ME);
      expect(el.textContent).toContain('No round to score yet.');
    });
  });

  describe('Board', () => {
    // Nine holes in: Fritz 36 (E), Dad 45 gross, 36 net (E), Brother 54 (+18).
    const nine = { me: all(9, 4), dad: all(9, 5), bro: all(9, 6) };
    const full = { me: all(18, 4), dad: [...all(10, 5), ...all(8, 4)], bro: all(18, 5) };

    it('a round in play: gross, net, to par, thru and points, live', async () => {
      const { el } = await boot('/board', ME, { live: [playing(nine)] });
      expect(
        [...el.querySelectorAll('ui-board thead th')].map((th) => th.textContent?.trim()),
      ).toEqual(['Pos', 'Name', 'Gross', 'Net', 'To par', 'Thru', 'Pts']);
      expect(cells(el)).toEqual([
        ['T1', 'Fritz', '36', '36', 'E', '9', '36'],
        ['T1', 'Dad', '45', '36', 'E', '9', '36'],
        ['3', 'Brother', '54', '54', '+18', '9', '9'],
      ]);
      expect(el.querySelector('ui-board ui-live-dot')).toBeTruthy();
      expect(el.querySelector('ui-board tr.me')?.textContent).toContain('Fritz');
      expect(el.querySelector('ui-choice-pills .on')?.textContent?.trim()).toBe('R1 · Live');
    });

    it('settle up reads "If it ended now", worded for whoever is looking', async () => {
      const { el } = await boot('/board', ME, { live: [playing(nine)] });
      const card = el.querySelector('[aria-label="Settle up"]')!;
      expect(card.querySelector('.note')?.textContent).toContain('If it ended now · 50¢ a point');
      // Against 27: Fritz +9, Dad +9, Brother −18, at 50¢.
      expect([...card.querySelectorAll('ui-list-row')].map((r) => rowText(r))).toEqual([
        'Fritz +$4.50',
        'Dad +$4.50',
        'Brother −$9.00',
        'Brother pays you $4.50',
        'Brother pays Dad $4.50',
      ]);
    });

    it('once complete, only an organizer is offered Finalize; after it the settle-up is final', async () => {
      const player = await boot('/board', ME, { live: [playing(full)] });
      expect(player.el.querySelector('[aria-label=Finalize]')).toBeNull();
      TestBed.resetTestingModule();
      const organizer: TripSession = { ...ME, player: { ...ME.player, role: 'organizer' } };
      const { el, click, finalize } = await boot('/board', organizer, { live: [playing(full)] });
      expect(el.querySelector('[aria-label="Settle up"] .note')?.textContent).toContain(
        'If it ended now',
      );
      await click('Finalize');
      expect(finalize).toHaveBeenCalledWith('r1');
      expect(el.querySelector('[aria-label=Finalize]')).toBeNull();
      expect(el.querySelector('[aria-label="Settle up"] .note')?.textContent).toContain(
        'Final · 50¢ a point',
      );
    });

    it('a round still in play is not offered Finalize', async () => {
      const organizer: TripSession = { ...ME, player: { ...ME.player, role: 'organizer' } };
      const { el } = await boot('/board', organizer, { live: [playing(nine)] });
      expect(el.querySelector('[aria-label=Finalize]')).toBeNull();
    });

    it('the Trip board adds the rounds up, and settles the trip once', async () => {
      const second = playing(nine, { id: 'r2', round_number: 2, status: 'scheduled' });
      const first = playing(full, { status: 'final', play_date: '2026-11-26' });
      const { el, click } = await boot('/board', ME, { live: [first, second] });
      await click('Trip');
      expect(
        [...el.querySelectorAll('ui-board thead th')].map((th) => th.textContent?.trim()),
      ).toEqual(['Pos', 'Name', 'Rounds', 'Gross', 'Net', 'To par', 'Pts']);
      // Round 1: Fritz 72 (E), Dad 82 gross 72 net (E), Brother 90 (+18); points 72 / 72 / 18.
      expect(cells(el)).toEqual([
        ['T1', 'Fritz', '2', '108', '108', 'E', '108'],
        ['T1', 'Dad', '2', '127', '108', 'E', '108'],
        ['3', 'Brother', '2', '144', '144', '+36', '27'],
      ]);
      const card = el.querySelector('[aria-label="Settle up"]')!;
      // Round 1 against 54: +18, +18, −36 = +$9, +$9, −$18. Round 2 so far: +$4.50, +$4.50, −$9.
      expect([...card.querySelectorAll('ui-list-row')].map((r) => rowText(r))).toEqual([
        'Fritz +$13.50',
        'Dad +$13.50',
        'Brother −$27.00',
        'Brother pays you $13.50',
        'Brother pays Dad $13.50',
      ]);
    });

    it('with no rounds, says so', async () => {
      expect((await boot('/board', ME)).el.textContent).toContain('No rounds yet.');
    });
  });

  describe('Home during a round', () => {
    const homeRound = (groups: unknown[]) => ({
      round_number: 1,
      play_date: today(),
      tee_time: '08:10:00',
      status: 'scheduled',
      courses: { name: 'PGA National Palmer', photo_path: null },
      tees: { name: 'Blue' },
      round_formats: [{ format_key: 'stroke' }, { format_key: 'nine_point' }],
      groups,
    });

    it('"Continue scoring · Hole N" and a mini board', async () => {
      const scored = [
        {
          group_players: [
            { position: 1, players: { id: 'me', name: 'Fritz' }, scores: [{ count: 2 }] },
          ],
        },
      ];
      const { el } = await boot('/home', ME, {
        rounds: [homeRound(scored)],
        live: [playing({ me: [4, 3], dad: [6, 5], bro: [4] })],
      });
      const button = el.querySelector('ui-course-card a[ui-button]');
      expect(button?.textContent?.trim()).toBe('Continue scoring · Hole 2');
      expect(cells(el, 'ui-board.mini')).toEqual([
        ['1', 'Fritz', '−1', '2'],
        ['2', 'Brother', 'E', '1'],
        ['3', 'Dad', '+1', '2'],
      ]);
    });

    it('before the first score: "Start scoring · Hole 1" and no board', async () => {
      const { el } = await boot('/home', ME, { rounds: [homeRound([])], live: [playing()] });
      expect(el.querySelector('ui-course-card a[ui-button]')?.textContent?.trim()).toBe(
        'Start scoring · Hole 1',
      );
      expect(el.querySelector('ui-board')).toBeNull();
    });
  });

  describe('a round’s page', () => {
    it('shows the setup and the strokes to everyone; only organizers get Edit', async () => {
      const { el } = await boot('/trip/rounds/r1', ME, { live: [playing()] });
      const setup = el.querySelector('[aria-label="Round setup"]')!;
      expect(setup.textContent).toContain('PGA National Palmer');
      expect(setup.textContent).toContain('Blue · 6,412 yds · par 72');
      expect(setup.textContent).toContain('18 holes');
      expect(setup.textContent).toMatch(/9-point game\s*50¢ a point/);
      // Like GHIN: the name over the index, then CH and SO. No PH at 100%.
      const strokes = el.querySelector('ui-board[aria-label=Strokes]')!;
      expect(strokes.querySelector('caption')?.textContent).toContain('100% · off the low man');
      expect(heads(strokes)).toEqual(['Player', 'CH', 'SO']);
      expect(sheet(strokes)).toEqual([
        ['Fritz', '10.0 HCI', '10', '0'],
        ['Dad', '20.0 HCI', '20', '10'],
        ['Brother', '10.0 HCI', '10', '0'],
      ]);
      expect(el.querySelector('button[ui-edit-pill]')).toBeNull();
      TestBed.resetTestingModule();
      const organizer: TripSession = { ...ME, player: { ...ME.player, role: 'organizer' } };
      const edit = (await boot('/trip/rounds/r1', organizer, { live: [playing()] })).el;
      expect(
        edit.querySelector('[aria-label="Round setup"] button[ui-edit-pill]')?.textContent?.trim(),
      ).toBe('Edit');
    });

    it('shows PH when the allowance is not 100%', async () => {
      const { el } = await boot('/trip/rounds/r1', ME, {
        live: [playing()],
        rules: { handicap_allowance: 0.9 },
      });
      const strokes = el.querySelector('ui-board[aria-label=Strokes]')!;
      expect(strokes.querySelector('caption')?.textContent).toContain('90% · off the low man');
      expect(heads(strokes)).toEqual(['Player', 'CH', 'PH', 'SO']);
      expect(sheet(strokes)).toEqual([
        ['Fritz', '10.0 HCI', '10', '9', '0'],
        ['Dad', '20.0 HCI', '20', '18', '9'],
        ['Brother', '10.0 HCI', '10', '9', '0'],
      ]);
    });

    it('with mixed tees, shows each player’s tees, and PH when the pars differ', async () => {
      // Dad stays on Blue (par 72). Fritz and Brother play Gold: rating 69, and 18 is a par 3.
      const row = playing();
      const gold = {
        id: 'gold',
        name: 'Gold',
        yards: 5900,
        rating: 69,
        slope: 113,
        par: [...Array<number>(17).fill(4), 3],
        stroke_index: row.tees!.stroke_index,
      };
      for (const gp of row.groups[0].group_players) if (gp.player?.id !== 'dad') gp.tee = gold;
      const { el } = await boot('/trip/rounds/r1', ME, { live: [row] });
      const strokes = el.querySelector('ui-board[aria-label=Strokes]')!;
      expect(heads(strokes)).toEqual(['Player', 'CH', 'PH', 'SO']);
      // 10 + (69 − 71) = 8. Dad: 20, plus 1 for the higher par = 21; 13 off the low man.
      expect(sheet(strokes)).toEqual([
        ['Fritz', '10.0 HCI · Gold tees', '8', '8', '0'],
        ['Dad', '20.0 HCI · Blue tees', '20', '21', '13'],
        ['Brother', '10.0 HCI · Gold tees', '8', '8', '0'],
      ]);
    });

    it('says who has no handicap index', async () => {
      const row = playing();
      row.groups[0].group_players.find((gp) => gp.player?.id === 'dad')!.player!.handicap_index =
        null;
      const { el } = await boot('/trip/rounds/r1', ME, { live: [row] });
      expect(sheet(el.querySelector('ui-board[aria-label=Strokes]')!)[1]).toEqual([
        'Dad',
        'No handicap index',
        '–',
        '–',
      ]);
    });

    it('shows the scores, a pickup marked "PU"', async () => {
      const row = playing({ me: [4, 5], dad: [6, 7], bro: [4] });
      row.groups[0].group_players.find((gp) => gp.player?.id === 'dad')!.scores[1].picked_up = true;
      const { el } = await boot('/trip/rounds/r1', ME, { live: [row] });
      expect([...el.querySelectorAll('[aria-label=Scores] ui-list-row')].map(rowText)).toEqual([
        'Fritz 4 · 5 9',
        'Dad 6 · 7 PU 13',
        'Brother 4 4',
      ]);
    });

    it('Trip › Courses lists the rounds, each to its own page', async () => {
      const { el } = await boot('/trip/courses', ME, {
        live: [playing({}, { play_date: '2026-11-26' })],
      });
      const link = el.querySelector('a[ui-list-row]')!;
      expect(link.querySelector('.title')?.textContent?.trim()).toBe('PGA National Palmer');
      expect(link.getAttribute('href')).toBe('/trip/rounds/r1');
    });

    it('the old /rounds/:id address still opens the round', async () => {
      const { router } = await boot('/rounds/r1', ME, { live: [playing()] });
      expect(router.url).toBe('/trip/rounds/r1');
    });
  });

  describe('invite link', () => {
    const TRIP_INVITE = {
      kind: 'trip',
      inviter: 'Fritz',
      name: 'Von',
      email: 'von@example.com',
      trip: {
        name: 'Southern Pines 2026',
        start_date: '2026-10-08',
        end_date: '2026-10-12',
        players: 4,
      },
    };
    const VON: Me = { ...FRITZ, id: 'u2', display_name: 'Von', email: 'von@example.com' };
    const joined = { status: 'ok', kind: 'trip', trip_id: 't1' };

    it('shows who invited you to what, with the email filled in when the organizer knew it', async () => {
      const { el, invoke } = await boot('/invite/TOKEN-1', null, {
        me: null,
        functions: { invite: TRIP_INVITE },
      });
      expect(invoke).toHaveBeenCalledWith('invite', { body: { token: 'TOKEN-1' } });
      expect(el.querySelector('.lead')?.textContent?.trim()).toBe('Fritz invited you to');
      expect(el.querySelector('h1')?.textContent).toBe('Southern Pines 2026');
      expect(el.querySelector('.facts')?.textContent).toBe('Oct 8–12, 2026 · 4 players');
      expect(el.querySelector<HTMLInputElement>('input[name=email]')?.value).toBe(
        'von@example.com',
      );
    });

    it('after the code, claims the spot and, on an iPhone, goes on to Add to Home Screen', async () => {
      const { router, el, rpc, signIn, auth } = await boot('/invite/TOKEN-1', null, {
        me: null,
        functions: { invite: TRIP_INVITE },
        claim: joined,
        signsInAs: VON,
        trips: [mine({})],
        platform: 'ios-safari',
      });
      await signIn(null);
      expect(auth.sendCode).toHaveBeenCalledWith('von@example.com');
      expect(rpc).toHaveBeenCalledWith('claim_invite', { p_token: 'TOKEN-1' });
      expect(router.url).toBe('/install');
      expect(el.querySelector('h1')?.textContent).toBe("You're in, Fritz");
      expect(el.querySelectorAll('ol li')).toHaveLength(3);
      expect(el.textContent).toContain('Leader alerts only work from the Home Screen app.');
      expect(el.querySelector('ui-tab-bar')).toBeNull();
    });

    it('on an iPhone, "Not now" on that step opens the trip\'s Home, never You', async () => {
      const { router, signIn, click, session } = await boot('/invite/TOKEN-1', null, {
        me: null,
        functions: { invite: TRIP_INVITE },
        claim: joined,
        signsInAs: VON,
        trips: [mine({})],
        platform: 'ios-safari',
      });
      await signIn(null);
      await click('Not now');
      expect(router.url).toBe('/home');
      expect(session()?.trip.id).toBe('t1');
    });

    it('with nothing to install, says "You\'re in" and then opens the trip\'s Home', async () => {
      const { router, el, signIn, click, session } = await boot('/invite/TOKEN-1', null, {
        me: null,
        functions: { invite: TRIP_INVITE },
        claim: joined,
        signsInAs: VON,
        trips: [mine({})],
      });
      await signIn(null);
      expect(router.url).toBe('/invite/TOKEN-1');
      expect(el.querySelector('h1')?.textContent).toBe("You're in, Von");
      expect(el.querySelector('[role=alert]')).toBeNull();
      await click('Open Southern Pines 2026');
      expect(router.url).toBe('/home');
      expect(session()?.trip.id).toBe('t1');
    });

    it('counts it as joined when the email already claimed the spot, or the link is opened again', async () => {
      // The organizer entered Von's email: verifying the code put him on the trip, and the
      // link then finds him already there.
      for (const claim of [joined, { status: 'already_on_trip', trip_id: 't1' }]) {
        const { el, signIn, click, router } = await boot('/invite/TOKEN-1', null, {
          me: null,
          functions: { invite: TRIP_INVITE },
          claim,
          signsInAs: VON,
          trips: [mine({})],
        });
        await signIn(null);
        expect(el.querySelector('[role=alert]')).toBeNull();
        expect(el.querySelector('h1')?.textContent).toBe("You're in, Von");
        await click('Open Southern Pines 2026');
        expect(router.url).toBe('/home');
        TestBed.resetTestingModule();
      }
    });

    it('says the link is used only when someone else took it up', async () => {
      const { el, signIn, router } = await boot('/invite/TOKEN-1', null, {
        me: null,
        functions: { invite: TRIP_INVITE },
        claim: { status: 'used' },
      });
      await signIn(null);
      expect(el.querySelector('[role=alert]')?.textContent).toContain('used or replaced');
      expect(el.querySelector('h1')).toBeNull();
      expect(router.url).toBe('/invite/TOKEN-1');
    });

    it('a draft: a co-organizer goes on to set it up; a player is told it opens once published', async () => {
      const draft = await boot('/invite/TOKEN-1', null, {
        me: null,
        functions: { invite: TRIP_INVITE },
        claim: joined,
        trips: [mine({ stage: 'draft', status: 'draft', role: 'co_organizer' })],
      });
      await draft.signIn(null);
      expect(draft.el.querySelector('h1')?.textContent).toBe("You're in, Fritz");
      expect(
        [...draft.el.querySelectorAll('a')]
          .find((a) => a.textContent?.trim() === 'Open Southern Pines 2026')
          ?.getAttribute('href'),
      ).toBe('/admin/trips/t1');
      TestBed.resetTestingModule();
      const hidden = await boot('/invite/TOKEN-1', null, {
        me: null,
        functions: { invite: TRIP_INVITE },
        claim: joined,
        trips: [],
      });
      await hidden.signIn(null);
      expect(hidden.el.querySelector('h1')?.textContent).toBe("You're in, Fritz");
      expect(hidden.el.querySelector('.facts')?.textContent).toBe(
        "Southern Pines 2026 opens once it's published.",
      );
      await hidden.click('Continue');
      expect(hidden.router.url).toBe('/you');
    });

    it('invites someone to plan trips, and lands them on You as a trip creator', async () => {
      const { el, router, signIn, auth } = await boot('/invite/TOKEN-2', null, {
        me: null,
        functions: { invite: { kind: 'creator', inviter: 'Fritz', name: 'Brendan' } },
        claim: { status: 'ok', kind: 'creator' },
        signsInAs: { ...FRITZ, id: 'u3', display_name: 'Brendan', is_trip_creator: true },
      });
      expect(el.querySelector('.lead')?.textContent?.trim()).toBe('Fritz invited you to');
      expect(el.querySelector('h1')?.textContent).toBe('Plan golf trips on Teed');
      await signIn('brendan@example.com');
      expect(auth.refresh).toHaveBeenCalled();
      expect(router.url).toBe('/you');
      expect(el.querySelector('.fab')?.textContent?.trim()).toBe('+ New trip');
    });

    it('lets someone already signed in take it up in one tap', async () => {
      const { click, rpc, router, el } = await boot('/invite/TOKEN-1', null, {
        functions: { invite: TRIP_INVITE },
        claim: joined,
        trips: [mine({})],
      });
      expect(el.querySelector('input[name=email]')).toBeNull();
      await click('Continue as Fritz');
      expect(rpc).toHaveBeenCalledWith('claim_invite', { p_token: 'TOKEN-1' });
      expect(el.querySelector('h1')?.textContent).toBe("You're in, Fritz");
      await click('Open Southern Pines 2026');
      expect(router.url).toBe('/home');
    });

    it('says so when the link has been used or replaced', async () => {
      const used = await boot('/invite/OLD', null, { me: null, functions: { invite: 'gone' } });
      expect(used.el.querySelector('[role=alert]')?.textContent).toContain('used or replaced');
      expect(used.el.querySelector('input')).toBeNull();
      TestBed.resetTestingModule();
      const late = await boot('/invite/TOKEN-1', null, {
        me: null,
        functions: { invite: TRIP_INVITE },
        claim: { status: 'invalid' },
      });
      await late.signIn(null);
      expect(late.el.querySelector('[role=alert]')?.textContent).toContain('used or replaced');
      expect(late.router.url).toBe('/invite/TOKEN-1');
    });
  });

  describe('a new version', () => {
    const toast = (el: HTMLElement) => el.querySelector('ui-toast');

    it('says "New version · Reload" when a new build is ready, and not before', async () => {
      const { el, versions, settle } = await boot('/home', SAVED);
      expect(toast(el)).toBeNull();
      versions.next({ type: 'VERSION_DETECTED' }); // still downloading
      await settle();
      expect(toast(el)).toBeNull();
      versions.next({ type: 'VERSION_READY' });
      await settle();
      expect(toast(el)?.textContent).toContain('New version');
      expect(toast(el)?.querySelector('button')?.textContent?.trim()).toBe('Reload');
    });

    it('checks for one when the app comes back to the foreground', async () => {
      const { el, updates, settle } = await boot('/home', SAVED);
      expect(updates.checkForUpdate).not.toHaveBeenCalled();
      updates.checkForUpdate.mockResolvedValue(true);
      document.dispatchEvent(new Event('visibilitychange'));
      await settle();
      expect(updates.checkForUpdate).toHaveBeenCalledTimes(1);
      expect(toast(el)?.textContent).toContain('New version');
    });

    it('does nothing where there is no service worker, or no signal', async () => {
      const none = await boot('/home', SAVED, { worker: false });
      document.dispatchEvent(new Event('visibilitychange'));
      await none.settle();
      expect(none.updates.checkForUpdate).not.toHaveBeenCalled();
      expect(toast(none.el)).toBeNull();
      TestBed.resetTestingModule();
      const offline = await boot('/home', SAVED);
      offline.updates.checkForUpdate.mockRejectedValue(new Error('offline'));
      document.dispatchEvent(new Event('visibilitychange'));
      await offline.settle();
      expect(toast(offline.el)).toBeNull();
    });
  });

  describe('Add to Home Screen', () => {
    const buttons = (el: HTMLElement) =>
      [...el.querySelectorAll('button[ui-button]')].map((b) => b.textContent?.trim());

    it('gives the steps for the browser in use', async () => {
      const chrome = await boot('/install', SAVED, { platform: 'ios-chrome' });
      expect(chrome.el.textContent).toContain('Chrome’s address bar');
      TestBed.resetTestingModule();
      const android = await boot('/install', SAVED, { platform: 'android' });
      expect(android.el.textContent).toContain('Tap the ⋮ menu');
    });

    it('on an iPhone has only "Not now", which goes on to the trip', async () => {
      const { el, click, router } = await boot('/install', SAVED, {
        platform: 'ios-safari',
        canPrompt: true,
      });
      expect(buttons(el)).toEqual(['Not now']);
      await click('Not now');
      expect(router.url).toBe('/home');
    });

    it('on Android adds "Install Teed", which opens the system install prompt', async () => {
      const { el, click, router, promptInstall } = await boot('/install', SAVED, {
        platform: 'android',
        canPrompt: true,
      });
      expect(buttons(el)).toEqual(['Install Teed', 'Not now']);
      await click('Install Teed');
      expect(promptInstall).toHaveBeenCalled();
      expect(router.url).toBe('/home');
    });

    it('is skipped when already running from the Home Screen', async () => {
      const { router } = await boot('/install', SAVED, { platform: 'standalone' });
      expect(router.url).toBe('/home');
    });
  });

  describe('spectator link', () => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const VIEW = {
      trip: {
        name: 'Southern Pines 2026',
        location: 'Southern Pines, NC',
        start_date: '2026-10-08',
        end_date: '2026-10-12',
        status: 'live',
        shows_winnings: false,
      },
      rounds: [
        {
          id: 'r1',
          round_number: 1,
          play_date: '2026-10-09',
          tee_time: '10:50:00',
          status: 'final',
          course: { name: 'Tot Hill Farm', short_name: 'Tot Hill', photo_path: null },
          tee: { name: 'Silver' },
          formats: [{ format_key: 'sixes' }],
          groups: [],
          scores: [{ player_id: 'p1', hole: 1, strokes: 5 }],
        },
        {
          id: 'r2',
          round_number: 2,
          play_date: date,
          tee_time: '07:33:00',
          status: 'scheduled',
          course: { name: 'Southern Pines', short_name: 'S. Pines', photo_path: null },
          tee: { name: 'White' },
          formats: [{ format_key: 'nassau' }],
          groups: [],
          scores: [{ player_id: 'p1', hole: 1, strokes: 5 }],
        },
        {
          id: 'r3',
          round_number: 3,
          play_date: '2099-10-11',
          tee_time: '08:05:00',
          status: 'scheduled',
          course: { name: 'Mid Pines', short_name: 'Mid Pines', photo_path: null },
          tee: { name: 'Ross' },
          formats: [{ format_key: 'stableford' }],
          groups: [],
          scores: [],
        },
      ],
    };

    it('needs no account and shows just the golf: the round on now and the list of rounds, on Home and Board', async () => {
      const { el, router, invoke } = await boot('/watch/SPEC-TOKEN', null, {
        me: null,
        functions: { spectate: VIEW },
      });
      expect(router.url).toBe('/watch/SPEC-TOKEN');
      expect(invoke).toHaveBeenCalledWith('spectate', { body: { token: 'SPEC-TOKEN' } });
      expect(el.querySelector('h1')?.textContent).toMatch(/^Round 2 · /);
      expect(el.querySelector('ui-header-band .label')?.textContent?.trim()).toBe(
        'Southern Pines · Oct 8–12',
      );
      expect(el.querySelector('ui-header-band .switch')).toBeNull();
      expect(el.querySelector('ui-course-card h2')?.textContent).toBe('Southern Pines');
      expect(el.querySelector('ui-course-card .live')?.textContent).toContain('Live');
      const list = [...el.querySelectorAll('[aria-label=Rounds] ui-list-row')];
      expect(list.map((r) => r.querySelector('.title')?.textContent?.trim())).toEqual([
        'R1 · Tot Hill',
        'R2 · S. Pines',
        'R3 · Mid Pines',
      ]);
      expect(list.map((r) => r.querySelector('ui-chip')?.textContent?.trim())).toEqual([
        'Final',
        'Live',
        '8:05 AM',
      ]);
      expect(tabs(el)).toEqual(['Home', 'Board']);
      expect(el.querySelector('ui-header-band .action')).toBeNull();
    });

    it('says so when the link has been reset', async () => {
      const { el } = await boot('/watch/OLD', null, { me: null, functions: { spectate: 'gone' } });
      expect(el.querySelector('[role=alert]')?.textContent).toBe('This link no longer works.');
    });
  });
});
