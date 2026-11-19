import {
  formatCountdown,
  formatDateRange,
  formatDay,
  formatName,
  formatTime,
  localDate,
} from './format';

describe('format', () => {
  it('formats a round day without shifting it by time zone', () => {
    expect(formatDay('2026-10-09')).toBe('Fri, Oct 9');
  });

  it('formats trip dates', () => {
    expect(formatDateRange('2026-10-08', '2026-10-12')).toBe('Oct 8–12, 2026');
    expect(formatDateRange('2026-09-30', '2026-10-03')).toBe('Sep 30 – Oct 3, 2026');
    expect(formatDateRange('2027-01-11', '2027-01-11')).toBe('Jan 11, 2027');
  });

  it('formats tee times', () => {
    expect(formatTime('07:33:00')).toBe('7:33 AM');
    expect(formatTime('12:05:00')).toBe('12:05 PM');
    expect(formatTime('00:10:00')).toBe('12:10 AM');
    expect(formatTime(null)).toBe('');
  });

  it('formats a lockout countdown', () => {
    expect(formatCountdown(300)).toBe('5:00');
    expect(formatCountdown(61.2)).toBe('1:02');
    expect(formatCountdown(-3)).toBe('0:00');
  });

  it("gives today's date as the phone sees it", () => {
    expect(localDate(new Date(2027, 0, 5, 23, 59))).toBe('2027-01-05');
  });

  it('names formats, falling back to the key', () => {
    expect(formatName('stableford')).toBe('Net Stableford');
    expect(formatName('something_new')).toBe('something_new');
  });
});
