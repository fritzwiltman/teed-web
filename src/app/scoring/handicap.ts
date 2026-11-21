import { Holes, HouseRules, RoundPlayer, Tee } from './types';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Rounds to the nearest whole stroke, .5 upward (as the World Handicap System does). */
export function roundStrokes(value: number): number {
  // Tidy binary noise first, so 19.5 is 19.5 and not 19.499999999.
  return Math.round(Math.round(value * 1e6) / 1e6) + 0;
}

/**
 * Course handicap, unrounded: index × slope / 113 + (course rating − par).
 * Null when the tees have no rating or slope: strokes are never guessed.
 */
export function courseHandicap(index: number, tee: Tee): number | null {
  if (tee.rating == null || tee.slope == null) return null;
  return (index * tee.slope) / 113 + (tee.rating - sum(tee.par));
}

/**
 * Playing handicap for 18 holes: the unrounded course handicap times the allowance, rounded to
 * the nearest whole stroke.
 */
export function playingHandicap(index: number, tee: Tee, allowance: number): number | null {
  const course = courseHandicap(index, tee);
  return course == null ? null : roundStrokes(course * allowance);
}

/**
 * When players in a group play tees with different pars, those on the higher par get the
 * difference as extra strokes (Rules of Handicapping 6.2b): a course handicap is the strokes to
 * play to par, so without this the lower-par tees would win every tie. Returns each player's
 * extra strokes: their tees' par less the lowest par in the group.
 */
export function parAdjustments(pars: number[]): number[] {
  const low = pars.length ? Math.min(...pars) : 0;
  return pars.map((par) => par - low);
}

/**
 * A player's playing handicap for this round: the one recorded for it if there is one, else
 * course handicap (from their own tees) × allowance, rounded, plus `parAdjustment`. Null when
 * there is no index to work from. A nine-hole round plays half of it, rounded.
 */
export function playingFor(
  player: RoundPlayer,
  tee: Tee,
  rules: HouseRules,
  holes: Holes,
  parAdjustment = 0,
): number | null {
  const worked = player.index == null ? null : playingHandicap(player.index, tee, rules.allowance);
  const full = player.storedPlaying ?? (worked == null ? null : worked + parAdjustment);
  if (full == null) return null;
  return holes === '18' ? full : roundStrokes(full / 2);
}

/**
 * Strokes each player gets, from their playing handicaps. Off the low man: everyone's strokes
 * are what they have over the lowest handicap in the group, who gets none.
 */
export function strokesReceived(playing: (number | null)[], offLowMan: boolean): (number | null)[] {
  const known = playing.filter((p): p is number => p != null);
  const low = offLowMan && known.length ? Math.min(...known) : 0;
  return playing.map((p) => (p == null ? null : p - low));
}
