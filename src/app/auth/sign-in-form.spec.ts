import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AuthService, RESEND_SECONDS, SendOutcome, VerifyOutcome } from '../core/auth';
import { SignInForm } from './sign-in-form';

describe('Sign-in form', () => {
  let fixture: ComponentFixture<SignInForm>;
  let el: HTMLElement;
  let sendCode: ReturnType<typeof vi.fn<(email: string) => Promise<SendOutcome>>>;
  let verify: ReturnType<typeof vi.fn<(email: string, code: string) => Promise<VerifyOutcome>>>;
  let done: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    sendCode = vi.fn(async () => 'sent' as SendOutcome);
    verify = vi.fn(async () => 'ok' as VerifyOutcome);
    done = vi.fn();
    await TestBed.configureTestingModule({
      imports: [SignInForm],
      providers: [{ provide: AuthService, useValue: { sendCode, verify } }],
    }).compileComponents();
    fixture = TestBed.createComponent(SignInForm);
    fixture.componentInstance.done.subscribe(() => done());
    el = fixture.nativeElement;
    await fixture.whenStable();
  });

  afterEach(() => vi.useRealTimers());

  const boxes = () => [...el.querySelectorAll<HTMLInputElement>('input.box')];
  const alert = () => el.querySelector('[role=alert]')?.textContent?.trim() ?? null;
  const button = (label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.trim().startsWith(label),
    );

  async function askFor(email: string): Promise<void> {
    const input = el.querySelector<HTMLInputElement>('input[name=email]')!;
    input.value = email;
    input.dispatchEvent(new Event('input'));
    button('Email me a code')!.click();
    await fixture.whenStable();
  }

  async function type(code: string, from = 0): Promise<void> {
    for (const [i, digit] of [...code].entries()) {
      const box = boxes()[from + i];
      box.value = box.value + digit;
      box.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    }
  }

  it('starts with the email and one button', () => {
    expect(el.querySelector('input[name=email]')).toBeTruthy();
    expect(el.querySelector('input[type=password]')).toBeNull();
    expect(button('Email me a code')).toBeTruthy();
    expect(boxes()).toHaveLength(0);
  });

  it('after "Email me a code", shows where it went and six boxes', async () => {
    await askFor('Von@Example.com');
    expect(sendCode).toHaveBeenCalledWith('Von@Example.com');
    expect(el.querySelector('h1')?.textContent).toBe('Enter your code');
    expect(el.querySelector('.sent')?.textContent).toBe('Sent to von@example.com');
    expect(boxes()).toHaveLength(6);
    expect(boxes()[0].getAttribute('autocomplete')).toBe('one-time-code');
    expect(boxes()[0].getAttribute('inputmode')).toBe('numeric');
  });

  it('says why a code could not be sent, and stays on the email', async () => {
    sendCode.mockResolvedValue('bad_email');
    await askFor('von at example');
    expect(alert()).toContain("doesn't look like an email");
    expect(boxes()).toHaveLength(0);
    sendCode.mockResolvedValue('rate_limited');
    await askFor('von@example.com');
    expect(alert()).toContain('Too many codes');
  });

  it('checks the code as soon as the sixth digit is in, and signs in', async () => {
    await askFor('von@example.com');
    await type('48219');
    expect(verify).not.toHaveBeenCalled();
    await type('3', 5);
    expect(verify).toHaveBeenCalledWith('von@example.com', '482193');
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('takes digits only, and a whole code pasted or filled in from the email', async () => {
    await askFor('von@example.com');
    await type('a');
    expect(boxes()[0].value).toBe('');

    const paste = new Event('paste', { cancelable: true }) as ClipboardEvent;
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => ' 482 193 ' } });
    boxes()[0].dispatchEvent(paste);
    await fixture.whenStable();
    expect(verify).toHaveBeenCalledWith('von@example.com', '482193');

    verify.mockClear();
    boxes()[0].value = '771204';
    boxes()[0].dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(verify).toHaveBeenCalledWith('von@example.com', '771204');
  });

  it('"That code didn\'t work": the boxes go red, and both links stay', async () => {
    verify.mockResolvedValue('wrong');
    await askFor('von@example.com');
    await type('482193');
    expect(alert()).toBe("That code didn't work");
    expect(boxes().every((b) => b.getAttribute('aria-invalid') === 'true')).toBe(true);
    expect(
      boxes()
        .map((b) => b.value)
        .join(''),
    ).toBe('482193');
    expect(button('Send a new code')).toBeTruthy();
    expect(button('Change email')).toBeTruthy();
    expect(done).not.toHaveBeenCalled();

    // The next digit starts a fresh code.
    verify.mockResolvedValue('ok');
    await type('7');
    expect(alert()).toBeNull();
    expect(boxes().map((b) => b.value)).toEqual(['7', '', '', '', '', '']);
    await type('71204', 1);
    expect(verify).toHaveBeenLastCalledWith('von@example.com', '771204');
    expect(done).toHaveBeenCalled();
  });

  it('"That code expired": one button, "Email me a new code", which sends one at once', async () => {
    verify.mockResolvedValue('expired');
    await askFor('von@example.com');
    await type('482193');
    expect(alert()).toBe('That code expired');
    expect(boxes().every((b) => b.getAttribute('aria-invalid') === 'true')).toBe(true);
    expect(button('Send a new code')).toBeUndefined();
    expect(button('Change email')).toBeUndefined();

    button('Email me a new code')!.click();
    await fixture.whenStable();
    expect(sendCode).toHaveBeenCalledTimes(2);
    expect(alert()).toBeNull();
    expect(boxes().every((b) => b.value === '')).toBe(true);
  });

  it(`holds "Send a new code" for ${RESEND_SECONDS} seconds after each send`, async () => {
    await askFor('von@example.com');
    const resend = () => button('Send a new code')!;
    expect(resend().disabled).toBe(true);
    expect(resend().textContent).toContain('Send a new code in 0:30');
    resend().click();
    expect(sendCode).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(12_000);
    await fixture.whenStable();
    expect(resend().textContent).toContain('0:18');

    vi.advanceTimersByTime(19_000);
    await fixture.whenStable();
    expect(resend().disabled).toBe(false);
    expect(resend().textContent?.trim()).toBe('Send a new code');
    resend().click();
    await fixture.whenStable();
    expect(sendCode).toHaveBeenCalledTimes(2);
    expect(resend().disabled).toBe(true);
  });

  it('"Change email" goes back to the address, kept as typed', async () => {
    await askFor('von@exmaple.com');
    button('Change email')!.click();
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('input[name=email]')?.value).toBe('von@exmaple.com');
    expect(boxes()).toHaveLength(0);
  });

  it('starts with the email from an invite when there is one', async () => {
    fixture.componentRef.setInput('email', 'von@example.com');
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('input[name=email]')?.value).toBe('von@example.com');
  });

  it('says so when there is no connection, and clears the boxes for another go', async () => {
    verify.mockResolvedValue('offline');
    await askFor('von@example.com');
    await type('482193');
    expect(alert()).toContain('Check your signal');
    expect(boxes().every((b) => b.value === '')).toBe(true);
    expect(boxes()[0].getAttribute('aria-invalid')).toBeNull();
  });
});
