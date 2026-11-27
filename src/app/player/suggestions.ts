import { Component, computed, effect, inject, signal } from '@angular/core';
import { AdminData, AdminError, ItemFields, Proposal } from '../admin/data';
import { formatDay, formatTime } from '../core/format';
import { SessionService } from '../core/session';
import { UiButton, UiCard, UiHeaderBand, UiListRow, UiSkeleton } from '../core/ui';

/**
 * Suggested changes to the itinerary, for organizers: each with Approve and Reject (no Edit).
 * Approving one that describes an item ("day" and "title") puts it on the itinerary, or changes
 * the item it names ("item_id").
 */
@Component({
  selector: 'app-suggestions',
  imports: [UiButton, UiCard, UiHeaderBand, UiListRow, UiSkeleton],
  template: `
    <ui-header-band title="Suggested changes" back="/trip/itinerary" backLabel="Trip" />
    <main class="content">
      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }
      @for (p of proposals(); track p.id) {
        <ui-card [attr.aria-label]="title(p)">
          <ui-list-row [eyebrow]="who(p)" [title]="title(p)" [detail]="detail(p)" />
          <div class="actions inset">
            <button
              ui-button
              size="small"
              type="button"
              [disabled]="busy()"
              (click)="review(p, 'approved')"
            >
              Approve
            </button>
            <button
              ui-button
              size="small"
              variant="outline"
              type="button"
              [disabled]="busy()"
              (click)="review(p, 'rejected')"
            >
              Reject
            </button>
          </div>
        </ui-card>
      } @empty {
        @if (loading()) {
          <ui-skeleton shape="block" height="120px" />
        } @else {
          <ui-card pad><p>Nothing waiting.</p></ui-card>
        }
      }
    </main>
  `,
  styles: `
    .inset {
      padding: 0 var(--s4) var(--s4);
    }
  `,
})
export class Suggestions {
  private readonly data = inject(AdminData);
  private readonly sessions = inject(SessionService);
  private readonly tripId = computed(() => this.sessions.session()?.trip.id ?? null);

  protected readonly proposals = signal<Proposal[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.tripId();
      if (id) void this.load(id);
    });
  }

  private text(value: unknown): string {
    return typeof value === 'string' ? value : '';
  }

  /** "Von · New item" */
  protected who(p: Proposal): string {
    return [p.proposer?.name, this.text(p.payload['item_id']) ? 'Change' : 'New item']
      .filter(Boolean)
      .join(' · ');
  }

  protected title(p: Proposal): string {
    return this.text(p.payload['title']) || this.text(p.payload['note']) || 'A change';
  }

  protected detail(p: Proposal): string {
    const day = this.text(p.payload['day']);
    return [
      day ? formatDay(day) : '',
      formatTime(this.text(p.payload['start_time']) || null),
      this.text(p.payload['details']),
    ]
      .filter(Boolean)
      .join(' · ');
  }

  protected async review(p: Proposal, status: 'approved' | 'rejected'): Promise<void> {
    const tripId = this.tripId();
    if (!tripId || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const day = this.text(p.payload['day']);
      const title = this.text(p.payload['title']);
      if (status === 'approved' && day && title) {
        const item: ItemFields = {
          day,
          start_time: this.text(p.payload['start_time']) || null,
          type: (this.text(p.payload['type']) || 'activity') as ItemFields['type'],
          title,
          details: (p.payload['details_json'] as Record<string, unknown>) ?? {},
          sort_order: 50,
        };
        await this.data.saveItem(tripId, this.text(p.payload['item_id']) || null, item);
      }
      await this.data.reviewProposal(p.id, status);
      this.proposals.update((list) => list.filter((x) => x.id !== p.id));
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "That didn't save.");
    } finally {
      this.busy.set(false);
    }
  }

  private async load(id: string): Promise<void> {
    try {
      this.proposals.set(await this.data.proposals(id));
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't load the suggested changes.");
    } finally {
      this.loading.set(false);
    }
  }
}
