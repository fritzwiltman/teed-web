// Nassau: two players, net match play, hole by hole. The front nine, the back nine and the
// overall 18 are separate bets, and a bet can be pressed: a new bet at the same stake from the
// next hole to the end of that side. Nothing here is stored; presses made by hand are inputs,
// like scores, and one that wasn't allowed is ignored.

/** Thrown when the money doesn't balance. It always should: this guards the engine itself. */
export class NassauError extends Error {}

export type NassauSide = 'front' | 'back' | 'overall';

/** When a bet may be pressed: once it is lost, or once it can no longer be won. */
export type PressAt = 'closed' | 'dormie';

export interface NassauSettings {
  /** What each side is played for, in cents. 0: not played for money. */
  stakes: Record<NassauSide, number>;
  /** A press starts by itself the moment it is allowed. Off: the player who is down may tap Press. */
  autoPress: boolean;
  pressAt: PressAt;
}

/** A press made by hand: `bet` is the bet being pressed, and the press starts on the next hole. */
export interface ManualPress {
  bet: string;
  afterHole: number;
}

export interface NassauBet {
  /** 'front', 'back', 'overall'; a press adds '_p1', '_p2': 'front_p2' is the press of 'front_p1'. */
  id: string;
  side: NassauSide;
  /** 0 for the side's own bet, 1 for its press, 2 for the press of that press. */
  press: number;
  /** "Front", "Front press", "Front press 2". */
  label: string;
  /** First and last hole. */
  from: number;
  to: number;
  stakeCents: number;
  /** Holes the first player is up (negative: down). It stops moving once the bet is decided. */
  up: number;
  /** Holes of this bet played, and left, when it was decided or as it stands. */
  played: number;
  left: number;
  /** open: still to play for · won: decided · halved: all square at the end. */
  state: 'open' | 'won' | 'halved';
  /** Who won it, or who is ahead while it is open. Null when all square. */
  leader: string | null;
  /** "AS", "2 up", "3 & 2", "Halved": the margin, without a name. */
  margin: string;
  /** Its first hole has been reached. */
  started: boolean;
  /** Who may press it now by hand, starting on the next hole. Null: nobody. */
  pressBy: string | null;
}

export interface NassauResult {
  /** Front, its presses, back, its presses, overall, its presses. */
  bets: NassauBet[];
  /** The last hole both have finished, counting from the first hole in play with no gap. */
  thru: number | null;
  /** Holes that count so far. */
  holesCounted: number;
  /**
   * What each player is up or down in cents if it ended now: every bet pays its stake to whoever
   * won it or is ahead in it. Null when nothing is played for money. Always sums to zero.
   */
  nets: Record<string, number> | null;
  /** Bets won or led, less bets lost or trailed. */
  betsUp: Record<string, number>;
}

const SIDE_NAMES: Record<NassauSide, string> = { front: 'Front', back: 'Back', overall: 'Overall' };

/** Reads a round_formats.settings object. Anything missing is off or zero. */
export function nassauSettings(settings: Record<string, unknown>): NassauSettings {
  const cents = (key: string) => {
    const value = Number(settings[key]);
    return Number.isInteger(value) && value > 0 ? value : 0;
  };
  return {
    stakes: {
      front: cents('stake_front_cents'),
      back: cents('stake_back_cents'),
      overall: cents('stake_overall_cents'),
    },
    autoPress: settings['auto_press'] === true,
    pressAt: settings['press_at'] === 'dormie' ? 'dormie' : 'closed',
  };
}

/**
 * Scores a Nassau between two players over the holes in play.
 *
 * `standing` is a player's net on a hole (Infinity for a pickup, so a pickup loses to anyone who
 * finished and two pickups halve); absent until they have a score. Holes count in order, up to
 * the first one both haven't finished.
 *
 * A bet is decided when one player is up more holes than are left ("3 & 2"), and its margin
 * stops there. A bet may be pressed once, by whoever is losing it, from the moment the setting
 * allows (lost; or dormie: down as many holes as are left, or more) while a hole is left on that
 * side. With auto press on that happens by itself; off, it takes a manual press. A press is a
 * bet like any other, and can be pressed in turn.
 */
