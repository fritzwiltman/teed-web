import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AdminAuth } from './auth';
import { AdminData, AdminError, RosterPlayer, Trip } from './data';
import { ADMIN_ROUTES } from './routes';

const VERO: Trip = {
  id: 'vero',
  name: 'Vero Beach 2027',
  slug: 'VERO',
  location: 'Vero Beach, FL',
  start_date: '2027-01-11',
  end_date: '2027-01-15',
  status: 'draft',
  theme: 'scorecard',
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
  code: 'VERO-FW27-K4M9',
  phone: '+17725550101',
  ...over,
});

/** Boots the organizer area at a URL. `who` is the email sign-in: an organizer, someone else, or nobody. */
async function boot(
  url: string,
  who: 'organizer' | 'stranger' | 'nobody' = 'organizer',
  data: Partial<Record<keyof AdminData, unknown>> = {},
) {
  const auth = {
    email: signal(who === 'nobody' ? null : `${who}@example.com`),
    isOrganizer: signal(who === 'organizer'),
    ready: vi.fn(async () => {}),
    send: vi.fn(async () => 'sent'),
    verify: vi.fn(async () => 'ok'),
    signOut: vi.fn(async () => {
      auth.email.set(null);
      auth.isOrganizer.set(false);
    }),
  };
  const api = {
    trips: vi.fn(async () => [VERO, PINES]),
    trip: vi.fn(async (id: string) => (id === 'pines' ? PINES : VERO)),
    rounds: vi.fn(async () => []),
    roster: vi.fn(async () => [] as RosterPlayer[]),
    spectatorCode: vi.fn(async () => null),
    createTrip: vi.fn(async (fields: object) => ({ ...VERO, ...fields, id: 'new-trip' })),
    updateTrip: vi.fn(async (_id: string, fields: object) => ({ ...VERO, ...fields })),
    addPlayer: vi.fn(async () => {}),
    courses: vi.fn(async () => []),
    ...data,
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter(
        [
          { path: 'admin', children: ADMIN_ROUTES },
          { path: 'login', children: [] },
        ],
        withComponentInputBinding(),
      ),
      { provide: AdminAuth, useValue: auth },
      { provide: AdminData, useValue: api },
    ],
  });
  const harness = await RouterTestingHarness.create(url);
  await harness.fixture.whenStable();
  const el = harness.routeNativeElement as HTMLElement;
  const settle = () => harness.fixture.whenStable();
  const page = () => harness.routeNativeElement as HTMLElement;
  const click = async (label: string) => {
    const target = [...page().querySelectorAll<HTMLElement>('button, a')].find(
      (b) => b.textContent?.trim() === label,
    );
    if (!target) throw new Error(`No button "${label}" in: ${page().textContent}`);
    target.click();
    await settle();
  };
  const type = async (selector: string, value: string) => {
    const input = page().querySelector<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  const submit = async () => {
    page()
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };
  return { el, page, auth, api, router: TestBed.inject(Router), click, type, submit, settle };
}

