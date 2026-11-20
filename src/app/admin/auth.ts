import { Injectable, inject, signal } from '@angular/core';
import { ADMIN_SUPABASE } from '../core/supabase';

export type SendOutcome = 'sent' | 'rate_limited' | 'offline' | 'error';
export type SignInOutcome = 'ok' | 'wrong' | 'rate_limited' | 'offline' | 'error';

/**
 * Organizer sign-in: email and password, or an emailed magic link (handy on a desktop; on an
 * iPhone a link opens in Safari, never in the installed app, which is why the password is the
 * main way in). Owner powers come from being listed in app_admins; anyone else who signs in
 * gets nothing.
 */
@Injectable({ providedIn: 'root' })
export class AdminAuth {
  private readonly supabase = inject(ADMIN_SUPABASE);

  /** The signed-in email, or null. */
  readonly email = signal<string | null>(null);
  /** True when the signed-in user is listed in app_admins. */
  readonly isOrganizer = signal(false);

  private loaded: Promise<void> | null = null;

  constructor() {
    this.supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        this.email.set(null);
        this.isOrganizer.set(false);
      }
    });
  }

  /** Resolves once we know who is signed in (this also completes a magic link in the address bar). */
  ready(): Promise<void> {
    return (this.loaded ??= this.refresh());
  }

  async refresh(): Promise<void> {
    try {
      const { data } = await this.supabase.auth.getSession();
      const user = data.session?.user;
      if (!user || user.is_anonymous) {
        this.email.set(null);
        this.isOrganizer.set(false);
        return;
      }
      this.email.set(user.email ?? '');
      const { data: row, error } = await this.supabase
        .from('app_admins')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!error) this.isOrganizer.set(!!row);
    } catch {
      // offline: keep whatever we knew
    }
  }

  /** Emails a sign-in link. Never says whether the address is known. */
  async send(email: string): Promise<SendOutcome> {
    try {
      const { error } = await this.supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/admin`, shouldCreateUser: false },
      });
      if (!error) return 'sent';
      if (error.status === 429) return 'rate_limited';
      if (error.name === 'AuthRetryableFetchError') return 'offline';
      // An unknown address is refused (no new accounts are created here); the screen says the same either way.
      return error.status && error.status >= 400 && error.status < 500 ? 'sent' : 'error';
    } catch {
      return 'offline';
    }
  }

  async signIn(email: string, password: string): Promise<SignInOutcome> {
    try {
      const { error } = await this.supabase.auth.signInWithPassword({ email, password });
      if (error) {
        if (error.name === 'AuthRetryableFetchError') return 'offline';
        if (error.status === 429) return 'rate_limited';
        return error.status && error.status < 500 ? 'wrong' : 'error';
      }
      await this.refresh();
      return 'ok';
    } catch {
      return 'offline';
    }
  }

  /** Sets (or changes) the signed-in organizer's password. */
  async setPassword(password: string): Promise<boolean> {
    try {
      const { error } = await this.supabase.auth.updateUser({ password });
      return !error;
    } catch {
      return false;
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.supabase.auth.signOut();
    } finally {
      this.email.set(null);
      this.isOrganizer.set(false);
    }
  }
}
