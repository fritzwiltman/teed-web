import {
  courseHandicap,
  parAdjustments,
  playingFor,
  roundStrokes,
  strokesReceived,
} from './handicap';
import { ninePoint } from './nine-point';
import { fewestPayments, ninePointNets } from './settle';
import { holesInPlay, netDoubleBogey, strokesByHole } from './strokes';
import { Payment, RoundInput, Tee } from './types';

/** One player's round so far. */
export interface PlayerResult {
  id: string;
  name: string;
  /** Their handicap index. */
  index: number | null;
  /** The tees they play, when the group is not all on the same ones. */
  teeName: string | null;
  /** Course handicap from their own tees, rounded, for 18 holes. */
  course: number | null;
  /** Extra strokes for playing tees with a higher par than someone else in the group. */
  parAdjustment: number;
  /** Playing handicap for this round; null when there is no handicap index to work from. */
  playing: number | null;
  /** Strokes received in this round (after the low man comes off). */
  strokes: number | null;
  /** Raw strokes over the holes scored. */
  gross: number;
  /** Net over the holes scored; null with no handicap. */
  net: number | null;
  /**
   * Net against par over the holes scored. With mixed tees, par is the lowest-par tees' in the
   * group, which is what the par adjustment levels everyone to.
   */
  toPar: number | null;
  /** Holes scored. */
  thru: number;
}

/** What a game (a format beyond stroke play) made of one hole: a value per player. */
export interface GameHole {
  key: string;
  values: Record<string, number>;
}

export interface HoleResult {
  hole: number;
  /** Par and stroke index from the round's tees. */
  par: number;
  strokeIndex: number;
  /** Par from each player's own tees (it can differ on a hole when tees are mixed). */
  parFor: Record<string, number>;
  /** Raw strokes entered, by player. Absent until entered. */
  strokes: Record<string, number | undefined>;
  /** Strokes received on this hole, by player. */
  received: Record<string, number>;
  /** Net score that counts in net stroke play (at most net double bogey with that rule on). */
  net: Record<string, number | undefined>;
  /**
   * Where a player stands on the hole for a game: their actual net, uncapped; a pickup stands
   * behind everyone who finished (Infinity), level with any other pickup.
   */
  standing: Record<string, number | undefined>;
  /** Who picked up here. */
  pickedUp: Record<string, boolean>;
  /** Everyone in the group has a score here. */
  complete: boolean;
  games: GameHole[];
}

/** A game's running totals, and the money when it is played for some. */
export interface GameResult {
  key: string;
  /** Column heading on a board. */
  label: string;
  out: Record<string, number>;
  in: Record<string, number>;
  total: Record<string, number>;
  /** Holes that count so far. */
  holesCounted: number;
  settle: { pointValueCents: number; nets: Record<string, number>; payments: Payment[] } | null;
}

export interface RoundResult {
  id: string;
  number: number;
  /**
   * scheduled: no score yet · live: in play · complete: every player has every hole ·
   * final: official, scores closed.
   */
  state: 'scheduled' | 'live' | 'complete' | 'final';
  holes: HoleResult[];
  players: PlayerResult[];
  games: GameResult[];
}

/**
 * Works a round out from its raw strokes: strokes received, net per hole, each player's totals,
 * and each game on top (the 9-point game and its money). Nothing here is stored.
 */
