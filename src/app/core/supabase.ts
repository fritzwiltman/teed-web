import { InjectionToken } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

/**
 * The player's Supabase client. It keeps the phone's anonymous auth session in localStorage and
 * refreshes it, which is what keeps a player logged in across app restarts.
 */
export const SUPABASE = new InjectionToken<SupabaseClient>('supabase', {
  providedIn: 'root',
  factory: () =>
    createClient(environment.supabaseUrl, environment.supabaseKey, {
      // Magic links belong to the organizer client below; this one must not swallow them.
      auth: { detectSessionInUrl: false },
    }),
});

/**
 * The organizer's Supabase client: an email sign-in, stored under its own key. Keeping it apart
 * from the player client means an organizer can also be logged in as a player on the same phone,
 * and signing in or out of one never touches the other.
 */
export const ADMIN_SUPABASE = new InjectionToken<SupabaseClient>('admin-supabase', {
  providedIn: 'root',
  factory: () =>
    createClient(environment.supabaseUrl, environment.supabaseKey, {
      auth: { storageKey: 'teed.admin.auth', detectSessionInUrl: true },
    }),
});
