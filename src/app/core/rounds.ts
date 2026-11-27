import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { Holes, RoundInput, RoundResult, scoreRound } from '../scoring';
import { PendingScore, ScoreQueue } from './score-queue';
import { SUPABASE } from './supabase';

/** A round as the database has it, with its course, tees, games, group and raw scores. */
export interface RoundRow {
  id: string;
  round_number: number;
  play_date: string;
  tee_time: string | null;
  status: 'scheduled' | 'live' | 'final';
  holes: Holes;
  courses: {
    id: string;
    name: string;
    short_name: string | null;
    photo_path: string | null;
  } | null;
  tees: {
    id: string;
    name: string;
    yards: number | null;
    rating: number | null;
    slope: number | null;
    par: number[];
    stroke_index: number[];
    hole_yards: number[] | null;
  } | null;
  round_formats: {
    id?: string;
    format_key: string;
    settings: Record<string, unknown>;
    sort_order: number;
    /** Presses made by hand in a match game. */
    presses?: { bet: string; after_hole: number }[];
  }[];
  groups: {
    id: string;
    group_number: number;
    group_players: {
      position: number;
      course_handicap?: number | null;
      playing_handicap: number | null;
      /** The tees this player plays, when they aren't the round's. */
      tee?: {
        id: string;
        name: string;
        yards: number | null;
        rating: number | null;
        slope: number | null;
        par: number[];
        stroke_index: number[];
      } | null;
      player: { id: string; name: string; initials: string; handicap_index: number | null } | null;
      scores: { hole: number; strokes: number; picked_up?: boolean }[];
    }[];
  }[];
}

/** The house rules the engine needs. */
export interface TripRules {
  handicap_allowance: number;
  strokes_off_low: boolean;
  pickup_net_double: boolean;
}

/** A round with what the engine makes of it. */
export interface RoundView {
  row: RoundRow;
  result: RoundResult;
}

interface Loaded {
  tripId: string;
  rules: TripRules;
  rounds: RoundRow[];
}

const KEY = 'teed.rounds';
const ROUND_COLUMNS =
  'id, round_number, play_date, tee_time, status, holes, courses(id, name, short_name, photo_path), ' +
  'tees(id, name, yards, rating, slope, par, stroke_index, hole_yards), ' +
  'round_formats(id, format_key, settings, sort_order, presses(bet, after_hole)), ' +
  'groups(id, group_number, group_players(position, course_handicap, playing_handicap, ' +
  'tee:tees(id, name, yards, rating, slope, par, stroke_index), ' +
  'player:trip_members(id, name, initials, handicap_index), scores(hole, strokes, picked_up)))';

/** What the engine is given for a round: its rows, the house rules, and scores still on their way. */
export function roundInput(row: RoundRow, rules: TripRules, pending: PendingScore[]): RoundInput {
  const players = row.groups
    .slice()
    .sort((a, b) => a.group_number - b.group_number)
    .flatMap((g) => g.group_players.slice().sort((a, b) => a.position - b.position))
    .filter((gp) => gp.player);
  const scores = new Map<
    string,
    { playerId: string; hole: number; strokes: number; pickedUp: boolean }
  >();
  for (const gp of players)
    for (const s of gp.scores ?? [])
      scores.set(`${gp.player!.id}:${s.hole}`, {
        playerId: gp.player!.id,
        hole: s.hole,
        strokes: s.strokes,
        pickedUp: !!s.picked_up,
      });
  // A score entered on this phone shows at once, before the server has it.
  for (const p of pending)
    if (p.round_id === row.id && players.some((gp) => gp.player!.id === p.player_id))
      scores.set(`${p.player_id}:${p.hole}`, {
        playerId: p.player_id,
        hole: p.hole,
        strokes: p.strokes,
        pickedUp: !!p.picked_up,
      });
  return {
    id: row.id,
    number: row.round_number,
    holes: row.holes ?? '18',
    status: row.status,
    tee: {
      par: row.tees?.par ?? [],
      strokeIndex: row.tees?.stroke_index ?? [],
      rating: row.tees?.rating ?? null,
      slope: row.tees?.slope ?? null,
      name: row.tees?.name ?? null,
    },
    rules: {
      allowance: Number(rules.handicap_allowance),
      offLowMan: rules.strokes_off_low,
      pickupNetDouble: rules.pickup_net_double,
    },
    players: players.map((gp) => ({
      id: gp.player!.id,
      name: gp.player!.name,
      index: gp.player!.handicap_index == null ? null : Number(gp.player!.handicap_index),
      tee: gp.tee
        ? {
            par: gp.tee.par,
            strokeIndex: gp.tee.stroke_index,
            rating: gp.tee.rating,
            slope: gp.tee.slope,
            name: gp.tee.name,
          }
        : null,
      storedCourse: gp.course_handicap ?? null,
      storedPlaying: gp.playing_handicap,
    })),
    scores: [...scores.values()],
    formats: row.round_formats
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((f) => ({
        key: f.format_key,
        settings: f.settings ?? {},
        presses: (f.presses ?? []).map((p) => ({ bet: p.bet, afterHole: p.after_hole })),
      })),
  };
}

