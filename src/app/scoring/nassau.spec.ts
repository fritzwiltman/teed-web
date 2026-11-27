import {
  HouseRules,
  ManualPress,
  NassauResult,
  NassauSettings,
  RoundInput,
  Score,
  Tee,
  matchCards,
  matchStatus,
  nassau,
  nassauSettings,
  pressable,
  roundBoard,
  roundNets,
  scoreRound,
  settleUp,
  tripBoard,
  tripNets,
} from './index';

// ── The round, worked by hand ───────────────────────────────────────────────
//
// Fritz against Brother. F: Fritz wins the hole, B: Brother, H: halved.
//
//   hole     1  2  3  4  5  6  7  8  9 | 10 11 12 13 14 15 16 17 18
//   result   B  B  B  H  B  H  B  B  F |  B  F  B  H  B  F  B  F  F
//
// Front (Fritz's holes up, holes left):
//   −1(8) −2(7) −3(6) −3(5) −4(4) dormie · −4(3) lost: Brother 4 & 3
// Back:
//   −1(8) 0(7) −1(6) −1(5) −2(4) −1(3) −2(2) dormie · −1(1) · 0(0): halved
// Overall: −5 after nine, then
//   −6(8) −5(7) −6(6) dormie · −6(5) lost: Brother 6 & 5
const F = 1;
const B = -1;
const H = 0;
const HOLES = [B, B, B, H, B, H, B, B, F, B, F, B, H, B, F, B, F, F];
const ALL = Array.from({ length: 18 }, (_, i) => i + 1);

const FIVES = { front: 500, back: 500, overall: 500 };
const OFF: NassauSettings = { stakes: FIVES, autoPress: false, pressAt: 'closed' };
const AUTO_CLOSED: NassauSettings = { stakes: FIVES, autoPress: true, pressAt: 'closed' };
const AUTO_DORMIE: NassauSettings = { stakes: FIVES, autoPress: true, pressAt: 'dormie' };

/** Plays the first `thru` holes of a list of results. */
function play(
  settings: NassauSettings,
  results = HOLES,
  thru = results.length,
  presses: ManualPress[] = [],
  holes = ALL,
): NassauResult {
  return nassau(
    ['fritz', 'bro'],
    holes,
    (id, hole) => {
      const at = holes.indexOf(hole);
      if (at >= thru) return undefined;
      // Fritz makes 4; Brother makes 5 to lose a hole, 3 to win it.
      return id === 'fritz' ? 4 : 4 + results[at];
    },
    settings,
    presses,
  );
}

/** "Front: bro 4 & 3" for every bet, in order. */
function lines(result: NassauResult): string[] {
  return result.bets.map((b) => `${b.label}: ${b.leader ? `${b.leader} ` : ''}${b.margin}`);
}

