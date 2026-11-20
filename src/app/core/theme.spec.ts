import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme';

describe('ThemeService', () => {
  const root = document.documentElement;

  beforeEach(() => {
    localStorage.clear();
    delete root.dataset['theme'];
  });

  const service = () => TestBed.inject(ThemeService);

  it('follows the phone until told otherwise', () => {
    expect(service().choice()).toBe('auto');
    expect(root.dataset['theme']).toBeUndefined();
  });

  it.each(['light', 'dark'] as const)('forces %s on <html> and remembers it', (mode) => {
    service().set(mode);
    expect(service().choice()).toBe(mode);
    expect(root.dataset['theme']).toBe(mode);
    expect(localStorage.getItem('teed.theme')).toBe(mode);
  });

  it('goes back to following the phone', () => {
    service().set('dark');
    service().set('auto');
    expect(service().choice()).toBe('auto');
    expect(root.dataset['theme']).toBeUndefined();
    expect(localStorage.getItem('teed.theme')).toBeNull();
  });

  it('starts from the saved choice', () => {
    localStorage.setItem('teed.theme', 'dark');
    expect(service().choice()).toBe('dark');
  });

  it('ignores a saved value it does not know', () => {
    localStorage.setItem('teed.theme', 'sepia');
    expect(service().choice()).toBe('auto');
  });

  it('still switches when the phone will not store anything', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      service().set('dark');
      expect(root.dataset['theme']).toBe('dark');
    } finally {
      setItem.mockRestore();
    }
  });
});
