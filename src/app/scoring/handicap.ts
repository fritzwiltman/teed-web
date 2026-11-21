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
 * A player's playing handicap for this round: the one recorded for it if there is one, else
 * worked out from their index; null when there is no index to work from. A nine-hole round
 * plays half of it, rounded.
 */
export function playingFor(
  player: RoundPlayer,
  tee: Tee,
  rules: HouseRules,
  holes: Holes,
): number | null {
  const full =
    player.storedPlaying ??
    (player.index == null ? null : playingHandicap(player.index, tee, rules.allowance));
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
