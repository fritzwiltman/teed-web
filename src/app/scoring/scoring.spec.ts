import {
  HouseRules,
  NinePointError,
  RoundInput,
  RoundResult,
  Score,
  SettleError,
  Tee,
  addNets,
  courseHandicap,
  fewestPayments,
  holesInPlay,
  moneyText,
  netDoubleBogey,
  nextHole,
  ninePoint,
  ninePointNets,
  playingFor,
  playingHandicap,
  pointValueText,
  roundBoard,
  roundNets,
  roundStrokes,
  scoreRound,
  settleUp,
  splitNine,
  strokesByHole,
  strokesReceived,
  toParText,
  tripBoard,
  tripNets,
} from './index';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const total = (record: Record<string, number>) => sum(Object.values(record));

// ── Southern Pines 2026: the real tees, indexes and scores (supabase/seed/southern-pines-2026.sql) ──

const INDEX = { Fritz: 18.6, Von: 8.1, Matt: 28.7, Charlie: 19.1 };
const NAMES = Object.keys(INDEX) as (keyof typeof INDEX)[];
const SOUTHERN_PINES: Tee = {
  rating: 70.3,
  slope: 135,
  par: [4, 5, 3, 4, 5, 4, 3, 4, 3, 4, 4, 4, 4, 3, 5, 4, 4, 4],
  strokeIndex: [11, 7, 13, 3, 5, 1, 17, 9, 15, 10, 14, 2, 8, 18, 6, 16, 4, 12],
};
const MID_PINES: Tee = {
  rating: 72.3,
  slope: 138,
  par: [4, 3, 4, 4, 5, 5, 4, 3, 4, 5, 3, 4, 3, 4, 5, 4, 4, 4],
  strokeIndex: [5, 15, 7, 13, 9, 1, 3, 17, 11, 2, 18, 8, 10, 16, 12, 6, 14, 4],
};
const PINE_NEEDLES: Tee = {
  rating: 71.9,
  slope: 138,
  par: [5, 4, 3, 4, 3, 4, 4, 4, 4, 5, 4, 4, 3, 4, 5, 3, 4, 4],
  strokeIndex: [11, 5, 17, 9, 7, 1, 3, 15, 13, 4, 12, 14, 16, 2, 6, 18, 8, 10],
};
const NINETY: HouseRules = { allowance: 0.9, offLowMan: true, pickupNetDouble: true };
const FULL: HouseRules = { allowance: 1, offLowMan: true, pickupNetDouble: true };

describe('handicaps', () => {
  it('rounds to the nearest stroke, a half upward', () => {
    expect([19.4, 19.5, 19.8, 0.49, -0.5, -1.5, -1.6].map(roundStrokes)).toEqual([
      19, 20, 20, 0, 0, -1, -2,
    ]);
  });

  it('course handicap is index × slope / 113 + (rating − par), kept unrounded', () => {
    // Fritz at Southern Pines: 18.6 × 135 / 113 + (70.3 − 71) = 21.52
    expect(courseHandicap(18.6, SOUTHERN_PINES)).toBeCloseTo(21.5212, 3);
    expect(courseHandicap(8.1, MID_PINES)).toBeCloseTo(10.192, 3);
  });

  it("reproduces GHIN's course and playing handicaps (90%) for Saturday, Sunday and Monday", () => {
    const course = (tee: Tee) => NAMES.map((n) => roundStrokes(courseHandicap(INDEX[n], tee)!));
    const at = (tee: Tee) => NAMES.map((n) => playingHandicap(INDEX[n], tee, 0.9));
    expect(course(SOUTHERN_PINES)).toEqual([22, 9, 34, 22]); // Saturday, as GHIN gave them
    expect(at(SOUTHERN_PINES)).toEqual([19, 8, 30, 20]);
    expect(course(MID_PINES)).toEqual([23, 10, 35, 24]); // Sunday
    expect(at(MID_PINES)).toEqual([21, 9, 32, 21]);
    expect(course(PINE_NEEDLES)).toEqual([24, 11, 36, 24]); // Monday (par 71)
    expect(at(PINE_NEEDLES)).toEqual([21, 10, 32, 22]);
    // The allowance is taken off the unrounded course handicap: Fritz is 21.52 × 0.9 = 19.37,
    // not 22 × 0.9 = 19.8.
    expect(playingHandicap(18.6, SOUTHERN_PINES, 0.9)).toBe(19);
  });

  it('at 100% the playing handicap is the rounded course handicap', () => {
    expect(NAMES.map((n) => playingHandicap(INDEX[n], SOUTHERN_PINES, 1))).toEqual([22, 9, 34, 22]);
  });

  it('takes strokes off the low man, as on the old site', () => {
    expect(strokesReceived([19, 8, 30, 20], true)).toEqual([11, 0, 22, 12]); // Saturday
    expect(strokesReceived([21, 9, 32, 21], true)).toEqual([12, 0, 23, 12]); // Sunday
    expect(strokesReceived([19, 8, 30, 20], false)).toEqual([19, 8, 30, 20]);
    expect(strokesReceived([-2, 3, 10], true)).toEqual([0, 5, 12]); // a plus handicap is the low man
  });

  it('never fills in a missing index or missing ratings', () => {
    const noIndex = { id: 'x', name: 'Dad', index: null };
    expect(playingFor(noIndex, SOUTHERN_PINES, FULL, '18')).toBeNull();
    expect(courseHandicap(10, { ...SOUTHERN_PINES, slope: null })).toBeNull();
    expect(strokesReceived([10, null, 4], true)).toEqual([6, null, 0]);
  });

  it('uses a recorded playing handicap as is, and otherwise works it out', () => {
    // Friday at Tot Hill Farm is the one day the trip's recorded numbers differ from the
    // formula: Von was played off 8, and the formula gives 7.
    const totHill: Tee = {
      ...SOUTHERN_PINES,
      rating: 70.6,
      slope: 135,
      par: Array<number>(18).fill(4),
    };
    const von = { id: 'v', name: 'Von', index: 8.1 };
    expect(playingFor(von, totHill, NINETY, '18')).toBe(7);
    expect(playingFor({ ...von, storedPlaying: 8 }, totHill, NINETY, '18')).toBe(8);
  });

  it('plays half the handicap, rounded, over nine holes', () => {
    const player = (index: number) => ({ id: 'p', name: 'P', index });
    expect(playingFor(player(18.6), SOUTHERN_PINES, FULL, 'front')).toBe(11); // 22 / 2
    expect(playingFor(player(8.1), SOUTHERN_PINES, FULL, 'back')).toBe(5); // 9 / 2 = 4.5, up
  });
});

