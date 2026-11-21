import { playingFor, strokesReceived } from './handicap';
import { ninePoint } from './nine-point';
import { fewestPayments, ninePointNets } from './settle';
import { holesInPlay, netDoubleBogey, strokesByHole } from './strokes';
import { Payment, RoundInput } from './types';

/** One player's round so far. */
export interface PlayerResult {
  id: string;
  name: string;
  /** Playing handicap for this round; null when there is no handicap index to work from. */
  playing: number | null;
  /** Strokes received in this round (after the low man comes off). */
  strokes: number | null;
  /** Raw strokes over the holes scored. */
  gross: number;
  /** Net over the holes scored; null with no handicap. */
  net: number | null;
  /** Net against the par of the holes scored. */
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
  par: number;
  strokeIndex: number;
  /** Raw strokes entered, by player. Absent until entered. */
  strokes: Record<string, number | undefined>;
  /** Strokes received on this hole, by player. */
  received: Record<string, number>;
  /** Net score that counts on this hole, by player. */
  net: Record<string, number | undefined>;
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
  const playing = players.map((p) => playingFor(p, tee, rules, input.holes));
  const received = strokesReceived(playing, rules.offLowMan);
  const perHole = received.map((n) => (n == null ? null : strokesByHole(n, holes, tee)));

  const entered = new Map<string, number>();
  for (const s of input.scores) entered.set(`${s.playerId}:${s.hole}`, s.strokes);

  const holeResults: HoleResult[] = holes.map((hole) => {
    const par = tee.par[hole - 1];
    const result: HoleResult = {
      hole,
      par,
      strokeIndex: tee.strokeIndex[hole - 1],
      strokes: {},
      received: {},
      net: {},
      complete: true,
      games: [],
    };
    players.forEach((player, i) => {
      const strokes = entered.get(`${player.id}:${hole}`);
      const gets = perHole[i]?.get(hole);
      result.strokes[player.id] = strokes;
      result.received[player.id] = gets ?? 0;
      if (strokes == null) result.complete = false;
      else if (gets != null) {
        const counted = rules.pickupNetDouble
          ? Math.min(strokes, netDoubleBogey(par, gets))
          : strokes;
        result.net[player.id] = counted - gets;
      }
    });
    if (!players.length) result.complete = false;
    return result;
  });

  const playerResults: PlayerResult[] = players.map((player, i) => {
    const scored = holeResults.filter((h) => h.strokes[player.id] != null);
    const gross = scored.reduce((n, h) => n + h.strokes[player.id]!, 0);
    const par = scored.reduce((n, h) => n + h.par, 0);
    const net = received[i] == null ? null : scored.reduce((n, h) => n + h.net[player.id]!, 0);
    return {
      id: player.id,
      name: player.name,
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
    const game = ninePoint(ids, holes, (id, hole) => byHole.get(hole)!.net[id]);
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
