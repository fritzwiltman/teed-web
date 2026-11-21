import { Holes, Tee } from './types';

/** The hole numbers a round plays. */
export function holesInPlay(holes: Holes, tee: Tee): number[] {
  const count = tee.par.length;
  const from = holes === 'back' ? 10 : 1;
  const to = holes === 'front' ? Math.min(9, count) : count;
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}

/**
 * Hands a player's strokes out over the holes in play, hardest first by stroke index. More
 * strokes than holes wraps round again (20 strokes over 18 holes: one everywhere, two on the two
 * hardest). A plus handicap gives strokes back, starting on the easiest hole. On nine holes the
 * nine are ranked among themselves.
 */
export function strokesByHole(strokes: number, holes: number[], tee: Tee): Map<number, number> {
  const ranked = [...holes].sort((a, b) => tee.strokeIndex[a - 1] - tee.strokeIndex[b - 1]);
  const count = ranked.length;
  const result = new Map<number, number>();
  if (!count) return result;
  const size = Math.abs(strokes);
  const each = Math.floor(size / count);
  const extra = size % count;
  ranked.forEach((hole, rank) => {
    const gets =
      strokes >= 0
        ? each + (rank < extra ? 1 : 0) // hardest holes first
        : -(each + (rank >= count - extra ? 1 : 0)); // easiest holes first
    result.set(hole, gets + 0);
  });
  return result;
}

/** Net double bogey: where a player picks up. Never less than 1. */
export function netDoubleBogey(par: number, received: number): number {
  return Math.max(1, par + 2 + received);
}
