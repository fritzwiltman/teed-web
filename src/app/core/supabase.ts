import { InjectionToken } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

/**
 * The app's one Supabase client. Everyone signs in the same way (an emailed code), and the
 * client keeps that session in localStorage and refreshes it, which is what keeps a person
 * signed in across app restarts. Sign-in is by typed code, never a link, so nothing is read
 * from the address bar.
 */
export const SUPABASE = new InjectionToken<SupabaseClient>('supabase', {
  providedIn: 'root',
  factory: () =>
    createClient(environment.supabaseUrl, environment.supabaseKey, {
      auth: { storageKey: 'teed.auth', detectSessionInUrl: false },
    }),
});
