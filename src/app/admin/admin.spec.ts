import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, Routes, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService, Me } from '../core/auth';
import { RoundRow, RoundsService, TripRules, roundInput, safeResult } from '../core/rounds';
import { roundRow } from '../core/rounds.testing';
import { MyTrip, Role, SessionService, TripSession } from '../core/session';
import { RoundPage } from '../player/round-page';
import { Suggestions } from '../player/suggestions';
import { TripCourses } from '../player/trip-courses';
import { TripInfo } from '../player/trip-info';
import { TripItinerary } from '../player/trip-itinerary';
import { TripPage } from '../player/trip-page';
import { TripPeople } from '../player/trip-people';
import { COURSE_RETURN } from './course-edit';
import { Creators } from './creators';
import {
  AdminData,
  AdminError,
  CourseChoice,
  ItineraryItem,
  Proposal,
  RosterPlayer,
  Trip,
  TripCreator,
  TripRole,
} from './data';
import { COURSE_ROUTES, adminOnly, creatorOnly } from './routes';
import { TripDetails, slugFor } from './trip-details';

// The organizer's screens, now inside the one trip app: a round's page (its setup and edit mode),
// Trip › Courses, People, Info and Itinerary, suggested changes, New trip, Trip creators, and
// the course library's guards. Every call to the database is a stand-in here.

const VERO: Trip = {
  id: 'vero',
  name: 'Vero Beach 2027',
  slug: 'VERO',
  location: 'Vero Beach, FL',
  start_date: '2027-01-14',
  end_date: '2027-01-17',
  status: 'live',
  theme: 'tour',
  handicap_allowance: 1,
  strokes_off_low: true,
  pickup_net_double: true,
  spectators_see_money: false,
  handicap_lock_date: null,
  timezone: 'America/New_York',
  buy_in_amount: 120,
};

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

const FRITZ = player({ id: 'me', role: 'organizer', is_me: true, buy_in_paid: true });
const DAD = player({
  id: 'dad',
  name: 'Dad',
  initials: 'D',
  handicap_index: 22,
  email: null,
  phone: null,
  claimed: false,
  flags: { no_email: true, not_claimed: true, not_paid: true },
});
const BRO = player({
  id: 'bro',
  name: 'Brother',
  initials: 'B',
  handicap_index: 9.4,
  role: 'co_organizer',
  buy_in_paid: true,
});
const ROSTER = [FRITZ, DAD, BRO];

const COURSES: CourseChoice[] = [
  {
    id: 'palmer',
    name: 'PGA National Resort Palmer Course',
    location: 'Palm Beach Gardens, FL',
    tees: [
      { id: 'blue', name: 'Blue', yards: 6412, rating: 71.2, slope: 131, par: Array(18).fill(4) },
      { id: 'white', name: 'White', yards: 6001, rating: 69.4, slope: 127, par: Array(18).fill(4) },
    ],
  },
  {
    id: 'fazio',
    name: 'PGA National Resort Fazio Course',
    location: 'Palm Beach Gardens, FL',
    tees: [
      { id: 'gold', name: 'Gold', yards: 6300, rating: 70.5, slope: 129, par: Array(18).fill(4) },
    ],
  },
  {
    id: 'pines',
    name: 'Pine Needles',
    location: 'Southern Pines, NC',
    tees: [
      { id: 'ross', name: 'Ross', yards: 6400, rating: 71.9, slope: 138, par: Array(18).fill(4) },
    ],
  },
];

/**
 * Who is signed in:
 *   organizer  the trip's organizer, and a trip creator
 *   co         a co-organizer: not a trip creator
 *   player     a player
 *   admin      the app admin, on none of these trips
 */
type Who = 'organizer' | 'co' | 'player' | 'admin' | 'nobody';
const ROLE: Record<Who, TripRole | null> = {
  organizer: 'organizer',
  co: 'co_organizer',
  player: 'player',
  admin: 'admin',
  nobody: null,
};
const SESSION_ROLE: Record<Who, Role> = {
  organizer: 'organizer',
  co: 'co_organizer',
  player: 'player',
  admin: 'organizer',
  nobody: 'player',
};

interface Options {
  data?: Partial<Record<keyof AdminData, unknown>>;
  trip?: Partial<Trip>;
  live?: RoundRow[];
  rules?: Partial<TripRules>;
}

const ROUTES: Routes = [
  {
    path: 'trip',
    component: TripPage,
    children: [
      { path: 'itinerary', component: TripItinerary },
      { path: 'courses', component: TripCourses },
      { path: 'people', component: TripPeople },
      { path: 'info', component: TripInfo },
    ],
  },
  { path: 'trip/rounds/new', component: RoundPage },
  { path: 'trip/rounds/:roundId', component: RoundPage },
  { path: 'trip/suggestions', component: Suggestions },
  { path: 'you/new-trip', component: TripDetails, canActivate: [creatorOnly] },
  { path: 'you/creators', component: Creators, canActivate: [adminOnly] },
  { path: 'courses', canActivate: [creatorOnly], children: COURSE_ROUTES },
  { path: 'login', children: [] },
  { path: 'you', children: [] },
  { path: 'home', children: [] },
];

