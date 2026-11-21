// Turns results into the rows a screen draws. Screens render these; none of them knows a format.

import { addNets, fewestPayments } from './settle';
import { GameResult, RoundResult } from './round';
import { Payment } from './types';

/** One line of a board: position, name, then a cell per column. */
export interface TableRow {
  pos: string;
  name: string;
  cells: string[];
  /** Net under par: the "To par" cell is drawn in red. */
  under: boolean;
  me: boolean;
}

export interface BoardTable {
  columns: string[];
  /** Which column is the one drawn big (and red under par). */
  valueColumn: number;
  rows: TableRow[];
}

/** 'E', '+3', '−2' (a real minus sign). */
export function toParText(value: number | null): string {
  if (value == null) return '–';
  return value === 0 ? 'E' : value > 0 ? `+${value}` : `−${-value}`;
}

/** '$3.00'; with `signed`, '+$3.00' / '−$2.00' / '$0.00'. */
export function moneyText(cents: number, signed = false): string {
  const amount = `$${(Math.abs(cents) / 100).toFixed(2)}`;
  if (!signed || cents === 0) return amount;
  return cents > 0 ? `+${amount}` : `−${amount}`;
}

/** '25¢', '50¢', '$1', '$2.50' for a point value. */
export function pointValueText(cents: number): string {
  if (cents < 100) return `${cents}¢`;
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** Positions for values sorted best first: '1', 'T2', 'T2', '4'. */
function positions<T>(sorted: T[], value: (row: T) => number): string[] {
  return sorted.map((row) => {
    const first = sorted.findIndex((other) => value(other) === value(row));
    const tied = sorted.filter((other) => value(other) === value(row)).length > 1;
    return `${tied ? 'T' : ''}${first + 1}`;
  });
}

/** A round's board: Gross, Net, To par, Thru, then a column per game. Best net to par first. */
export function roundBoard(round: RoundResult, me?: string | null): BoardTable {
  const playing = round.players.filter((p) => p.thru > 0 && p.toPar != null);
  const waiting = round.players.filter((p) => !(p.thru > 0 && p.toPar != null));
  playing.sort((a, b) => a.toPar! - b.toPar!);
  const pos = positions(playing, (p) => p.toPar!);
  const cells = (p: (typeof round.players)[number]) => [
    p.thru ? String(p.gross) : '–',
    p.thru && p.net != null ? String(p.net) : '–',
    p.thru ? toParText(p.toPar) : '–',
    p.thru ? String(p.thru) : '–',
    ...round.games.map((g) => (g.holesCounted ? String(g.total[p.id] ?? 0) : '–')),
  ];
  return {
    columns: ['Gross', 'Net', 'To par', 'Thru', ...round.games.map((g) => g.label)],
    valueColumn: 2,
    rows: [
      ...playing.map((p, i) => ({
        pos: pos[i],
        name: p.name,
        cells: cells(p),
        under: p.toPar! < 0,
        me: p.id === me,
      })),
      ...waiting.map((p) => ({
        pos: '–',
        name: p.name,
        cells: cells(p),
        under: false,
        me: p.id === me,
      })),
    ],
  };
}

/** The trip's board: every round added up. Rounds, Gross, Net, To par, then a column per game. */
export function tripBoard(rounds: RoundResult[], me?: string | null): BoardTable {
  interface Total {
    id: string;
    name: string;
    rounds: number;
    gross: number;
    net: number;
    toPar: number;
    games: Record<string, number>;
  }
  const totals = new Map<string, Total>();
  const gameLabels = new Map<string, string>();
  for (const round of rounds) {
    for (const game of round.games) if (game.holesCounted) gameLabels.set(game.key, game.label);
    for (const p of round.players) {
      const total = totals.get(p.id) ?? {
        id: p.id,
        name: p.name,
        rounds: 0,
        gross: 0,
        net: 0,
        toPar: 0,
        games: {},
      };
      totals.set(p.id, total);
      if (p.thru && p.net != null && p.toPar != null) {
        total.rounds += 1;
        total.gross += p.gross;
        total.net += p.net;
        total.toPar += p.toPar;
      }
      for (const game of round.games)
        total.games[game.key] = (total.games[game.key] ?? 0) + (game.total[p.id] ?? 0);
    }
  }
  const all = [...totals.values()];
  const playing = all.filter((t) => t.rounds > 0).sort((a, b) => a.toPar - b.toPar);
  const waiting = all.filter((t) => t.rounds === 0);
  const pos = positions(playing, (t) => t.toPar);
  const keys = [...gameLabels.keys()];
  const row = (t: Total, position: string): TableRow => ({
    pos: position,
    name: t.name,
    cells: t.rounds
      ? [
          String(t.rounds),
          String(t.gross),
          String(t.net),
          toParText(t.toPar),
          ...keys.map((k) => String(t.games[k] ?? 0)),
        ]
      : ['–', '–', '–', '–', ...keys.map(() => '–')],
    under: t.rounds > 0 && t.toPar < 0,
    me: t.id === me,
  });
  return {
    columns: ['Rounds', 'Gross', 'Net', 'To par', ...keys.map((k) => gameLabels.get(k)!)],
    valueColumn: 3,
    rows: [...playing.map((t, i) => row(t, pos[i])), ...waiting.map((t) => row(t, '–'))],
  };
}

/** What a settle-up card shows: each player up or down, then who pays whom. */
export interface SettleUp {
  nets: { name: string; text: string; me: boolean }[];
  payments: string[];
}

/** A round's money, from every game played for some. Null when nothing is played for money. */
export function roundNets(round: RoundResult): Record<string, number> | null {
  const played = round.games.filter((g): g is GameResult & { settle: object } => !!g.settle);
  return played.length ? addNets(played.map((g) => g.settle!.nets)) : null;
}

/** The trip's money: every round's nets added up, then reduced to the fewest payments. */
export function tripNets(rounds: RoundResult[]): Record<string, number> | null {
  const each = rounds.map(roundNets).filter((n): n is Record<string, number> => !!n);
  return each.length ? addNets(each) : null;
}

/**
 * Words a settle-up for whoever is looking: "+$3.00" beside each name, then "Brother pays you
 * $2.00", "You pay Dad $1.00" or "Dad pays Brother $1.00".
 */
export function settleUp(
  nets: Record<string, number>,
  names: Record<string, string>,
  me?: string | null,
): SettleUp {
  const who = (id: string) => names[id] ?? 'Someone';
  const line = (p: Payment) => {
    const amount = moneyText(p.cents);
    if (p.from === me) return `You pay ${who(p.to)} ${amount}`;
    if (p.to === me) return `${who(p.from)} pays you ${amount}`;
    return `${who(p.from)} pays ${who(p.to)} ${amount}`;
  };
  return {
    nets: Object.entries(nets)
      .sort((a, b) => b[1] - a[1])
      .map(([id, cents]) => ({ name: who(id), text: moneyText(cents, true), me: id === me })),
    payments: fewestPayments(nets).map(line),
  };
}
