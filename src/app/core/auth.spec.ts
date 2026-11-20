import { TestBed } from '@angular/core/testing';
import { AuthService, CODE_LIFETIME_MS, Me } from './auth';
import { SUPABASE } from './supabase';

const FRITZ: Me = {
  id: 'u1',
  display_name: 'Fritz',
  email: 'fritz@example.com',
  handicap_index: 18.6,
  is_admin: true,
  is_trip_creator: true,
};

describe('AuthService', () => {
  let signedInUser: { id: string } | null;
  let fake: {
    auth: {
      getSession: ReturnType<typeof vi.fn>;
      signInWithOtp: ReturnType<typeof vi.fn>;
      verifyOtp: ReturnType<typeof vi.fn>;
      signOut: ReturnType<typeof vi.fn>;
    };
    rpc: ReturnType<typeof vi.fn>;
    from: ReturnType<typeof vi.fn>;
  };
  let updated: unknown;

  function make(): AuthService {
    TestBed.configureTestingModule({ providers: [{ provide: SUPABASE, useValue: fake }] });
    return TestBed.inject(AuthService);
  }

  beforeEach(() => {
    localStorage.clear();
    signedInUser = null;
    updated = undefined;
    fake = {
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: signedInUser && { user: signedInUser } },
          error: null,
        })),
        signInWithOtp: vi.fn(async () => ({ error: null })),
        verifyOtp: vi.fn(async () => {
          signedInUser = { id: 'u1' };
          return { error: null };
        }),
        signOut: vi.fn(async () => ({ error: null })),
      },
      rpc: vi.fn(async () => ({ data: FRITZ, error: null })),
      from: vi.fn(() => ({
        update: (fields: unknown) => ({
          eq: async () => {
            updated = fields;
            return { error: null };
          },
        }),
      })),
    };
  });

  afterEach(() => vi.useRealTimers());

  describe('asking for a code', () => {
    it('emails a one-time code, creating the account if the address is new', async () => {
      const auth = make();
      expect(await auth.sendCode('  Fritz@Example.com ')).toBe('sent');
      expect(fake.auth.signInWithOtp).toHaveBeenCalledWith({
        email: 'fritz@example.com',
        options: { shouldCreateUser: true },
      });
    });

    it('never sends a link target: sign-in is by typed code only', async () => {
      await make().sendCode('fritz@example.com');
      const [{ options }] = fake.auth.signInWithOtp.mock.calls[0] as [{ options: object }];
      expect(options).not.toHaveProperty('emailRedirectTo');
    });

    it('does not bother the server with something that is not an email', async () => {
      expect(await make().sendCode('fritz at example')).toBe('bad_email');
      expect(fake.auth.signInWithOtp).not.toHaveBeenCalled();
    });

    it('tells too many requests and no connection apart', async () => {
      const auth = make();
      fake.auth.signInWithOtp.mockResolvedValue({ error: { status: 429, name: 'AuthApiError' } });
      expect(await auth.sendCode('fritz@example.com')).toBe('rate_limited');
      fake.auth.signInWithOtp.mockResolvedValue({ error: { name: 'AuthRetryableFetchError' } });
      expect(await auth.sendCode('fritz@example.com')).toBe('offline');
      fake.auth.signInWithOtp.mockRejectedValue(new TypeError('Failed to fetch'));
      expect(await auth.sendCode('fritz@example.com')).toBe('offline');
    });
  });

  describe('typing the code', () => {
    it('signs in, loads who that is and remembers them on the phone', async () => {
      const auth = make();
      await auth.sendCode('fritz@example.com');
      expect(await auth.verify('Fritz@example.com', '482193')).toBe('ok');
      expect(fake.auth.verifyOtp).toHaveBeenCalledWith({
        email: 'fritz@example.com',
        token: '482193',
        type: 'email',
      });
      expect(auth.me()).toEqual(FRITZ);
      expect(auth.signedIn()).toBe(true);
      expect(JSON.parse(localStorage.getItem('teed.me')!)).toEqual(FRITZ);
    });

    it("says a refused code didn't work, or expired once it is over an hour old", async () => {
      vi.useFakeTimers();
      const auth = make();
      await auth.sendCode('fritz@example.com');
      fake.auth.verifyOtp.mockResolvedValue({
        error: { status: 403, code: 'otp_expired', name: 'AuthApiError' },
      });
      expect(await auth.verify('fritz@example.com', '000000')).toBe('wrong');
      vi.advanceTimersByTime(CODE_LIFETIME_MS + 1000);
      expect(await auth.verify('fritz@example.com', '482193')).toBe('expired');
      expect(auth.me()).toBeNull();

      // A new code starts the clock again.
      await auth.sendCode('fritz@example.com');
      expect(await auth.verify('fritz@example.com', '000000')).toBe('wrong');
    });

    it('says so when there is no connection', async () => {
      const auth = make();
      fake.auth.verifyOtp.mockResolvedValue({ error: { name: 'AuthRetryableFetchError' } });
      expect(await auth.verify('fritz@example.com', '482193')).toBe('offline');
    });
  });

  describe('staying signed in', () => {
    it('opens as the person remembered on the phone, before any answer from the server', () => {
      localStorage.setItem('teed.me', JSON.stringify(FRITZ));
      expect(make().me()).toEqual(FRITZ);
    });

    it('keeps them when the server cannot be reached', async () => {
      localStorage.setItem('teed.me', JSON.stringify(FRITZ));
      fake.auth.getSession.mockRejectedValue(new TypeError('Failed to fetch'));
      const auth = make();
      await auth.ready();
      expect(auth.me()).toEqual(FRITZ);
    });

    it('forgets them when the server says the session is over', async () => {
      localStorage.setItem('teed.me', JSON.stringify(FRITZ));
      const auth = make();
      await auth.ready();
      expect(auth.me()).toBeNull();
      expect(localStorage.getItem('teed.me')).toBeNull();
    });

    it('refreshes what it knows about them (a new trip creator, say)', async () => {
      signedInUser = { id: 'u1' };
      localStorage.setItem('teed.me', JSON.stringify({ ...FRITZ, is_trip_creator: false }));
      const auth = make();
      await auth.ready();
      expect(fake.rpc).toHaveBeenCalledWith('me');
      expect(auth.me()?.is_trip_creator).toBe(true);
    });
  });

  it('saves my own name and handicap index', async () => {
    signedInUser = { id: 'u1' };
    const auth = make();
    await auth.ready();
    expect(await auth.saveProfile({ display_name: 'Fritz W', handicap_index: 17.2 })).toBe(true);
    expect(fake.from).toHaveBeenCalledWith('profiles');
    expect(updated).toEqual({ display_name: 'Fritz W', handicap_index: 17.2 });
    expect(auth.me()?.display_name).toBe('Fritz W');
  });

  it('signs out on the phone even with no connection', async () => {
    signedInUser = { id: 'u1' };
    const auth = make();
    await auth.ready();
    fake.auth.signOut.mockRejectedValue(new TypeError('Failed to fetch'));
    await auth.signOut();
    expect(auth.me()).toBeNull();
    expect(localStorage.getItem('teed.me')).toBeNull();
  });
});
