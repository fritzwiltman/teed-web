import { TestBed } from '@angular/core/testing';
import { RoundRow, RoundsService, TripRules, roundInput, safeResult } from './rounds';
import { nassauRow, roundRow } from './rounds.testing';
import { ScoreQueue } from './score-queue';
import { SUPABASE } from './supabase';

const RULES: TripRules = { handicap_allowance: 1, strokes_off_low: true, pickup_net_double: true };

describe('roundInput', () => {
  it('hands the engine the group in order, the house rules and the raw scores', () => {
    const input = roundInput(roundRow({}, { me: [4, 5], dad: [6] }), RULES, []);
    expect(input.players.map((p) => [p.name, p.index])).toEqual([
      ['Fritz', 10],
      ['Dad', 20],
      ['Brother', 10],
    ]);
    expect(input.rules).toEqual({ allowance: 1, offLowMan: true, pickupNetDouble: true });
    expect(input.scores).toEqual([
      { playerId: 'me', hole: 1, strokes: 4, pickedUp: false },
      { playerId: 'me', hole: 2, strokes: 5, pickedUp: false },
      { playerId: 'dad', hole: 1, strokes: 6, pickedUp: false },
    ]);
    expect(input.formats.map((f) => f.key)).toEqual(['stroke', 'nine_point']);
    expect(input.players.every((p) => p.storedPlaying === null)).toBe(true);
  });

  it('a score still on its way shows at once, over what the server last said', () => {
    const pending = [
      { round_id: 'r1', player_id: 'me', hole: 1, strokes: 3, picked_up: false, at: 1 },
      { round_id: 'r1', player_id: 'bro', hole: 1, strokes: 5, picked_up: false, at: 2 },
      { round_id: 'another-round', player_id: 'me', hole: 2, strokes: 9, picked_up: false, at: 3 },
    ];
    const input = roundInput(roundRow({}, { me: [4], dad: [6] }), RULES, pending);
    const result = safeResult(input);
    expect(result.holes[0].strokes).toEqual({ me: 3, dad: 6, bro: 5 });
    expect(result.holes[0].games[0].values).toEqual({ me: 5, dad: 2, bro: 2 }); // nets 3, 5, 5
    expect(result.holes[1].strokes['me']).toBeUndefined();
  });
});

describe('RoundsService', () => {
  function make(rounds: RoundRow[] | 'offline') {
    const handlers: ((change: unknown) => void)[] = [];
    const channel = {
      on: vi.fn((_kind: string, _filter: unknown, handler: (change: unknown) => void) => {
        handlers.push(handler);
        return channel;
      }),
      subscribe: vi.fn(() => channel),
    };
    const update = vi.fn();
    const db = {
      rpc: vi.fn(async () => ({ data: null, error: null })),
      from: (table: string) => {
        if (rounds === 'offline') throw new TypeError('Failed to fetch');
        if (table === 'trips')
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: RULES, error: null }) }),
            }),
          };
        return {
          select: () => ({ eq: () => ({ order: async () => ({ data: rounds, error: null }) }) }),
          update: (fields: unknown) => {
            update(fields);
            return { eq: () => ({ select: async () => ({ data: [{ id: 'r1' }], error: null }) }) };
          },
        };
      },
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    };
    const pending = vi.fn(() => []);
    const queue = { pending, put: vi.fn(), onSaved: null as null | ((s: unknown[]) => void) };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: SUPABASE, useValue: db },
        { provide: ScoreQueue, useValue: queue },
      ],
    });
    return { service: TestBed.inject(RoundsService), db, queue, handlers, update };
  }

  beforeEach(() => localStorage.clear());

  it('loads the trip’s rounds, finalizing any that are due first, and scores them', async () => {
    const { service, db } = make([roundRow({}, { me: [4], dad: [5], bro: [6] })]);
    expect(await service.load('t1')).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith('finalize_due_rounds', { p_trip_id: 't1' });
    const [round] = service.for('t1');
    expect(round.result.state).toBe('live');
    expect(round.result.games[0].total).toEqual({ me: 4, dad: 4, bro: 1 }); // nets 4, 4 (Dad's 5 less a stroke), 6
    expect(service.for('another-trip')).toEqual([]);
  });

  it('opens from the phone with no signal', async () => {
    await make([roundRow()]).service.load('t1');
    const { service } = make('offline');
    expect(service.for('t1')).toHaveLength(1);
    expect(await service.load('t1')).toBe(false);
    expect(service.for('t1')).toHaveLength(1);
  });

  it('a score from another phone arrives over Realtime and changes the board', async () => {
    const { service, handlers } = make([roundRow()]);
    await service.watch('t1');
    expect(service.for('t1')[0].result.state).toBe('scheduled');
    const scores = handlers[0];
    scores({ eventType: 'INSERT', new: { round_id: 'r1', player_id: 'dad', hole: 1, strokes: 5 } });
    expect(service.for('t1')[0].result.holes[0].strokes['dad']).toBe(5);
    scores({ eventType: 'UPDATE', new: { round_id: 'r1', player_id: 'dad', hole: 1, strokes: 4 } });
    expect(service.for('t1')[0].result.holes[0].strokes['dad']).toBe(4);
    scores({
      eventType: 'UPDATE',
      new: { round_id: 'r1', player_id: 'dad', hole: 1, strokes: 7, picked_up: true },
    });
    expect(service.for('t1')[0].result.holes[0].pickedUp['dad']).toBe(true);
    scores({ eventType: 'DELETE', old: { round_id: 'r1', player_id: 'dad', hole: 1 } });
    expect(service.for('t1')[0].result.holes[0].strokes['dad']).toBeUndefined();
    // Another trip's score is none of this trip's business.
    scores({
      eventType: 'INSERT',
      new: { round_id: 'elsewhere', player_id: 'x', hole: 1, strokes: 3 },
    });
    expect(service.for('t1')).toHaveLength(1);
  });

  it('entering a score goes through the queue; a confirmed one joins the round', async () => {
    const { service, queue } = make([roundRow()]);
    await service.load('t1');
    service.setScore('r1', 'me', 3, 4);
    expect(queue.put).toHaveBeenCalledWith('r1', 'me', 3, 4, false);
    queue.onSaved!([
      { round_id: 'r1', player_id: 'me', hole: 3, strokes: 4, picked_up: false, at: 1 },
    ]);
    expect(service.for('t1')[0].result.holes[2].strokes['me']).toBe(4);
    // A pickup keeps its mark all the way to the round.
    service.setScore('r1', 'dad', 3, 7, true);
    expect(queue.put).toHaveBeenCalledWith('r1', 'dad', 3, 7, true);
    queue.onSaved!([
      { round_id: 'r1', player_id: 'dad', hole: 3, strokes: 7, picked_up: true, at: 2 },
    ]);
    expect(service.for('t1')[0].result.holes[2].pickedUp['dad']).toBe(true);
  });

  it('finalizes a round', async () => {
    const { service, update } = make([roundRow()]);
    await service.load('t1');
    expect(await service.finalize('r1')).toBe(true);
    expect(update).toHaveBeenCalledWith({ status: 'final' });
    expect(service.for('t1')[0].result.state).toBe('final');
  });
});

