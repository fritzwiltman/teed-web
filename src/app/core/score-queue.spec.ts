import { TestBed } from '@angular/core/testing';
import { ScoreQueue } from './score-queue';
import { SUPABASE } from './supabase';

type Answer = { error: null | { message: string }; status: number } | 'offline';

describe('ScoreQueue', () => {
  let answers: Answer[];
  let upsert: ReturnType<typeof vi.fn>;

  function make(): ScoreQueue {
    upsert = vi.fn(async (_rows: unknown[], _options: unknown) => {
      const answer = answers.length > 1 ? answers.shift()! : answers[0];
      if (answer === 'offline') throw new TypeError('Failed to fetch');
      return answer;
    });
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [{ provide: SUPABASE, useValue: { from: () => ({ upsert }) } }],
    });
    return TestBed.inject(ScoreQueue);
  }
  const OK: Answer = { error: null, status: 201 };
  const sent = (call = 0) => upsert.mock.calls[call][0] as Record<string, unknown>[];
  const settle = () => new Promise((r) => setTimeout(r));

  beforeEach(() => {
    localStorage.clear();
    answers = [OK];
    vi.useRealTimers();
  });

  it('sends a score keyed by round, player and hole, and clears it once the server has it', async () => {
    const queue = make();
    const saved = vi.fn();
    queue.onSaved = saved;
    queue.put('r1', 'dad', 7, 5);
    expect(queue.count()).toBe(1); // on the phone before anything is sent
    await settle();
    expect(sent()).toEqual([
      { round_id: 'r1', player_id: 'dad', hole: 7, strokes: 5, picked_up: false },
    ]);
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'round_id,player_id,hole' });
    expect(saved).toHaveBeenCalledTimes(1);
    expect(queue.count()).toBe(0);
    expect(localStorage.getItem('teed.scores.pending')).toBeNull();
  });

  it('a pickup is sent marked, and a played score after it is sent unmarked', async () => {
    const queue = make();
    queue.put('r1', 'dad', 7, 7, true);
    await settle();
    expect(sent()).toEqual([
      { round_id: 'r1', player_id: 'dad', hole: 7, strokes: 7, picked_up: true },
    ]);
    queue.put('r1', 'dad', 7, 6);
    await settle();
    expect(sent(1)).toEqual([
      { round_id: 'r1', player_id: 'dad', hole: 7, strokes: 6, picked_up: false },
    ]);
  });

  it('with no signal, keeps the scores and says how many are waiting', async () => {
    answers = ['offline'];
    const queue = make();
    queue.put('r1', 'dad', 7, 5);
    queue.put('r1', 'me', 7, 4);
    await settle();
    expect(queue.count()).toBe(2);
    expect(queue.refused()).toBe(0);
    expect(JSON.parse(localStorage.getItem('teed.scores.pending')!)).toHaveLength(2);
  });

  it('a second entry for the same hole replaces the first: one score per player per hole', async () => {
    answers = ['offline'];
    const queue = make();
    queue.put('r1', 'dad', 7, 5);
    queue.put('r1', 'dad', 7, 6);
    queue.put('r1', 'dad', 8, 4);
    await settle();
    expect(queue.pending().map((p) => [p.hole, p.strokes])).toEqual([
      [7, 6],
      [8, 4],
    ]);
  });

  it('when signal returns, sends everything once, and a retry is the same upsert', async () => {
    answers = ['offline'];
    const queue = make();
    queue.put('r1', 'dad', 7, 5);
    queue.put('r1', 'me', 7, 4);
    await settle();
    const before = upsert.mock.calls.length;
    answers = [OK];
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(queue.count()).toBe(0);
    expect(upsert.mock.calls.length).toBe(before + 1);
    expect(sent(before)).toEqual([
      { round_id: 'r1', player_id: 'dad', hole: 7, strokes: 5, picked_up: false },
      { round_id: 'r1', player_id: 'me', hole: 7, strokes: 4, picked_up: false },
    ]);
    // Nothing left to send: no duplicate goes out afterwards.
    await queue.flush();
    expect(upsert.mock.calls.length).toBe(before + 1);
  });

  it('retries after a server error or an expired sign-in, and does not drop the score', async () => {
    answers = [
      { error: { message: 'bad gateway' }, status: 502 },
      { error: { message: 'JWT expired' }, status: 401 },
      { error: { message: 'no answer' }, status: 0 },
    ];
    const queue = make();
    queue.put('r1', 'dad', 7, 5);
    await settle();
    await queue.flush();
    await queue.flush();
    expect(queue.count()).toBe(1);
    expect(queue.refused()).toBe(0);
    answers = [OK];
    await queue.flush();
    expect(queue.count()).toBe(0);
  });

  it('survives the app being closed: what was waiting is sent on the next open', async () => {
    answers = ['offline'];
    make().put('r1', 'dad', 7, 5);
    await settle();
    answers = [OK];
    const reopened = make(); // a fresh start reads the phone's saved list
    expect(reopened.count()).toBe(1);
    await settle();
    expect(sent()).toEqual([
      { round_id: 'r1', player_id: 'dad', hole: 7, strokes: 5, picked_up: false },
    ]);
    expect(reopened.count()).toBe(0);
  });

  it('drops a score the server refuses (the round is final) and counts it', async () => {
    answers = [{ error: { message: 'row-level security' }, status: 403 }];
    const queue = make();
    queue.put('r1', 'dad', 7, 5);
    await settle();
    expect(queue.count()).toBe(0);
    expect(queue.refused()).toBe(1);
  });

  it('one refused score does not hold up the others', async () => {
    answers = ['offline'];
    const queue = make();
    queue.put('final-round', 'dad', 18, 5);
    queue.put('r2', 'dad', 1, 4);
    await settle();
    const saved = vi.fn();
    queue.onSaved = saved;
    // The batch is refused; sent one by one, the first is refused and the second saved.
    answers = [
      { error: { message: 'row-level security' }, status: 403 },
      { error: { message: 'row-level security' }, status: 403 },
      OK,
    ];
    await queue.flush();
    expect(queue.count()).toBe(0);
    expect(queue.refused()).toBe(1);
    expect(saved).toHaveBeenCalledWith([expect.objectContaining({ round_id: 'r2', hole: 1 })]);
  });

  it('a score changed while its first value is being sent is sent again, not lost', async () => {
    let release!: (answer: { error: null; status: number }) => void;
    const queue = make();
    upsert.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    queue.put('r1', 'dad', 7, 5);
    await settle();
    queue.put('r1', 'dad', 7, 6); // tapped + while the 5 is in the air
    release({ error: null, status: 201 });
    await vi.waitFor(() => expect(queue.count()).toBe(0));
    expect(sent(1)).toEqual([
      { round_id: 'r1', player_id: 'dad', hole: 7, strokes: 6, picked_up: false },
    ]);
    expect(queue.count()).toBe(0);
  });

  describe('slow', () => {
    afterEach(() => vi.useRealTimers());

    it('says nothing for a score that is saved promptly', async () => {
      const queue = make();
      queue.put('r1', 'dad', 7, 5);
      expect(queue.slow()).toBe(false);
      await settle();
      expect(queue.slow()).toBe(false);
    });

    it('is true once a score has waited more than five seconds, and false again when it is saved', async () => {
      vi.useFakeTimers();
      answers = ['offline'];
      const queue = make();
      queue.put('r1', 'dad', 7, 5);
      await vi.advanceTimersByTimeAsync(4_900);
      expect(queue.slow()).toBe(false);
      await vi.advanceTimersByTimeAsync(200);
      expect(queue.slow()).toBe(true);
      // Another score entered meanwhile doesn't reset the wait: the oldest one still counts.
      queue.put('r1', 'dad', 8, 4);
      expect(queue.slow()).toBe(true);
      answers = [OK];
      await vi.advanceTimersByTimeAsync(60_000);
      expect(queue.count()).toBe(0);
      expect(queue.slow()).toBe(false);
    });

    it('is true straight away for a score left over from before the app was closed', () => {
      localStorage.setItem(
        'teed.scores.pending',
        JSON.stringify([
          {
            round_id: 'r1',
            player_id: 'dad',
            hole: 7,
            strokes: 5,
            picked_up: false,
            at: Date.now() - 60_000,
          },
        ]),
      );
      answers = ['offline'];
      expect(make().slow()).toBe(true);
    });
  });
});
