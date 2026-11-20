import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatDay, formatTime } from '../core/format';
import { UiButton, UiCard, UiChip, UiListRow, UiSkeleton } from '../core/ui';
import { AdminData, AdminError, RoundSummary, Trip } from './data';
import { OrganizerHeader } from './organizer-header';

/** Rounds: the trip's rounds, in order. Setting one up arrives with M3b. */
@Component({
  selector: 'app-rounds',
  imports: [RouterLink, OrganizerHeader, UiButton, UiCard, UiChip, UiListRow, UiSkeleton],
  template: `
    <app-organizer-header title="Rounds" [trip]="trip()" />
    <main class="content">
      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }
      @if (rounds(); as list) {
        @if (list.length) {
          <ui-card aria-label="Rounds">
            @for (round of list; track round.id) {
              <ui-list-row
                icon="flag"
                [title]="round.courses?.short_name || round.courses?.name || 'Course to come'"
                [detail]="when(round)"
              >
                <ui-chip>{{ status(round) }}</ui-chip>
              </ui-list-row>
            }
          </ui-card>
        }
        @if (trip()?.status !== 'final') {
          <a ui-button variant="outline" [routerLink]="['new']">Add round</a>
        }
      } @else if (!error()) {
        <ui-skeleton shape="block" height="170px" />
      }
    </main>
  `,
})
export class Rounds {
  readonly id = input.required<string>();

  private readonly data = inject(AdminData);

  protected readonly trip = signal<Trip | null>(null);
  protected readonly rounds = signal<RoundSummary[] | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => void this.load(this.id()));
  }

  /** "Round 3 · Sun, Oct 11 · 8:10 AM" */
  protected when(round: RoundSummary): string {
    return [`Round ${round.round_number}`, formatDay(round.play_date), formatTime(round.tee_time)]
      .filter(Boolean)
      .join(' · ');
  }

  protected status(round: RoundSummary): string {
    if (round.status === 'final') return 'Final';
    if (round.status === 'live') return 'Live';
    return round.pairings_tbd ? 'Pairings TBD' : 'Ready';
  }

  private async load(id: string): Promise<void> {
    try {
      const [trip, rounds] = await Promise.all([this.data.trip(id), this.data.rounds(id)]);
      this.trip.set(trip);
      this.rounds.set(rounds);
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't load the rounds.");
    }
  }
}
