import {
  CODE_ALPHABET,
  codeChar,
  displayCode,
  codeFromClipboard,
  looksLikeCode,
  tidyCode,
} from './code';

describe('tidyCode', () => {
  it('capitalises what is typed', () => {
    expect(tidyCode('pines-fw26-k4m9')).toBe('PINES-FW26-K4M9');
  });

  it('turns spaces into dashes and drops anything else', () => {
    expect(tidyCode('pines fw26  k4m9')).toBe('PINES-FW26-K4M9');
    expect(tidyCode(' pines–fw26_k4m9!')).toBe('PINES-FW26-K4M9');
  });

  it('leaves a code typed without dashes alone (the server ignores dashes)', () => {
    expect(tidyCode('pinesfw26k4m9')).toBe('PINESFW26K4M9');
  });

  it('keeps a trailing dash while typing, and caps the length', () => {
    expect(tidyCode('pines-')).toBe('PINES-');
    expect(tidyCode('a'.repeat(100))).toHaveLength(32);
  });
});

describe('looksLikeCode', () => {
  it('needs at least six letters or digits', () => {
    expect(looksLikeCode('PINES-FW26-K4M9')).toBe(true);
    expect(looksLikeCode('AB-C-1')).toBe(false);
    expect(looksLikeCode('------')).toBe(false);
  });
});

describe('the code alphabet', () => {
  it('is 32 characters with no look-alikes', () => {
    expect(CODE_ALPHABET).toHaveLength(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    expect(CODE_ALPHABET).not.toMatch(/[IO01]/);
  });
});

describe('codeFromClipboard', () => {
  it('takes a code copied by itself, in either style', () => {
    expect(codeFromClipboard(' k4m9qt\n')).toBe('K4M9QT');
    expect(codeFromClipboard('PINES-FW26-K4M9')).toBe('PINES-FW26-K4M9');
  });

  it('finds the code in a join link or the whole text message', () => {
    expect(codeFromClipboard('https://teed.fgwilt1.workers.dev/join/K4M9QT')).toBe('K4M9QT');
    expect(
      codeFromClipboard(
        'You’re in for Vero Beach 2027. Tap to open Teed: https://teed.fgwilt1.workers.dev/join/K4M9QT',
      ),
    ).toBe('K4M9QT');
  });

  it('finds nothing in an empty clipboard or anything else', () => {
    expect(codeFromClipboard('')).toBe('');
    expect(codeFromClipboard('K4M')).toBe('');
    expect(codeFromClipboard('Dinner is at 7:30, see you there!')).toBe('');
  });
});

describe('codeChar', () => {
  it('keeps one capital letter or digit, and drops anything else', () => {
    expect(codeChar('k')).toBe('K');
    expect(codeChar('K4')).toBe('4');
    expect(codeChar('-')).toBe('');
    expect(codeChar('')).toBe('');
  });
});

describe('displayCode', () => {
  it('shows a six-character code without the dash it is stored with', () => {
    expect(displayCode('K4M-9QT')).toBe('K4M9QT');
    expect(displayCode('K4M9QT')).toBe('K4M9QT');
  });

  it('leaves a code issued in the old style as it is', () => {
    expect(displayCode('PINES-FW26-K4M9')).toBe('PINES-FW26-K4M9');
  });
});
