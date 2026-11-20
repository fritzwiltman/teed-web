import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RedeemOutcome, SessionService } from '../core/session';
import { Login } from './login';

describe('Welcome back (signed out)', () => {
  let fixture: ComponentFixture<Login>;
  let el: HTMLElement;
  let redeem: ReturnType<typeof vi.fn<(code: string) => Promise<RedeemOutcome>>>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let readText: ReturnType<typeof vi.fn<() => Promise<string>>>;

  beforeEach(async () => {
    redeem = vi.fn(async () => ({ status: 'ok' }) as RedeemOutcome);
    readText = vi.fn(async () => 'K4M9QT');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideRouter([]),
        { provide: SessionService, useValue: { redeem, session: signal(null) } },
      ],
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(Login);
    el = fixture.nativeElement;
    await fixture.whenStable();
  });

  const boxes = () => [...el.querySelectorAll<HTMLInputElement>('input.box')];
  const pasteButton = () => el.querySelector<HTMLButtonElement>('button[ui-button]')!;
  const alert = () => el.querySelector('[role=alert]')?.textContent?.trim() ?? null;

  async function paste(): Promise<void> {
    pasteButton().click();
    await fixture.whenStable();
  }

  async function type(code: string): Promise<void> {
    for (const [i, char] of [...code].entries()) {
      boxes()[i].value = char;
      boxes()[i].dispatchEvent(new Event('input'));
      await fixture.whenStable();
    }
  }

  it('shows the wordmark, Welcome back, one big Paste my code button and six boxes', () => {
    expect(el.querySelector('.wordmark')?.textContent).toBe('teed');
    expect(el.querySelector('h1')?.textContent).toBe('Welcome back');
    expect(pasteButton().textContent).toContain('Paste my code');
    expect(boxes()).toHaveLength(6);
    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelector('a[href="/admin"]')?.textContent).toContain('Organizer sign-in');
  });

  describe('Paste my code', () => {
    it('reads the clipboard from the tap, logs in and goes to trip home', async () => {
      await paste();
      expect(readText).toHaveBeenCalledTimes(1);
      expect(redeem).toHaveBeenCalledWith('K4M9QT');
      expect(navigate).toHaveBeenCalledWith('/home');
      expect(alert()).toBeNull();
    });

    it('takes the code out of a copied link or the whole text message', async () => {
      readText.mockResolvedValue(
        'You’re in for Vero Beach 2027. Tap to open Teed: https://teed.fgwilt1.workers.dev/join/K4M9QT',
      );
      await paste();
      expect(redeem).toHaveBeenCalledWith('K4M9QT');
    });

    it('still takes a long code issued earlier', async () => {
      readText.mockResolvedValue('pines-fw26-k4m9');
      await paste();
      expect(redeem).toHaveBeenCalledWith('PINES-FW26-K4M9');
    });

    it('says so when there is no code on the clipboard, without trying one', async () => {
      readText.mockResolvedValue('Dinner is at 7:30');
      await paste();
      expect(redeem).not.toHaveBeenCalled();
      expect(alert()).toContain('no code to paste');
    });

    it('falls back to the boxes when the clipboard cannot be read', async () => {
      readText.mockRejectedValue(new Error('NotAllowedError'));
      await paste();
      expect(redeem).not.toHaveBeenCalled();
      expect(alert()).toBe('Type your code below.');
    });
  });

  describe('the six boxes', () => {
    it('capitalise each character, move on, and log in after the sixth', async () => {
      await type('k4m9q');
      expect(boxes().map((b) => b.value)).toEqual(['K', '4', 'M', '9', 'Q', '']);
      expect(redeem).not.toHaveBeenCalled();
      boxes()[5].value = 't';
      boxes()[5].dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(redeem).toHaveBeenCalledWith('K4M9QT');
      expect(navigate).toHaveBeenCalledWith('/home');
    });

    it('refuse a character that cannot be in a code', async () => {
      await type('-');
      expect(boxes()[0].value).toBe('');
    });

    it('take a whole code pasted into one of them', async () => {
      const event = new Event('paste', { cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', { value: { getData: () => 'k4m9qt' } });
      boxes()[0].dispatchEvent(event);
      await fixture.whenStable();
      expect(redeem).toHaveBeenCalledWith('K4M9QT');
    });
  });

  it('explains a wrong code, empties the boxes, and clears the message when you type again', async () => {
    redeem.mockResolvedValue({ status: 'invalid_code' });
    await type('K4M9QX');
    expect(alert()).toContain("didn't work");
    expect(boxes().every((b) => b.value === '')).toBe(true);
    expect(boxes()[0].getAttribute('aria-invalid')).toBe('true');
    expect(navigate).not.toHaveBeenCalled();

    await type('K');
    expect(alert()).toBeNull();
  });

  it('explains a trip that is not open yet, and one that has finished', async () => {
    redeem.mockResolvedValue({ status: 'trip_not_live', tripStatus: 'draft' });
    await paste();
    expect(alert()).toContain("isn't open yet");

    redeem.mockResolvedValue({ status: 'trip_not_live', tripStatus: 'final' });
    await paste();
    expect(alert()).toContain('finished');
  });

  it('shows a countdown and blocks both ways in after too many tries', async () => {
    redeem.mockResolvedValue({ status: 'rate_limited', retryAfter: 300 });
    await paste();
    expect(alert()).toMatch(/Too many tries.*(5:00|4:59)/);
    expect(pasteButton().disabled).toBe(true);
    expect(boxes().every((b) => b.disabled)).toBe(true);

    await paste();
    expect(redeem).toHaveBeenCalledTimes(1);
  });

  it('says so when there is no connection', async () => {
    redeem.mockResolvedValue({ status: 'offline' });
    await paste();
    expect(alert()).toContain('Check your signal');
  });
});