/** Scores a round without letting one bad round take the screen down. */
export function safeResult(input: RoundInput): RoundResult {
  try {
    return scoreRound(input);
  } catch {
    // The engine refused its own totals. Show the round with no games rather than nothing.
    return scoreRound({ ...input, formats: input.formats.filter((f) => f.key === 'stroke') });
  }
}

/**
 * The open trip's rounds and their live results.
 *
 * Rounds are read once, saved on the phone (so the scorecard opens with no signal), and kept
 * current over Realtime: a score entered on any phone in the trip arrives here within a moment.
 * Scores entered on this phone go through ScoreQueue and show straight away.
 */
@Injectable({ providedIn: 'root' })
export class RoundsService {
  private readonly db = inject(SUPABASE);
  private readonly queue = inject(ScoreQueue);

  private readonly loaded = signal<Loaded | null>(this.restore());
  private channel: RealtimeChannel | null = null;
  private pressChannel: RealtimeChannel | null = null;
  private watching: string | null = null;

  /** The trip whose rounds are in hand. */
  readonly tripId = computed(() => this.loaded()?.tripId ?? null);
  /** That trip's house rules. */
  readonly rules = computed(() => this.loaded()?.rules ?? null);

  /** Every round of the trip in hand, in order, scored. */
  readonly rounds = computed<RoundView[]>(() => {
    const loaded = this.loaded();
    if (!loaded) return [];
    const pending = this.queue.pending();
    return loaded.rounds.map((row) => ({
      row,
      result: safeResult(roundInput(row, loaded.rules, pending)),
    }));
  });

  constructor() {
    this.queue.onSaved = (scores) => {
      for (const s of scores)
        this.applyScore(s.round_id, s.player_id, s.hole, s.strokes, !!s.picked_up);
    };
    if (typeof document !== 'undefined') {
      // Back from the lock screen: Realtime may have missed a few.
      const seen = () => {
        if (document.visibilityState === 'visible' && this.watching) void this.load(this.watching);
      };
      document.addEventListener('visibilitychange', seen);
      inject(DestroyRef).onDestroy(() => document.removeEventListener('visibilitychange', seen));
    }
  }

  /** The rounds for this trip, if they are the ones in hand. */
  for(tripId: string | undefined): RoundView[] {
    return tripId && this.tripId() === tripId ? this.rounds() : [];
  }

