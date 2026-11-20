import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { ADMIN_SUPABASE, SUPABASE } from './supabase';

export interface TripInfo {
  id: string;
  name: string;
  slug: string;
  status: 'draft' | 'live' | 'final';
  location: string | null;
  start_date: string;
  end_date: string;
  /** Which player is the trip's owner ("This is me"). */
  owner_player_id?: string | null;
}

export interface PlayerInfo {
  id: string;
  name: string;
  initials: string;
  role: 'player' | 'co_admin';
}

/** Who this phone is on which trip. A spectator has no player. */
export interface TripSession {
  role: 'player' | 'spectator';
  trip: TripInfo;
  player: PlayerInfo | null;
  /**
   * How this phone got in: with a code, or as the trip's owner on their organizer (email)
   * sign-in, where the database treats that account as the player marked "This is me".
   */
  via?: 'code' | 'owner';
}

export type RedeemOutcome =
  | { status: 'ok' }
  | { status: 'invalid_code' }
  | { status: 'trip_not_live'; tripStatus: 'draft' | 'final' }
  | { status: 'rate_limited'; retryAfter: number } // seconds
  | { status: 'offline' }
  | { status: 'error' };

const KEY = 'teed.session';
const CODE_KEY = 'teed.code';
const TRIP_COLUMNS = 'id, name, slug, status, location, start_date, end_date, owner_player_id';
const PLAYER_COLUMNS = 'id, name, initials, role';

