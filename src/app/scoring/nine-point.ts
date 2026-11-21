// The 9-point game: three players, nine points a hole, split by net score. A hole is ranked by
// actual net strokes; a player who picked up ranks below everyone who finished it (the caller
// passes Infinity for a pickup, so two pickups tie).

/** Thrown when the points don't add up. They always should: this guards the engine itself. */
export class NinePointError extends Error {}

/**
 * One hole's nine points, in the order the net scores were given.
 *   all different            5-3-1
 *   two tied for low         4-4-1
 *   two tied for second      5-2-2
 *   all three tied           3-3-3
 */
export function splitNine(nets: readonly [number, number, number]): [number, number, number] {
  const low = Math.min(...nets);
  const high = Math.max(...nets);
  if (low === high) return [3, 3, 3];
  const atLow = nets.filter((n) => n === low).length;
  const atHigh = nets.filter((n) => n === high).length;
  if (atLow === 2) return nets.map((n) => (n === low ? 4 : 1)) as [number, number, number];
  if (atHigh === 2) return nets.map((n) => (n === low ? 5 : 2)) as [number, number, number];
  return nets.map((n) => (n === low ? 5 : n === high ? 1 : 3)) as [number, number, number];
}

export interface NinePointResult {
  /** Points per player on each completed hole. Holes not everyone has finished are absent. */
  byHole: Map<number, Record<string, number>>;
  /** Holes all three have a score on, in order. */
  completed: number[];
  out: Record<string, number>;
  in: Record<string, number>;
  total: Record<string, number>;
}

/**
 * Scores the game over the holes in play. A hole counts only once all three have a net score on
 * it. Checks itself: every counted hole adds to 9, a finished nine to 81, a finished 18 to 162.
 */
export function ninePoint(
  players: readonly string[],
  holes: readonly number[],
  net: (playerId: string, hole: number) => number | null | undefined,
): NinePointResult {
  if (players.length !== 3) throw new NinePointError('The 9-point game is for three players');
  const zero = () => Object.fromEntries(players.map((id) => [id, 0])) as Record<string, number>;
  const result: NinePointResult = {
    byHole: new Map(),
    completed: [],
    out: zero(),
    in: zero(),
    total: zero(),
  };

  for (const hole of holes) {
    const nets = players.map((id) => net(id, hole));
    if (nets.some((n) => n == null)) continue;
    const points = splitNine(nets as [number, number, number]);
    if (points[0] + points[1] + points[2] !== 9)
      throw new NinePointError(`Hole ${hole} does not add up to 9`);
    const row: Record<string, number> = {};
    players.forEach((id, i) => {
      row[id] = points[i];
      result.total[id] += points[i];
      (hole <= 9 ? result.out : result.in)[id] += points[i];
    });
    result.byHole.set(hole, row);
    result.completed.push(hole);
  }

  const of = (side: Record<string, number>) => players.reduce((n, id) => n + side[id], 0);
  const done = (nine: number[]) => nine.filter((h) => result.byHole.has(h)).length;
  const front = holes.filter((h) => h <= 9);
  const back = holes.filter((h) => h > 9);
  if (of(result.out) !== 9 * done(front) || of(result.in) !== 9 * done(back))
    throw new NinePointError('A nine does not add up to 9 points a hole');
  if (of(result.total) !== 9 * result.completed.length)
    throw new NinePointError('The round does not add up to 9 points a hole');
  return result;
}