describe('presses and reopening', () => {
  function make(row: RoundRow, insertError: { code: string } | null | 'offline' = null) {
    const insert = vi.fn(async (_row: unknown) => {
      if (insertError === 'offline') throw new TypeError('Failed to fetch');
      return { error: insertError };
    });
    const rpc = vi.fn(async (name: string, _args?: unknown) => ({
      data: null,
      error: name === 'reopen_round' && row.status !== 'final' ? { code: '23514' } : null,
    }));
    const db = {
      rpc,
      from: (table: string) => {
        if (table === 'presses') return { insert };
        if (table === 'trips')
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: RULES, error: null }) }),
            }),
          };
        return {
          select: () => ({ eq: () => ({ order: async () => ({ data: [row], error: null }) }) }),
        };
      },
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: SUPABASE, useValue: db },
        { provide: ScoreQueue, useValue: { pending: () => [], put: vi.fn(), onSaved: null } },
      ],
    });
    return { service: TestBed.inject(RoundsService), insert, rpc };
  }
  const labels = (service: RoundsService) =>
    service.for('t1')[0].result.games[0].bets!.map((b) => b.label);

  beforeEach(() => localStorage.clear());

  it('hands the engine a match game’s presses', () => {
    const row = nassauRow(18);
    row.round_formats[1].presses = [{ bet: 'front', after_hole: 6 }];
    expect(roundInput(row, RULES, []).formats[1].presses).toEqual([{ bet: 'front', afterHole: 6 }]);
  });

  it('a press is saved for the group and shows at once', async () => {
    const { service, insert } = make(nassauRow(6));
    await service.load('t1');
    expect(labels(service)).toEqual(['Front', 'Back', 'Overall']);
    expect(await service.press('r1', 'nassau', 'front', 6)).toBe(true);
    expect(insert).toHaveBeenCalledWith({
      round_id: 'r1',
      round_format_id: 'f-nassau',
      group_id: 'g',
      bet: 'front',
      after_hole: 6,
    });
    expect(labels(service)).toEqual(['Front', 'Front press', 'Back', 'Overall']);
  });

  it('a press the server already has is still one press', async () => {
    const { service } = make(nassauRow(6), { code: '23505' });
    await service.load('t1');
    expect(await service.press('r1', 'nassau', 'front', 6)).toBe(true);
    expect(labels(service)).toEqual(['Front', 'Front press', 'Back', 'Overall']);
  });

  it('a press needs signal: with none, or refused, nothing changes', async () => {
    for (const failure of ['offline', { code: '42501' }] as const) {
      const { service } = make(nassauRow(6), failure);
      await service.load('t1');
      expect(await service.press('r1', 'nassau', 'front', 6)).toBe(false);
      expect(labels(service)).toEqual(['Front', 'Back', 'Overall']);
    }
  });

  it('reopening sets a final round back to live', async () => {
    const { service, rpc } = make(nassauRow(18, { status: 'final' }));
    await service.load('t1');
    expect(service.for('t1')[0].result.state).toBe('final');
    expect(await service.reopen('r1')).toBe(true);
    expect(rpc).toHaveBeenCalledWith('reopen_round', { p_round_id: 'r1' });
    expect(service.for('t1')[0].result.state).toBe('complete');
  });

  it('says so when the server refuses to reopen', async () => {
    const { service } = make(nassauRow(18));
    await service.load('t1');
    expect(await service.reopen('r1')).toBe(false);
  });
});
