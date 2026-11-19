// Small display helpers. Dates from the database are plain 'YYYY-MM-DD' and times 'HH:MM:SS',
// with no time zone: they mean that day and time at the course.

/** Today's date on this phone as 'YYYY-MM-DD'. */
export function localDate(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** 'Fri, Oct 9' */
export function formatDay(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(utc(date));
}

/** 'Oct 8–12, 2026' or 'Sep 30 – Oct 3, 2026' */
export function formatDateRange(start: string, end: string): string {
  const monthDay = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  const a = utc(start);
  const b = utc(end);
  const year = b.getUTCFullYear();
  if (start === end) return `${monthDay.format(a)}, ${year}`;
  if (a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === year) {
    return `${monthDay.format(a)}–${b.getUTCDate()}, ${year}`;
  }
  return `${monthDay.format(a)} – ${monthDay.format(b)}, ${year}`;
}

/** '07:33:00' → '7:33 AM' */
export function formatTime(time: string | null): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** '4:32' for a countdown. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const FORMAT_NAMES: Record<string, string> = {
  stroke: 'Net stroke play',
  stableford: 'Net Stableford',
  nassau: 'Nassau',
  sixes: 'Sixes',
  scramble: 'Scramble',
  alt_shot: 'Alternate shot',
  wolf: 'Wolf',
  nine_point: '9-point game',
  skins: 'Skins',
};

export function formatName(key: string): string {
  return FORMAT_NAMES[key] ?? key;
}