describe('strokes by hole', () => {
  const holes = holesInPlay('18', SOUTHERN_PINES);
  const on = (strokes: number, list = holes, tee = SOUTHERN_PINES) =>
    list.map((h) => strokesByHole(strokes, list, tee).get(h));

  it('gives them to the hardest holes first', () => {
    // Fritz's 11 on Saturday: the holes with stroke index 1 to 11.
    expect(on(11)).toEqual(SOUTHERN_PINES.strokeIndex.map((si) => (si <= 11 ? 1 : 0)));
    expect(sum(on(11) as number[])).toBe(11);
    expect(on(0).every((n) => n === 0)).toBe(true);
  });

  it('wraps past 18: Matt gets 22, one everywhere and two on the four hardest', () => {
    expect(on(22)).toEqual(SOUTHERN_PINES.strokeIndex.map((si) => (si <= 4 ? 2 : 1)));
    expect(sum(on(22) as number[])).toBe(22);
    expect(on(36).every((n) => n === 2)).toBe(true);
    expect(sum(on(40) as number[])).toBe(40);
  });

  it('a plus handicap gives strokes back on the easiest holes', () => {
    expect(on(-2)).toEqual(SOUTHERN_PINES.strokeIndex.map((si) => (si >= 17 ? -1 : 0)));
  });

  it('on nine holes, ranks the nine among themselves', () => {
    const front = holesInPlay('front', SOUTHERN_PINES);
    const back = holesInPlay('back', SOUTHERN_PINES);
    expect(front).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(back).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    // Front nine stroke indexes 11,7,13,3,5,1,17,9,15: three strokes go to holes 6, 4 and 5.
    expect(on(3, front)).toEqual([0, 0, 0, 1, 1, 1, 0, 0, 0]);
    // Eleven strokes over nine holes: one each, and a second on the two hardest (6 and 4).
    expect(on(11, front)).toEqual([1, 1, 1, 2, 1, 2, 1, 1, 1]);
    // Back nine 10,14,2,8,18,6,16,4,12: two strokes go to holes 12 and 17.
    expect(on(2, back)).toEqual([0, 0, 1, 0, 0, 0, 0, 1, 0]);
  });

  it('knows where a player picks up', () => {
    expect(netDoubleBogey(4, 0)).toBe(6);
    expect(netDoubleBogey(4, 2)).toBe(8);
    expect(netDoubleBogey(3, -1)).toBe(4);
  });
});

describe('net stroke play: Southern Pines 2026, Monday at Pine Needles', () => {
  // GHIN's playing handicaps for the day (21, 10, 32, 22) are recorded with the round.
  const stored = { Fritz: 21, Von: 10, Matt: 32, Charlie: 22 };
  const gross = {
    Fritz: [6, 5, 3, 5, 5, 5, 6, 6, 5, 7, 5, 6, 4, 6, 7, 4, 7, 6],
    Von: [6, 5, 4, 4, 4, 4, 4, 4, 4, 4, 6, 5, 3, 5, 5, 4, 6, 5],
    Matt: [7, 5, 6, 6, 6, 6, 5, 7, 7, 7, 8, 6, 3, 8, 9, 4, 6, 6],
    Charlie: [8, 5, 5, 5, 5, 7, 6, 6, 7, 8, 8, 5, 3, 5, 7, 3, 6, 6],
  };
  const input = (rules: HouseRules): RoundInput => ({
    id: 'r4',
    number: 4,
    holes: '18',
    status: 'final',
    tee: PINE_NEEDLES,
    rules,
    players: NAMES.map((n) => ({ id: n, name: n, index: INDEX[n], storedPlaying: stored[n] })),
    scores: NAMES.flatMap((n) =>
      gross[n].map((strokes, i) => ({ playerId: n, hole: i + 1, strokes })),
    ),
    formats: [{ key: 'stroke', settings: {} }],
  });
  const by = (round: RoundResult) => Object.fromEntries(round.players.map((p) => [p.id, p]));

  it('reproduces the old site: strokes, gross and net (capped at net double bogey)', () => {
    const round = scoreRound(input(NINETY));
    const p = by(round);
    expect(NAMES.map((n) => p[n].strokes)).toEqual([11, 0, 22, 12]);
    expect(NAMES.map((n) => p[n].gross)).toEqual([98, 82, 112, 105]);
    expect(NAMES.map((n) => p[n].net)).toEqual([87, 82, 88, 91]);
    expect(NAMES.map((n) => p[n].toPar)).toEqual([16, 11, 17, 20]); // par 71
    expect(round.state).toBe('final');
    expect(round.games).toEqual([]);
  });

  it('without the pickup rule, every stroke counts', () => {
    const p = by(scoreRound(input({ ...NINETY, pickupNetDouble: false })));
    expect(NAMES.map((n) => p[n].net)).toEqual([87, 82, 90, 93]);
  });

  it('draws the board best net first', () => {
    const board = roundBoard(scoreRound(input(NINETY)), 'Fritz');
    expect(board.columns).toEqual(['Gross', 'Net', 'To par', 'Thru']);
    expect(board.rows.map((r) => [r.pos, r.name, ...r.cells])).toEqual([
      ['1', 'Von', '82', '82', '+11', '18'],
      ['2', 'Fritz', '98', '87', '+16', '18'],
      ['3', 'Matt', '112', '88', '+17', '18'],
      ['4', 'Charlie', '105', '91', '+20', '18'],
    ]);
    expect(board.rows.map((r) => r.me)).toEqual([false, true, false, false]);
  });
});