describe('organizer area', () => {
  describe('who gets in', () => {
    it('sends someone who is not signed in to the sign-in screen', async () => {
      const { router, page } = await boot('/admin', 'nobody');
      expect(router.url).toBe('/admin/sign-in');
      expect(page().querySelector('h1')?.textContent).toBe('Organizer sign-in');
    });

    it('lets an organizer in', async () => {
      const { router, page } = await boot('/admin');
      expect(router.url).toBe('/admin');
      expect(page().querySelector('h1')?.textContent).toBe('My trips');
    });

    it('gives a signed-in non-organizer nothing but a way to sign out', async () => {
      const { router, page, api, click, auth } = await boot('/admin/trips/vero/roster', 'stranger');
      expect(router.url).toBe('/admin/sign-in');
      expect(page().textContent).toContain("stranger@example.com isn't an organizer account");
      expect(api.roster).not.toHaveBeenCalled();
      await click('Sign out');
      expect(auth.signOut).toHaveBeenCalled();
    });
  });

  describe('sign-in', () => {
    it('emails a link, then accepts the code from the email', async () => {
      const t = await boot('/admin/sign-in', 'nobody');
      await t.type('#email', 'me@example.com');
      await t.submit();
      expect(t.auth.send).toHaveBeenCalledWith('me@example.com');
      expect(t.page().textContent).toContain('Check me@example.com');

      t.auth.verify.mockImplementation(async () => {
        t.auth.email.set('me@example.com');
        t.auth.isOrganizer.set(true);
        return 'ok';
      });
      await t.type('#otp', '12 34 56');
      await t.submit();
      expect(t.auth.verify).toHaveBeenCalledWith('me@example.com', '123456');
      expect(t.router.url).toBe('/admin');
    });

    it('says so when the code is wrong', async () => {
      const t = await boot('/admin/sign-in', 'nobody');
      await t.type('#email', 'me@example.com');
      await t.submit();
      t.auth.verify.mockResolvedValue('wrong_code');
      await t.type('#otp', '000000');
      await t.submit();
      expect(t.page().querySelector('[role=alert]')?.textContent).toContain("didn't work");
    });

    it('says so when too many emails have been sent', async () => {
      const t = await boot('/admin/sign-in', 'nobody');
      t.auth.send.mockResolvedValue('rate_limited');
      await t.type('#email', 'me@example.com');
      await t.submit();
      expect(t.page().querySelector('[role=alert]')?.textContent).toContain(
        'Too many sign-in emails',
      );
    });
  });

  describe('My trips', () => {
    it('lists upcoming trips with their status, and past trips as final', async () => {
      const { page } = await boot('/admin');
      const upcoming = page().querySelector('[aria-label=Upcoming]')!;
      const past = page().querySelector('[aria-label=Past]')!;
      expect(upcoming.textContent).toContain('Vero Beach 2027');
      expect(upcoming.querySelector('.badge')?.textContent?.trim()).toBe('draft');
      expect(past.textContent).toContain('Southern Pines 2026');
      expect(past.querySelector('.badge')?.textContent?.trim()).toBe('Final');
      expect(page().querySelector('a.button')?.textContent).toContain('+ New trip');
    });
  });

  describe('New trip', () => {
    it('creates a draft trip and opens its admin home', async () => {
      const t = await boot('/admin/trips/new');
      await t.type('[name=name]', 'Vero Beach 2027');
      await t.type('[name=slug]', 'vero!');
      await t.type('[name=start]', '2027-01-11');
      await t.type('[name=end]', '2027-01-15');
      await t.type('[name=allowance]', '85');
      await t.submit();
      expect(t.api.createTrip).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Vero Beach 2027',
          slug: 'VERO',
          start_date: '2027-01-11',
          end_date: '2027-01-15',
          theme: 'scorecard',
          handicap_allowance: 0.85,
          strokes_off_low: true,
        }),
      );
      expect(t.router.url).toBe('/admin/trips/new-trip');
    });

    it('checks the form before saving', async () => {
      const t = await boot('/admin/trips/new');
      await t.type('[name=name]', 'Vero Beach 2027');
      await t.type('[name=slug]', 'VERO');
      await t.type('[name=start]', '2027-01-15');
      await t.type('[name=end]', '2027-01-11');
      await t.submit();
      expect(t.page().querySelector('[role=alert]')?.textContent).toContain('before the first day');
      expect(t.api.createTrip).not.toHaveBeenCalled();
    });

    it('says which prefix is taken', async () => {
      const t = await boot('/admin/trips/new', 'organizer', {
        createTrip: vi.fn(async () => {
          throw new AdminError('That is already in use. Pick a different one.');
        }),
      });
      await t.type('[name=name]', 'Vero Beach 2027');
      await t.type('[name=slug]', 'VERO');
      await t.type('[name=start]', '2027-01-11');
      await t.type('[name=end]', '2027-01-15');
      await t.submit();
      expect(t.page().querySelector('[role=alert]')?.textContent).toContain(
        'The code prefix VERO is already in use',
      );
    });

    it('offers only the Scorecard theme for now', async () => {
      const { page } = await boot('/admin/trips/new');
      const radios = [...page().querySelectorAll<HTMLInputElement>('[name=theme]')];
      expect(radios.map((r) => `${r.value}:${r.checked}:${r.disabled}`)).toEqual([
        'scorecard:true:false',
        'coastal:false:true',
      ]);
    });
  });

  describe('Admin home', () => {
    it('shows the draft banner and the setup rows', async () => {
      const { page } = await boot('/admin/trips/vero');
      expect(page().querySelector('.banner')?.textContent).toContain(
        "Players can't see this trip yet. Codes start working when you set it live.",
      );
      const rows = [...page().querySelectorAll('a.row')].map((a) =>
        a.textContent?.replace('›', '').trim(),
      );
      expect(rows).toEqual(['Trip details', 'Roster and codes', 'Trip info']);
      expect(page().textContent).toContain('+ Add round');
    });

    it('lists rounds with their status', async () => {
      const round = (n: number, status: string, tbd: boolean) => ({
        id: `r${n}`,
        round_number: n,
        play_date: '2027-01-12',
        tee_time: null,
        status,
        pairings_tbd: tbd,
        courses: { name: `Course ${n}`, short_name: null },
      });
      const { page } = await boot('/admin/trips/vero', 'organizer', {
        rounds: vi.fn(async () => [
          round(1, 'final', false),
          round(2, 'live', false),
          round(3, 'scheduled', false),
          round(4, 'scheduled', true),
        ]),
      });
      const statuses = [...page().querySelectorAll('[aria-label=Rounds] .row')]
        .slice(1)
        .map((r) => r.lastElementChild?.textContent?.trim());
      expect(statuses).toEqual(['Final', 'Live', 'Ready', 'Pairings TBD']);
    });

    it('sets the trip live only after a confirm step, then goes on to texting codes', async () => {
      const t = await boot('/admin/trips/vero');
      await t.click('Set trip live · send codes');
      expect(t.api.updateTrip).not.toHaveBeenCalled();
      await t.click('Set live');
      expect(t.api.updateTrip).toHaveBeenCalledWith('vero', { status: 'live' });
      expect(t.router.url).toBe('/admin/trips/vero/roster?send=all');
    });

    it('has no banner, add-round or set-live for a finished trip', async () => {
      const { page } = await boot('/admin/trips/pines');
      expect(page().querySelector('.banner')).toBeNull();
      expect(page().textContent).not.toContain('Add round');
      expect(page().textContent).not.toContain('Set trip live');
    });
  });

  describe('Roster and codes', () => {
    const roster = [
      player({}),
      player({
        id: 'p2',
        name: 'Ben',
        initials: 'BK',
        code: 'VERO-BK27-Q2X7',
        phone: null,
        handicap_index: null,
        index_entered_at: null,
        sort_order: 2,
        role: 'co_admin',
      }),
    ];
    const withRoster = { roster: vi.fn(async () => roster) };

    it('shows each player with code and index, and warns about an unconfirmed index', async () => {
      const { page } = await boot('/admin/trips/vero/roster', 'organizer', withRoster);
      const rows = [...page().querySelectorAll('[aria-label=Players] .player')].map((r) =>
        r.textContent?.replace(/\s+/g, ' ').trim(),
      );
      expect(rows[0]).toContain('Fritz');
      expect(rows[0]).toContain('VERO-FW27-K4M9');
      expect(rows[0]).toContain('Index 18.6');
      expect(rows[0]).not.toContain('not confirmed');
      expect(rows[1]).toContain('Ben · Co-admin');
      expect(rows[1]).toContain('Index not confirmed');
    });

    it('offers edit, replace, new code and co-admin from the ⋯ menu', async () => {
      const t = await boot('/admin/trips/vero/roster', 'organizer', withRoster);
      t.page().querySelector<HTMLElement>('[aria-label="More for Fritz"]')!.click();
      await t.settle();
      const actions = [...t.page().querySelectorAll('.stack .actions button')].map((b) =>
        b.textContent?.trim(),
      );
      expect(actions).toEqual(['Edit', 'Replace player', 'New code', 'Make co-admin']);
    });

    it('adds a player, suggesting initials and tidying the phone number', async () => {
      const t = await boot('/admin/trips/vero/roster', 'organizer', withRoster);
      await t.click('+ Add player');
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
      await t.click('+ Add player');
      await t.type('[name=name]', 'Cal');
      await t.type('[name=phone]', '555');
      await t.submit();
      expect(t.page().querySelector('[role=alert]')?.textContent).toContain(
        "doesn't look like a mobile number",
      );
      expect(t.api.addPlayer).not.toHaveBeenCalled();
    });

    it('steps through the players for "Text all codes"', async () => {
      const t = await boot('/admin/trips/vero/roster?send=all', 'organizer', withRoster);
      const panel = () =>
        t
          .page()
          .querySelector('[aria-label="Text all codes"]')
          ?.textContent?.replace(/\s+/g, ' ') ?? '';
      expect(panel()).toContain('Text codes · 1 of 2');
      expect(panel()).toContain('Text Fritz');
      await t.click('Next');
      expect(panel()).toContain('2 of 2');
      expect(panel()).toContain('Share Ben'); // no phone number: the share sheet
      await t.click('Done');
      expect(t.page().querySelector('[aria-label="Text all codes"]')).toBeNull();
    });

    it('offers to create the spectator code, then shows it with Share and an on/off switch', async () => {
      const none = await boot('/admin/trips/vero/roster', 'organizer', withRoster);
      expect(none.page().querySelector('[aria-label="Spectator code"]')?.textContent).toContain(
        '+ Create spectator code',
      );
      TestBed.resetTestingModule();
      const some = await boot('/admin/trips/vero/roster', 'organizer', {
        ...withRoster,
        spectatorCode: vi.fn(async () => ({ id: 's1', code: 'VERO-WATCH-7Q3D', enabled: true })),
      });
      const card = some.page().querySelector('[aria-label="Spectator code"]')!;
      expect(card.textContent).toContain('VERO-WATCH-7Q3D');
      expect(card.textContent).toContain('Share');
      expect(card.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(true);
    });
  });
});
