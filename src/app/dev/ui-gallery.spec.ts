import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { UiGallery } from './ui-gallery';

describe('/dev/ui', () => {
  it('shows every component twice: a light half and a dark half', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(UiGallery);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const halves = [...el.querySelectorAll<HTMLElement>('.half')];
    expect(halves.map((h) => h.dataset['theme'])).toEqual(['light', 'dark']);

    const components = [
      'ui-header-band',
      'ui-card',
      'ui-section-head',
      'ui-list-row',
      '[ui-button]',
      'ui-chip',
      'ui-badge',
      'ui-choice-pills',
      'ui-segmented',
      'ui-switch',
      'ui-checkbox',
      'ui-field',
      'ui-paid-status',
      'ui-tab-bar',
      'ui-course-card',
      'ui-itinerary-row',
      'ui-board',
      'ui-game-card',
      'ui-stepper-row',
      '[ui-name-button]',
      'ui-alert-card',
      'ui-toast',
      'ui-sheet',
      'ui-skeleton',
      'ui-live-dot',
    ];
    for (const half of halves) {
      for (const selector of components) {
        expect(
          half.querySelector(selector),
          `${selector} in ${half.dataset['theme']}`,
        ).toBeTruthy();
      }
    }
  });
});
