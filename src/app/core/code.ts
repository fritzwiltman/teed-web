// Login codes are six characters (K4M9QT). Codes issued before that are longer, with dashes
// (PINES-FW26-K4M9), and still work. The server ignores case, spaces and dashes.

/** The characters a new code is made of: no I, O, 0 or 1. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

const MAX_LENGTH = 32;

/**
 * A code as people see it. A six-character code is stored with a dash in the middle (K4M-9QT);
 * the dash isn't part of it, so it is shown without. Older codes are shown as they are.
 */
export function displayCode(code: string): string {
  const bare = code.replace(/-/g, '');
  return bare.length === CODE_LENGTH ? bare : code;
}

/** A code as pasted or typed, made tidy: capitals, with spaces turned into dashes. */
export function tidyCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s_–—]+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-/, '')
    .slice(0, MAX_LENGTH);
}

/** Long enough to be worth sending. */
export function looksLikeCode(raw: string): boolean {
  return raw.replace(/[^A-Za-z0-9]/g, '').length >= CODE_LENGTH;
}

/**
 * Finds the code in whatever is on the clipboard: the code alone, a join link, or the whole text
 * message. Returns '' when there is nothing that could be one.
 */
export function codeFromClipboard(text: string): string {
  const link = /\/join\/([A-Za-z0-9-]+)/.exec(text);
  if (link) return tidyCode(link[1]);
  const trimmed = text.trim();
  // The code by itself (old or new style), not a sentence that happens to be long enough.
  if (/^[A-Za-z0-9][A-Za-z0-9\s-]*$/.test(trimmed) && looksLikeCode(trimmed))
    return tidyCode(trimmed);
  return '';
}

/** One typed character for a code box: a capital letter or digit, or '' if it can't be in a code. */
export function codeChar(raw: string): string {
  const char = raw.slice(-1).toUpperCase();
  return /^[A-Z0-9]$/.test(char) ? char : '';
}
