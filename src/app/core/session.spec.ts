import { TestBed } from '@angular/core/testing';
import { SessionService, TripSession } from './session';
import { SUPABASE } from './supabase';

const TRIP = {
  id: 't1',
  name: 'Southern Pines 2026',
  slug: 'PINES',
  status: 'live',
  location: 'Southern Pines, NC',
  start_date: '2026-10-08',
  end_date: '2026-10-12',
} as const;
const FRITZ = { id: 'p1', name: 'Fritz', initials: 'FW', role: 'co_admin' } as const;
const SAVED: TripSession = { role: 'player', trip: TRIP, player: FRITZ };
const AUTH = { user: { id: 'u1' } };

/** A stand-in for the Supabase client: just the calls SessionService makes. */
function fakeSupabase(options: {
  authSession?: unknown;
  authError?: unknown;
  invoke?: () => Promise<{ data: unknown; error: unknown }>;
  row?: { data: unknown; error: unknown };
}) {
  let authSession = options.authSession ?? null;
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'delete']) query[method] = vi.fn(() => query);
  query['maybeSingle'] = vi.fn(async () => options.row ?? { data: null, error: null });
  query['then'] = (resolve: (value: unknown) => void) => resolve({ data: null, error: null });
  return {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: authSession },
        error: options.authError ?? null,
      })),
      signInAnonymously: vi.fn(async () => {
        authSession = AUTH;
        return { data: { session: AUTH }, error: null };
      }),
      signOut: vi.fn(async () => {
        authSession = null;
        return { error: null };
      }),
    },
    functions: { invoke: vi.fn(options.invoke ?? (async () => ({ data: null, error: null }))) },
    from: vi.fn(() => query),
    query,
  };
}

/** What supabase-js gives back for a non-2xx answer from a function. */
const httpError = (status: number, body: unknown) => ({
  data: null,
  error: { context: new Response(JSON.stringify(body), { status }) },
});

function setup(fake: ReturnType<typeof fakeSupabase>): SessionService {
  TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: fake }] });
  return TestBed.inject(SessionService);
}

