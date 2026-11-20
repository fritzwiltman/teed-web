import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { SupabaseClient } from '@supabase/supabase-js';
import { AuthService } from './auth';
import { SUPABASE } from './supabase';

export type Role = 'organizer' | 'co_organizer' | 'player';
export type TripStatus = 'draft' | 'live' | 'final';

export interface TripInfo {
  id: string;
  name: string;
  status: TripStatus;
  location: string | null;
  start_date: string;
  end_date: string;
}

/** The signed-in person's place on a trip. */
export interface PlayerInfo {
  id: string;
  name: string;
  initials: string;
  role: Role;
}

/** The trip the app is showing, and who the signed-in person is on it. */
export interface TripSession {
  trip: TripInfo;
  player: PlayerInfo;
}

/** One row of "My trips" (the database's my_trips()). */
export interface MyTrip extends TripInfo {
  stage: 'draft' | 'upcoming' | 'in_progress' | 'final';
  /** next: in progress, else the soonest to come · upcoming · past. */
  bucket: 'next' | 'upcoming' | 'past';
  role: Role;
  member_id: string;
  player_count: number;
  /** For a final trip, "1st" and the money won. Null until the scoring engine supplies them. */
  finish: string | null;
  winnings: number | null;
}

const KEY = 'teed.session';
const TRIPS_KEY = 'teed.trips';

/**
 * Which trip the app is on.
 *
 * Signing in is AuthService's job. This keeps the signed-in person's trips and the one they have
 * open, both saved on the phone so the app opens straight to trip home with no signal;
 * `revalidate()` checks them against the server whenever there is a connection.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly supabase = inject(SUPABASE);
  private readonly auth = inject(AuthService);

  readonly session = signal<TripSession | null>(
    this.load<TripSession>(KEY, (s) => !!s?.trip?.id && !!s.player?.id),
  );
  readonly trips = signal<MyTrip[]>(this.load<MyTrip[]>(TRIPS_KEY, Array.isArray) ?? []);

  /** True for the people who get the "Manage" pill: the organizer and co-organizers. */
  readonly canManage = computed(() => {
    const role = this.session()?.player.role;
    return role === 'organizer' || role === 'co_organizer';
  });

  constructor() {
    // Signing out (here or because the server says so) forgets the trips on this phone.
    effect(() => {
      if (!this.auth.me()) this.forget();
    });
  }

  /** The client the screens read and write with. */
  db(): SupabaseClient {
    return this.supabase;
  }

  /** Loads "My trips". Returns false, keeping what the phone has, when it can't be reached. */
  async loadTrips(): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.rpc('my_trips');
      if (error || !Array.isArray(data)) return false;
      this.trips.set(data as MyTrip[]);
      this.store(TRIPS_KEY, data);
      return true;
    } catch {
      return false;
    }
  }

  /** Opens one of my trips. Returns false if I'm not on it (or it can't be loaded and isn't saved). */
  async open(tripId: string): Promise<boolean> {
    let mine = this.trips().find((t) => t.id === tripId);
    if (!mine) {
      await this.loadTrips();
      mine = this.trips().find((t) => t.id === tripId);
      if (!mine) return false;
    }
    const trip: TripInfo = {
      id: mine.id,
      name: mine.name,
      status: mine.status,
      location: mine.location,
      start_date: mine.start_date,
      end_date: mine.end_date,
    };

    const saved = this.session();
    let player = saved?.trip.id === tripId ? saved.player : null;
    try {
      const { data } = await this.supabase
        .from('trip_members')
        .select('id, name, initials, role')
        .eq('id', mine.member_id)
        .maybeSingle();
      if (data) player = data as PlayerInfo;
    } catch {
      // offline: what was saved will do
    }
    if (!player) return false;
    this.save({ trip, player: { ...player, role: mine.role } });
    return true;
  }

  /**
   * Where the app starts: the Home of a trip in progress, else You.
   * (Works from what the phone has saved when there is no connection.)
   */
  async startUrl(): Promise<string> {
    await this.loadTrips();
    const now = this.trips().find((t) => t.stage === 'in_progress');
    if (now && (await this.open(now.id))) return '/home';
    return '/you';
  }

  /**
   * Checks the open trip against the server and refreshes it. Closes it if I'm no longer on the
   * trip. With no connection, changes nothing.
   */
  async revalidate(): Promise<void> {
    const saved = this.session();
    if (!this.auth.me() || !(await this.loadTrips()) || !saved) return;
    if (this.session() !== saved) return; // it changed while we were asking
    if (!this.trips().some((t) => t.id === saved.trip.id)) return this.leave();
    await this.open(saved.trip.id);
  }

  /** Back to You: closes the open trip. */
  leave(): void {
    this.session.set(null);
    this.remove(KEY);
  }

  private forget(): void {
    this.session.set(null);
    this.trips.set([]);
    this.remove(KEY);
    this.remove(TRIPS_KEY);
  }

  private save(session: TripSession): void {
    this.session.set(session);
    this.store(KEY, session);
  }

  private store(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // storage unavailable: kept until the app is closed
    }
  }

  private remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // nothing to remove
    }
  }

  private load<T>(key: string, valid: (value: T | null) => boolean): T | null {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
      return valid(saved) ? saved : null;
    } catch {
      return null;
    }
  }
}
