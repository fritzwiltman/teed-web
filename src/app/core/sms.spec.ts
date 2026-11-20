import {
  formatPhone,
  initialsFor,
  joinLink,
  linkMessage,
  smsLink,
  spectatorMessage,
  tidyPhone,
} from './sms';

describe('texting a join link', () => {
  it('writes the message players get', () => {
    expect(linkMessage('Vero Beach 2027', 'K4M9QT', 'https://teed.example')).toBe(
      'You’re in for Vero Beach 2027. Tap to open Teed: https://teed.example/join/K4M9QT',
    );
  });

  it('links to the site the organizer has open, so a preview texts preview links', () => {
    expect(location.origin).toMatch(/^https?:/);
    expect(linkMessage('Vero Beach 2027', 'K4M9QT')).toContain(`${location.origin}/join/K4M9QT`);
    expect(spectatorMessage('Vero Beach 2027', 'W7Q3DX')).toBe(
      `Follow Vero Beach 2027. Tap to open Teed: ${location.origin}/join/W7Q3DX`,
    );
  });

  it('puts a code issued in the old style into the link without its dashes', () => {
    expect(joinLink('pines-fw26-k4m9', 'https://teed.example')).toBe(
      'https://teed.example/join/PINESFW26K4M9',
    );
  });

  it('builds an sms: link with the number and the message filled in', () => {
    const link = smsLink('+17725550101', linkMessage('Vero Beach 2027', 'K4M9QT'));
    expect(link.startsWith('sms:+17725550101?&body=')).toBe(true);
    expect(decodeURIComponent(link.split('body=')[1])).toContain('/join/K4M9QT');
  });

  it('accepts phone numbers however they are typed', () => {
    expect(tidyPhone('(772) 555-0101')).toBe('+17725550101');
    expect(tidyPhone('1 772 555 0101')).toBe('+17725550101');
    expect(tidyPhone('+44 20 7946 0958')).toBe('+442079460958');
  });

  it('refuses things that are not phone numbers', () => {
    expect(tidyPhone('call me')).toBeNull();
    expect(tidyPhone('555-0101')).toBeNull();
    expect(tidyPhone('')).toBeNull();
  });

  it('shows US numbers the usual way', () => {
    expect(formatPhone('+17725550101')).toBe('(772) 555-0101');
    expect(formatPhone('+442079460958')).toBe('+442079460958');
  });

  it('suggests initials from a name', () => {
    expect(initialsFor('Fritz Wiltman')).toBe('FW');
    expect(initialsFor('Von')).toBe('V');
    expect(initialsFor('Mary-Jane O’Neil')).toBe('MJO');
  });
});
