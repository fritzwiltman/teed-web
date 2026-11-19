import { Injectable, inject, signal } from '@angular/core';
import { SUPABASE } from './supabase';

export interface TripInfo {
  id: string;
  name: string;
  slug: string;
  status: 'draft' | 'live' | 'final';
  location: string | null;
  start_date: string;
  end_date: string;
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
}

export type RedeemOutcome =
  | { status: 'ok' }
  | { status: 'invalid_code' }
  | { status: 'trip_not_live'; tripStatus: 'draft' | 'final' }
  | { status: 'rate_limited'; retryAfter: number } // seconds
  | { status: 'offline' }
  | { status: 'error' };

const KEY = 'teed.session';

/**
 * Logging in with a code, and staying logged in.
 *
 * Two things are kept on the phone: the Supabase auth session (an anonymous user, stored and
 * refreshed by the Supabase client) and, here, which trip and player that user was linked to.
 * The second is what lets the app open straight to trip home with no signal; `revalidate()`
 * checks it against the server whenever there is a connection.
 *
 * Safari and the installed home-screen app have separate storage, so a player enters their code
 * once in each.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly supabase = inject(SUPABASE);

  readonly session = signal<TripSession | null>(this.load());

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

  /**
   * Checks the saved session against the server and refreshes the trip and player details.
   * Logs out if the code was revoked or regenerated. With no connection, changes nothing.
   */
  async revalidate(): Promise<void> {
    const saved = this.session();
    if (!saved) return;
    try {
      const { data: auth, error: authError } = await this.supabase.auth.getSession();
      if (authError) return; // couldn't refresh right now (offline): keep what we have
      if (!auth.session) return this.clear();

      const { data, error } = await this.supabase
        .from('trip_sessions')
        .select(
          'player_id, trips(id, name, slug, status, location, start_date, end_date), players(id, name, initials, role)',
        )
        .eq('user_id', auth.session.user.id)
        .eq('trip_id', saved.trip.id)
        .maybeSingle();
      if (error) return;

      const row = data as {
        player_id: string | null;
        trips: TripInfo | null;
        players: PlayerInfo | null;
      } | null;
      // No row: the code was revoked. No trip: it is no longer open to players.
      if (!row || !row.trips) return this.clear();
      if (this.session() !== saved) return; // logged out or switched trip while we were asking
      this.save({
        role: row.player_id ? 'player' : 'spectator',
        trip: row.trips,
        player: row.players,
      });
    } catch {
      // offline: keep what we have
    }
  }

  /** "Switch trip / log out": forgets the trip on this phone and ends its session on the server. */
  async logout(): Promise<void> {
    const saved = this.session();
    this.clear();
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
        this.save({ role: body.role, trip: body.trip, player: body.player ?? null });
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

  private clear(): void {
    this.session.set(null);
    try {
      localStorage.removeItem(KEY);
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