describe('the 9-point split', () => {
  it('all different: 5-3-1', () => {
    expect(splitNine([4, 5, 6])).toEqual([5, 3, 1]);
    expect(splitNine([6, 4, 5])).toEqual([1, 5, 3]);
    expect(splitNine([5, 7, 3])).toEqual([3, 1, 5]);
  });
  it('two tied for low: 4-4-1', () => {
    expect(splitNine([4, 4, 5])).toEqual([4, 4, 1]);
    expect(splitNine([4, 6, 4])).toEqual([4, 1, 4]);
  });
  it('two tied for second: 5-2-2', () => {
    expect(splitNine([4, 5, 5])).toEqual([5, 2, 2]);
    expect(splitNine([6, 3, 6])).toEqual([2, 5, 2]);
  });
  it('all three tied: 3-3-3', () => {
    expect(splitNine([4, 4, 4])).toEqual([3, 3, 3]);
  });
  it('always hands out nine', () => {
    for (let a = 2; a <= 8; a++)
      for (let b = 2; b <= 8; b++)
        for (let c = 2; c <= 8; c++) expect(sum(splitNine([a, b, c]))).toBe(9);
  });
});

// ── A full round of the 9-point game, worked by hand ─────────────────────────
//
// Par 4 everywhere, stroke index = hole number, rating 72 and slope 113, so a course handicap is
// the index. Me 10.0, Dad 20.0, Brother 10.0, at 100% off the low man: Dad gets 10 strokes, one
// on each of holes 1 to 10; Me and Brother get none.
//
//  hole  gross Me/Dad/Bro   net Me/Dad/Bro   points Me/Dad/Bro
//   1–4      4 / 6 / 6        4 / 5 / 6          5 / 3 / 1      (×4)
//   5–7      4 / 7 / 5        4 / 6 / 5          5 / 1 / 3      (×3)
//   8–9      4 / 5 / 4        4 / 4 / 4          3 / 3 / 3      (×2)   Out: 41 / 21 / 19 = 81
//   10       6 / 5 / 5        6 / 4 / 5          1 / 5 / 3
//   11       6 / 4 / 5        6 / 4 / 5          1 / 5 / 3
//   12–13    6 / 5 / 4        6 / 5 / 4          1 / 3 / 5      (×2)
//   14       4 / 4 / 5        4 / 4 / 5          4 / 4 / 1      two tied for low
//   15       5 / 5 / 4        5 / 5 / 4          2 / 2 / 5      two tied for second
//   16       4 / 5 / 5        4 / 5 / 5          5 / 2 / 2      two tied for second
//   17       5 / 4 / 4        5 / 4 / 4          1 / 4 / 4      two tied for low
//   18       4 / 4 / 4        4 / 4 / 4          3 / 3 / 3      In: 19 / 31 / 31 = 81
//
//  Total points: Me 60, Dad 52, Brother 50 = 162.
//  Gross: Me 82, Dad 96, Brother 87. Net: Me 82, Dad 86, Brother 87.
//  At 50¢ against 54: Me +6 = +$3.00, Dad −2 = −$1.00, Brother −4 = −$2.00.
//  Payments: Brother pays Me $2.00, Dad pays Me $1.00.

const FLAT: Tee = {
  rating: 72,
  slope: 113,
  par: Array<number>(18).fill(4),
  strokeIndex: Array.from({ length: 18 }, (_, i) => i + 1),
};
const GROSS: Record<string, number[]> = {
  me: [4, 4, 4, 4, 4, 4, 4, 4, 4, 6, 6, 6, 6, 4, 5, 4, 5, 4],
  dad: [6, 6, 6, 6, 7, 7, 7, 5, 5, 5, 4, 5, 5, 4, 5, 5, 4, 4],
  bro: [6, 6, 6, 6, 5, 5, 5, 4, 4, 5, 5, 4, 4, 5, 4, 5, 4, 4],
};
const POINTS: Record<string, number[]> = {
  me: [5, 5, 5, 5, 5, 5, 5, 3, 3, 1, 1, 1, 1, 4, 2, 5, 1, 3],
  dad: [3, 3, 3, 3, 1, 1, 1, 3, 3, 5, 5, 3, 3, 4, 2, 2, 4, 3],
  bro: [1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 3, 5, 5, 1, 5, 2, 4, 3],
};
const TRIO = [
  { id: 'me', name: 'Fritz', index: 10 },
  { id: 'dad', name: 'Dad', index: 20 },
  { id: 'bro', name: 'Brother', index: 10 },
];
const NAME_OF = { me: 'Fritz', dad: 'Dad', bro: 'Brother' };