describe('a full 18 of Nassau, worked by hand', () => {
  it('with no presses: three bets, a nine halved, the overall closed out early', () => {
    const result = play(OFF);
    expect(lines(result)).toEqual(['Front: bro 4 & 3', 'Back: Halved', 'Overall: bro 6 & 5']);
    expect(result.bets.map((b) => b.state)).toEqual(['won', 'halved', 'won']);
    // Two bets to Brother at $5; the halved nine pays nothing.
    expect(result.nets).toEqual({ fritz: -1000, bro: 1000 });
  });

  it('a decided bet stops moving: the margin is where it was closed out', () => {
    const front = play(OFF).bets[0];
    expect(front).toEqual(expect.objectContaining({ up: -4, played: 6, left: 3 }));
    const overall = play(OFF).bets[2];
    expect(overall).toEqual(expect.objectContaining({ up: -6, played: 13, left: 5 }));
  });

  it('auto press when closed out: a press on the front, a press on that press, one on the overall', () => {
    const result = play(AUTO_CLOSED);
    // Front lost after 6: its press is 7–9. Fritz loses 7 and 8 (2 & 1), so that press is
    // pressed for the 9th alone, which he wins. The back is never lost, so never pressed.
    // The overall is lost after 13: its press is 14–18, B F B F F, Fritz 1 up.
    expect(lines(result)).toEqual([
      'Front: bro 4 & 3',
      'Front press: bro 2 & 1',
      'Front press 2: fritz 1 up',
      'Back: Halved',
      'Overall: bro 6 & 5',
      'Overall press: fritz 1 up',
    ]);
    expect(result.bets.map((b) => [b.id, b.from, b.to])).toEqual([
      ['front', 1, 9],
      ['front_p1', 7, 9],
      ['front_p2', 9, 9],
      ['back', 10, 18],
      ['overall', 1, 18],
      ['overall_p1', 14, 18],
    ]);
    // −5 −5 +5 on the front, 0 on the back, −5 +5 overall.
    expect(result.nets).toEqual({ fritz: -500, bro: 500 });
  });

  it('auto press at dormie: presses start a hole sooner, and the back is pressed twice', () => {
    const result = play(AUTO_DORMIE);
    // Front dormie after 5 (4 down, 4 left): press 6–9, H B B, lost 2 & 1 after 8; press 2 is the 9th.
    // Back dormie after 16 (2 down, 2 left): Fritz's press is 17–18. He wins 17, so now Brother
    // is dormie in the press (1 down, 1 left) and presses the 18th, which Fritz wins too.
    // Overall dormie after 12 (6 down, 6 left): press 13–18, H B F B F F, Fritz 1 up.
    expect(lines(result)).toEqual([
      'Front: bro 4 & 3',
      'Front press: bro 2 & 1',
      'Front press 2: fritz 1 up',
      'Back: Halved',
      'Back press: fritz 2 up',
      'Back press 2: fritz 1 up',
      'Overall: bro 6 & 5',
      'Overall press: fritz 1 up',
    ]);
    expect(result.bets.map((b) => [b.id, b.from, b.to])).toEqual([
      ['front', 1, 9],
      ['front_p1', 6, 9],
      ['front_p2', 9, 9],
      ['back', 10, 18],
      ['back_p1', 17, 18],
      ['back_p2', 18, 18],
      ['overall', 1, 18],
      ['overall_p1', 13, 18],
    ]);
    // −5 −5 +5 on the front, +5 +5 on the back's presses, −5 +5 overall.
    expect(result.nets).toEqual({ fritz: 500, bro: -500 });
  });

  it('a press is for the stake of the bet it came from', () => {
    const stakes = { front: 500, back: 1000, overall: 2000 };
    const closed = play({ stakes, autoPress: true, pressAt: 'closed' });
    expect(closed.bets.map((b) => b.stakeCents)).toEqual([500, 500, 500, 1000, 2000, 2000]);
    // −5 −5 +5 on the front; −20 +20 overall.
    expect(closed.nets).toEqual({ fritz: -500, bro: 500 });
    const dormie = play({ stakes, autoPress: true, pressAt: 'dormie' });
    // −5 −5 +5 on the front; +10 +10 on the back's presses; −20 +20 overall.
    expect(dormie.nets).toEqual({ fritz: 1500, bro: -1500 });
  });

  it('every way of playing it sums to zero', () => {
    for (const settings of [OFF, AUTO_CLOSED, AUTO_DORMIE])
      for (let thru = 0; thru <= 18; thru++) {
        const nets = play(settings, HOLES, thru).nets!;
        expect(nets['fritz'] + nets['bro']).toBe(0);
      }
  });
});

describe('a Nassau bet decided on the last hole', () => {
  // All square through 8, then Brother wins the 9th: nothing is left to press.
  const LATE = [H, H, H, H, H, H, H, H, B];

  it('is not pressed, whatever the setting', () => {
    for (const settings of [AUTO_CLOSED, AUTO_DORMIE]) {
      const result = play(settings, [...LATE, ...Array(9).fill(H)]);
      expect(result.bets.filter((b) => b.side === 'front').map((b) => b.id)).toEqual(['front']);
      expect(lines(result).slice(0, 3)).toEqual([
        'Front: bro 1 up',
        'Back: Halved',
        'Overall: bro 1 up',
      ]);
    }
    // The overall is another matter at dormie: 1 down with the 18th to play, so that is pressed.
    const closed = play(AUTO_CLOSED, [...LATE, ...Array(9).fill(H)]);
    expect(closed.bets.length).toBe(3);
    const dormie = play(AUTO_DORMIE, [...LATE, ...Array(9).fill(H)]);
    expect(lines(dormie)[3]).toBe('Overall press: Halved');
    expect(dormie.bets[3]).toEqual(expect.objectContaining({ from: 18, to: 18 }));
  });

  it('one down with one to go is dormie: pressed at dormie, not when closed out', () => {
    const results = [H, H, H, H, H, H, H, B, B, ...Array(9).fill(H)];
    expect(lines(play(AUTO_CLOSED, results)).slice(0, 2)).toEqual([
      'Front: bro 2 up',
      'Back: Halved',
    ]);
    expect(lines(play(AUTO_DORMIE, results)).slice(0, 2)).toEqual([
      'Front: bro 2 up',
      'Front press: bro 1 up',
    ]);
  });

  it('going from 1 down with 2 left to lost skips dormie: the dormie press still starts', () => {
    const results = [H, H, H, H, H, H, B, B, H, ...Array(9).fill(H)];
    // After 7: 1 down, 2 left. After 8: 2 down, 1 left: lost, never exactly dormie.
    expect(lines(play(AUTO_DORMIE, results)).slice(0, 2)).toEqual([
      'Front: bro 2 & 1',
      'Front press: Halved',
    ]);
  });
});

