import { Injectable, inject, signal } from '@angular/core';
import { ADMIN_SUPABASE } from '../core/supabase';

export type SendOutcome = 'sent' | 'rate_limited' | 'offline' | 'error';
export type VerifyOutcome = 'ok' | 'wrong_code' | 'offline' | 'error';

/**
 * Organizer sign-in: an email magic link (or the 6-digit code from the same email, which is the
 * only way in from the installed home-screen app on an iPhone, where links open in Safari).
 * Owner powers come from being listed in app_admins; anyone else who signs in gets nothing.
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

  /** Emails a sign-in link and code. Never says whether the address is known. */
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

  /** Signs in with the 6-digit code from the email. */
  async verify(email: string, code: string): Promise<VerifyOutcome> {
    try {
      const { error } = await this.supabase.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) {
        if (error.name === 'AuthRetryableFetchError') return 'offline';
        return error.status && error.status < 500 ? 'wrong_code' : 'error';
      }
      await this.refresh();
      return 'ok';
    } catch {
      return 'offline';
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
