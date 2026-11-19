import { looksLikeCode, tidyCode } from './code';

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
