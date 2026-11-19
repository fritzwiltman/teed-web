import { detectPlatform } from './install';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15',
  ipadSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

const detect = (userAgent: string, extra: { standalone?: boolean; maxTouchPoints?: number } = {}) =>
  detectPlatform({ userAgent, standalone: false, maxTouchPoints: 0, ...extra });

describe('detectPlatform', () => {
  it('tells iPhone Safari from iPhone Chrome', () => {
    expect(detect(UA.iphoneSafari, { maxTouchPoints: 5 })).toBe('ios-safari');
    expect(detect(UA.iphoneChrome, { maxTouchPoints: 5 })).toBe('ios-chrome');
  });

  it('sends other iPhone browsers to Safari', () => {
    expect(detect(UA.iphoneFirefox, { maxTouchPoints: 5 })).toBe('ios-other');
  });

  it('recognises an iPad pretending to be a Mac', () => {
    expect(detect(UA.ipadSafari, { maxTouchPoints: 5 })).toBe('ios-safari');
    expect(detect(UA.ipadSafari, { maxTouchPoints: 0 })).toBe('other');
  });

  it('recognises Android, and shows nothing on desktop', () => {
    expect(detect(UA.androidChrome, { maxTouchPoints: 5 })).toBe('android');
    expect(detect(UA.macChrome)).toBe('other');
  });

  it('is standalone when launched from the home screen, whatever the browser', () => {
    expect(detect(UA.iphoneSafari, { standalone: true })).toBe('standalone');
    expect(detect(UA.androidChrome, { standalone: true })).toBe('standalone');
  });
});