describe('pressing by hand', () => {
  it('with auto press off, the player who lost a bet may press it, never earlier', () => {
    // After 5 Fritz is dormie on the front, not yet lost.
    expect(play(OFF, HOLES, 5).bets.map((b) => b.pressBy)).toEqual([null, null, null]);
    // After 6 the front is lost with three to play.
    expect(play(OFF, HOLES, 6).bets.map((b) => b.pressBy)).toEqual(['fritz', null, null]);
    // At dormie the button is there a hole sooner.
    const dormie: NassauSettings = { ...OFF, pressAt: 'dormie' };
    expect(play(dormie, HOLES, 5).bets.map((b) => b.pressBy)).toEqual(['fritz', null, null]);
  });

  it('a press starts on the next hole and runs to the end of that side', () => {
    const result = play(OFF, HOLES, 18, [{ bet: 'front', afterHole: 6 }]);
    expect(lines(result)).toEqual([
      'Front: bro 4 & 3',
      'Front press: bro 2 & 1',
      'Back: Halved',
      'Overall: bro 6 & 5',
    ]);
    expect(result.nets).toEqual({ fritz: -1500, bro: 1500 });
  });

  it('a press can come later than the first moment, while a hole is left', () => {
    const result = play(OFF, HOLES, 18, [{ bet: 'front', afterHole: 7 }]);
    // 8–9: Brother wins 8, Fritz wins 9.
    expect(lines(result)[1]).toBe('Front press: Halved');
    expect(result.bets[1]).toEqual(expect.objectContaining({ from: 8, to: 9 }));
  });

  it('a press can be pressed in turn, under the same rule', () => {
    const presses = [
      { bet: 'front', afterHole: 6 },
      { bet: 'front_p1', afterHole: 8 },
    ];
    expect(play(OFF, HOLES, 8, [presses[0]]).bets[1].pressBy).toBe('fritz');
    const result = play(OFF, HOLES, 18, presses);
    expect(lines(result).slice(0, 3)).toEqual([
      'Front: bro 4 & 3',
      'Front press: bro 2 & 1',
      'Front press 2: fritz 1 up',
    ]);
  });

  it('a press that was not allowed is ignored', () => {
    const early = play(OFF, HOLES, 18, [{ bet: 'front', afterHole: 5 }]);
    expect(early.bets.length).toBe(3);
    // Nothing is left on the front after 9, and the back was never lost.
    const late = play(OFF, HOLES, 18, [
      { bet: 'front', afterHole: 9 },
      { bet: 'back', afterHole: 16 },
    ]);
    expect(late.bets.length).toBe(3);
  });

  it('once per bet: a second press of the same bet changes nothing', () => {
    const result = play(OFF, HOLES, 18, [
      { bet: 'front', afterHole: 6 },
      { bet: 'front', afterHole: 7 },
    ]);
    expect(result.bets.filter((b) => b.side === 'front').map((b) => b.from)).toEqual([1, 7]);
  });

  it('with auto press on, nobody is offered a press', () => {
    for (let thru = 0; thru <= 18; thru++)
      expect(play(AUTO_CLOSED, HOLES, thru).bets.every((b) => b.pressBy === null)).toBe(true);
  });

  it('nobody is offered a press when no hole is left on that side', () => {
    // Fritz loses the front on the 9th.
    const results = [H, H, H, H, H, H, H, B, B];
    expect(play(OFF, results, 9).bets[0].pressBy).toBeNull();
  });
});

