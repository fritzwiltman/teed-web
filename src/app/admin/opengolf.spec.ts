import {
  courseName,
  OpenGolfHole,
  OpenGolfTee,
  TeeDraft,
  applyFresh,
  diffTees,
  isPermutation,
  isPlaceholderIndex,
  mapOpenGolf,
} from './opengolf';

const COURSE = {
  id: 'og-1',
  name: 'Dunes At Sandridge Golf Club',
  city: 'Vero Beach',
  state: 'FL',
  website: 'http://www.sandridgegc.com/',
  year_built: 1987,
};
const PAR = [4, 5, 3, 5, 4, 3, 4, 4, 4, 4, 4, 5, 4, 3, 4, 4, 3, 5];
const SI = [11, 5, 17, 3, 9, 15, 1, 13, 7, 10, 14, 2, 12, 16, 6, 8, 18, 4];
const holes = (si: (number | null)[] = SI): OpenGolfHole[] =>
  PAR.map((par, i) => ({
    number: i + 1,
    par,
    handicap_index: si[i],
    yardages: { blue: 300 + i, white: 280 + i },
  }));
const TEES: OpenGolfTee[] = [
  {
    tee_name: 'Blue',
    tee_color: 'blue',
    gender: 'Male',
    course_rating: 69.4,
    slope: 123,
    yardage: 6114,
  },
  {
    tee_name: 'White',
    tee_color: 'white',
    gender: 'Male',
    course_rating: 66.9,
    slope: 115,
    yardage: 5571,
  },
  {
    tee_name: 'White',
    tee_color: 'white',
    gender: 'Female',
    course_rating: 73,
    slope: 130,
    yardage: 5571,
  },
  {
    tee_name: 'Red',
    tee_color: 'red',
    gender: 'Female',
    course_rating: 69.7,
    slope: 122,
    yardage: 4967,
  },
];

describe('mapOpenGolf', () => {
  it('imports the course with its source recorded for attribution and refresh', () => {
    const { draft, gaps } = mapOpenGolf(COURSE, TEES, holes());
    expect(draft).toMatchObject({
      name: 'Dunes At Sandridge Golf Club',
      location: 'Vero Beach, FL',
      year_opened: 1987,
      website_url: 'http://www.sandridgegc.com/',
      source: 'opengolfapi',
      source_ref: 'og-1',
    });
    expect(draft.ratings_checked_at).toBeTruthy();
    expect(gaps).toEqual({ par: false, strokeIndex: false });
  });

  it('imports each tee with yards, rating, slope, and par, stroke index and yards per hole', () => {
    const blue = mapOpenGolf(COURSE, TEES, holes()).draft.tees[0];
    expect(blue).toMatchObject({
      name: 'Blue',
      yards: 6114,
      rating: 69.4,
      slope: 123,
      par: PAR,
      stroke_index: SI,
    });
    expect(blue.hole_yards?.slice(0, 3)).toEqual([300, 301, 302]);
  });

  it("keeps men's and women's ratings for the same tee apart", () => {
    const names = mapOpenGolf(COURSE, TEES, holes()).draft.tees.map(
      (t) => `${t.name} ${t.rating}/${t.slope}`,
    );
    expect(names).toEqual([
      'Blue 69.4/123',
      'White 66.9/115',
      'White (W) 73/130',
      'Red (W) 69.7/122',
    ]);
  });

  it('leaves hole yards empty for a tee the source has none for', () => {
    expect(mapOpenGolf(COURSE, TEES, holes()).draft.tees[3].hole_yards).toBeNull();
  });

  it('ignores the empty filler holes some records have after the 18th', () => {
    const filler = Array.from({ length: 13 }, (_, i) => ({
      number: 19 + i,
      par: 4,
      handicap_index: null,
      yardages: {},
    }));
    const { draft, gaps } = mapOpenGolf(COURSE, TEES, [...holes(), ...filler]);
    expect(draft.tees[0].par).toEqual(PAR);
    expect(draft.tees[0].stroke_index).toEqual(SI);
    expect(gaps).toEqual({ par: false, strokeIndex: false });
  });

  it('flags a missing stroke index instead of inventing one', () => {
    const { draft, gaps } = mapOpenGolf(COURSE, TEES, holes(SI.map(() => null)));
    expect(gaps.strokeIndex).toBe(true);
    expect(isPermutation(draft.tees[0].stroke_index)).toBe(true); // a placeholder the database accepts, to be overwritten
  });

  it('recognises the placeholder later, so the course stays flagged until a real stroke index is entered', () => {
    const placeholder = mapOpenGolf(COURSE, TEES, holes(SI.map(() => null))).draft.tees[0]
      .stroke_index;
    expect(isPlaceholderIndex(placeholder)).toBe(true);
    expect(isPlaceholderIndex(SI)).toBe(false);
  });

  it('flags a stroke index that repeats a number', () => {
    expect(mapOpenGolf(COURSE, TEES, holes([1, 1, ...SI.slice(2)])).gaps.strokeIndex).toBe(true);
  });

  it('falls back to the course scorecard for par, and flags it when there is none', () => {
    const scorecard = PAR.map((par, i) => ({ hole: i + 1, par }));
    const withCard = mapOpenGolf({ ...COURSE, scorecard }, TEES, []);
    expect(withCard.draft.tees[0].par).toEqual(PAR);
    expect(withCard.gaps).toEqual({ par: false, strokeIndex: true });
    expect(mapOpenGolf(COURSE, TEES, []).gaps.par).toBe(true);
  });
});