/**
 * Logging in, and staying logged in.
 *
 * Two things are kept on the phone: the Supabase auth session (stored and refreshed by the
 * Supabase client) and, here, which trip and player that sign-in is. The second is what lets
 * the app open straight to trip home with no signal; `revalidate()` checks it against the server
 * whenever there is a connection.
 *
 * Players get in with a code (an anonymous sign-in linked to their player). The trip's owner
 * needs no code: their organizer sign-in is their player too.
 *
 * Safari and the installed home-screen app have separate storage, so a player logs in once in
 * each.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly supabase = inject(SUPABASE);
  private readonly injector = inject(Injector);

  readonly session = signal<TripSession | null>(this.load());

  /** True for the people who get the "Manage" pill: the owner and co-admins. */
  readonly canManage = computed(() => {
    const s = this.session();
    return !!s && (s.via === 'owner' || s.player?.role === 'co_admin');
  });

  /** Where to go once the session is gone: the owner back to their trips, players to login. */
  readonly exitUrl = signal('/login');

  /**
   * The code this phone logged in with. Kept so it can be put on the clipboard for the Home
   * Screen app, which has its own storage and asks for it once ("Paste my code").
   */
  code(): string | null {
    try {
      return localStorage.getItem(CODE_KEY);
    } catch {
      return null;
    }
  }

  /** The client the player screens read and write with: the one this session is signed in on. */
  db(): SupabaseClient {
    return this.session()?.via === 'owner' ? this.injector.get(ADMIN_SUPABASE) : this.supabase;
  }

  /** Sends the code to the redeem-code function. On 'ok' the session is set and saved. */
  async redeem(code: string): Promise<RedeemOutcome> {
    try {
      let result = await this.callRedeem(code);
      if (result === 'unauthorized') {
        // The stored auth session is no good any more (user deleted, token revoked): start a new one.
        await this.supabase.auth.signOut({ scope: 'local' });
        result = await this.callRedeem(code);
      }
      return result === 'unauthorized' ? { status: 'error' } : result;
    } catch {
      return { status: navigator.onLine === false ? 'offline' : 'error' };
    }
  }

  /** The owner opens their own trip as a player, on their organizer sign-in. */
  enterAsOwner(trip: TripInfo, player: PlayerInfo): void {
    try {
      localStorage.removeItem(CODE_KEY);
    } catch {
      // nothing to remove
    }
    this.save({ role: 'player', trip, player, via: 'owner' });
  }

  /**
   * Checks the saved session against the server and refreshes the trip and player details.
   * Logs out if the code was revoked or regenerated. With no connection, changes nothing.
   */
  async revalidate(): Promise<void> {
    const saved = this.session();
    if (!saved) return;
    try {
      const fresh =
        saved.via === 'owner' ? await this.checkOwner(saved) : await this.checkCode(saved);
      if (fresh === 'keep' || this.session() !== saved) return; // or it changed while we were asking
      if (fresh === 'gone') return this.clear(saved.via === 'owner' ? '/admin' : '/login');
      this.save(fresh);
    } catch {
      // offline: keep what we have
    }
  }

  /** "Switch trip / log out": forgets the trip on this phone and ends its session on the server. */
  async logout(): Promise<void> {
    const saved = this.session();
    if (saved?.via === 'owner') {
      // Leaving player mode. The organizer sign-in itself stays.
      this.clear('/admin');
      return;
    }
    this.clear('/login');
    try {
      const { data } = await this.supabase.auth.getSession();
      if (saved && data.session) {
        await this.supabase
          .from('trip_sessions')
          .delete()
          .eq('user_id', data.session.user.id)
          .eq('trip_id', saved.trip.id);
      }
      await this.supabase.auth.signOut();
    } catch {
      // offline: the phone is logged out locally, which is what matters to the person holding it
    }
  }

  private async checkCode(saved: TripSession): Promise<TripSession | 'keep' | 'gone'> {
    const { data: auth, error: authError } = await this.supabase.auth.getSession();
    if (authError) return 'keep'; // couldn't refresh right now (offline)
    if (!auth.session) return 'gone';

    const { data, error } = await this.supabase
      .from('trip_sessions')
      .select(`player_id, trips(${TRIP_COLUMNS}), players(${PLAYER_COLUMNS})`)
      .eq('user_id', auth.session.user.id)
      .eq('trip_id', saved.trip.id)
      .maybeSingle();
    if (error) return 'keep';

    const row = data as {
      player_id: string | null;
      trips: TripInfo | null;
      players: PlayerInfo | null;
    } | null;
    // No row: the code was revoked. No trip: it is no longer open to players.
    if (!row || !row.trips) return 'gone';
    return {
      role: row.player_id ? 'player' : 'spectator',
      trip: row.trips,
      player: row.players,
      via: 'code',
    };
  }

  private async checkOwner(saved: TripSession): Promise<TripSession | 'keep' | 'gone'> {
    const db = this.injector.get(ADMIN_SUPABASE);
    const { data: auth, error: authError } = await db.auth.getSession();
    if (authError) return 'keep';
    if (!auth.session) return 'gone';

    const { data, error } = await db
      .from('trips')
      .select(`${TRIP_COLUMNS}, owner_id`)
      .eq('id', saved.trip.id)
      .maybeSingle();
    if (error) return 'keep';
    const found = data as (TripInfo & { owner_id: string | null }) | null;
    // Still theirs, still open to players, and "This is me" still set.
    if (
      !found ||
      found.owner_id !== auth.session.user.id ||
      found.status === 'draft' ||
      !found.owner_player_id
    )
      return 'gone';

    const { data: player, error: playerError } = await db
      .from('players')
      .select(PLAYER_COLUMNS)
      .eq('id', found.owner_player_id)
      .maybeSingle();
    if (playerError) return 'keep';
    if (!player) return 'gone';
    const { owner_id: _owner, ...trip } = found;
    return { role: 'player', trip, player: player as PlayerInfo, via: 'owner' };
  }

  private async callRedeem(code: string): Promise<RedeemOutcome | 'unauthorized'> {
    const { data: existing } = await this.supabase.auth.getSession();
    if (!existing.session) {
      const { error } = await this.supabase.auth.signInAnonymously();
      if (error) {
        if (error.status === 429) return { status: 'rate_limited', retryAfter: 300 };
        return {
          status:
            error.name === 'AuthRetryableFetchError' || navigator.onLine === false
              ? 'offline'
              : 'error',
        };
      }
    }

    const { data, error } = await this.supabase.functions.invoke('redeem-code', { body: { code } });
    let body = data as RedeemBody | null;
    if (error) {
      // A non-2xx answer carries the Response in error.context; anything else never reached the function.
      const response = (error as { context?: unknown }).context;
      if (!(response instanceof Response)) return { status: 'offline' };
      if (response.status === 401) return 'unauthorized';
      body = (await response.json().catch(() => null)) as RedeemBody | null;
    }

    switch (body?.status) {
      case 'ok':
        if (!body.trip || !body.role) return { status: 'error' };
        this.save({ role: body.role, trip: body.trip, player: body.player ?? null, via: 'code' });
        try {
          localStorage.setItem(CODE_KEY, code);
        } catch {
          // storage unavailable
        }
        return { status: 'ok' };
      case 'invalid_code':
        return { status: 'invalid_code' };
      case 'trip_not_live':
        return {
          status: 'trip_not_live',
          tripStatus: body.trip_status === 'final' ? 'final' : 'draft',
        };
      case 'rate_limited':
        return { status: 'rate_limited', retryAfter: body.retry_after ?? 300 };
      default:
        return { status: 'error' };
    }
  }

  private save(session: TripSession): void {
    this.session.set(session);
    try {
      localStorage.setItem(KEY, JSON.stringify(session));
    } catch {
      // storage unavailable: logged in until the app is closed
    }
  }

  private clear(exitUrl: string): void {
    this.exitUrl.set(exitUrl);
    this.session.set(null);
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem(CODE_KEY);
    } catch {
      // nothing to remove
    }
  }

  private load(): TripSession | null {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as TripSession | null;
      return saved?.trip?.id && (saved.role === 'player' || saved.role === 'spectator')
        ? saved
        : null;
    } catch {
      return null;
    }
  }
}

interface RedeemBody {
  status?: string;
  role?: 'player' | 'spectator';
  trip?: TripInfo;
  player?: PlayerInfo | null;
  trip_status?: string;
  retry_after?: number;
}