  /**
   * Reads the trip's rounds (finalizing any that are due first). Returns false, keeping what the
   * phone has, when the server can't be reached.
   */
  async load(tripId: string): Promise<boolean> {
    try {
      await this.db.rpc('finalize_due_rounds', { p_trip_id: tripId }).then(
        () => undefined,
        () => undefined,
      );
      const [trip, rounds] = await Promise.all([
        this.db
          .from('trips')
          .select('handicap_allowance, strokes_off_low, pickup_net_double')
          .eq('id', tripId)
          .maybeSingle(),
        this.db.from('rounds').select(ROUND_COLUMNS).eq('trip_id', tripId).order('round_number'),
      ]);
      if (trip.error || rounds.error || !trip.data) return false;
      this.set({
        tripId,
        rules: trip.data as TripRules,
        rounds: (rounds.data ?? []) as unknown as RoundRow[],
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Loads the trip and keeps it current until `unwatch()` or another trip is watched. */
  async watch(tripId: string): Promise<void> {
    if (this.loaded() && this.loaded()!.tripId !== tripId) this.loaded.set(null);
    if (this.watching !== tripId) {
      this.unwatch();
      this.watching = tripId;
      try {
        this.channel = this.db
          .channel(`trip-${tripId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, (change) => {
            const row = (change.eventType === 'DELETE' ? change.old : change.new) as {
              round_id?: string;
              player_id?: string;
              hole?: number;
              strokes?: number;
              picked_up?: boolean;
            };
            if (!row.round_id || !row.player_id || !row.hole) return;
            this.applyScore(
              row.round_id,
              row.player_id,
              row.hole,
              change.eventType === 'DELETE' ? null : (row.strokes ?? null),
              !!row.picked_up,
            );
          })
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'rounds', filter: `trip_id=eq.${tripId}` },
            () => void this.load(tripId),
          )
          .subscribe((status) => {
            // (Re)connected: catch up on anything missed while away.
            if (status === 'SUBSCRIBED') void this.load(tripId);
          });
        // A press made on another phone, on a channel of its own: if presses aren't published
        // yet (the migration not run), that must not cost the scores their channel.
        this.pressChannel = this.db
          .channel(`trip-${tripId}-presses`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'presses' }, () => {
            void this.load(tripId);
          })
          .subscribe();
      } catch {
        // No Realtime: the screens still load and reload.
      }
    }
    await this.load(tripId);
  }

  unwatch(): void {
    if (this.channel) void this.db.removeChannel(this.channel);
    if (this.pressChannel) void this.db.removeChannel(this.pressChannel);
    this.channel = null;
    this.pressChannel = null;
    this.watching = null;
  }

  /** Enters a score: it shows at once and is sent as soon as there is signal. */
  setScore(
    roundId: string,
    playerId: string,
    hole: number,
    strokes: number,
    pickedUp = false,
  ): void {
    this.queue.put(roundId, playerId, hole, strokes, pickedUp);
  }

  /** The organizer makes a complete round official. */
  async finalize(roundId: string): Promise<boolean> {
    try {
      const { data, error } = await this.db
        .from('rounds')
        .update({ status: 'final' })
        .eq('id', roundId)
        .select('id');
      if (error || !data?.length) return false;
      this.patchRound(roundId, (row) => ({ ...row, status: 'final' }));
      return true;
    } catch {
      return false;
    }
  }

  /** An organizer sets a final round back to live, so its scores can be corrected. */
  async reopen(roundId: string): Promise<boolean> {
    try {
      const { error } = await this.db.rpc('reopen_round', { p_round_id: roundId });
      if (error) return false;
      this.patchRound(roundId, (row) => ({ ...row, status: 'live' }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Presses a bet in a match game, starting on the hole after `afterHole`. Needs signal: false
   * when the server can't be reached or refuses. Pressing the same bet twice is one press.
   */
  async press(roundId: string, game: string, bet: string, afterHole: number): Promise<boolean> {
    const row = this.loaded()?.rounds.find((r) => r.id === roundId);
    const format = row?.round_formats.find((f) => f.format_key === game);
    const group = row?.groups[0];
    if (!format?.id || !group) return false;
    try {
      const { error } = await this.db.from('presses').insert({
        round_id: roundId,
        round_format_id: format.id,
        group_id: group.id,
        bet,
        after_hole: afterHole,
      });
      if (error && error.code !== '23505') return false;
      this.patchRound(roundId, (r) => ({
        ...r,
        round_formats: r.round_formats.map((f) =>
          f.format_key !== game
            ? f
            : {
                ...f,
                presses: [
                  ...(f.presses ?? []).filter(
                    (p) => !(p.bet === bet && p.after_hole === afterHole),
                  ),
                  { bet, after_hole: afterHole },
                ],
              },
        ),
      }));
      return true;
    } catch {
      return false;
    }
  }

  /** Puts one score (or its removal) into the rounds in hand. */
  private applyScore(
    roundId: string,
    playerId: string,
    hole: number,
    strokes: number | null,
    pickedUp = false,
  ): void {
    this.patchRound(roundId, (row) => ({
      ...row,
      groups: row.groups.map((group) => ({
        ...group,
        group_players: group.group_players.map((gp) => {
          if (gp.player?.id !== playerId) return gp;
          const others = (gp.scores ?? []).filter((s) => s.hole !== hole);
          return {
            ...gp,
            scores: strokes == null ? others : [...others, { hole, strokes, picked_up: pickedUp }],
          };
        }),
      })),
    }));
  }

  private patchRound(roundId: string, change: (row: RoundRow) => RoundRow): void {
    const loaded = this.loaded();
    if (!loaded?.rounds.some((r) => r.id === roundId)) return;
    this.set({
      ...loaded,
      rounds: loaded.rounds.map((r) => (r.id === roundId ? change(r) : r)),
    });
  }

  private set(loaded: Loaded): void {
    this.loaded.set(loaded);
    try {
      localStorage.setItem(KEY, JSON.stringify(loaded));
    } catch {
      // storage unavailable: kept until the app is closed
    }
  }

  private restore(): Loaded | null {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Loaded | null;
      return saved?.tripId && Array.isArray(saved.rounds) && saved.rules ? saved : null;
    } catch {
      return null;
    }
  }
}
