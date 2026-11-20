// Texting a player their join link.

import { environment } from '../../environments/environment';

/**
 * The link that logs a phone straight in. Always the production address, never the page the
 * organizer happens to be on (a preview link would install the wrong app).
 */
export function joinLink(code: string, url: string = environment.appUrl): string {
  return `${url}/join/${encodeURIComponent(code.replace(/[^A-Za-z0-9]/g, '').toUpperCase())}`;
}

/** The text a player gets. */
export function linkMessage(trip: string, code: string, url: string = environment.appUrl): string {
  return `You’re in for ${trip}. Tap to open Teed: ${joinLink(code, url)}`;
}

/** The text for sharing the spectator link. */
export function spectatorMessage(
  trip: string,
  code: string,
  url: string = environment.appUrl,
): string {
  return `Follow ${trip} live. Tap to open Teed: ${joinLink(code, url)}`;
}

/**
 * A phone number as stored: digits with an optional leading +. A 10-digit number is taken to be
 * a US one. Returns null if it can't be a phone number.
 */
export function tidyPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return null;
  if (raw.trim().startsWith('+'))
    return digits.length >= 7 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

/** '+17725550101' → '(772) 555-0101'; anything else is shown as stored. */
export function formatPhone(phone: string): string {
  const us = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return us ? `(${us[1]}) ${us[2]}-${us[3]}` : phone;
}

/** Opens the phone's Messages app with the number and text filled in ("?&" suits both iOS and Android). */
export function smsLink(phone: string, body: string): string {
  return `sms:${phone}?&body=${encodeURIComponent(body)}`;
}

/** Initials from a name: 'Fritz Wiltman' → 'FW', 'Von' → 'V'. */
export function initialsFor(name: string): string {
  return name
    .split(/[\s-]+/)
    .map((word) => word.replace(/[^A-Za-z]/g, '').charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 4);
}
