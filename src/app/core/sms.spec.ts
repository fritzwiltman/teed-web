import { codeMessage, formatPhone, initialsFor, smsLink, spectatorMessage, tidyPhone } from './sms';

describe('texting a code', () => {
  it('writes the message players get', () => {
    expect(codeMessage('Vero Beach 2027', 'VERO-FW27-K4M9', 'https://teed.example')).toBe(
      'You’re in for Vero Beach 2027 ⛳ Your Teed code: VERO-FW27-K4M9. Open https://teed.example, add it to your Home Screen, and enter your code.',
    );
  });

  it('always links to the production address, wherever the organizer has the app open', () => {
    expect(location.origin).not.toBe('https://teed.fgwilt1.workers.dev');
    expect(codeMessage('Vero Beach 2027', 'VERO-FW27-K4M9')).toContain(
      'Open https://teed.fgwilt1.workers.dev, add it',
    );
    expect(spectatorMessage('Vero Beach 2027', 'VERO-WATCH-7Q3D')).toContain(
      'Open https://teed.fgwilt1.workers.dev and enter',
    );
  });

  it('builds an sms: link with the number and the message filled in', () => {
    const link = smsLink('+17725550101', 'Your Teed code: VERO-FW27-K4M9 ⛳');
    expect(link.startsWith('sms:+17725550101?&body=')).toBe(true);
    expect(decodeURIComponent(link.split('body=')[1])).toBe('Your Teed code: VERO-FW27-K4M9 ⛳');
  });

  it('accepts phone numbers however they are typed', () => {
    expect(tidyPhone('(772) 555-0101')).toBe('+17725550101');
    expect(tidyPhone('1 772 555 0101')).toBe('+17725550101');
    expect(tidyPhone('+44 7700 900123')).toBe('+447700900123');
  });

  it('refuses things that are not phone numbers', () => {
    expect(tidyPhone('555-0101')).toBeNull();
    expect(tidyPhone('call me')).toBeNull();
    expect(tidyPhone('')).toBeNull();
  });

  it('shows US numbers the usual way', () => {
    expect(formatPhone('+17725550101')).toBe('(772) 555-0101');
    expect(formatPhone('+447700900123')).toBe('+447700900123');
  });

  it('suggests initials from a name', () => {
    expect(initialsFor('Fritz Wiltman')).toBe('FW');
    expect(initialsFor('von')).toBe('V');
    expect(initialsFor('Mary-Kate O’Neil')).toBe('MKO');
  });
});
