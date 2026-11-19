// Trip codes look like VERO-FW27-K4M9. The server ignores case, spaces and dashes, so the field
// only needs to keep what is typed tidy.

const MAX_LENGTH = 32;

/** What the code field shows for what was typed: capitals, with spaces turned into dashes. */
export function tidyCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s_–—]+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-/, '')
    .slice(0, MAX_LENGTH);
}

/** Long enough to be worth sending (the shortest real code has 9 letters and digits). */
export function looksLikeCode(raw: string): boolean {
  return raw.replace(/[^A-Za-z0-9]/g, '').length >= 6;
}
