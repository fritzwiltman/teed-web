import { Injectable, signal } from '@angular/core';

/** Where the app is running, as far as "Add to Home Screen" is concerned. */
export type InstallPlatform =
  | 'standalone' // already launched from the home screen: nothing to show
  | 'ios-safari'
  | 'ios-chrome'
  | 'ios-other' // another iOS browser or an in-app browser: send them to Safari
  | 'android'
  | 'other'; // desktop and everything else: nothing to show

export function detectPlatform(env: {
  userAgent: string;
  standalone: boolean;
  maxTouchPoints: number;
}): InstallPlatform {
  if (env.standalone) return 'standalone';
  const ua = env.userAgent;
  // iPadOS reports itself as a Mac; a Mac with a touch screen is an iPad.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && env.maxTouchPoints > 1);
  if (ios) {
    if (/CriOS/.test(ua)) return 'ios-chrome';
    if (/FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|Instagram|FBAN|FBAV|Line\//.test(ua))
      return 'ios-other';
    return 'ios-safari';
  }
  if (/Android/.test(ua)) return 'android';
  return 'other';
}

/** Chrome's install prompt event (not in the standard DOM types). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

@Injectable({ providedIn: 'root' })
export class InstallService {
  readonly platform = signal<InstallPlatform>(
    detectPlatform({
      userAgent: navigator.userAgent,
      standalone:
        (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true,
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
    }),
  );

  /** True once Android Chrome has offered a one-tap install. */
  readonly canPrompt = signal(false);
  private promptEvent: BeforeInstallPromptEvent | null = null;

  constructor() {
    // Chrome fires this early, once: the service is created at startup to catch it.
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.promptEvent = event as BeforeInstallPromptEvent;
      this.canPrompt.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.promptEvent = null;
      this.canPrompt.set(false);
      this.platform.set('standalone');
    });
  }

  async promptInstall(): Promise<void> {
    const event = this.promptEvent;
    if (!event) return;
    await event.prompt();
    await event.userChoice;
    // The event can only be used once, whatever they chose.
    this.promptEvent = null;
    this.canPrompt.set(false);
  }
}
