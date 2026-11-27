import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { localDate } from './format';
import { RoundView, RoundsService } from './rounds';
import { SessionService } from './session';

/** Away this long, coming back counts as opening the app again. */
export const AWAY_MS = 2 * 60_000;
/** A round is "on" from this long before its tee time. */
const EARLY_MS = 30 * 60_000;
/** How long after launch a late answer from the server may still choose the landing. */
const SETTLE_MS = 10_000;

/**
 * Where opening the app should land someone who is playing today.
 *
 * If they are in a round dated today that isn't final, and it is on (within 30 minutes of its
 * tee time, or a score is in): the Scorecard, or the Board once the card is complete.
 * Otherwise null: the normal landing.
 */
export function launchTarget(
  rounds: RoundView[],
  playerId: string | null | undefined,
  now = new Date(),
): '/score' | '/board' | null {
  if (!playerId) return null;
  const today = localDate(now);
  const mine = rounds.filter(
    (r) =>
      r.row.play_date === today &&
      r.result.state !== 'final' &&
      r.result.players.some((p) => p.id === playerId) &&
      (r.result.state !== 'scheduled' || nearTeeTime(r.row.tee_time, now)),
  );
  if (!mine.length) return null;
  return mine.some((r) => r.result.state !== 'complete') ? '/score' : '/board';
}

function nearTeeTime(teeTime: string | null, now: Date): boolean {
  const [hours, minutes] = (teeTime ?? '').split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return false;
  const tee = new Date(now);
  tee.setHours(hours, minutes, 0, 0);
  return now.getTime() >= tee.getTime() - EARLY_MS;
}

/**
 * Lands the app on your hole. Only when the app is opened, or comes back after more than two
 * minutes in the background: never while someone is using it.
 */
@Injectable({ providedIn: 'root' })
export class LaunchService {
  private readonly router = inject(Router);
  private readonly sessions = inject(SessionService);
  private readonly rounds = inject(RoundsService);

  /** Counts landings on the Scorecard, so one already open moves to the next unscored hole. */
  readonly landed = signal(0);

  private launched = false;
  private pendingUntil = 0;
  private hiddenAt: number | null = null;

  /** The trip's frame has appeared. The first time since the app was opened is a launch. */
  opened(): void {
    if (this.launched) return;
    this.launched = true;
    if (!this.land(true)) this.pendingUntil = Date.now() + SETTLE_MS;
  }

  /** The rounds have just been read from the server: a launch still undecided can be now. */
  loaded(): void {
    if (Date.now() > this.pendingUntil) return;
    if (this.land(true)) this.pendingUntil = 0;
  }

  /** The app went to the background or came back. */
  seen(visible: boolean): void {
    if (!visible) {
      this.hiddenAt = Date.now();
      return;
    }
    const away = this.hiddenAt === null ? 0 : Date.now() - this.hiddenAt;
    this.hiddenAt = null;
    if (away > AWAY_MS) this.land(false);
  }

  /** Goes to today's card or board if there is one. True when it found somewhere to go. */
  private land(launch: boolean): boolean {
    const session = this.sessions.session();
    if (!session) return false;
    const path = this.router.url.split(/[?#]/)[0];
    // A launch only replaces the normal landing; a link straight to a page is left alone.
    if (launch && path !== '/' && path !== '/home') return false;
    // Coming back never interrupts a round being set up.
    if (!launch && path.startsWith('/trip/rounds')) return false;
    const target = launchTarget(this.rounds.for(session.trip.id), session.player.id);
    if (!target) return false;
    if (target === '/score') this.landed.update((n) => n + 1);
    if (this.router.url !== target) void this.router.navigateByUrl(target, { replaceUrl: launch });
    return true;
  }
}
