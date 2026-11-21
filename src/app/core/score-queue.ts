import { DestroyRef, Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { SUPABASE } from './supabase';

/** A score on its way to the server. One per player per hole: a newer entry replaces an older one. */
export interface PendingScore {
  round_id: string;
  player_id: string;
  hole: number;
  strokes: number;
  /** The player picked up on this hole. */
  picked_up: boolean;
  /** When it was entered on this phone (ms, never repeated). Tells a newer entry from the one being sent. */
  at: number;
}

const KEY = 'teed.scores.pending';
const FIRST_RETRY_MS = 2_000;
const LAST_RETRY_MS = 30_000;

const same = (a: PendingScore, b: PendingScore) =>
  a.round_id === b.round_id && a.player_id === b.player_id && a.hole === b.hole;

/**
 * Scores entered on this phone, kept until the server has them.
 *
 * Every score goes into a list saved on the phone, then is sent. A send that gets no answer
 * (no signal, the server down) is tried again, sooner at first and then every 30 seconds, and
 * straight away when the phone comes back online or the app is reopened. Sending the same score
 * twice is harmless: the server keeps one score per round, player and hole (that is the table's
 * key), so a retry overwrites with the same number and never adds a second. Nothing leaves the
 * list until the server has confirmed it. A score the server refuses (the round is final, or the
 * person is no longer in the group) is dropped and counted in `refused`.
 *
 * Two phones changing the same hole: the last one to reach the server wins. Proper conflict
 * rules and service-worker sync are M5.
 */
@Injectable({ providedIn: 'root' })
export class ScoreQueue {
  private readonly db = inject(SUPABASE);
  private readonly zone = inject(NgZone);

  readonly pending = signal<PendingScore[]>(this.load());
  readonly count = computed(() => this.pending().length);
  /** How many scores the server refused since the screen last cleared it. */
  readonly refused = signal(0);
  /** Called with scores the server has just confirmed, before they leave the list. */
  onSaved: ((scores: PendingScore[]) => void) | null = null;

  private lastStamp = 0;
  private sending = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      const online = () => void this.flush();
      const seen = () => {
        if (document.visibilityState === 'visible') void this.flush();
      };
      window.addEventListener('online', online);
      document.addEventListener('visibilitychange', seen);
      inject(DestroyRef).onDestroy(() => {
        window.removeEventListener('online', online);
        document.removeEventListener('visibilitychange', seen);
        this.clearTimer();
      });
    }
    if (this.pending().length) void this.flush();
  }

  /** Records a score and starts sending it. */
  put(roundId: string, playerId: string, hole: number, strokes: number, pickedUp = false): void {
    const entry: PendingScore = {
      round_id: roundId,
      player_id: playerId,
      hole,
      strokes,
      picked_up: pickedUp,
      at: this.stamp(),
    };
    this.save([...this.pending().filter((p) => !same(p, entry)), entry]);
    void this.flush();
  }

  /** A time that never repeats, even for two entries in the same millisecond. */
  private stamp(): number {
    this.lastStamp = Math.max(Date.now(), this.lastStamp + 1);
    return this.lastStamp;
  }

  /** Sends what is waiting. Safe to call at any time; only one send runs at once. */
  async flush(): Promise<void> {
    if (this.sending || !this.pending().length) return;
    this.sending = true;
    this.clearTimer();
    try {
      const batch = this.pending();
      let outcome = await this.send(batch);
      if (outcome === 'refused' && batch.length > 1) {
        // One bad score must not hold up the rest: send them one by one.
        outcome = 'saved';
        for (const entry of batch) {
          const one = await this.send([entry]);
          if (one === 'retry') outcome = 'retry';
          else this.settle([entry], one === 'saved');
        }
      } else if (outcome !== 'retry') {
        this.settle(batch, outcome === 'saved');
      }
      this.failures = outcome === 'retry' ? this.failures + 1 : 0;
    } finally {
      this.sending = false;
    }
    if (this.pending().length) this.schedule();
  }

  private async send(batch: PendingScore[]): Promise<'saved' | 'refused' | 'retry'> {
    try {
      const { error, status } = await this.db.from('scores').upsert(
        batch.map(({ round_id, player_id, hole, strokes, picked_up }) => ({
          round_id,
          player_id,
          hole,
          strokes,
          picked_up: !!picked_up,
        })),
        { onConflict: 'round_id,player_id,hole' },
      );
      if (!error) return 'saved';
      // No answer, the server's own trouble, or a sign-in that needs refreshing: try again.
      const retry = !status || status >= 500 || status === 401 || status === 408 || status === 429;
      return retry ? 'retry' : 'refused';
    } catch {
      return 'retry';
    }
  }

  /** Takes sent scores off the list, unless a newer entry for the same hole arrived meanwhile. */
  private settle(sent: PendingScore[], saved: boolean): void {
    if (saved) this.onSaved?.(sent);
    else this.refused.update((n) => n + sent.length);
    this.save(this.pending().filter((p) => !sent.some((s) => same(s, p) && s.at === p.at)));
  }

  private schedule(): void {
    this.clearTimer();
    // Straight away for a score entered during the last send; otherwise back off.
    const wait = this.failures
      ? Math.min(LAST_RETRY_MS, FIRST_RETRY_MS * 2 ** (this.failures - 1))
      : 0;
    this.zone.runOutsideAngular(() => {
      this.timer = setTimeout(() => void this.flush(), wait);
    });
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private save(pending: PendingScore[]): void {
    this.pending.set(pending);
    try {
      if (pending.length) localStorage.setItem(KEY, JSON.stringify(pending));
      else localStorage.removeItem(KEY);
    } catch {
      // storage unavailable: kept until the app is closed
    }
  }

  private load(): PendingScore[] {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '[]') as PendingScore[];
      return Array.isArray(saved) ? saved.filter((p) => p?.round_id && p.player_id && p.hole) : [];
    } catch {
      return [];
    }
  }
}
