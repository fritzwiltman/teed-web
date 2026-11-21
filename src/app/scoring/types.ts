// What the scoring engine is given. Plain data: no Angular, no database, nothing stored back.

/** Which holes a round plays. */
export type Holes = '18' | 'front' | 'back';

/** A set of tees: par and stroke index per hole (index 0 = hole 1), and the 18-hole ratings. */
export interface Tee {
  par: number[];
  strokeIndex: number[];
  rating: number | null;
  slope: number | null;
  /** "Blue". Only for showing. */
  name?: string | null;
}

/** The trip's house rules. */
export interface HouseRules {
  /** 1 = 100%, 0.9 = 90%. */
  allowance: number;
  /** Strokes come off the lowest handicap in the group. */
  offLowMan: boolean;
  /** A hole counts at most net double bogey (par + 2 + strokes received). */
  pickupNetDouble: boolean;
}

export interface RoundPlayer {
  id: string;
  name: string;
  /** The handicap index locked for this trip. */
  index: number | null;
  /** The tees this player plays, when they aren't the round's. */
  tee?: Tee | null;
  /** A course handicap recorded for this round (Southern Pines 2026 only), for showing. */
  storedCourse?: number | null;
  /**
   * A playing handicap recorded for this round (after the allowance, before the low man).
   * Only Southern Pines 2026 has these, read off GHIN; when present it is used as is.
   * New rounds never store one: it is always worked out from the index.
   */
  storedPlaying?: number | null;
}

export interface Score {
  playerId: string;
  hole: number;
  strokes: number;
  /** The player picked up: the strokes are net double bogey, and games rank them below finishers. */
  pickedUp?: boolean;
}

export interface RoundFormat {
  key: string;
  settings: Record<string, unknown>;
}

export interface RoundInput {
  id: string;
  number: number;
  holes: Holes;
  status: 'scheduled' | 'live' | 'final';
  tee: Tee;
  rules: HouseRules;
  /** The group, in playing order. */
  players: RoundPlayer[];
  scores: Score[];
  formats: RoundFormat[];
}

/** Who pays whom, in cents. */
export interface Payment {
  from: string;
  to: string;
  cents: number;
}
