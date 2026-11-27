// Course data from OpenGolfAPI (https://opengolfapi.org): free, no key, ODbL. Anything shown or
// stored from it carries the attribution "Course data: OpenGolf" (courses.source = 'opengolfapi').

export const OPENGOLF_API = 'https://api.opengolfapi.org/v1';
export const OPENGOLF_CREDIT = 'Course data: OpenGolf';

export interface OpenGolfSearchHit {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  par: number | null;
}

export interface OpenGolfCourse {
  id: string;
  name: string;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  year_built?: number | null;
  architect?: string | null;
  description?: string | null;
  scorecard?: { hole: number; par: number }[] | null;
}

export interface OpenGolfTee {
  tee_name: string;
  tee_color: string | null;
  gender: string | null;
  course_rating: number | null;
  slope: number | null;
  yardage: number | null;
}

export interface OpenGolfHole {
  number: number;
  par: number | null;
  handicap_index: number | null;
  yardages: Record<string, number | null> | null;
}

/** A tee as the app stores it. Arrays have one entry per hole. */
export interface TeeDraft {
  id?: string;
  name: string;
  yards: number | null;
  rating: number | null;
  slope: number | null;
  par: number[];
  stroke_index: number[];
  hole_yards: (number | null)[] | null;
}

export interface CourseDraft {
  id?: string;
  name: string;
  short_name: string | null;
  location: string | null;
  architect: string | null;
  year_opened: number | null;
  description: string | null;
  website_url: string | null;
  scorecard_url: string | null;
  directions_url: string | null;
  photo_path: string | null;
  source: 'manual' | 'opengolfapi';
  source_ref: string | null;
  ratings_checked_at: string | null;
  tees: TeeDraft[];
}

/** Things the source didn't have, which someone must fill in from the scorecard. */
export interface ImportGaps {
  par: boolean;
  strokeIndex: boolean;
}

export function isPermutation(values: (number | null)[]): boolean {
  const sorted = [...values].sort((a, b) => (a ?? 0) - (b ?? 0));
  return sorted.every((v, i) => v === i + 1);
}

/**
 * A stroke index of 1, 2, 3… in hole order is what an import leaves when the source has none.
 * No real course is rated that way, so it marks "not entered yet".
 */
export function isPlaceholderIndex(strokeIndex: number[]): boolean {
  return strokeIndex.length > 1 && strokeIndex.every((v, i) => v === i + 1);
}

/** Turns OpenGolfAPI's course, tees and holes into a course draft, noting what was missing. */
/** Words in course names that are acronyms, kept in capitals. */
const ACRONYMS = new Set([
  'PGA',
  'TPC',
  'CC',
  'GC',
  'LPGA',
  'USGA',
  'RTJ',
  'ABC',
  'II',
  'III',
  'IV',
]);

/**
 * OpenGolf title-cases every word, so "PGA National" arrives as "Pga National". Known acronyms
 * go back to capitals; everything else is left as it came.
 */
export function courseName(name: string): string {
  return name.replace(/[A-Za-z]+/g, (word) =>
    ACRONYMS.has(word.toUpperCase()) ? word.toUpperCase() : word,
  );
}

export function mapOpenGolf(
  course: OpenGolfCourse,
  tees: OpenGolfTee[],
  holes: OpenGolfHole[],
): { draft: CourseDraft; gaps: ImportGaps } {
  // Some records are padded with empty filler holes after the real ones (19, 20, …: no stroke
  // index, no yardage). They carry no data, so they are dropped.
  const ordered = holes
    .filter((h) => h.handicap_index != null || Object.values(h.yardages ?? {}).some((y) => y))
    .sort((a, b) => a.number - b.number);
  const count = ordered.length || course.scorecard?.length || 18;

  const parFromHoles = ordered.map((h) => h.par);
  const parFromCard = [...(course.scorecard ?? [])]
    .sort((a, b) => a.hole - b.hole)
    .map((h) => h.par);
  const knownPar = [parFromHoles, parFromCard].find(
    (p) => p.length === count && p.every((v) => typeof v === 'number' && v >= 3 && v <= 6),
  );
  const par = (knownPar as number[] | undefined) ?? Array<number>(count).fill(4);

  const si = ordered.map((h) => h.handicap_index);
  const knownSi = si.length === count && isPermutation(si);
  const strokeIndex = knownSi ? (si as number[]) : Array.from({ length: count }, (_, i) => i + 1);

  const drafts: TeeDraft[] = tees.map((tee) => {
    const color = (tee.tee_color ?? tee.tee_name).toLowerCase();
    const yards = ordered.map((h) => h.yardages?.[color] ?? null);
    const women = (tee.gender ?? '').toLowerCase().startsWith('f');
    return {
      name: women ? `${tee.tee_name} (W)` : tee.tee_name,
      yards: tee.yardage ?? null,
      rating: tee.course_rating ?? null,
      slope: tee.slope ?? null,
      par: [...par],
      stroke_index: [...strokeIndex],
      hole_yards:
        yards.length === count && yards.every((y) => typeof y === 'number' && y > 0) ? yards : null,
    };
  });

  return {
    draft: {
      name: courseName(course.name),
      short_name: null,
      location: [course.city, course.state].filter(Boolean).join(', ') || null,
      architect: course.architect ?? null,
      year_opened: course.year_built ?? null,
      description: course.description ?? null,
      website_url: course.website ?? null,
      scorecard_url: null,
      directions_url: null,
      photo_path: null,
      source: 'opengolfapi',
      source_ref: course.id,
      ratings_checked_at: new Date().toISOString(),
      tees: drafts,
    },
    gaps: { par: !knownPar, strokeIndex: !knownSi },
  };
}

