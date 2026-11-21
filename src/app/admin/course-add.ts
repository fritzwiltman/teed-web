import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { UiButton, UiCard, UiField, UiHeaderBand, UiListRow } from '../core/ui';
import { DraftStore, blankCourse } from './draft-store';
import { OPENGOLF_CREDIT, OpenGolfSearchHit, fetchOpenGolf, searchOpenGolf } from './opengolf';

/** Add a course: find it on OpenGolfAPI and import it, or start from a blank card. */
@Component({
  selector: 'app-course-add',
  imports: [UiButton, UiCard, UiField, UiHeaderBand, UiListRow],
  template: `
    <ui-header-band title="Add a course" back="/courses" backLabel="Course library" />
    <main class="content">
      <form class="stack" (submit)="search($event)" novalidate>
        <ui-field label="Course name">
          <input
            type="search"
            name="q"
            autocomplete="off"
            placeholder="Sandridge"
            [value]="query()"
            (input)="query.set(text($event))"
          />
        </ui-field>
        <button ui-button type="submit" [busy]="busy()" [disabled]="query().trim().length < 3">
          {{ busy() ? 'Searching…' : 'Search' }}
        </button>
      </form>

      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }

      @if (hits(); as list) {
        @if (list.length) {
          <ui-card aria-label="Results">
            @for (hit of list; track hit.id) {
              <button
                ui-list-row
                type="button"
                [title]="hit.name"
                [detail]="place(hit)"
                [value]="hit.par ? 'Par ' + hit.par : null"
                [disabled]="busy()"
                (click)="pick(hit)"
              ></button>
            }
          </ui-card>
        } @else {
          <p>No courses found for "{{ searched() }}".</p>
        }
        <p class="detail">{{ credit }}</p>
      }

      <button ui-button variant="text" type="button" class="center" (click)="byHand()">
        Enter a course by hand
      </button>
    </main>
  `,
})
export class CourseAdd {
  private readonly store = inject(DraftStore);
  private readonly router = inject(Router);

  protected readonly credit = OPENGOLF_CREDIT;
  protected readonly query = signal('');
  protected readonly searched = signal('');
  protected readonly hits = signal<OpenGolfSearchHit[] | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected place(hit: OpenGolfSearchHit): string {
    return [hit.city, hit.state].filter(Boolean).join(', ');
  }

  protected async search(event: Event): Promise<void> {
    event.preventDefault();
    const query = this.query().trim();
    if (this.busy() || query.length < 3) return;
    await this.work("Couldn't search OpenGolf. Try again in a moment.", async () => {
      this.hits.set(await searchOpenGolf(query));
      this.searched.set(query);
    });
  }

  protected async pick(hit: OpenGolfSearchHit): Promise<void> {
    await this.work("Couldn't load that course from OpenGolf. Try again in a moment.", async () => {
      const { draft, gaps } = await fetchOpenGolf(hit.id);
      this.store.put(draft, gaps);
      await this.router.navigateByUrl('/courses/new');
    });
  }

  protected async byHand(): Promise<void> {
    this.store.put(blankCourse(), { par: false, strokeIndex: false });
    await this.router.navigateByUrl('/courses/new');
  }

  private async work(failure: string, task: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await task();
    } catch {
      this.error.set(failure);
    } finally {
      this.busy.set(false);
    }
  }
}
