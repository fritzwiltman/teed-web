import { Payment } from './types';

/** Thrown when money doesn't balance. It always should: this guards the engine itself. */
export class SettleError extends Error {}

/** Par in the 9-point game: 3 points a hole. */
export const POINTS_PAR = 3;

/**
 * What each player is up or down, in cents, against par (3 points a hole) over the holes all
 * three have finished. Always sums to zero.
 */
export function ninePointNets(
  points: Record<string, number>,
  completedHoles: number,
  pointValueCents: number,
): Record<string, number> {
  const nets: Record<string, number> = {};
  for (const [id, total] of Object.entries(points))
    nets[id] = (total - POINTS_PAR * completedHoles) * pointValueCents + 0;
  assertZeroSum(nets);
  return nets;
}

/** Adds rounds' nets together, player by player. */
export function addNets(rounds: Record<string, number>[]): Record<string, number> {
  const total: Record<string, number> = {};
  for (const nets of rounds)
    for (const [id, cents] of Object.entries(nets)) total[id] = (total[id] ?? 0) + cents;
  assertZeroSum(total);
  return total;
}

/**
 * Reduces what everyone is up or down to the fewest payments: whoever owes most pays whoever is
 * owed most, until all are square. Never more than one payment fewer than there are players
 * (two, for three players).
 */
export function fewestPayments(nets: Record<string, number>): Payment[] {
  assertZeroSum(nets);
  const order = Object.keys(nets);
  const left = { ...nets };
  const payments: Payment[] = [];
  const pick = (sign: 1 | -1) =>
    order
      .filter((id) => left[id] * sign > 0)
      .sort((a, b) => left[b] * sign - left[a] * sign || order.indexOf(a) - order.indexOf(b))[0];

  for (;;) {
    const to = pick(1);
    const from = pick(-1);
    if (!to || !from) break;
    const cents = Math.min(left[to], -left[from]);
    payments.push({ from, to, cents });
    left[to] -= cents;
    left[from] += cents;
  }
  return payments;
}

function assertZeroSum(nets: Record<string, number>): void {
  const sum = Object.values(nets).reduce((a, b) => a + b, 0);
  if (sum !== 0) throw new SettleError(`Nets are off by ${sum} cents`);
}