function scoresFor(
  holes: number[],
  skip: (id: string, hole: number) => boolean = () => false,
): Score[] {
  return Object.keys(GROSS).flatMap((id) =>
    holes
      .filter((hole) => !skip(id, hole))
      .map((hole) => ({ playerId: id, hole, strokes: GROSS[id][hole - 1] })),
  );
}

function ninePointRound(over: Partial<RoundInput> = {}, cents: number | null = 50): RoundInput {
  return {
    id: 'r1',
    number: 1,
    holes: '18',
    status: 'scheduled',
    tee: FLAT,
    rules: FULL,
    players: TRIO,
    scores: scoresFor(holesInPlay('18', FLAT)),
    formats: [
      { key: 'stroke', settings: {} },
      { key: 'nine_point', settings: cents == null ? {} : { point_value_cents: cents } },
    ],
    ...over,
  };
}

/** Every counted hole is 9 points, a finished nine 81, a finished round 162. */
function expectTotalsAddUp(round: RoundResult): void {
  const game = round.games.find((g) => g.key === 'nine_point')!;
  const counted = round.holes.filter((h) => h.games.length);
  for (const hole of counted) expect(total(hole.games[0].values)).toBe(9);
  const front = counted.filter((h) => h.hole <= 9).length;
  const back = counted.filter((h) => h.hole > 9).length;
  expect(total(game.out)).toBe(9 * front);
  expect(total(game.in)).toBe(9 * back);
  expect(total(game.total)).toBe(9 * counted.length);
  expect(game.holesCounted).toBe(counted.length);
  if (game.settle) expect(total(game.settle.nets)).toBe(0);
}