export function nassau(
  players: readonly [string, string],
  holes: readonly number[],
  standing: (playerId: string, hole: number) => number | null | undefined,
  settings: NassauSettings,
  presses: readonly ManualPress[] = [],
): NassauResult {
  const [a, b] = players;

  // +1: the first player won the hole, −1: the second, 0: halved. Stops at the first gap.
  const won: number[] = [];
  for (const hole of holes) {
    const mine = standing(a, hole);
    const theirs = standing(b, hole);
    if (mine == null || theirs == null) break;
    won.push(mine < theirs ? 1 : mine > theirs ? -1 : 0);
  }
  const outcome = new Map(holes.slice(0, won.length).map((hole, i) => [hole, won[i]]));
  const thru = won.length ? holes[won.length - 1] : null;
  const next = holes[won.length] ?? null;

  const front = holes.filter((h) => h <= 9);
  const back = holes.filter((h) => h > 9);
  const sides: [NassauSide, number[]][] =
    front.length && back.length
      ? [
          ['front', front],
          ['back', back],
          ['overall', [...holes]],
        ]
      : front.length
        ? [['front', front]]
        : [['back', back]];

  const bets: NassauBet[] = [];
  const run = (side: NassauSide, sideHoles: number[], start: number, press: number): void => {
    const id = press ? `${side}_p${press}` : side;
    const mine = sideHoles.slice(start);
    let up = 0;
    let played = 0;
    let left = mine.length;
    let decided = false;
    let pressFrom: number | null = null;
    let pressBy: string | null = null;

    for (let i = 0; i < mine.length; i++) {
      const result = outcome.get(mine[i]);
      if (result === undefined) break;
      const holesLeft = mine.length - 1 - i;
      if (!decided) {
        up += result;
        played = i + 1;
        left = holesLeft;
        decided = Math.abs(up) > left || left === 0;
      }
      const down = Math.abs(up);
      const allowed =
        holesLeft >= 1 && (settings.pressAt === 'closed' ? down > holesLeft : down >= holesLeft);
      pressBy = null;
      if (!allowed || pressFrom !== null) continue;
      if (settings.autoPress || presses.some((p) => p.bet === id && p.afterHole === mine[i]))
        pressFrom = start + i + 1;
      else if (mine[i] === thru) pressBy = up > 0 ? b : a;
    }

    const down = Math.abs(up);
    const leader = up > 0 ? a : up < 0 ? b : null;
    bets.push({
      id,
      side,
      press,
      label: `${SIDE_NAMES[side]}${press ? ' press' : ''}${press > 1 ? ` ${press}` : ''}`,
      from: mine[0],
      to: mine[mine.length - 1],
      stakeCents: settings.stakes[side],
      up,
      played,
      left,
      state: !decided ? 'open' : down ? 'won' : 'halved',
      leader,
      margin: !decided
        ? down
          ? `${down} up`
          : 'AS'
        : !down
          ? 'Halved'
          : left
            ? `${down} & ${left}`
            : `${down} up`,
      started: played > 0 || mine[0] === next,
      pressBy,
    });
    if (pressFrom !== null) run(side, sideHoles, pressFrom, press + 1);
  };
  for (const [side, sideHoles] of sides) run(side, sideHoles, 0, 0);

  const betsUp: Record<string, number> = { [a]: 0, [b]: 0 };
  const money: Record<string, number> = { [a]: 0, [b]: 0 };
  for (const bet of bets) {
    if (!bet.leader) continue;
    const loser = bet.leader === a ? b : a;
    betsUp[bet.leader] += 1;
    betsUp[loser] -= 1;
    money[bet.leader] += bet.stakeCents;
    money[loser] -= bet.stakeCents;
  }
  if (money[a] + money[b] !== 0) throw new NassauError('The Nassau does not sum to zero');
  const forMoney = Object.values(settings.stakes).some((cents) => cents > 0);

  return { bets, thru, holesCounted: won.length, nets: forMoney ? money : null, betsUp };
}
