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
export { NassauError, nassau, nassauSettings } from './nassau';
export type {
  ManualPress,
  NassauBet,
  NassauResult,
  NassauSettings,
  NassauSide,
  PressAt,
} from './nassau';
export { NinePointError, ninePoint, splitNine } from './nine-point';
export type { NinePointResult } from './nine-point';
export { POINTS_PAR, SettleError, addNets, fewestPayments, ninePointNets } from './settle';
export { nextHole, scoreRound } from './round';
export type { GameHole, GameResult, HoleResult, PlayerResult, RoundResult } from './round';
export {
  matchCards,
  matchStatus,
  moneyText,
  pointValueText,
  pressable,
  roundBoard,
  roundNets,
  settleUp,
  toParText,
  tripBoard,
  tripNets,
} from './present';
export type { BoardTable, MatchCard, Pressable, SettleUp, TableRow } from './present';