/** Boots a screen at a URL as that person, with Vero Beach 2027 open. */
async function boot(url: string, who: Who = 'organizer', options: Options = {}) {
  const me = signal<Me | null>(
    who === 'nobody'
      ? null
      : {
          id: 'u1',
          display_name: who === 'co' ? 'Brother' : 'Fritz',
          email: `${who}@example.com`,
          handicap_index: 18.6,
          is_admin: who === 'admin',
          is_trip_creator: who === 'admin' || who === 'organizer',
        },
  );
  const trip = { ...VERO, ...options.trip };
  const api = {
    tripRole: vi.fn(async () => ROLE[who]),
    trip: vi.fn(async () => trip),
    rounds: vi.fn(async () => [] as { id: string; play_date: string }[]),
    roster: vi.fn(async () => ROSTER),
    createTrip: vi.fn(async (fields: object) => ({
      ...VERO,
      ...fields,
      id: 'new-trip',
      status: 'draft',
    })),
    updateTrip: vi.fn(async (_id: string, fields: object) => ({ ...trip, ...fields })),
    deleteTrip: vi.fn(async () => {}),
    addMember: vi.fn(async () => ({ id: 'new-member', token: 'TOKEN-NEW' })),
    updateMember: vi.fn(async () => {}),
    removeMember: vi.fn(async () => {}),
    handOff: vi.fn(async () => {}),
    setIndex: vi.fn(async () => {}),
    setPaid: vi.fn(async () => {}),
    invite: vi.fn(async () => 'TOKEN-AGAIN'),
    spectatorToken: vi.fn(async () => null as string | null),
    creators: vi.fn(async () => [] as TripCreator[]),
    addCreator: vi.fn(async () => 'TOKEN-CREATOR'),
    inviteCreator: vi.fn(async () => 'TOKEN-CREATOR-AGAIN'),
    removeCreator: vi.fn(async () => {}),
    courses: vi.fn(async () => []),
    courseChoices: vi.fn(async () => COURSES),
    lastPointValue: vi.fn(async () => null as number | null),
    roundSetup: vi.fn(),
    saveRound: vi.fn(async () => 'new-round'),
    deleteRound: vi.fn(async () => {}),
    itinerary: vi.fn(async () => [] as ItineraryItem[]),
    saveItem: vi.fn(async () => {}),
    deleteItem: vi.fn(async () => {}),
    proposals: vi.fn(async () => [] as Proposal[]),
    reviewProposal: vi.fn(async () => {}),
    ...options.data,
  };

  const session = signal<TripSession | null>(
    who === 'nobody'
      ? null
      : {
          trip: {
            id: trip.id,
            name: trip.name,
            status: trip.status,
            location: trip.location,
            start_date: trip.start_date,
            end_date: trip.end_date,
          },
          player: { id: 'me', name: 'Fritz', initials: 'FW', role: SESSION_ROLE[who] },
        },
  );
  const trips = signal<MyTrip[]>([]);
  const sessions = {
    session,
    trips,
    canManage: computed(() => ['organizer', 'co_organizer'].includes(session()?.player.role ?? '')),
    open: vi.fn(async () => true),
    loadTrips: vi.fn(async () => true),
    revalidate: vi.fn(async () => {}),
    leave: vi.fn(() => session.set(null)),
  };

  const rules: TripRules = {
    handicap_allowance: 1,
    strokes_off_low: true,
    pickup_net_double: true,
    ...options.rules,
  };
  const liveRows = signal(options.live ?? []);
  const views = computed(() =>
    liveRows().map((row) => ({ row, result: safeResult(roundInput(row, rules, [])) })),
  );
  const rounds = {
    tripId: computed(() => trip.id),
    rules: computed(() => rules),
    rounds: views,
    for: (id: string | undefined) => (id === trip.id ? views() : []),
    load: vi.fn(async () => true),
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
      provideRouter(ROUTES, withComponentInputBinding()),
      { provide: AuthService, useValue: { me, ready: vi.fn(async () => {}) } },
      { provide: AdminData, useValue: api },
      { provide: SessionService, useValue: sessions },
      { provide: RoundsService, useValue: rounds },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r));
      await harness.fixture.whenStable();
    }
  };
  await settle();
  const router = TestBed.inject(Router);
  const page = () => harness.fixture.nativeElement as HTMLElement;
  const label = (b: Element) =>
    b.querySelector('.title')?.textContent?.trim() ||
    b.textContent?.trim() ||
    b.getAttribute('aria-label') ||
    '';
  const buttons = () => [...page().querySelectorAll<HTMLElement>('button, a')].map(label);
  const click = async (text: string, within: ParentNode = page()) => {
    const target = [...within.querySelectorAll<HTMLElement>('button, a')].find(
      (b) =>
        b.textContent?.trim() === text ||
        b.querySelector('.title')?.textContent?.trim() === text ||
        b.getAttribute('aria-label') === text,
    );
    if (!target) throw new Error(`No button "${text}" in: ${page().textContent}`);
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
  const submit = async (form: ParentNode = page()) => {
    form.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };
  /** The open sheet: the last dialog on the page. */
  const sheet = () => [...page().querySelectorAll<HTMLElement>('[role=dialog]')].at(-1)!;
  /** Picks a row in the open picker sheet. */
  const pickRow = async (title: string) => {
    const row = [...sheet().querySelectorAll<HTMLElement>('.row')].find(
      (r) => r.querySelector('.title')?.textContent?.trim() === title,
    );
    if (!row) throw new Error(`No row "${title}" in the sheet: ${sheet().textContent}`);
    row.click();
    await settle();
  };
  /** The text of the message handed to Messages. */
  const texted = () => {
    const link = sms.mock.calls.at(-1)?.[0] as string | undefined;
    return link
      ? { to: link.slice(4).split('?')[0], body: decodeURIComponent(link.split('body=')[1]) }
      : null;
  };
  return {
    page,
    api,
    sessions,
    rounds,
    router,
    buttons,
    click,
    type,
    submit,
    sheet,
    pickRow,
    settle,
    share,
    texted,
    origin: original.origin,
  };
}