export function scoreRound(input: RoundInput): RoundResult {
  const { tee, rules, players } = input;
  const holes = holesInPlay(input.holes, tee);
  const tees: Tee[] = players.map((p) => p.tee ?? tee);
  const totalPar = (t: Tee) => t.par.reduce((a, b) => a + b, 0);
  const adjust = parAdjustments(tees.map(totalPar));
  const playing = players.map((p, i) => playingFor(p, tees[i], rules, input.holes, adjust[i]));
  const received = strokesReceived(playing, rules.offLowMan);
  const perHole = received.map((n, i) => (n == null ? null : strokesByHole(n, holes, tees[i])));
  const mixed = tees.some((t) => t !== tees[0]);
  // "To par" is measured against the lowest-par tees in the group.
  const reference = tees.reduce(
    (low, t) => (totalPar(t) < totalPar(low) ? t : low),
    tees[0] ?? tee,
  );

  const entered = new Map<string, number>();
  const pickups = new Set<string>();
  for (const s of input.scores) {
    entered.set(`${s.playerId}:${s.hole}`, s.strokes);
    if (s.pickedUp) pickups.add(`${s.playerId}:${s.hole}`);
  }

  const holeResults: HoleResult[] = holes.map((hole) => {
    const par = tee.par[hole - 1];
    const result: HoleResult = {
      hole,
      par,
      strokeIndex: tee.strokeIndex[hole - 1],
      parFor: {},
      strokes: {},
      received: {},
      net: {},
      standing: {},
      pickedUp: {},
      complete: true,
      games: [],
    };
    players.forEach((player, i) => {
      const strokes = entered.get(`${player.id}:${hole}`);
      const gets = perHole[i]?.get(hole);
      const ownPar = tees[i].par[hole - 1] ?? par;
      result.parFor[player.id] = ownPar;
      result.strokes[player.id] = strokes;
      result.received[player.id] = gets ?? 0;
      const pickedUp = strokes != null && pickups.has(`${player.id}:${hole}`);
      result.pickedUp[player.id] = pickedUp;
      if (strokes == null) result.complete = false;
      else if (gets != null) {
        const counted = rules.pickupNetDouble
          ? Math.min(strokes, netDoubleBogey(ownPar, gets))
          : strokes;
        result.net[player.id] = counted - gets;
        result.standing[player.id] = pickedUp ? Infinity : strokes - gets;
      }
    });
    if (!players.length) result.complete = false;
    return result;
  });

  const playerResults: PlayerResult[] = players.map((player, i) => {
    const scored = holeResults.filter((h) => h.strokes[player.id] != null);
    const gross = scored.reduce((n, h) => n + h.strokes[player.id]!, 0);
    const par = scored.reduce((n, h) => n + (reference.par[h.hole - 1] ?? h.par), 0);
    const net = received[i] == null ? null : scored.reduce((n, h) => n + h.net[player.id]!, 0);
    const course = player.index == null ? null : courseHandicap(player.index, tees[i]);
    return {
      id: player.id,
      name: player.name,
      index: player.index,
      teeName: mixed ? (tees[i].name ?? null) : null,
      course: player.storedCourse ?? (course == null ? null : roundStrokes(course)),
      parAdjustment: player.storedPlaying == null ? adjust[i] : 0,
      playing: playing[i],
      strokes: received[i],
      gross,
      net,
      toPar: net == null ? null : net - par,
      thru: scored.length,
    };
  });

  const games: GameResult[] = [];
  const nine = input.formats.find((f) => f.key === 'nine_point');
  if (nine && players.length === 3 && received.every((n) => n != null)) {
    const ids = players.map((p) => p.id);
    const byHole = new Map(holeResults.map((h) => [h.hole, h]));
    const game = ninePoint(ids, holes, (id, hole) => byHole.get(hole)!.standing[id]);
    for (const [hole, values] of game.byHole)
      byHole.get(hole)!.games.push({ key: 'nine_point', values });
    const value = Number(nine.settings['point_value_cents']);
    const nets =
      Number.isInteger(value) && value > 0
        ? ninePointNets(game.total, game.completed.length, value)
        : null;
    games.push({
      key: 'nine_point',
      label: 'Pts',
      out: game.out,
      in: game.in,
      total: game.total,
      holesCounted: game.completed.length,
      settle: nets && { pointValueCents: value, nets, payments: fewestPayments(nets) },
    });
  }

  const started = input.scores.length > 0 && playerResults.some((p) => p.thru > 0);
  const complete = holeResults.length > 0 && holeResults.every((h) => h.complete);
  return {
    id: input.id,
    number: input.number,
    state:
      input.status === 'final' ? 'final' : complete ? 'complete' : started ? 'live' : 'scheduled',
    holes: holeResults,
    players: playerResults,
    games,
  };
}

/** The next hole to score: the first one someone in the group has no score on. Null when done. */
export function nextHole(round: RoundResult): number | null {
  return round.holes.find((h) => !h.complete)?.hole ?? null;
}
