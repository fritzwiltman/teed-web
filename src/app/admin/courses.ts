import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiButton, UiCard, UiChip, UiField, UiHeaderBand, UiListRow, UiSkeleton } from '../core/ui';
import { AdminData, AdminError, CourseSummary } from './data';
import { isPlaceholderIndex } from './opengolf';

/** The course library: every course any trip can use. */
@Component({
  selector: 'app-courses',
  imports: [RouterLink, UiButton, UiCard, UiChip, UiField, UiHeaderBand, UiListRow, UiSkeleton],
  template: `
    <ui-header-band title="Course library" back="/you" backLabel="You" />
    <main class="content">
      <a ui-button routerLink="/courses/add">Add a course</a>

      <ui-field label="Search the library">
        <input
          type="search"
          autocomplete="off"
          [value]="query()"
          (input)="query.set(text($event))"
        />
      </ui-field>

      @if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }
      @if (loading()) {
        <ui-skeleton shape="block" height="230px" />
      }

      @if (shown().length) {
        <ui-card>
          @for (course of shown(); track course.id) {
            <a
              ui-list-row
              [routerLink]="['/courses', course.id]"
              [title]="course.name"
              [detail]="detail(course)"
              chevron
            >
              @if (needsIndex(course)) {
                <ui-chip class="warn">Needs stroke index</ui-chip>
              }
            </a>
          }
        </ui-card>
      }
    </main>
  `,
})
export class Courses {
  private readonly courses = signal<CourseSummary[]>([]);
  protected readonly query = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(true);

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
      )
      .finally(() => this.loading.set(false));
  }

  /** "Vero Beach, FL · 4 tees" */
  protected detail(course: CourseSummary): string {
    const tees = `${course.tees.length} ${course.tees.length === 1 ? 'tee' : 'tees'}`;
    return [course.location, tees].filter(Boolean).join(' · ');
  }

  protected needsIndex(course: CourseSummary): boolean {
    return course.tees.some((tee) => isPlaceholderIndex(tee.stroke_index));
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
