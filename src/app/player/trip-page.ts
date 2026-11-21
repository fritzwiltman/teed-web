import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatDay, formatTime } from '../core/format';
import { RoundView, RoundsService } from '../core/rounds';
import { SessionService } from '../core/session';
import { sendText, spectatorMessage } from '../core/sms';
import { ThemeChoice, ThemeService } from '../core/theme';
import { Choice, UiButton, UiCard, UiListRow, UiSectionHead, UiSegmented } from '../core/ui';
import { PlayerHeader } from './player-header';

/** Trip: the rounds (each opens its setup), the spectator link, appearance and the way back to You. The itinerary and trip info come later. */
@Component({
  selector: 'app-trip-info',
  imports: [RouterLink, PlayerHeader, UiButton, UiCard, UiListRow, UiSectionHead, UiSegmented],
  template: `
    <app-player-header label="Trip" [title]="session()?.trip?.name ?? ''" />
    <main class="content">
      @if (rounds().length) {
        <ui-card aria-label="Rounds">
          <ui-section-head title="Rounds" />
          @for (r of rounds(); track r.row.id) {
            <a
              ui-list-row
              icon="flag"
              [routerLink]="['/rounds', r.row.id]"
              [title]="
                'R' +
                r.row.round_number +
                ' · ' +
                (r.row.courses?.short_name || r.row.courses?.name || '')
              "
              [detail]="when(r)"
              chevron
            ></a>
          }
        </ui-card>
      }

      <ui-card aria-label="Spectators">
        <button
          ui-list-row
          type="button"
          title="Share the spectator link"
          [detail]="shareNote()"
          [disabled]="sharing()"
          (click)="share()"
        ></button>
      </ui-card>

      <ui-card pad aria-label="Appearance">
        <ui-section-head title="Appearance" />
        <ui-segmented
          label="Appearance"
          [options]="themes"
          [value]="theme.choice()"
          (valueChange)="theme.set($event ?? 'auto')"
        />
      </ui-card>

      <button ui-button type="button" variant="text" class="center" (click)="leave()">
        All my trips
      </button>
    </main>
  `,
})
export class TripPage {
  private readonly sessions = inject(SessionService);
  protected readonly session = this.sessions.session;
  protected readonly theme = inject(ThemeService);
  private readonly roundsService = inject(RoundsService);
  protected readonly rounds = computed(() => this.roundsService.for(this.session()?.trip.id));

  /** "Thu, Nov 26 · 8:10 AM" */
  protected when(r: RoundView): string {
    return [formatDay(r.row.play_date), formatTime(r.row.tee_time)].filter(Boolean).join(' · ');
  }

  protected readonly sharing = signal(false);
  protected readonly shareNote = signal<string | undefined>(undefined);
  protected readonly themes: Choice<ThemeChoice>[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  /** Anyone on the trip can pass the spectator link on, once the organizer has made one. */
  protected async share(): Promise<void> {
    const trip = this.session()?.trip;
    if (!trip || this.sharing()) return;
    this.sharing.set(true);
    this.shareNote.set(undefined);
    try {
      const { data, error } = await this.sessions
        .db()
        .functions.invoke('spectator-link', { body: { trip_id: trip.id, action: 'get' } });
      const token = (data as { token: string | null } | null)?.token;
      if (error) this.shareNote.set("Couldn't get the link. Check your signal.");
      else if (!token) this.shareNote.set('No link yet');
      else if ((await sendText(null, spectatorMessage(trip.name, token))) === 'copied')
        this.shareNote.set('Copied');
    } catch {
      this.shareNote.set("Couldn't get the link. Check your signal.");
    } finally {
      this.sharing.set(false);
    }
  }

  /** Back to You. The shell sends us on once the trip is closed. */
  protected leave(): void {
    this.sessions.leave();
  }
}