describe('a Nassau in progress', () => {
  it('counts holes in order, up to the first one both have not finished', () => {
    const result = nassau(
      ['fritz', 'bro'],
      ALL,
      (id, hole) => (hole === 3 ? undefined : id === 'fritz' ? 5 : 4),
      OFF,
    );
    expect(result.thru).toBe(2);
    expect(result.bets[0].up).toBe(-2);
  });

  it('pays whoever is ahead if it ended now', () => {
    const result = play(OFF, HOLES, 2);
    expect(lines(result)).toEqual(['Front: bro 2 up', 'Back: AS', 'Overall: bro 2 up']);
    expect(result.bets.map((b) => b.started)).toEqual([true, false, true]);
    expect(result.nets).toEqual({ fritz: -1000, bro: 1000 });
  });

  it('a pickup loses the hole; two pickups halve it', () => {
    const net = (mine: number, theirs: number) =>
      nassau(['fritz', 'bro'], [1], (id) => (id === 'fritz' ? mine : theirs), OFF).bets[0].up;
    expect(net(Infinity, 9)).toBe(-1);
    expect(net(3, Infinity)).toBe(1);
    expect(net(Infinity, Infinity)).toBe(0);
  });

  it('a nine-hole round is one bet, with its presses', () => {
    const front = play(AUTO_CLOSED, HOLES.slice(0, 9), 9, [], ALL.slice(0, 9));
    expect(lines(front)).toEqual([
      'Front: bro 4 & 3',
      'Front press: bro 2 & 1',
      'Front press 2: fritz 1 up',
    ]);
    const back = play(OFF, HOLES.slice(9), 9, [], ALL.slice(9));
    expect(lines(back)).toEqual(['Back: Halved']);
  });

  it('reads its settings, with everything off or zero when missing', () => {
    expect(nassauSettings({})).toEqual({
      stakes: { front: 0, back: 0, overall: 0 },
      autoPress: false,
      pressAt: 'closed',
    });
    expect(
      nassauSettings({
        stake_front_cents: 500,
        stake_back_cents: 1000,
        stake_overall_cents: 2000,
        auto_press: true,
        press_at: 'dormie',
      }),
    ).toEqual({
      stakes: { front: 500, back: 1000, overall: 2000 },
      autoPress: true,
      pressAt: 'dormie',
    });
    expect(play({ ...OFF, stakes: { front: 0, back: 0, overall: 0 } }).nets).toBeNull();
  });
});

// ── The same round through the whole engine, with handicap strokes ─────────

// Par 4 everywhere, rated at par with a slope of 113, so a course handicap is the index.
// Stroke index runs 1 to 18: Fritz (10.0) gets a stroke on holes 1–6 off Brother (4.0).
const LEVEL: Tee = {
  rating: 72,
  slope: 113,
  par: Array(18).fill(4),
  strokeIndex: ALL,
};
const RULES: HouseRules = { allowance: 1, offLowMan: true, pickupNetDouble: true };
//               1  2  3  4  5  6  7  8  9 10 11 12 13 14 15 16 17 18
const FRITZ = [6, 6, 7, 5, 6, 5, 5, 5, 4, 5, 4, 6, 4, 5, 3, 5, 4, 4];
const BRO = [4, 4, 4, 4, 4, 4, 4, 3, 5, 4, 5, 5, 4, 4, 4, 4, 5, 6];

function round(over: Partial<RoundInput> = {}, thru = 18, settings: object = {}): RoundInput {
  const scores: Score[] = [];
  for (let hole = 1; hole <= thru; hole++) {
    scores.push({ playerId: 'fritz', hole, strokes: FRITZ[hole - 1] });
    scores.push({ playerId: 'bro', hole, strokes: BRO[hole - 1] });
  }
  return {
    id: 'r1',
    number: 1,
    holes: '18',
    status: 'live',
    tee: LEVEL,
    rules: RULES,
    players: [
      { id: 'fritz', name: 'Fritz', index: 10 },
      { id: 'bro', name: 'Brother', index: 4 },
    ],
    scores,
    formats: [
      { key: 'stroke', settings: {} },
      {
        key: 'nassau',
        settings: {
          stake_front_cents: 500,
          stake_back_cents: 500,
          stake_overall_cents: 500,
          ...settings,
        },
      },
    ],
    ...over,
  };
}

