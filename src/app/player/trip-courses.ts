import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatDay, formatTime, gameLine } from '../core/format';
import { RoundView, RoundsService } from '../core/rounds';
import { SessionService } from '../core/session';
import { UiButton, UiCard, UiListRow, UiSkeleton } from '../core/ui';

/**
 * Trip › Courses: the rounds, each opening its own page (where it is set up and edited). There is
 * no Edit here: organizers get "+ Add a round" at the bottom.
 */
@Component({
  selector: 'app-trip-courses',
  imports: [RouterLink, UiButton, UiCard, UiListRow, UiSkeleton],
  template: `
    @for (r of rounds(); track r.row.id) {
      <ui-card>
        <a
          ui-list-row
          [routerLink]="['/trip/rounds', r.row.id]"
          [eyebrow]="when(r)"
          [title]="r.row.courses?.name ?? 'Course to come'"
          [detail]="detail(r)"
          chevron
        ></a>
      </ui-card>
    } @empty {
      @if (loading()) {
        <ui-skeleton shape="block" height="96px" />
      } @else {
        <ui-card pad><p>No rounds yet.</p></ui-card>
      }
    }
    @if (canAdd()) {
      <a ui-button variant="outline" routerLink="/trip/rounds/new">+ Add a round</a>
    }
  `,
})
export class TripCourses {
  private readonly sessions = inject(SessionService);
  private readonly live = inject(RoundsService);
  private readonly session = this.sessions.session;

  protected readonly rounds = computed(() => this.live.for(this.session()?.trip.id));
  protected readonly loading = computed(() => this.live.tripId() !== this.session()?.trip.id);
  protected readonly canAdd = computed(
    () => this.sessions.canManage() && this.session()?.trip.status !== 'final',
  );

  /** "R1 · Fri, Oct 9 · 10:50 AM" */
  protected when(r: RoundView): string {
    return [`R${r.row.round_number}`, formatDay(r.row.play_date), formatTime(r.row.tee_time)]
      .filter(Boolean)
      .join(' · ');
  }

  /** "9-point game · Blue tees" */
  protected detail(r: RoundView): string {
    return [
      gameLine(r.row.round_formats.map((f) => f.format_key)),
      r.row.tees?.name ? `${r.row.tees.name} tees` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
}
