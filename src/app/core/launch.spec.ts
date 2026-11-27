import { localDate } from './format';
import { launchTarget } from './launch';
import { RoundRow, RoundView, TripRules, roundInput, safeResult } from './rounds';
import { roundRow } from './rounds.testing';

const RULES: TripRules = { handicap_allowance: 1, strokes_off_low: true, pickup_net_double: true };
const view = (row: RoundRow): RoundView => ({
  row,
  result: safeResult(roundInput(row, RULES, [])),
});
const all = (n: number) => Array<number>(n).fill(4);

describe('where opening the app lands', () => {
  // 9:00 on a round day.
  const NOW = new Date(2026, 10, 29, 9, 0);
  const TODAY = localDate(NOW);
  const today = (over: Partial<RoundRow> = {}, scores: Record<string, number[]> = {}) =>
    view(roundRow({ play_date: TODAY, tee_time: null, ...over }, scores));

  it('the Scorecard once a score is in on my round today', () => {
    expect(launchTarget([today({}, { dad: [5] })], 'me', NOW)).toBe('/score');
  });

  it('the Scorecard from 30 minutes before the tee time, not sooner', () => {
    expect(launchTarget([today({ tee_time: '09:30:00' })], 'me', NOW)).toBe('/score');
    expect(launchTarget([today({ tee_time: '09:31:00' })], 'me', NOW)).toBeNull();
    expect(launchTarget([today({ tee_time: '07:00:00' })], 'me', NOW)).toBe('/score');
  });

  it('nowhere special before any score when the round has no tee time', () => {
    expect(launchTarget([today()], 'me', NOW)).toBeNull();
  });

  it('the Board once my group’s card is complete', () => {
    const done = today({}, { me: all(18), dad: all(18), bro: all(18) });
    expect(launchTarget([done], 'me', NOW)).toBe('/board');
  });

  it('nowhere special for a final round, another day’s round, or a round I am not in', () => {
    const scores = { me: all(18), dad: all(18), bro: all(18) };
    expect(launchTarget([today({ status: 'final' }, scores)], 'me', NOW)).toBeNull();
    expect(
      launchTarget([view(roundRow({ play_date: '2026-11-28' }, { dad: [5] }))], 'me', NOW),
    ).toBeNull();
    expect(launchTarget([today({}, { dad: [5] })], 'someone-else', NOW)).toBeNull();
    expect(launchTarget([today({}, { dad: [5] })], null, NOW)).toBeNull();
    expect(launchTarget([], 'me', NOW)).toBeNull();
  });

  it('two rounds today: the Scorecard while either is still to finish', () => {
    const morning = today({ id: 'am' }, { me: all(18), dad: all(18), bro: all(18) });
    const afternoon = today({ id: 'pm', round_number: 2 }, { me: [4] });
    expect(launchTarget([morning, afternoon], 'me', NOW)).toBe('/score');
  });
});