describe('refreshing a course', () => {
  const ours = (): TeeDraft[] =>
    mapOpenGolf(COURSE, TEES, holes()).draft.tees.map((t, i) => ({ ...t, id: `tee-${i}` }));

  it('finds nothing to change when the source matches', () => {
    expect(diffTees(ours(), mapOpenGolf(COURSE, TEES, holes()).draft.tees)).toEqual([]);
  });

  it('flags changed ratings and slopes, per tee', () => {
    const rerated = TEES.map((t) =>
      t.tee_name === 'Blue' ? { ...t, course_rating: 69.8, slope: 125 } : t,
    );
    expect(diffTees(ours(), mapOpenGolf(COURSE, rerated, holes()).draft.tees)).toEqual([
      { tee: 'Blue', what: 'Rating', from: '69.4', to: '69.8' },
      { tee: 'Blue', what: 'Slope', from: '123', to: '125' },
    ]);
  });

  it('flags a new tee and one that is no longer listed', () => {
    const changed = [
      ...TEES.slice(0, 3),
      {
        tee_name: 'Gold',
        tee_color: 'gold',
        gender: 'Male',
        course_rating: 72.6,
        slope: 129,
        yardage: 6968,
      },
    ];
    const whats = diffTees(ours(), mapOpenGolf(COURSE, changed, holes()).draft.tees).map(
      (c) => `${c.tee}: ${c.what}`,
    );
    expect(whats).toEqual(['Gold: New tee', 'Red (W): No longer listed']);
  });

  it('does not flag values the source simply lacks', () => {
    const sparse = TEES.map((t) => ({ ...t, course_rating: null }));
    expect(diffTees(ours(), mapOpenGolf(COURSE, sparse, holes()).draft.tees)).toEqual([]);
  });

  it('applies changes in place, keeping our tee ids and anything the source lacks, and removes nothing', () => {
    const changed = [
      { ...TEES[0], slope: 125, course_rating: null },
      {
        tee_name: 'Gold',
        tee_color: 'gold',
        gender: 'Male',
        course_rating: 72.6,
        slope: 129,
        yardage: 6968,
      },
    ];
    const merged = applyFresh(ours(), mapOpenGolf(COURSE, changed, holes()).draft.tees);
    expect(merged.map((t) => t.name)).toEqual(['Blue', 'White', 'White (W)', 'Red (W)', 'Gold']);
    expect(merged[0]).toMatchObject({ id: 'tee-0', slope: 125, rating: 69.4 });
    expect(merged[4].id).toBeUndefined();
  });
});

describe('course names from OpenGolf', () => {
  it('keeps acronyms in capitals', () => {
    expect(courseName('Pga National Resort Palmer Course')).toBe(
      'PGA National Resort Palmer Course',
    );
    expect(courseName('Tpc Sawgrass Stadium')).toBe('TPC Sawgrass Stadium');
    expect(courseName('Forest Hills Cc')).toBe('Forest Hills CC');
    expect(courseName('Dunes At Sandridge Golf Club')).toBe('Dunes At Sandridge Golf Club');
    expect(courseName('Pinehurst No. Ii')).toBe('Pinehurst No. II');
  });
});
