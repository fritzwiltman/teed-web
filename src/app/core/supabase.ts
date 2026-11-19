import { InjectionToken } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

/**
 * The one Supabase client. It keeps the phone's auth session in localStorage and refreshes it,
 * which is what keeps a player logged in across app restarts.
 */
export const SUPABASE = new InjectionToken<SupabaseClient>('supabase', {
  providedIn: 'root',
  factory: () => createClient(environment.supabaseUrl, environment.supabaseKey),
});