describe('a Nassau round through the engine', () => {
  it('plays the hand-worked round off net scores', () => {
    const result = scoreRound(round());
    expect(result.players.map((p) => p.strokes)).toEqual([6, 0]);
    expect(matchCards(result)).toEqual([
      {
        key: 'nassau',
        rows: [
          { label: 'Front', value: 'Brother 4 & 3' },
          { label: 'Back', value: 'Halved' },
          { label: 'Overall', value: 'Brother 6 & 5' },
        ],
      },
    ]);
  });

  it('settles up: each bet pays its stake, and the round sums to zero', () => {
    const result = scoreRound(round({}, 18, { auto_press: true, press_at: 'dormie' }));
    const nets = roundNets(result)!;
    expect(nets).toEqual({ fritz: 500, bro: -500 });
    expect(settleUp(nets, { fritz: 'Fritz', bro: 'Brother' }, 'fritz')).toEqual({
      nets: [
        { name: 'Fritz', text: '+$5.00', me: true },
        { name: 'Brother', text: '−$5.00', me: false },
      ],
      payments: ['Brother pays you $5.00'],
    });
  });

  it('the board has a money column, and the trip adds it to the other games', () => {
    const result = scoreRound(round({}, 18, { auto_press: true }));
    const board = roundBoard(result, 'fritz');
    expect(board.columns).toEqual(['Gross', 'Net', 'To par', 'Thru', 'Nassau']);
    expect(board.rows.map((r) => [r.name, r.cells[4]])).toEqual([
      ['Brother', '+$5.00'],
      ['Fritz', '−$5.00'],
    ]);
    const trip = tripBoard([result, scoreRound(round({ id: 'r2', number: 2 }))]);
    expect(trip.columns.at(-1)).toBe('Nassau');
    expect(trip.rows.map((r) => [r.name, r.cells.at(-1)])).toEqual([
      ['Brother', '+$15.00'],
      ['Fritz', '−$15.00'],
    ]);
    expect(tripNets([result, scoreRound(round({ id: 'r2', number: 2 }))])).toEqual({
      fritz: -1500,
      bro: 1500,
    });
  });

  it('without stakes (a spectator not shown winnings) it counts bets instead', () => {
    const result = scoreRound(
      round({ formats: [{ key: 'nassau', settings: { auto_press: true } }] }),
    );
    expect(result.games[0].settle).toBeNull();
    expect(roundBoard(result).columns.at(-1)).toBe('Bets');
    // Brother: front, front press, overall. Fritz: front press 2, overall press.
    expect(roundBoard(result).rows.map((r) => r.cells.at(-1))).toEqual(['+1', '−1']);
  });

  it('the scorecard line is the open bets, from the side of whoever is looking', () => {
    const five = scoreRound(round({}, 5));
    expect(matchStatus(five, 'fritz')).toBe('Front 4 down · Overall 4 down');
    expect(matchStatus(five, 'bro')).toBe('Front 4 up · Overall 4 up');
    expect(matchStatus(five, 'someone')).toBe('Front Brother 4 up · Overall Brother 4 up');
    // The front is decided after 6; its press is open from the 7th.
    const seven = scoreRound(round({}, 7, { auto_press: true }));
    expect(matchStatus(seven, 'fritz')).toBe('Front press 1 down · Overall 5 down');
    expect(matchStatus(scoreRound(round({}, 0)), 'fritz')).toBe('Front AS · Overall AS');
    expect(matchStatus(scoreRound(round({}, 9)), 'fritz')).toBe('Back AS · Overall 5 down');
    expect(matchStatus(scoreRound(round()), 'fritz')).toBeNull();
  });

  it('offers the press to the player who lost the bet, for the next hole', () => {
    const six = scoreRound(round({}, 6));
    expect(pressable(six, 'fritz')).toEqual([
      { game: 'nassau', bet: 'front', label: 'Front', afterHole: 6, from: 7 },
    ]);
    expect(pressable(six, 'bro')).toEqual([]);
    expect(pressable(scoreRound(round({}, 5)), 'fritz')).toEqual([]);
    expect(pressable(scoreRound(round({ status: 'final' }, 6)), 'fritz')).toEqual([]);
  });

  it('a press made by hand is part of the round', () => {
    const input = round({}, 18);
    input.formats[1].presses = [{ bet: 'front', afterHole: 6 }];
    expect(matchCards(scoreRound(input))[0].rows.map((r) => r.label)).toEqual([
      'Front',
      'Front press',
      'Back',
      'Overall',
    ]);
  });

  it('match play is not capped at net double bogey', () => {
    // Fritz makes 9 on the 7th (net double bogey would be 6) against a pickup marked at 6.
    const input = round({}, 7);
    input.scores = input.scores.map((s) =>
      s.hole !== 7
        ? s
        : s.playerId === 'fritz'
          ? { ...s, strokes: 9 }
          : { ...s, strokes: 6, pickedUp: true },
    );
    const result = scoreRound(input);
    // Fritz finished the hole, so he wins it from a pickup: 4 down becomes 3 down.
    expect(result.games[0].bets![0].up).toBe(-4); // the front was already decided after 6
    expect(result.games[0].bets![2].up).toBe(-3);
  });

  it('needs exactly two players', () => {
    const three = round();
    three.players = [...three.players, { id: 'dad', name: 'Dad', index: 20 }];
    expect(scoreRound(three).games).toEqual([]);
  });
});
