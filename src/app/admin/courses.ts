import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminData, AdminError, CourseSummary } from './data';
import { isPlaceholderIndex } from './opengolf';

/** The course library: every course any trip can use. */
@Component({
  selector: 'app-courses',
  imports: [RouterLink],
  template: `
    <main class="page">
      <a class="back" routerLink="/admin">‹ My trips</a>
      <h1>Course library</h1>
      <a class="button" routerLink="/admin/courses/add">Add a course</a>

      <label class="field">
        <span class="label">Search the library</span>
        <input
          class="input"
          type="search"
          autocomplete="off"
          [value]="query()"
          (input)="query.set(text($event))"
        />
      </label>

      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }

      @if (shown().length) {
        <section class="card">
          @for (course of shown(); track course.id) {
            <a class="row" [routerLink]="['/admin/courses', course.id]">
              <span class="course">
                <strong>{{ course.name }}</strong>
                <span class="label"
                  >{{ course.location }}{{ course.location ? ' · ' : '' }}{{ course.tees.length }}
                  {{ course.tees.length === 1 ? 'tee' : 'tees' }}</span
                >
              </span>
              @if (needsIndex(course)) {
                <span class="badge draft">Needs stroke index</span>
              } @else {
                <span aria-hidden="true">›</span>
              }
            </a>
          }
        </section>
      }
    </main>
  `,
  styles: `
    .course {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      min-width: 0;
    }
    .course strong {
      font-family: var(--font-heading);
    }
  `,
})
export class Courses {
  private readonly courses = signal<CourseSummary[]>([]);
  protected readonly query = signal('');
  protected readonly error = signal<string | null>(null);

  protected readonly shown = computed(() => {
    const words = this.query().toLowerCase().split(/\s+/).filter(Boolean);
    return this.courses().filter((c) =>
      words.every((w) => `${c.name} ${c.location ?? ''}`.toLowerCase().includes(w)),
    );
  });

  constructor() {
    inject(AdminData)
      .courses()
      .then(
        (courses) => this.courses.set(courses),
        (e: unknown) =>
          this.error.set(e instanceof AdminError ? e.message : "Couldn't load the course library."),
      );
  }

  protected needsIndex(course: CourseSummary): boolean {
    return course.tees.some((tee) => isPlaceholderIndex(tee.stroke_index));
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
