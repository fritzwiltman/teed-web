import { Injectable, computed, inject, signal } from '@angular/core';
import { SUPABASE } from './supabase';

/** The signed-in person, as the database's me() describes them. */
export interface Me {
  id: string;
  display_name: string;
  email: string;
  handicap_index: number | null;
  is_admin: boolean;
  is_trip_creator: boolean;
}

export type SendOutcome = 'sent' | 'bad_email' | 'rate_limited' | 'offline' | 'error';
export type VerifyOutcome = 'ok' | 'wrong' | 'expired' | 'rate_limited' | 'offline' | 'error';

/** A new code can be asked for this long after the last one. */
export const RESEND_SECONDS = 30;
/** How long a code lasts (Supabase Auth's email OTP expiry, one hour). */
export const CODE_LIFETIME_MS = 60 * 60 * 1000;

const KEY = 'teed.me';

/**
 * Signing in, for everyone: type your email, get a 6-digit code by email, type it in. There are
 * no links (they open in Safari, never in the Home Screen app) and no passwords.
 *
 * Who you are (`me`) is also kept on the phone, so the app opens with no signal.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supabase = inject(SUPABASE);

  readonly me = signal<Me | null>(this.load());
  readonly signedIn = computed(() => !!this.me());

  /** When the last code was sent to each address, to tell an expired code from a wrong one. */
  private readonly sentAt = new Map<string, number>();
  private loaded: Promise<void> | null = null;

  /** Resolves once we know who is signed in. */
  ready(): Promise<void> {
    return (this.loaded ??= this.refresh());
  }

  /** Asks the server who is signed in. With no connection, keeps what the phone remembers. */
  async refresh(): Promise<void> {
    try {
      const { data, error } = await this.supabase.auth.getSession();
      if (error) return; // couldn't refresh right now (offline)
      if (!data.session) return this.forget();
      const { data: me, error: meError } = await this.supabase.rpc('me');
      if (meError) return;
      if (me) this.remember(me as Me);
    } catch {
      // offline: keep what we have
    }
  }

  /** Emails a 6-digit code. A new address gets an account when its code is verified. */
  async sendCode(email: string): Promise<SendOutcome> {
    const address = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) return 'bad_email';
    try {
      const { error } = await this.supabase.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: true },
      });
      if (!error) {
        this.sentAt.set(address, Date.now());
        return 'sent';
      }
      if (error.status === 429) return 'rate_limited';
      if (error.name === 'AuthRetryableFetchError' || navigator.onLine === false) return 'offline';
      return error.status === 400 || error.status === 422 ? 'bad_email' : 'error';
    } catch {
      return 'offline';
    }
  }

  /** Checks the typed code. On 'ok' the person is signed in and `me` is set. */
  async verify(email: string, code: string): Promise<VerifyOutcome> {
    const address = email.trim().toLowerCase();
    try {
      const { error } = await this.supabase.auth.verifyOtp({
        email: address,
        token: code,
        type: 'email',
      });
      if (error) {
        if (error.name === 'AuthRetryableFetchError' || navigator.onLine === false)
          return 'offline';
        if (error.status === 429) return 'rate_limited';
        if (error.status && error.status >= 500) return 'error';
        // Auth gives one answer for a wrong code and an old one; the clock tells them apart.
        const sent = this.sentAt.get(address);
        return sent && Date.now() - sent > CODE_LIFETIME_MS ? 'expired' : 'wrong';
      }
      this.sentAt.delete(address);
      await this.refresh();
      return this.me() ? 'ok' : 'error';
    } catch {
      return 'offline';
    }
  }

  /** Changes your own name and handicap index. */
  async saveProfile(fields: {
    display_name: string;
    handicap_index: number | null;
  }): Promise<boolean> {
    const me = this.me();
    if (!me) return false;
    try {
      const { error } = await this.supabase.from('profiles').update(fields).eq('id', me.id);
      if (error) return false;
      this.remember({ ...me, ...fields });
      return true;
    } catch {
      return false;
    }
  }

  async signOut(): Promise<void> {
    this.forget();
    try {
      await this.supabase.auth.signOut();
    } catch {
      // offline: signed out on this phone, which is what matters to the person holding it
    }
  }

  private remember(me: Me): void {
    this.me.set(me);
    try {
      localStorage.setItem(KEY, JSON.stringify(me));
    } catch {
      // storage unavailable: signed in until the app is closed
    }
  }

  private forget(): void {
    this.me.set(null);
    try {
      localStorage.removeItem(KEY);
    } catch {
      // nothing to remove
    }
  }

  private load(): Me | null {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Me | null;
      return saved?.id ? saved : null;
    } catch {
      return null;
    }
  }
}
