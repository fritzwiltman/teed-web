import { Injectable, signal } from '@angular/core';

export type ThemeChoice = 'auto' | 'light' | 'dark';
const KEY = 'teed.theme';

/** Light/dark follows the phone ('auto') unless overridden. index.html applies the saved choice before first paint. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly choice = signal<ThemeChoice>(this.load());

  set(choice: ThemeChoice): void {
    this.choice.set(choice);
    if (choice === 'auto') delete document.documentElement.dataset['theme'];
    else document.documentElement.dataset['theme'] = choice;
    try {
      if (choice === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      // private browsing: the choice just won't be remembered
    }
  }

  private load(): ThemeChoice {
    try {
      const saved = localStorage.getItem(KEY);
      return saved === 'light' || saved === 'dark' ? saved : 'auto';
    } catch {
      return 'auto';
    }
  }
}