describe('a full 18 of the 9-point game, worked by hand', () => {
  const round = scoreRound(ninePointRound());
  const game = round.games[0];

  it('gives Dad his ten strokes on holes 1 to 10', () => {
    expect(round.players.map((p) => [p.playing, p.strokes])).toEqual([
      [10, 0],
      [20, 10],
      [10, 0],
    ]);
    expect(round.holes.map((h) => h.received['dad'])).toEqual([
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('splits every hole as the table says', () => {
    for (const id of ['me', 'dad', 'bro'])
      expect(round.holes.map((h) => h.games[0].values[id])).toEqual(POINTS[id]);
  });

  it('adds up: 81 out, 81 in, 162 in all', () => {
    expect(game.out).toEqual({ me: 41, dad: 21, bro: 19 });
    expect(game.in).toEqual({ me: 19, dad: 31, bro: 31 });
    expect(game.total).toEqual({ me: 60, dad: 52, bro: 50 });
    expect(total(game.out)).toBe(81);
    expect(total(game.in)).toBe(81);
    expect(total(game.total)).toBe(162);
    expectTotalsAddUp(round);
  });

  it('has the gross and net totals', () => {
    expect(round.players.map((p) => [p.gross, p.net, p.toPar, p.thru])).toEqual([
      [82, 82, 10, 18],
      [96, 86, 14, 18],
      [87, 87, 15, 18],
    ]);
    expect(round.state).toBe('complete');
    expect(nextHole(round)).toBeNull();
  });

  it('settles at 50¢ a point: Me +$3.00, Dad −$1.00, Brother −$2.00', () => {
    expect(game.settle).toEqual({
      pointValueCents: 50,
      nets: { me: 300, dad: -100, bro: -200 },
      payments: [
        { from: 'bro', to: 'me', cents: 200 },
        { from: 'dad', to: 'me', cents: 100 },
      ],
    });
  });

  it('words it for whoever is looking', () => {
    const nets = roundNets(round)!;
    expect(settleUp(nets, NAME_OF, 'me')).toEqual({
      nets: [
        { name: 'Fritz', text: '+$3.00', me: true },
        { name: 'Dad', text: '−$1.00', me: false },
        { name: 'Brother', text: '−$2.00', me: false },
      ],
      payments: ['Brother pays you $2.00', 'Dad pays you $1.00'],
    });
    expect(settleUp(nets, NAME_OF, 'bro').payments).toEqual([
      'You pay Fritz $2.00',
      'Dad pays Fritz $1.00',
    ]);
    expect(settleUp(nets, NAME_OF).payments).toEqual([
      'Brother pays Fritz $2.00',
      'Dad pays Fritz $1.00',
    ]);
  });

  it('puts the points on the board', () => {
    const board = roundBoard(round, 'dad');
    expect(board.columns).toEqual(['Gross', 'Net', 'To par', 'Thru', 'Pts']);
    expect(board.rows.map((r) => [r.pos, r.name, ...r.cells])).toEqual([
      ['1', 'Fritz', '82', '82', '+10', '18', '60'],
      ['2', 'Dad', '96', '86', '+14', '18', '52'],
      ['3', 'Brother', '87', '87', '+15', '18', '50'],
    ]);
  });

  it('other point values: 25¢ and $1', () => {
    const quarter = scoreRound(ninePointRound({}, 25)).games[0].settle!;
    expect(quarter.nets).toEqual({ me: 150, dad: -50, bro: -100 });
    const dollar = scoreRound(ninePointRound({}, 100)).games[0].settle!;
    expect(dollar.nets).toEqual({ me: 600, dad: -200, bro: -400 });
    expect(total(quarter.nets)).toBe(0);
    expect(total(dollar.nets)).toBe(0);
  });

  it('with no point value there are points but no money', () => {
    const free = scoreRound(ninePointRound({}, null));
    expect(free.games[0].total).toEqual({ me: 60, dad: 52, bro: 50 });
    expect(free.games[0].settle).toBeNull();
    expect(roundNets(free)).toBeNull();
    expectTotalsAddUp(free);
  });
});

describe('picking up in the 9-point game', () => {
  // Hole 12: par 4, nobody gets a stroke there, so net double bogey is 6 for all three.
  // A pickup is saved as 6 strokes and marked; it ranks below anyone who finished the hole.
  type Entry = [strokes: number, pickedUp?: boolean];
  const hole12 = (me: Entry, dad: Entry, bro: Entry) => {
    const round = scoreRound(
      ninePointRound({
        scores: [
          { playerId: 'me', hole: 12, strokes: me[0], pickedUp: me[1] },
          { playerId: 'dad', hole: 12, strokes: dad[0], pickedUp: dad[1] },
          { playerId: 'bro', hole: 12, strokes: bro[0], pickedUp: bro[1] },
        ],
      }),
    );
    expectTotalsAddUp(round);
    return round;
  };
  const points = (round: RoundResult) => round.holes[11].games[0].values;

  it('a pickup against a real net double bogey: the one who finished wins', () => {
    // Me holes out for 6; Dad picks up (also 6 on the card). Not a tie for second.
    const round = hole12([6], [6, true], [4]);
    expect(points(round)).toEqual({ bro: 5, me: 3, dad: 1 });
    expect(round.holes[11].pickedUp).toEqual({ me: false, dad: true, bro: false });
  });

  it('a pickup against a real net triple: the one who finished still wins', () => {
    // Me holes out for 7, more than the 6 Dad's pickup is saved as.
    expect(points(hole12([7], [6, true], [4]))).toEqual({ bro: 5, me: 3, dad: 1 });
  });

  it('two pickups tie with each other: 5-2-2', () => {
    expect(points(hole12([4], [6, true], [6, true]))).toEqual({ me: 5, dad: 2, bro: 2 });
    // Even when the finisher made a 9.
    expect(points(hole12([9], [6, true], [6, true]))).toEqual({ me: 5, dad: 2, bro: 2 });
  });

  it('all three pick up: 3-3-3', () => {
    expect(points(hole12([6, true], [6, true], [6, true]))).toEqual({ me: 3, dad: 3, bro: 3 });
  });

  it('ranks finishers by their actual net, not capped: a 7 loses to a 6', () => {
    expect(points(hole12([7], [6], [4]))).toEqual({ bro: 5, dad: 3, me: 1 });
    expect(points(hole12([8], [7], [9]))).toEqual({ dad: 5, me: 3, bro: 1 });
  });

  it('net stroke totals keep the net double bogey cap', () => {
    const round = hole12([7], [6, true], [9]);
    expect(round.players.map((p) => [p.gross, p.net])).toEqual([
      [7, 6],
      [6, 6],
      [9, 6],
    ]);
  });

  it('a pickup on a stroke hole is saved at par + 2 + the stroke, and still ranks last', () => {
    // Hole 1: Dad gets a stroke, so his pickup is 7. Me makes a real 7 (net 7); Brother 4.
    const round = scoreRound(
      ninePointRound({
        scores: [
          { playerId: 'me', hole: 1, strokes: 7 },
          { playerId: 'dad', hole: 1, strokes: 7, pickedUp: true },
          { playerId: 'bro', hole: 1, strokes: 4 },
        ],
      }),
    );
    expect(round.holes[0].games[0].values).toEqual({ bro: 5, me: 3, dad: 1 });
    expectTotalsAddUp(round);
  });
});

describe('a round in progress', () => {
  it('only counts holes all three have finished', () => {
    // Brother has not putted out on 18.
    const round = scoreRound(
      ninePointRound({
        scores: scoresFor(holesInPlay('18', FLAT), (id, h) => id === 'bro' && h === 18),
      }),
    );
    const game = round.games[0];
    expect(round.state).toBe('live');
    expect(nextHole(round)).toBe(18);
    expect(round.holes[17].complete).toBe(false);
    expect(round.holes[17].games).toEqual([]);
    expect(game.holesCounted).toBe(17);
    expect(game.total).toEqual({ me: 57, dad: 49, bro: 47 });
    expect(total(game.total)).toBe(153); // 17 × 9
    // Against 3 × 17 = 51: +6, −2, −4.
    expect(game.settle!.nets).toEqual({ me: 300, dad: -100, bro: -200 });
    expectTotalsAddUp(round);
  });

  it('a hole in the middle left unfinished does not count, and is the next to score', () => {
    const round = scoreRound(
      ninePointRound({ scores: scoresFor([1, 2, 3, 4, 5, 6], (id, h) => id === 'dad' && h === 3) }),
    );
    const game = round.games[0];
    expect(nextHole(round)).toBe(3);
    expect(game.holesCounted).toBe(5);
    expect(game.total).toEqual({ me: 25, dad: 11, bro: 9 }); // holes 1, 2, 4 (5-3-1) and 5, 6 (5-1-3)
    expect(game.settle!.nets).toEqual({ me: 500, dad: -200, bro: -300 }); // against 15
    expect(round.players.map((p) => p.thru)).toEqual([6, 5, 6]);
    expectTotalsAddUp(round);
  });

  it('before anyone has a score, nobody owes anything', () => {
    const round = scoreRound(ninePointRound({ scores: [] }));
    expect(round.state).toBe('scheduled');
    expect(nextHole(round)).toBe(1);
    expect(round.games[0].settle!.nets).toEqual({ me: 0, dad: 0, bro: 0 });
    expect(round.games[0].settle!.payments).toEqual([]);
    expect(roundBoard(round).rows.map((r) => [r.pos, ...r.cells])).toEqual([
      ['–', '–', '–', '–', '–', '–'],
      ['–', '–', '–', '–', '–', '–'],
      ['–', '–', '–', '–', '–', '–'],
    ]);
    expectTotalsAddUp(round);
  });

  it('a final round says so', () => {
    expect(scoreRound(ninePointRound({ status: 'final' })).state).toBe('final');
  });
});

describe('a nine-hole round', () => {
  // Front nine. Dad's 20 becomes 10 for nine holes, Me and Brother 5: Dad gets 5 strokes, on
  // the five hardest of the nine (holes 1 to 5).
  //  hole  gross Me/Dad/Bro   net Me/Dad/Bro   points
  //   1–4      4 / 6 / 6        4 / 5 / 6        5 / 3 / 1   (×4)
  //   5        4 / 7 / 5        4 / 6 / 5        5 / 1 / 3
  //   6–7      4 / 7 / 5        4 / 7 / 5        5 / 1 / 3   (×2: the game ranks the actual 7)
  //   8–9      4 / 5 / 4        4 / 5 / 4        4 / 1 / 4   (×2: no stroke for Dad now)
  //  Total: Me 43, Dad 17, Brother 21 = 81. Against 27: +16, −10, −6.
  const round = scoreRound(
    ninePointRound({ holes: 'front', scores: scoresFor([1, 2, 3, 4, 5, 6, 7, 8, 9]) }),
  );
  const game = round.games[0];

  it('plays nine holes with half the handicap', () => {
    expect(round.holes.map((h) => h.hole)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(round.players.map((p) => [p.playing, p.strokes])).toEqual([
      [5, 0],
      [10, 5],
      [5, 0],
    ]);
    expect(round.holes.map((h) => h.received['dad'])).toEqual([1, 1, 1, 1, 1, 0, 0, 0, 0]);
    expect(round.state).toBe('complete');
  });

  it('adds up to 81', () => {
    expect(game.total).toEqual({ me: 43, dad: 17, bro: 21 });
    expect(game.out).toEqual(game.total);
    expect(game.in).toEqual({ me: 0, dad: 0, bro: 0 });
    expect(total(game.total)).toBe(81);
    expectTotalsAddUp(round);
  });

  it('settles against 27', () => {
    expect(game.settle!.nets).toEqual({ me: 800, dad: -500, bro: -300 });
    expect(game.settle!.payments).toEqual([
      { from: 'dad', to: 'me', cents: 500 },
      { from: 'bro', to: 'me', cents: 300 },
    ]);
  });

  it('a back nine counts as the In side', () => {
    const back = scoreRound(
      ninePointRound({ holes: 'back', scores: scoresFor([10, 11, 12, 13, 14, 15, 16, 17, 18]) }),
    );
    expect(back.holes.map((h) => h.hole)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(total(back.games[0].in)).toBe(81);
    expect(total(back.games[0].out)).toBe(0);
    expectTotalsAddUp(back);
  });
});

describe('settling up', () => {
  it('is against 3 points a hole, and always sums to zero', () => {
    expect(ninePointNets({ a: 60, b: 52, c: 50 }, 18, 50)).toEqual({ a: 300, b: -100, c: -200 });
    expect(ninePointNets({ a: 54, b: 54, c: 54 }, 18, 100)).toEqual({ a: 0, b: 0, c: 0 });
    expect(ninePointNets({ a: 5, b: 2, c: 2 }, 1, 25)).toEqual({ a: 50, b: -25, c: -25 });
    for (const cents of [25, 50, 100])
      expect(total(ninePointNets({ a: 71, b: 49, c: 42 }, 18, cents))).toBe(0);
  });

  it('refuses points that do not match the holes played', () => {
    expect(() => ninePointNets({ a: 60, b: 52, c: 51 }, 18, 50)).toThrow(SettleError);
  });

  it('all square: nobody pays', () => {
    expect(fewestPayments({ a: 0, b: 0, c: 0 })).toEqual([]);
  });

  it('one winner: the other two each pay him', () => {
    expect(fewestPayments({ me: 300, dad: -100, bro: -200 })).toEqual([
      { from: 'bro', to: 'me', cents: 200 },
      { from: 'dad', to: 'me', cents: 100 },
    ]);
  });

  it('one loser: he pays the other two', () => {
    expect(fewestPayments({ me: 125, dad: 75, bro: -200 })).toEqual([
      { from: 'bro', to: 'me', cents: 125 },
      { from: 'bro', to: 'dad', cents: 75 },
    ]);
  });

  it('two tied on money, and one man square', () => {
    expect(fewestPayments({ me: 100, dad: 100, bro: -200 })).toEqual([
      { from: 'bro', to: 'me', cents: 100 },
      { from: 'bro', to: 'dad', cents: 100 },
    ]);
    expect(fewestPayments({ me: 150, dad: 0, bro: -150 })).toEqual([
      { from: 'bro', to: 'me', cents: 150 },
    ]);
  });

  it('adds a trip of rounds up and reduces once, not round by round', () => {
    // Four rounds; who is up changes every day.
    const rounds = [
      { me: 300, dad: -100, bro: -200 },
      { me: -500, dad: 400, bro: 100 },
      { me: 250, dad: -125, bro: -125 },
      { me: 1400, dad: 25, bro: -1425 },
    ];
    const totals = addNets(rounds);
    expect(totals).toEqual({ me: 1450, dad: 200, bro: -1650 });
    expect(total(totals)).toBe(0);
    // Eight payments if settled daily; two for the trip.
    expect(fewestPayments(totals)).toEqual([
      { from: 'bro', to: 'me', cents: 1450 },
      { from: 'bro', to: 'dad', cents: 200 },
    ]);
    expect(settleUp(totals, NAME_OF, 'me').payments).toEqual([
      'Brother pays you $14.50',
      'Brother pays Dad $2.00',
    ]);
  });

  it('never needs more payments than players minus one', () => {
    const nets = { a: 700, b: -300, c: 250, d: -650, e: 0 };
    const payments = fewestPayments(nets);
    expect(payments.length).toBeLessThanOrEqual(4);
    const after: Record<string, number> = { ...nets };
    for (const p of payments) {
      after[p.from] += p.cents;
      after[p.to] -= p.cents;
    }
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
  });

  it('refuses money that does not balance', () => {
    expect(() => fewestPayments({ a: 100, b: -50 })).toThrow(SettleError);
  });
});

describe('the trip', () => {
  const first = scoreRound(ninePointRound());
  // Round 2 at $1: the front nine only so far.
  const second = scoreRound(
    ninePointRound({ id: 'r2', number: 2, scores: scoresFor([1, 2, 3, 4, 5, 6, 7, 8, 9]) }, 100),
  );
  const third = scoreRound(ninePointRound({ id: 'r3', number: 3, scores: [] }));

  it('adds the rounds up', () => {
    const board = tripBoard([first, second, third], 'me');
    expect(board.columns).toEqual(['Rounds', 'Gross', 'Net', 'To par', 'Pts']);
    // Round 2, front nine: Me 36 (E), Dad gross 55 net 46 (+10), Brother 47 (+11); 41 / 21 / 19 points.
    expect(board.rows.map((r) => [r.pos, r.name, ...r.cells])).toEqual([
      ['1', 'Fritz', '2', '118', '118', '+10', '101'],
      ['2', 'Dad', '2', '151', '132', '+24', '73'],
      ['3', 'Brother', '2', '134', '134', '+26', '69'],
    ]);
  });

  it('settles the trip: every round’s nets, then the fewest payments', () => {
    // Round 1 at 50¢: +300 / −100 / −200. Round 2 at $1 over nine holes, against 27:
    // +14 / −6 / −8 points = +1400 / −600 / −800. Round 3 has not started.
    const nets = tripNets([first, second, third])!;
    expect(nets).toEqual({ me: 1700, dad: -700, bro: -1000 });
    expect(total(nets)).toBe(0);
    expect(settleUp(nets, NAME_OF, 'me').payments).toEqual([
      'Brother pays you $10.00',
      'Dad pays you $7.00',
    ]);
    for (const round of [first, second, third]) expectTotalsAddUp(round);
  });

  it('ties share a position', () => {
    const tied = scoreRound(
      ninePointRound({
        scores: [
          { playerId: 'me', hole: 11, strokes: 4 },
          { playerId: 'dad', hole: 11, strokes: 4 },
          { playerId: 'bro', hole: 11, strokes: 5 },
        ],
      }),
    );
    expect(roundBoard(tied).rows.map((r) => [r.pos, r.name])).toEqual([
      ['T1', 'Fritz'],
      ['T1', 'Dad'],
      ['3', 'Brother'],
    ]);
  });
});

describe('tees per player', () => {
  // Back tees: rating 72, slope 113, par 72 (all 4s), so a course handicap is the index.
  const BACK: Tee = { ...FLAT, name: 'Blue' };
  // Forward tees with the same par: three strokes easier.
  const FORWARD: Tee = { ...FLAT, rating: 69, name: 'White' };
  // Forward tees where 18 is a par 3: par 71.
  const SHORT: Tee = {
    ...FLAT,
    rating: 69,
    par: [...Array<number>(17).fill(4), 3],
    name: 'Gold',
  };
  const mixed = (tees: Record<string, Tee>, over: Partial<RoundInput> = {}, rules = FULL) =>
    scoreRound(
      ninePointRound({
        tee: BACK,
        rules,
        players: TRIO.map((p) => ({ ...p, tee: tees[p.id] ?? null })),
        scores: [],
        ...over,
      }),
    );
  const sheet = (round: RoundResult) =>
    round.players.map((p) => [p.name, p.teeName, p.course, p.parAdjustment, p.playing, p.strokes]);

  it('everyone on the round’s tees: no tee names, no adjustment', () => {
    expect(sheet(mixed({}))).toEqual([
      ['Fritz', null, 10, 0, 10, 0],
      ['Dad', null, 20, 0, 20, 10],
      ['Brother', null, 10, 0, 10, 0],
    ]);
  });

  it('mixed tees with the same par: each course handicap comes from its own rating and slope', () => {
    // Dad moves up: 20 × 113 / 113 + (69 − 72) = 17. Same par, so nothing else changes.
    const round = mixed({ dad: FORWARD });
    expect(sheet(round)).toEqual([
      ['Fritz', 'Blue', 10, 0, 10, 0],
      ['Dad', 'White', 17, 0, 17, 7],
      ['Brother', 'Blue', 10, 0, 10, 0],
    ]);
    // His seven strokes fall on the seven hardest holes.
    expect(round.holes.map((h) => h.received['dad'])).toEqual([
      1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('mixed tees with different pars: the higher par gets the difference', () => {
    // Fritz and Brother play Gold (par 71): 10 + (69 − 71) = 8. Dad stays on Blue (par 72): 20,
    // plus one for the par difference = 21. Off the low man: 13, not 12.
    const round = mixed({ me: SHORT, bro: SHORT });
    expect(sheet(round)).toEqual([
      ['Fritz', 'Gold', 8, 0, 8, 0],
      ['Dad', 'Blue', 20, 1, 21, 13],
      ['Brother', 'Gold', 8, 0, 8, 0],
    ]);
  });

  it('the adjustment is added after the allowance', () => {
    // 90%: Fritz 8 × 0.9 = 7.2 → 7. Dad 20 × 0.9 = 18, + 1 = 19. Off the low man: 12.
    const round = mixed({ me: SHORT, bro: SHORT }, {}, NINETY);
    expect(round.players.map((p) => [p.playing, p.strokes])).toEqual([
      [7, 0],
      [19, 12],
      [7, 0],
    ]);
  });

  it('two players who each play to their handicap tie, which is what the adjustment is for', () => {
    // Fritz, off 8 on the par 71: bogeys 1 to 8, pars in. Gross 79.
    // Dad, off 20 on the par 72: doubles 1 and 2, bogeys the rest. Gross 92, less 13 = 79.
    // Brother pars everything from Gold: 71.
    const me = [...Array<number>(8).fill(5), ...Array<number>(9).fill(4), 3];
    const dad = [6, 6, ...Array<number>(16).fill(5)];
    const bro = [...Array<number>(17).fill(4), 3];
    const scores = [me, dad, bro].flatMap((card, i) =>
      card.map((strokes, h) => ({ playerId: ['me', 'dad', 'bro'][i], hole: h + 1, strokes })),
    );
    const round = mixed({ me: SHORT, bro: SHORT }, { scores });
    expect(round.players.map((p) => [p.name, p.gross, p.net, p.toPar])).toEqual([
      ['Fritz', 79, 79, 8],
      ['Dad', 92, 79, 8],
      ['Brother', 71, 71, 0],
    ]);
    expect(roundBoard(round).rows.map((r) => [r.pos, r.name, ...r.cells.slice(0, 3)])).toEqual([
      ['1', 'Brother', '71', '71', 'E'],
      ['T2', 'Fritz', '79', '79', '+8'],
      ['T2', 'Dad', '92', '79', '+8'],
    ]);
    // Hole 18 is a par 3 for Fritz and Brother and a par 4 for Dad; the game compares strokes.
    expect(round.holes[17].parFor).toEqual({ me: 3, dad: 4, bro: 3 });
    expect(round.holes[17].games[0].values).toEqual({ me: 4, dad: 1, bro: 4 });
    expectTotalsAddUp(round);
    expect(total(round.games[0].total)).toBe(162);
  });

  it('net double bogey is from the player’s own par', () => {
    // Hole 18, nobody gets a stroke there: Fritz (par 3) counts at most 5, Dad (par 4) at most 6.
    const round = mixed(
      { me: SHORT, bro: SHORT },
      {
        scores: [
          { playerId: 'me', hole: 18, strokes: 8 },
          { playerId: 'dad', hole: 18, strokes: 8 },
          { playerId: 'bro', hole: 18, strokes: 3 },
        ],
      },
    );
    expect(round.holes[17].net).toEqual({ me: 5, dad: 6, bro: 3 });
  });

  it('a recorded playing handicap is left alone', () => {
    const round = mixed(
      { me: SHORT, bro: SHORT },
      {
        players: TRIO.map((p) => ({
          ...p,
          tee: p.id === 'dad' ? null : SHORT,
          storedPlaying: 15,
          storedCourse: 17,
        })),
      },
    );
    expect(round.players.map((p) => [p.course, p.parAdjustment, p.playing])).toEqual([
      [17, 0, 15],
      [17, 0, 15],
      [17, 0, 15],
    ]);
  });
});

describe('the engine checks itself', () => {
  it('the 9-point game is for three', () => {
    expect(() => ninePoint(['a', 'b'], [1], () => 4)).toThrow(NinePointError);
  });
  it('a foursome with the game switched on simply has no game', () => {
    const four = scoreRound(
      ninePointRound({ players: [...TRIO, { id: 'x', name: 'Sam', index: 12 }], scores: [] }),
    );
    expect(four.games).toEqual([]);
  });
  it('a player with no index gets no net, and the game waits', () => {
    const round = scoreRound(
      ninePointRound({ players: [TRIO[0], { ...TRIO[1], index: null }, TRIO[2]] }),
    );
    expect(round.players[1].net).toBeNull();
    expect(round.players[1].gross).toBe(96);
    expect(round.games).toEqual([]);
  });
});

describe('words', () => {
  it('to par', () => {
    expect([0, 3, -2, null].map(toParText)).toEqual(['E', '+3', '−2', '–']);
  });
  it('money', () => {
    expect(moneyText(300, true)).toBe('+$3.00');
    expect(moneyText(-200, true)).toBe('−$2.00');
    expect(moneyText(0, true)).toBe('$0.00');
    expect(moneyText(1450)).toBe('$14.50');
    expect(moneyText(25)).toBe('$0.25');
  });
  it('point values', () => {
    expect([25, 50, 100, 250].map(pointValueText)).toEqual(['25¢', '50¢', '$1', '$2.50']);
  });
});
