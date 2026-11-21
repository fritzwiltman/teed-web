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