describe('SessionService', () => {
  beforeEach(() => localStorage.clear());

  describe('redeem', () => {
    it('signs in anonymously, redeems the code, and remembers the trip and player', async () => {
      const fake = fakeSupabase({
        invoke: async () => ({
          data: { status: 'ok', role: 'player', trip: TRIP, player: FRITZ },
          error: null,
        }),
      });
      const service = setup(fake);

      expect(await service.redeem('PINES-FW26-K4M9')).toEqual({ status: 'ok' });

      expect(fake.auth.signInAnonymously).toHaveBeenCalledTimes(1);
      expect(fake.functions.invoke).toHaveBeenCalledWith('redeem-code', {
        body: { code: 'PINES-FW26-K4M9' },
      });
      expect(service.session()).toEqual(SAVED);
      expect(JSON.parse(localStorage.getItem('teed.session')!)).toEqual(SAVED);
    });

    it("reuses the phone's existing sign-in", async () => {
      const fake = fakeSupabase({
        authSession: AUTH,
        invoke: async () => ({
          data: { status: 'ok', role: 'spectator', trip: TRIP, player: null },
          error: null,
        }),
      });
      const service = setup(fake);

      await service.redeem('PINES-WATCH-7Q3D');

      expect(fake.auth.signInAnonymously).not.toHaveBeenCalled();
      expect(service.session()).toEqual({ role: 'spectator', trip: TRIP, player: null });
    });

    it('reports a wrong code and stays logged out', async () => {
      const service = setup(
        fakeSupabase({ invoke: async () => httpError(404, { status: 'invalid_code' }) }),
      );
      expect(await service.redeem('NOPE')).toEqual({ status: 'invalid_code' });
      expect(service.session()).toBeNull();
    });

    it('reports a trip that is not live, and why', async () => {
      const draft = setup(
        fakeSupabase({
          invoke: async () => httpError(409, { status: 'trip_not_live', trip_status: 'draft' }),
        }),
      );
      expect(await draft.redeem('X')).toEqual({ status: 'trip_not_live', tripStatus: 'draft' });
    });

    it('reports a lockout with how long to wait', async () => {
      const service = setup(
        fakeSupabase({
          invoke: async () => httpError(429, { status: 'rate_limited', retry_after: 240 }),
        }),
      );
      expect(await service.redeem('X')).toEqual({ status: 'rate_limited', retryAfter: 240 });
    });

    it('reports no connection when the function cannot be reached', async () => {
      const service = setup(
        fakeSupabase({
          invoke: async () => ({
            data: null,
            error: { context: new TypeError('Failed to fetch') },
          }),
        }),
      );
      expect(await service.redeem('X')).toEqual({ status: 'offline' });
    });

    it('starts a fresh sign-in and retries once if the stored one is rejected', async () => {
      const answers = [
        httpError(401, { status: 'unauthorized' }),
        { data: { status: 'ok', role: 'player', trip: TRIP, player: FRITZ }, error: null },
      ];
      const fake = fakeSupabase({
        authSession: { user: { id: 'stale' } },
        invoke: async () => answers.shift()!,
      });
      const service = setup(fake);

      expect(await service.redeem('PINES-FW26-K4M9')).toEqual({ status: 'ok' });
      expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
      expect(fake.auth.signInAnonymously).toHaveBeenCalledTimes(1);
    });
  });

  describe('staying logged in', () => {
    beforeEach(() => localStorage.setItem('teed.session', JSON.stringify(SAVED)));

    it('restores the saved login when the app starts, before any network call', () => {
      const fake = fakeSupabase({});
      expect(setup(fake).session()).toEqual(SAVED);
      expect(fake.auth.getSession).not.toHaveBeenCalled();
    });

    it('ignores saved data it does not understand', () => {
      localStorage.setItem('teed.session', '{"role":"wizard"}');
      expect(setup(fakeSupabase({})).session()).toBeNull();
    });

    it('refreshes the details from the server', async () => {
      const row = {
        player_id: 'p1',
        trips: { ...TRIP, status: 'final' },
        players: { ...FRITZ, name: 'Fritz W' },
      };
      const service = setup(fakeSupabase({ authSession: AUTH, row: { data: row, error: null } }));

      await service.revalidate();

      expect(service.session()?.trip.status).toBe('final');
      expect(service.session()?.player?.name).toBe('Fritz W');
      expect(JSON.parse(localStorage.getItem('teed.session')!).player.name).toBe('Fritz W');
    });

    it('logs out when the code has been revoked', async () => {
      const service = setup(fakeSupabase({ authSession: AUTH, row: { data: null, error: null } }));
      await service.revalidate();
      expect(service.session()).toBeNull();
      expect(localStorage.getItem('teed.session')).toBeNull();
    });

    it("logs out when the phone's sign-in is gone", async () => {
      const service = setup(fakeSupabase({ authSession: null }));
      await service.revalidate();
      expect(service.session()).toBeNull();
    });

    it('stays logged in when there is no signal', async () => {
      const offlineQuery = setup(
        fakeSupabase({
          authSession: AUTH,
          row: { data: null, error: { message: 'Failed to fetch' } },
        }),
      );
      await offlineQuery.revalidate();
      expect(offlineQuery.session()).toEqual(SAVED);
    });

    it('stays logged in when the sign-in cannot be refreshed right now', async () => {
      const service = setup(
        fakeSupabase({ authSession: null, authError: { name: 'AuthRetryableFetchError' } }),
      );
      await service.revalidate();
      expect(service.session()).toEqual(SAVED);
    });

    it('logs out on request: forgets the trip and ends the session on the server', async () => {
      const fake = fakeSupabase({ authSession: AUTH });
      const service = setup(fake);

      await service.logout();

      expect(service.session()).toBeNull();
      expect(localStorage.getItem('teed.session')).toBeNull();
      expect(fake.from).toHaveBeenCalledWith('trip_sessions');
      expect(fake.query['delete']).toHaveBeenCalled();
      expect(fake.auth.signOut).toHaveBeenCalled();
    });
  });
});
