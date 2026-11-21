import {
  creatorInviteMessage,
  formatPhone,
  initialsFor,
  inviteLink,
  inviteMessage,
  sendText,
  smsLink,
  spectatorMessage,
  tidyPhone,
} from './sms';

describe('texting links', () => {
  it('writes the invite a player gets', () => {
    expect(inviteMessage('Fritz', 'Vero Beach 2027', 'TOKEN-1', 'https://teed.example')).toBe(
      'Fritz added you to Vero Beach 2027 on Teed. Tap to join: https://teed.example/invite/TOKEN-1',
    );
    expect(inviteMessage('', 'Vero Beach 2027', 'TOKEN-1', 'https://teed.example')).toBe(
      "You've been added to Vero Beach 2027 on Teed. Tap to join: https://teed.example/invite/TOKEN-1",
    );
  });

  it('writes the invite to plan trips', () => {
    expect(creatorInviteMessage('Fritz', 'TOKEN-2', 'https://teed.example')).toBe(
      'Fritz invited you to plan golf trips on Teed: https://teed.example/invite/TOKEN-2',
    );
  });

  it('links to the site the sender has open, so a preview texts preview links', () => {
    expect(location.origin).toMatch(/^https?:/);
    expect(inviteLink('TOKEN-1')).toBe(`${location.origin}/invite/TOKEN-1`);
    expect(spectatorMessage('Vero Beach 2027', 'SPEC')).toBe(
      `Follow Vero Beach 2027. Tap to open Teed: ${location.origin}/watch/SPEC`,
    );
  });

  it('builds an sms: link with the message, and the number when there is one', () => {
    const link = smsLink('+17725550101', 'Hello there');
    expect(link).toBe('sms:+17725550101?&body=Hello%20there');
    expect(smsLink(null, 'Hello')).toBe('sms:?&body=Hello');
  });

  it('with no number, uses the share sheet, and failing that the clipboard', async () => {
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    expect(await sendText(null, 'Hello')).toBe('opened');
    expect(share).toHaveBeenCalledWith({ text: 'Hello' });

    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    expect(await sendText(null, 'Hello')).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('Hello');

    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: vi.fn(async () => Promise.reject(new Error('AbortError'))),
    });
    expect(await sendText(null, 'Hello')).toBe('cancelled');
  });

  it('accepts phone numbers however they are typed', () => {
    expect(tidyPhone('(772) 555-0101')).toBe('+17725550101');
    expect(tidyPhone('1 772 555 0101')).toBe('+17725550101');
    expect(tidyPhone('+44 20 7946 0958')).toBe('+442079460958');
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
