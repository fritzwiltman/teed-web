// Texting people their links.

/** The link that takes someone to their invite, on the site the sender has open. */
export function inviteLink(token: string, url: string = location.origin): string {
  return `${url}/invite/${encodeURIComponent(token)}`;
}

/** The text a player gets: "Fritz invited you to Vero Beach 2027 on Teed: <link>". */
export function inviteMessage(
  inviter: string,
  trip: string,
  token: string,
  url: string = location.origin,
): string {
  return `${inviter ? inviter + ' invited you' : "You're invited"} to ${trip} on Teed: ${inviteLink(token, url)}`;
}

/** The text someone gets who may now create trips. */
export function creatorInviteMessage(
  inviter: string,
  token: string,
  url: string = location.origin,
): string {
  return `${inviter ? inviter + ' invited you' : "You're invited"} to plan golf trips on Teed: ${inviteLink(token, url)}`;
}

/** The link for people following along without an account. */
export function spectatorLink(token: string, url: string = location.origin): string {
  return `${url}/watch/${encodeURIComponent(token)}`;
}

/** The text for sharing the spectator link. */
export function spectatorMessage(
  trip: string,
  token: string,
  url: string = location.origin,
): string {
  return `Follow ${trip}. Tap to open Teed: ${spectatorLink(token, url)}`;
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

/**
 * Opens the phone's Messages app with the text filled in, and the number too when there is one
 * ("?&" suits both iOS and Android).
 */
export function smsLink(phone: string | null, body: string): string {
  return `sms:${phone ?? ''}?&body=${encodeURIComponent(body)}`;
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

/**
 * Sends a text: to the person's number in Messages when we have it, else through the phone's
 * share sheet, else onto the clipboard. Returns how it went.
 */
export async function sendText(
  phone: string | null,
  message: string,
): Promise<'opened' | 'copied' | 'cancelled'> {
  if (phone) {
    location.href = smsLink(phone, message);
    return 'opened';
  }
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ text: message });
      return 'opened';
    }
    await navigator.clipboard.writeText(message);
    return 'copied';
  } catch {
    return 'cancelled'; // they closed the share sheet
  }
}