export interface TeeChange {
  tee: string;
  what: string; // 'Rating', 'Slope', 'Yards', 'Par', 'Stroke index', 'Hole yards', 'New tee', 'No longer listed'
  from: string;
  to: string;
}

/** What a fresh pull would change in the tees we have. Tees are matched by name. */
export function diffTees(current: TeeDraft[], fresh: TeeDraft[]): TeeChange[] {
  const changes: TeeChange[] = [];
  const show = (v: unknown) =>
    v === null || v === undefined
      ? '–'
      : Array.isArray(v)
        ? v.map((x) => x ?? '–').join(' ')
        : String(v);
  for (const next of fresh) {
    const now = current.find((t) => t.name.toLowerCase() === next.name.toLowerCase());
    if (!now) {
      changes.push({
        tee: next.name,
        what: 'New tee',
        from: '–',
        to: `${show(next.yards)} yds · ${show(next.rating)} / ${show(next.slope)}`,
      });
      continue;
    }
    const fields: [string, unknown, unknown][] = [
      ['Rating', now.rating, next.rating],
      ['Slope', now.slope, next.slope],
      ['Yards', now.yards, next.yards],
      ['Par', now.par, next.par],
      ['Stroke index', now.stroke_index, next.stroke_index],
      ['Hole yards', now.hole_yards, next.hole_yards],
    ];
    for (const [what, a, b] of fields) {
      // The source having nothing is not a change worth flagging.
      if (b === null || b === undefined) continue;
      if (show(a) !== show(b)) changes.push({ tee: next.name, what, from: show(a), to: show(b) });
    }
  }
  for (const now of current) {
    if (!fresh.some((t) => t.name.toLowerCase() === now.name.toLowerCase())) {
      changes.push({
        tee: now.name,
        what: 'No longer listed',
        from: `${show(now.rating)} / ${show(now.slope)}`,
        to: '–',
      });
    }
  }
  return changes;
}

/** Applies a fresh pull to the tees we have: updates matching tees in place and adds new ones. Nothing is removed. */
export function applyFresh(current: TeeDraft[], fresh: TeeDraft[]): TeeDraft[] {
  const merged = current.map((now) => {
    const next = fresh.find((t) => t.name.toLowerCase() === now.name.toLowerCase());
    if (!next) return now;
    return {
      ...now,
      yards: next.yards ?? now.yards,
      rating: next.rating ?? now.rating,
      slope: next.slope ?? now.slope,
      par: next.par,
      stroke_index: next.stroke_index,
      hole_yards: next.hole_yards ?? now.hole_yards,
    };
  });
  const added = fresh.filter(
    (next) => !current.some((t) => t.name.toLowerCase() === next.name.toLowerCase()),
  );
  return [...merged, ...added];
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${OPENGOLF_API}${path}`);
  if (!res.ok) throw new Error(`OpenGolfAPI ${res.status}`);
  return (await res.json()) as T;
}

export async function searchOpenGolf(query: string): Promise<OpenGolfSearchHit[]> {
  const data = await get<{ courses?: OpenGolfSearchHit[] }>(
    `/courses/search?q=${encodeURIComponent(query)}`,
  );
  return data.courses ?? [];
}

export async function fetchOpenGolf(id: string): Promise<{ draft: CourseDraft; gaps: ImportGaps }> {
  const [course, tees, holes] = await Promise.all([
    get<OpenGolfCourse>(`/courses/${id}`),
    get<{ tees?: OpenGolfTee[] }>(`/courses/${id}/tees`),
    get<{ holes?: OpenGolfHole[] }>(`/courses/${id}/holes`),
  ]);
  return mapOpenGolf(course, tees.tees ?? [], holes.holes ?? []);
}
