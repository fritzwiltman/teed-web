// The scoring engine: pure TypeScript, no Angular. Raw strokes in, results out, nothing stored.

export * from './types';
export {
  courseHandicap,
  playingFor,
  playingHandicap,
  roundStrokes,
  strokesReceived,
} from './handicap';
export { holesInPlay, netDoubleBogey, strokesByHole } from './strokes';
export { NinePointError, ninePoint, splitNine } from './nine-point';
export type { NinePointResult } from './nine-point';
export { POINTS_PAR, SettleError, addNets, fewestPayments, ninePointNets } from './settle';
export { nextHole, scoreRound } from './round';
export type { GameHole, GameResult, HoleResult, PlayerResult, RoundResult } from './round';
export {
  moneyText,
  pointValueText,
  roundBoard,
  roundNets,
  settleUp,
  toParText,
  tripBoard,
  tripNets,
} from './present';
export type { BoardTable, SettleUp, TableRow } from './present';
