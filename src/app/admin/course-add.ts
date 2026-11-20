import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DraftStore, blankCourse } from './draft-store';
import { OPENGOLF_CREDIT, OpenGolfSearchHit, fetchOpenGolf, searchOpenGolf } from './opengolf';

/** Add a course: find it on OpenGolfAPI and import it, or start from a blank card. */
@Component({
  selector: 'app-course-add',
  imports: [RouterLink],
  template: `
    <main class="page">
      <a class="back" routerLink="/admin/courses">‹ Course library</a>
      <h1>Add a course</h1>

      <form class="search" (submit)="search($event)" novalidate>
        <label class="field">
          <span class="label">Course name</span>
          <input
            class="input"
            type="search"
            name="q"
            autocomplete="off"
            placeholder="Sandridge"
            [value]="query()"
            (input)="query.set(text($event))"
          />
        </label>
        <button class="button" type="submit" [disabled]="busy() || query().trim().length < 3">
          {{ busy() ? 'Searching…' : 'Search' }}
        </button>
      </form>

      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }

      @if (hits(); as list) {
        @if (list.length) {
          <section class="card" aria-label="Results">
            @for (hit of list; track hit.id) {
              <button type="button" class="row" [disabled]="busy()" (click)="pick(hit)">
                <span class="hit">
                  <strong>{{ hit.name }}</strong>
                  <span class="label">{{ place(hit) }}</span>
                </span>
                <span class="label">{{ hit.par ? 'Par ' + hit.par : '' }}</span>
              </button>
            }
          </section>
        } @else {
          <p>No courses found for "{{ searched() }}".</p>
        }
        <p class="label">{{ credit }}</p>
      }

      <button type="button" class="link-button" (click)="byHand()">Enter a course by hand</button>
    </main>
  `,
  styles: `
    .search {
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
    }
    .hit {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      min-width: 0;
    }
    .hit strong {
      font-family: var(--font-heading);
    }
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
      await this.router.navigateByUrl('/admin/courses/new');
    });
  }

  protected async byHand(): Promise<void> {
    this.store.put(blankCourse(), { par: false, strokeIndex: false });
    await this.router.navigateByUrl('/admin/courses/new');
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
