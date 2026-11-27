// A made-up round for tests. Not used by the app.

import { RoundRow } from './rounds';

/** A round at a par-72, slope-113 course: a course handicap is the index. */
export function roundRow(
  over: Partial<RoundRow> = {},
  scores: Record<string, number[]> = {},
): RoundRow {
  const player = (id: string, name: string, index: number | null, position: number) => ({
    position,
    playing_handicap: null,
    player: { id, name, initials: name[0], handicap_index: index },
    scores: (scores[id] ?? []).map((strokes, i) => ({ hole: i + 1, strokes })),
  });
  return {
    id: 'r1',
    round_number: 1,
    play_date: '2026-11-26',
    tee_time: '08:10:00',
    status: 'scheduled',
    holes: '18',
    courses: { id: 'c', name: 'PGA National Palmer', short_name: 'Palmer', photo_path: null },
    tees: {
      id: 't',
      name: 'Blue',
      yards: 6412,
      rating: 72,
      slope: 113,
      par: Array<number>(18).fill(4),
      stroke_index: Array.from({ length: 18 }, (_, i) => i + 1),
      hole_yards: null,
    },
    round_formats: [
      { format_key: 'stroke', settings: {}, sort_order: 0 },
      { format_key: 'nine_point', settings: { point_value_cents: 50 }, sort_order: 1 },
    ],
    groups: [
      {
        id: 'g',
        group_number: 1,
        // Out of order on purpose: the group is read by position.
        group_players: [
          player('bro', 'Brother', 10, 3),
          player('me', 'Fritz', 10, 1),
          player('dad', 'Dad', 20, 2),
        ],
      },
    ],
    ...over,
  };
}

/** The hand-worked Nassau (src/app/scoring/nassau.spec.ts): Fritz's and Brother's strokes. */
export const NASSAU_FRITZ = [6, 6, 7, 5, 6, 5, 5, 5, 4, 5, 4, 6, 4, 5, 3, 5, 4, 4];
export const NASSAU_BRO = [4, 4, 4, 4, 4, 4, 4, 3, 5, 4, 5, 5, 4, 4, 4, 4, 5, 6];

/**
 * A Nassau round for tests: Fritz (10.0, a stroke on holes 1 to 6) against Brother (4.0), $5 a
 * side, played through `thru` holes of the hand-worked round. Brother wins the front 4 & 3
 * after 6, the back is halved, and Brother wins the overall 6 & 5 after 13.
 */
export function nassauRow(
  thru = 0,
  over: Partial<RoundRow> = {},
  settings: Record<string, unknown> = {},
): RoundRow {
  const base = roundRow();
  const player = (id: string, name: string, index: number, position: number, all: number[]) => ({
    position,
    playing_handicap: null,
    player: { id, name, initials: name[0], handicap_index: index },
    scores: all.slice(0, thru).map((strokes, i) => ({ hole: i + 1, strokes })),
  });
  return {
    ...base,
    round_formats: [
      { id: 'f-stroke', format_key: 'stroke', settings: {}, sort_order: 0 },
      {
        id: 'f-nassau',
        format_key: 'nassau',
        settings: {
          stake_front_cents: 500,
          stake_back_cents: 500,
          stake_overall_cents: 500,
          auto_press: false,
          press_at: 'closed',
          ...settings,
        },
        sort_order: 1,
        presses: [],
      },
    ],
    groups: [
      {
        id: 'g',
        group_number: 1,
        group_players: [
          player('me', 'Fritz', 10, 1, NASSAU_FRITZ),
          player('bro', 'Brother', 4, 2, NASSAU_BRO),
        ],
      },
    ],
    ...over,
  };
}