const realLocation = window.location;
afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  try {
    sessionStorage.clear();
  } catch {
    // nothing stored
  }
});

const rowTitles = (root: ParentNode, selector = '[ui-list-row], ui-list-row') =>
  [...root.querySelectorAll(selector)].map((r) => r.querySelector('.title')?.textContent?.trim());

describe('organizer screens', () => {
  describe('who gets in', () => {
    it('keeps New trip and the course library for trip creators', async () => {
      expect((await boot('/you/new-trip', 'organizer')).router.url).toBe('/you/new-trip');
      TestBed.resetTestingModule();
      expect((await boot('/you/new-trip', 'co')).router.url).toBe('/you');
      TestBed.resetTestingModule();
      expect((await boot('/courses', 'player')).router.url).toBe('/you');
      TestBed.resetTestingModule();
      expect((await boot('/courses', 'nobody')).router.url).toBe('/login');
    });

    it('keeps Trip creators for the app admin', async () => {
      expect((await boot('/you/creators', 'admin')).router.url).toBe('/you/creators');
      TestBed.resetTestingModule();
      expect((await boot('/you/creators', 'organizer')).router.url).toBe('/you');
    });
  });

  describe('Trip › Courses', () => {
    const r1 = roundRow({ round_number: 1, play_date: '2027-01-14' });
    const r2 = roundRow({
      id: 'r2',
      round_number: 2,
      play_date: '2027-01-15',
      round_formats: [{ format_key: 'stroke', settings: {}, sort_order: 0 }],
    });

    it('lists the rounds, each to its own page, with no Edit', async () => {
      const { page } = await boot('/trip/courses', 'player', { live: [r1, r2] });
      const rows = [...page().querySelectorAll('a[ui-list-row]')];
      expect(rows.map((r) => r.querySelector('.eyebrow')?.textContent?.trim())).toEqual([
        'R1 · Thu, Jan 14 · 8:10 AM',
        'R2 · Fri, Jan 15 · 8:10 AM',
      ]);
      // A side game is named on its own; a round of net stroke play says so.
      expect(rows.map((r) => r.querySelector('.detail')?.textContent?.trim())).toEqual([
        '9-point game · Blue tees',
        'Net stroke play · Blue tees',
      ]);
      expect(rows[0].getAttribute('href')).toBe('/trip/rounds/r1');
      expect(page().querySelector('button[ui-edit-pill]')).toBeNull();
      expect(page().textContent).not.toContain('Add a round');
    });

    it('gives organizers "+ Add a round" at the bottom, except on a final trip', async () => {
      expect((await boot('/trip/courses', 'co', { live: [r1] })).buttons()).toContain(
        '+ Add a round',
      );
      TestBed.resetTestingModule();
      expect(
        (
          await boot('/trip/courses', 'organizer', { live: [r1], trip: { status: 'final' } })
        ).buttons(),
      ).not.toContain('+ Add a round');
    });
  });

  describe("a round's page", () => {
    const SETUP = {
      id: 'r1',
      round_number: 1,
      status: 'scheduled',
      scored: false,
      course_id: 'palmer',
      tee_id: 'blue',
      holes: '18',
      play_date: '2027-01-14',
      tee_time: '08:10:00',
      player_ids: ['me', 'dad', 'bro'],
      player_tees: { me: null, dad: 'white', bro: null },
      nine_point: true,
      point_value_cents: 100,
    };
    // Played at the Palmer course: it comes first in the course sheet.
    const live = [
      roundRow({
        courses: { id: 'palmer', name: 'PGA National Resort Palmer Course', short_name: null, photo_path: null },
      }),
    ];
    const chip = (page: HTMLElement, name: string) =>
      page.querySelector<HTMLButtonElement>(`ui-tees-chip button[aria-label^="${name}’s tees"]`)!;

    it('shows the setup to everyone; only organizers get Edit', async () => {
      const t = await boot('/trip/rounds/r1', 'player', { live });
      expect(t.page().querySelector('[aria-label="Round setup"] h2')?.textContent).toBe(
        'Round setup',
      );
      expect(t.page().querySelector('button[ui-edit-pill]')).toBeNull();
      // The side game alone, with what it is played for: net stroke play is always on the board.
      expect(t.page().textContent).toContain('9-point game');
      expect(t.page().textContent).not.toContain('Net stroke play');
      TestBed.resetTestingModule();
      const organizer = await boot('/trip/rounds/r1', 'organizer', { live });
      expect(
        organizer
          .page()
          .querySelector('[aria-label="Round setup"] button[ui-edit-pill]')
          ?.textContent?.trim(),
      ).toBe('Edit');
    });

    it('Edit turns the setup into its edit mode in place, and Done saves it', async () => {
      const t = await boot('/trip/rounds/r1', 'organizer', {
        live,
        data: { roundSetup: vi.fn(async () => SETUP) },
      });
      await t.click('Edit');
      expect(t.page().querySelector('button[ui-edit-pill]')?.textContent?.trim()).toBe('Done');
      expect(t.page().textContent).toContain('PGA National Resort Palmer Course');
      // Everyone on the round's tees by default; Dad's own tees are drawn bold.
      expect(chip(t.page(), 'Fritz').textContent).toContain('Blue');
      expect(chip(t.page(), 'Dad').textContent).toContain('White');
      expect(chip(t.page(), 'Dad').classList).toContain('changed');
      expect(chip(t.page(), 'Fritz').classList).not.toContain('changed');
      await t.click('Done');
      expect(t.api.saveRound).toHaveBeenCalledWith(
        'vero',
        'r1',
        expect.objectContaining({
          tee_id: 'blue',
          player_tees: { me: null, dad: 'white', bro: null },
          point_value_cents: 100,
        }),
      );
      expect(t.page().querySelector('button[ui-edit-pill]')?.textContent?.trim()).toBe('Edit');
    });

    it('picking the round’s tees puts everyone on them; a chip can then change on its own', async () => {
      const t = await boot('/trip/rounds/r1', 'organizer', {
        live,
        data: { roundSetup: vi.fn(async () => SETUP) },
      });
      await t.click('Edit');
      await t.click('Tees');
      await t.pickRow('White');
      expect(chip(t.page(), 'Dad').textContent).toContain('White');
      expect(chip(t.page(), 'Fritz').textContent).toContain('White');
      expect(chip(t.page(), 'Dad').classList).not.toContain('changed');
      chip(t.page(), 'Brother').click();
      await t.settle();
      expect(t.sheet().textContent).toContain('Brother’s tees');
      expect(t.sheet().textContent).toContain('6,412 yds · 71.2 / 131');
      await t.pickRow('Blue');
      expect(chip(t.page(), 'Brother').classList).toContain('changed');
      await t.click('Done');
      expect(t.api.saveRound).toHaveBeenCalledWith(
        'vero',
        'r1',
        expect.objectContaining({ tee_id: 'white', player_tees: { bro: 'blue' } }),
      );
    });

    it('adds a round: course from a search sheet, the group, and the 9-point game', async () => {
      const t = await boot('/trip/rounds/new', 'organizer', { live });
      expect(t.page().querySelector('h1')?.textContent).toBe('Add round');
      // A trip of three starts with all three in the group and the 9-point game on, at 50¢.
      expect(t.page().querySelector('[aria-label=Players] h2')?.textContent).toContain(
        'Players · 3',
      );
      await t.click('Course');
      // Courses this trip has played come first; the search filters by name or place.
      expect(rowTitles(t.sheet(), '.row')[0]).toBe('PGA National Resort Palmer Course');
      await t.type('[role=dialog] input[type=search]', 'southern');
      expect(rowTitles(t.sheet(), '.row').filter(Boolean)).toEqual(
        ['Pine Needles', undefined].filter(Boolean),
      );
      await t.type('[role=dialog] input[type=search]', 'fazio');
      await t.pickRow('PGA National Resort Fazio Course');
      // One set of tees: picked.
      expect(t.page().textContent).toContain('Gold · 6,300 yds');
      await t.click('$1');
      await t.click('Add round');
      expect(t.api.saveRound).toHaveBeenCalledWith(
        'vero',
        null,
        expect.objectContaining({
          course_id: 'fazio',
          tee_id: 'gold',
          player_ids: ['me', 'dad', 'bro'],
          nine_point: true,
          point_value_cents: 100,
        }),
      );
      expect(t.router.url).toBe('/trip/rounds/new-round');
    });

    it('only offers the 9-point game to a group of exactly three', async () => {
      const t = await boot('/trip/rounds/new', 'organizer', {
        live,
        data: { roster: vi.fn(async () => [...ROSTER, player({ id: 'sam', name: 'Sam' })]) },
      });
      expect(t.page().textContent).toContain('For a group of exactly 3');
      expect(t.page().textContent).not.toContain('A point is worth');
    });

    it('a player without an index shows the "!"; the sheet saves it in place with nothing lost', async () => {
      const roster = vi.fn(async () => [FRITZ, { ...DAD, handicap_index: null }, BRO]);
      const t = await boot('/trip/rounds/new', 'organizer', { live, data: { roster } });
      await t.click('Course');
      await t.pickRow('PGA National Resort Fazio Course');
      expect(t.page().textContent).toContain('No handicap index');
      await t.click('Add Dad’s handicap index');
      expect(t.sheet().querySelector('h2')?.textContent).toBe("Dad's handicap index");
      expect(t.sheet().querySelector<HTMLInputElement>('input')?.getAttribute('inputmode')).toBe(
        'decimal',
      );
      await t.type('[role=dialog] input[name=index]', '22.4');
      roster.mockResolvedValue([FRITZ, { ...DAD, handicap_index: 22.4 }, BRO]);
      await t.submit(t.sheet());
      expect(t.api.setIndex).toHaveBeenCalledWith('dad', 22.4);
      expect(t.page().textContent).toContain('22.4 HCI');
      // The course picked before is still picked.
      expect(t.page().textContent).toContain('PGA National Resort Fazio Course');
    });

    it('"+ Add a course" goes to the library, and comes back with the new course picked', async () => {
      const t = await boot('/trip/rounds/new', 'organizer', { live });
      await t.click('Course');
      await t.click('+ Add a course');
      expect(t.router.url).toBe('/courses/add');
      expect(sessionStorage.getItem(COURSE_RETURN)).toBe('/trip/rounds/new');
      await t.router.navigateByUrl('/trip/rounds/new?course=pines');
      await t.settle();
      expect(t.page().textContent).toContain('Pine Needles');
      expect(t.page().textContent).toContain('Ross · 6,400 yds');
    });

    it("shows the database's own refusal", async () => {
      const t = await boot('/trip/rounds/new', 'organizer', {
        live,
        data: {
          saveRound: vi.fn(async () => {
            throw new AdminError('Brother has scores in this round');
          }),
        },
      });
      await t.click('Course');
      await t.pickRow('PGA National Resort Fazio Course');
      await t.click('Add round');
      expect(t.page().querySelector('[role=alert]')?.textContent).toContain(
        'Brother has scores in this round',
      );
    });

    it('deletes a round only after the confirm sheet', async () => {
      const t = await boot('/trip/rounds/r1', 'organizer', {
        live,
        data: { roundSetup: vi.fn(async () => SETUP) },
      });
      await t.click('Edit');
      await t.click('Delete round');
      expect(t.api.deleteRound).not.toHaveBeenCalled();
      expect(t.sheet().querySelector('h2')?.textContent).toBe('Delete Round 1?');
      await t.click('Delete round', t.sheet());
      expect(t.api.deleteRound).toHaveBeenCalledWith('r1');
      expect(t.router.url).toBe('/trip/courses');
    });

    it('lays the strokes out like GHIN: PH only when it differs from CH', async () => {
      const at100 = await boot('/trip/rounds/r1', 'player', { live });
      const heads = (page: HTMLElement) =>
        [...page.querySelectorAll('[aria-label=Strokes] th')].map((th) => th.textContent?.trim());
      expect(heads(at100.page())).toEqual(['Player', 'CH', 'SO']);
      expect(at100.page().querySelector('[aria-label=Strokes] caption')?.textContent).toContain(
        '100% · off the low man',
      );
      TestBed.resetTestingModule();
      const at90 = await boot('/trip/rounds/r1', 'player', {
        live,
        rules: { handicap_allowance: 0.9 },
      });
      expect(heads(at90.page())).toEqual(['Player', 'CH', 'PH', 'SO']);
    });
  });

  describe('People', () => {
    const MATT = player({
      id: 'matt',
      name: 'Matt',
      initials: 'M',
      handicap_index: 28.7,
      claimed: false,
      phone: '+17725550103',
      flags: { no_email: false, not_claimed: true, not_paid: true },
    });
    const withRoster = { data: { roster: vi.fn(async () => [FRITZ, BRO, MATT, DAD]) } };
    const row = (page: HTMLElement, name: string) =>
      [
        ...page.querySelectorAll<HTMLElement>(
          '[aria-label=Players] [ui-list-row], [aria-label=Players] ui-list-row',
        ),
      ].find((r) => r.querySelector('.title')?.textContent?.trim().startsWith(name))!;

    it('shows each name with the role under it and the index on the right', async () => {
      const { page } = await boot('/trip/people', 'player', withRoster);
      expect(page().querySelector('[aria-label=Players] h2')?.textContent).toBe('Players · 4');
      expect([...page().querySelectorAll('.columns span')].map((x) => x.textContent)).toEqual(['Player', 'HCI']);
      expect(row(page(), 'Fritz').querySelector('.detail')?.textContent).toBe('Organizer');
      expect(row(page(), 'Brother').querySelector('.detail')?.textContent).toBe('Co-organizer');
      expect(row(page(), 'Matt').querySelector('.value')?.textContent).toBe('28.7');
      // Players get no Edit and no "!" (the flags only come to organizers).
      expect(page().querySelector('button[ui-edit-pill]')).toBeNull();
    });

    it('gives organizers one "!" per row, with the reasons in a tooltip', async () => {
      const { page, settle } = await boot('/trip/people', 'organizer', withRoster);
      expect(row(page(), 'Fritz').querySelector('ui-attention')).toBeNull();
      const mark = row(page(), 'Dad').querySelector<HTMLButtonElement>('ui-attention button')!;
      expect(mark.getAttribute('aria-label')).toBe('No email yet, Not paid');
      mark.click();
      await settle();
      expect(
        document.querySelector('.cdk-overlay-container [role=tooltip]')?.textContent,
      ).toContain('No email yet');
      expect(
        row(page(), 'Matt').querySelector('ui-attention button')?.getAttribute('aria-label'),
      ).toBe("Hasn't joined, Not paid");
    });

    it('Edit gives rows a chevron, "+ Add a player", the spectator link and "Text invites"', async () => {
      const t = await boot('/trip/people', 'organizer', withRoster);
      expect(t.buttons()).not.toContain('Add a player');
      await t.click('Edit');
      expect(t.page().querySelector('button[ui-edit-pill]')?.textContent?.trim()).toBe('Done');
      expect(row(t.page(), 'Fritz').querySelector('.chevron')).toBeTruthy();
      expect(t.buttons()).toContain('Add a player');
      expect(t.buttons()).toContain('Create spectator link');
      expect(t.buttons()).toContain('Text invites to 2 players');
    });

    it('the player sheet: name, email, index, role; "Save and text invite" for someone not joined', async () => {
      const t = await boot('/trip/people', 'organizer', withRoster);
      await t.click('Edit');
      row(t.page(), 'Matt').click();
      await t.settle();
      expect(t.sheet().querySelector('h2')?.textContent).toBe('Matt');
      expect(
        [...t.sheet().querySelectorAll('ui-segmented button')].map((b) => b.textContent?.trim()),
      ).toEqual(['Player', 'Co-organizer', 'Organizer']);
      await t.type('[role=dialog] input[name=index]', '27.9');
      await t.click('Save and text invite', t.sheet());
      expect(t.api.updateMember).toHaveBeenCalledWith(
        MATT,
        expect.objectContaining({ name: 'Matt', handicap_index: 27.9 }),
      );
      expect(t.api.invite).toHaveBeenCalledWith('matt');
      expect(t.texted()?.to).toBe('+17725550103');
    });

    it('adds a player and texts the invite', async () => {
      const t = await boot('/trip/people', 'co', withRoster);
      await t.click('Edit');
      await t.click('Add a player');
      await t.type('[role=dialog] input[name=name]', 'Sam Jones');
      await t.type('[role=dialog] input[name=phone]', '(772) 555-0199');
      await t.click('Save and text invite', t.sheet());
      expect(t.api.addMember).toHaveBeenCalledWith(
        'vero',
        expect.objectContaining({
          name: 'Sam Jones',
          initials: 'SJ',
          phone: '+17725550199',
          role: 'player',
        }),
      );
      expect(t.texted()?.body).toContain(`/invite/TOKEN-NEW`);
      // A co-organizer doesn't choose roles.
    });

    it('removing a player asks first, and says their scores stay', async () => {
      const t = await boot('/trip/people', 'organizer', withRoster);
      await t.click('Edit');
      row(t.page(), 'Dad').click();
      await t.settle();
      await t.click('Remove from trip', t.sheet());
      expect(t.api.removeMember).not.toHaveBeenCalled();
      expect(t.sheet().querySelector('h2')?.textContent).toBe('Remove Dad?');
      expect(t.sheet().textContent).toContain('Scores already entered stay');
      await t.click('Remove Dad', t.sheet());
      expect(t.api.removeMember).toHaveBeenCalledWith('dad');
    });

    it('picking Organizer is a hand-off: it asks "Make Brother the organizer?"', async () => {
      const t = await boot('/trip/people', 'organizer', withRoster);
      await t.click('Edit');
      row(t.page(), 'Brother').click();
      await t.settle();
      await t.click('Organizer', t.sheet());
      expect(t.sheet().querySelector('h2')?.textContent).toBe('Make Brother the organizer?');
      expect(t.sheet().textContent).toContain('You stay on as a co-organizer.');
      await t.click('Make Brother organizer', t.sheet());
      expect(t.api.handOff).toHaveBeenCalledWith('vero', 'bro');
    });

    it('a co-organizer cannot choose roles, remove a co-organizer, or touch the organizer', async () => {
      const t = await boot('/trip/people', 'co', withRoster);
      await t.click('Edit');
      row(t.page(), 'Fritz').click();
      await t.settle();
      expect(t.sheet().querySelector('ui-segmented')).toBeNull();
      expect(t.sheet().textContent).not.toContain('Remove from trip');
    });

    it('is read-only on a final trip', async () => {
      const { page } = await boot('/trip/people', 'organizer', {
        ...withRoster,
        trip: { status: 'final' },
      });
      expect(page().querySelector('button[ui-edit-pill]')).toBeNull();
    });
  });

  describe('Info', () => {
    const STAY: ItineraryItem = {
      id: 'stay',
      day: '2027-01-14',
      start_time: '16:00:00',
      type: 'lodging',
      title: 'Vero Beach house',
      details: {
        address: '1 Ocean Dr, Vero Beach',
        check_out: '2027-01-17',
        check_out_time: '10:00',
      },
      sort_order: 0,
    };
    const withStay = { itinerary: vi.fn(async () => [STAY]) };

    it('shows the stay, buy-ins and house rules to everyone', async () => {
      const { page } = await boot('/trip/info', 'player', { data: withStay });
      const stay = page().querySelector('[aria-label=Stay]')!;
      expect(stay.textContent).toContain('Vero Beach house');
      expect(stay.textContent).toContain('Thu, Jan 14 · 4:00 PM');
      expect(stay.textContent).toContain('Sun, Jan 17 · 10:00 AM');
      expect(page().querySelector('[aria-label=Buy-ins] h2')?.textContent).toBe(
        'Buy-ins · $120 each',
      );
      expect(page().querySelector('[aria-label=Buy-ins] .note')?.textContent).toBe('2 of 3 paid');
      expect(page().querySelector('[aria-label="House rules"]')?.textContent).toContain('100%');
      expect(page().querySelector('button[ui-edit-pill]')).toBeNull();
    });

    it('Edit: name and dates, the stay, paid boxes, house rules; Done saves them all', async () => {
      const t = await boot('/trip/info', 'co', { data: withStay });
      await t.click('Edit');
      await t.type('input[name=name]', 'Vero 2027');
      await t.type('input[name=stay]', 'The beach house');
      await t.type('input[name=allowance]', '90');
      const dadPaid = t
        .page()
        .querySelector<HTMLElement>('ui-checkbox[aria-label="Dad paid"], [aria-label="Dad paid"]')!;
      dadPaid.click();
      await t.settle();
      await t.click('Done');
      expect(t.api.updateTrip).toHaveBeenCalledWith(
        'vero',
        expect.objectContaining({ name: 'Vero 2027', handicap_allowance: 0.9 }),
      );
      expect(t.api.saveItem).toHaveBeenCalledWith(
        'vero',
        'stay',
        expect.objectContaining({ type: 'lodging', title: 'The beach house' }),
      );
      expect(t.api.setPaid).toHaveBeenCalledWith('dad', true);
      // A co-organizer can't delete the trip.
      expect(t.buttons()).not.toContain('Delete trip');
    });

    it('Delete trip is the organizer’s, behind the confirm sheet', async () => {
      const t = await boot('/trip/info', 'organizer', { data: withStay });
      await t.click('Edit');
      await t.click('Delete trip');
      expect(t.sheet().querySelector('h2')?.textContent).toBe('Delete Vero Beach 2027?');
      expect(t.sheet().textContent).toContain(
        'Scores, results, itinerary and photos go away for all 3 players.',
      );
      expect(t.api.deleteTrip).not.toHaveBeenCalled();
      await t.click('Delete trip', t.sheet());
      expect(t.api.deleteTrip).toHaveBeenCalledWith('vero');
      expect(t.router.url).toBe('/you');
    });
  });

  describe('Itinerary', () => {
    const DINNER: ItineraryItem = {
      id: 'dinner',
      day: '2027-01-14',
      start_time: '18:45:00',
      type: 'meal',
      title: 'Dinner · Riverside',
      details: { reservation: true },
      sort_order: 2,
    };

    it('shows one day, titled "Travel day · Thu, Jan 14"; Edit edits that day', async () => {
      const t = await boot('/trip/itinerary', 'organizer', {
        data: { itinerary: vi.fn(async () => [DINNER]) },
      });
      expect(t.page().querySelector('ui-section-head h2')?.textContent).toBe(
        'Travel day · Thu, Jan 14',
      );
      expect(t.page().textContent).toContain('Dinner · Riverside');
      await t.click('Edit');
      expect(t.buttons()).toContain('Add to Thursday');
      await t.click('Dinner · Riverside');
      expect(t.sheet().querySelector('h2')?.textContent).toBe('Edit item');
      await t.type('[role=dialog] input[name=title]', 'Dinner · Mulligans');
      await t.click('Save', t.sheet());
      expect(t.api.saveItem).toHaveBeenCalledWith(
        'vero',
        'dinner',
        expect.objectContaining({ title: 'Dinner · Mulligans', day: '2027-01-14' }),
      );
    });

    it('a round day is titled by its round', async () => {
      const t = await boot('/trip/itinerary', 'player', {
        live: [roundRow({ play_date: '2027-01-14' })],
      });
      expect(t.page().querySelector('ui-section-head h2')?.textContent).toBe(
        'Round 1 · Thu, Jan 14',
      );
      expect(t.page().querySelector('button[ui-edit-pill]')).toBeNull();
    });

    it('shows organizers a Review card for suggested changes; Approve and Reject on each', async () => {
      const proposals = vi.fn(
        async () =>
          [
            {
              id: 'x1',
              payload: { title: 'Dinner · Pinehurst Brewing', day: '2027-01-15' },
              created_at: '',
              status: 'pending',
              proposer: { name: 'Dad' },
            },
          ] as Proposal[],
      );
      const t = await boot('/trip/itinerary', 'organizer', { data: { proposals } });
      expect(t.page().querySelector('[aria-label="Suggested changes"]')?.textContent).toContain(
        '1 suggested change',
      );
      TestBed.resetTestingModule();
      const review = await boot('/trip/suggestions', 'organizer', { data: { proposals } });
      expect(review.page().textContent).toContain('Dad · New item');
      expect(review.page().querySelector('button[ui-edit-pill]')).toBeNull();
      await review.click('Approve');
      expect(review.api.saveItem).toHaveBeenCalledWith(
        'vero',
        null,
        expect.objectContaining({ title: 'Dinner · Pinehurst Brewing', day: '2027-01-15' }),
      );
      expect(review.api.reviewProposal).toHaveBeenCalledWith('x1', 'approved');
    });
  });

  describe('New trip', () => {
    it('creates a draft trip with name, dates and where, and opens its Home', async () => {
      const t = await boot('/you/new-trip');
      expect(t.page().querySelector('h1')?.textContent).toBe('New trip');
      await t.type('input[name=name]', 'Bandon 2027');
      await t.type('input[name=start]', '2027-06-10');
      expect(t.page().querySelector<HTMLInputElement>('input[name=end]')?.value).toBe('2027-06-13');
      await t.type('input[name=location]', 'Bandon, OR');
      await t.click('Create trip');
      expect(t.api.createTrip).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Bandon 2027',
          slug: 'BANDON2027',
          location: 'Bandon, OR',
          start_date: '2027-06-10',
          end_date: '2027-06-13',
          handicap_allowance: 1,
        }),
      );
      expect(t.sessions.open).toHaveBeenCalledWith('new-trip');
      expect(t.router.url).toBe('/home');
    });

    it('checks the form before saving', async () => {
      const t = await boot('/you/new-trip');
      await t.click('Create trip');
      expect(t.page().querySelector('[role=alert]')?.textContent).toContain(
        'Give the trip a name.',
      );
      expect(t.api.createTrip).not.toHaveBeenCalled();
    });

    it('quietly picks another handle when a trip of the same name exists', async () => {
      const createTrip = vi
        .fn()
        .mockRejectedValueOnce(new AdminError('That is already in use. Pick a different one.'))
        .mockResolvedValue({ ...VERO, id: 'new-trip' });
      const t = await boot('/you/new-trip', 'organizer', { data: { createTrip } });
      await t.type('input[name=name]', 'Vero Beach 2027');
      await t.type('input[name=start]', '2027-01-14');
      await t.click('Create trip');
      expect(createTrip).toHaveBeenCalledTimes(2);
      expect(createTrip.mock.calls[1][0].slug).toMatch(/^VEROBEACH2[A-Z0-9]{2}$/);
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
    const withCreators = { data: { creators: vi.fn(async () => CREATORS) } };

    it('lists who may create trips: their email once signed in, the invited number until then', async () => {
      const { page } = await boot('/you/creators', 'admin', withCreators);
      expect(page().querySelector('[aria-label="Trip creators"] .note')?.textContent).toBe('2');
      const rows = [...page().querySelectorAll('[aria-label="Trip creators"] ui-list-row')];
      expect(rows.map((r) => r.querySelector('.title')?.textContent?.trim())).toEqual([
        'Charlie',
        'Brendan',
      ]);
      expect(rows[0].textContent).toContain('charlie@example.com');
      expect(rows[1].textContent).toContain('(412) 555-0148');
    });

    it('adds someone by name and phone, and texts them the invite to plan trips', async () => {
      const t = await boot('/you/creators', 'admin', withCreators);
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
  });
});

describe('slugFor', () => {
  it("makes a trip's handle from its name", () => {
    expect(slugFor('Vero Beach 2027')).toBe('VEROBEACH202');
    expect(slugFor('Pines')).toBe('PINES');
  });

  it('always gives something the database accepts', () => {
    for (const name of ['', '!!', 'a', 'Ångström Cup'])
      expect(slugFor(name)).toMatch(/^[A-Z0-9]{2,12}$/);
  });

  it('ends differently after a clash', () => {
    expect(slugFor('Vero Beach 2027', true)).toMatch(/^VEROBEACH2[A-Z0-9]{2}$/);
  });
});
