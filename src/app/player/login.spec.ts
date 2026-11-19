import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { InstallPlatform, InstallService } from '../core/install';
import { RedeemOutcome, SessionService } from '../core/session';
import { Login } from './login';

describe('Login', () => {
  let fixture: ComponentFixture<Login>;
  let el: HTMLElement;
  let redeem: ReturnType<typeof vi.fn<(code: string) => Promise<RedeemOutcome>>>;
  let navigate: ReturnType<typeof vi.spyOn>;
  const platform = signal<InstallPlatform>('other');
  const canPrompt = signal(false);
  const promptInstall = vi.fn();

  beforeEach(async () => {
    platform.set('other');
    canPrompt.set(false);
    redeem = vi.fn(async () => ({ status: 'ok' }) as RedeemOutcome);
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideRouter([]),
        { provide: SessionService, useValue: { redeem, session: signal(null) } },
        { provide: InstallService, useValue: { platform, canPrompt, promptInstall } },
      ],
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(Login);
    el = fixture.nativeElement;
    await fixture.whenStable();
  });

  const field = () => el.querySelector<HTMLInputElement>('#code')!;
  const button = () => el.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const alert = () => el.querySelector('[role=alert]')?.textContent?.trim() ?? null;

  async function type(value: string): Promise<void> {
    field().value = value;
    field().dispatchEvent(new Event('input'));
    await fixture.whenStable();
  }

  async function submit(): Promise<void> {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
  }

  it('shows the wordmark, one code field and a Join trip button', () => {
    expect(el.querySelector('h1')?.textContent).toContain('Teed');
    expect(el.querySelectorAll('input')).toHaveLength(1);
    expect(button().textContent).toContain('Join trip');
    expect(button().disabled).toBe(true);
  });

  it('capitalises the code as it is typed', async () => {
    await type('pines fw26 k4m9');
    expect(field().value).toBe('PINES-FW26-K4M9');
    expect(button().disabled).toBe(false);
  });

  it('goes to trip home when the code works', async () => {
    await type('pines-fw26-k4m9');
    await submit();
    expect(redeem).toHaveBeenCalledWith('PINES-FW26-K4M9');
    expect(navigate).toHaveBeenCalledWith('/home');
    expect(alert()).toBeNull();
  });

  it('does not send something too short to be a code', async () => {
    await type('abc');
    await submit();
    expect(redeem).not.toHaveBeenCalled();
    expect(alert()).toContain('too short');
  });

  it('explains a wrong code, and clears the message when you type again', async () => {
    redeem.mockResolvedValue({ status: 'invalid_code' });
    await type('PINES-FW26-XXXX');
    await submit();
    expect(alert()).toContain("didn't work");
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(navigate).not.toHaveBeenCalled();

    await type('PINES-FW26-K4M9');
    expect(alert()).toBeNull();
  });

  it('explains a trip that is not open yet, and one that has finished', async () => {
    redeem.mockResolvedValue({ status: 'trip_not_live', tripStatus: 'draft' });
    await type('VERO-FW27-K4M9');
    await submit();
    expect(alert()).toContain("isn't open yet");

    redeem.mockResolvedValue({ status: 'trip_not_live', tripStatus: 'final' });
    await submit();
    expect(alert()).toContain('finished');
  });

  it('shows a countdown and blocks the button after too many tries', async () => {
    redeem.mockResolvedValue({ status: 'rate_limited', retryAfter: 300 });
    await type('PINES-FW26-XXXX');
    await submit();
    expect(alert()).toMatch(/Too many tries.*(5:00|4:59)/);
    expect(button().disabled).toBe(true);

    await submit();
    expect(redeem).toHaveBeenCalledTimes(1);
  });

  it('says so when there is no connection', async () => {
    redeem.mockResolvedValue({ status: 'offline' });
    await type('PINES-FW26-K4M9');
    await submit();
    expect(alert()).toContain('Check your signal');
  });

  describe('Add to Home Screen card', () => {
    const card = () => el.querySelector('app-install-card')!.textContent ?? '';

    async function on(value: InstallPlatform): Promise<void> {
      platform.set(value);
      await fixture.whenStable();
    }

    it('is hidden when running from the home screen, and on desktop', async () => {
      await on('standalone');
      expect(card().trim()).toBe('');
      await on('other');
      expect(card().trim()).toBe('');
    });

    it('shows the Share steps on iPhone Safari and iPhone Chrome', async () => {
      await on('ios-safari');
      expect(card()).toContain("Safari's toolbar");
      expect(card()).toContain('Add to Home Screen');
      await on('ios-chrome');
      expect(card()).toContain("Chrome's address bar");
    });

    it('offers one-tap Install on Android once Chrome allows it', async () => {
      await on('android');
      expect(el.querySelector('app-install-card button')).toBeNull();
      expect(card()).toContain('menu');

      canPrompt.set(true);
      await fixture.whenStable();
      el.querySelector<HTMLButtonElement>('app-install-card button')!.click();
      expect(promptInstall).toHaveBeenCalled();
    });
  });
});
