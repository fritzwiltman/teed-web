import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  UiAlertCard,
  UiButton,
  UiCard,
  UiField,
  UiHeaderBand,
  UiListRow,
  UiSkeleton,
} from '../core/ui';
import { AdminData, AdminError } from './data';
import { DraftStore, blankTee } from './draft-store';
import {
  CourseDraft,
  ImportGaps,
  OPENGOLF_CREDIT,
  TeeChange,
  TeeDraft,
  applyFresh,
  diffTees,
  fetchOpenGolf,
  isPermutation,
  isPlaceholderIndex,
} from './opengolf';
import { resizePhoto } from './photo';

type CourseText =
  | 'name'
  | 'short_name'
  | 'location'
  | 'architect'
  | 'description'
  | 'website_url'
  | 'scorecard_url'
  | 'directions_url';
type TeeNumber = 'yards' | 'rating' | 'slope';
type HoleField = 'par' | 'stroke_index' | 'hole_yards';

/** One course: its details, photo and tees. Every cell is editable, imported or not. */
@Component({
  selector: 'app-course-edit',
  imports: [UiAlertCard, UiButton, UiCard, UiField, UiHeaderBand, UiListRow, UiSkeleton],
  template: `
    <ui-header-band
      [title]="draft()?.name || 'New course'"
      back="/courses"
      backLabel="Course library"
    />
    <main class="content">
      @if (draft(); as c) {
        @if (c.id) {
          @if (photoUrl(); as url) {
            <img class="photo" [src]="url" alt="" />
          }
          <label ui-button variant="outline" [busy]="busy() === 'photo'">
            {{ busy() === 'photo' ? 'Uploading…' : c.photo_path ? 'Replace photo' : 'Add photo' }}
            <input
              type="file"
              accept="image/*"
              hidden
              [disabled]="!!busy()"
              (change)="upload($event)"
            />
          </label>
        }

        @if (needsIndex()) {
          <ui-alert-card level="important">
            The stroke index is still a placeholder (1 to {{ c.tees[0]?.par?.length }} in order).
            Enter it from the scorecard.
          </ui-alert-card>
        }
        @if (gaps().par) {
          <ui-alert-card level="important">
            OpenGolf has no hole pars for this course. Enter them from the scorecard.
          </ui-alert-card>
        }

        <ui-card pad>
          <ui-field label="Name">
            <input [value]="c.name" (input)="setText('name', $event)" />
          </ui-field>
          <div class="pair">
            <ui-field label="Short name">
              <input [value]="c.short_name ?? ''" (input)="setText('short_name', $event)" />
            </ui-field>
            <ui-field label="Location">
              <input [value]="c.location ?? ''" (input)="setText('location', $event)" />
            </ui-field>
          </div>
          <div class="pair">
            <ui-field label="Architect">
              <input [value]="c.architect ?? ''" (input)="setText('architect', $event)" />
            </ui-field>
            <ui-field label="Year opened">
              <input inputmode="numeric" [value]="c.year_opened ?? ''" (input)="setYear($event)" />
            </ui-field>
          </div>
          <ui-field label="Description">
            <textarea
              [value]="c.description ?? ''"
              (input)="setText('description', $event)"
            ></textarea>
          </ui-field>
          <ui-field label="Website">
            <input
              type="url"
              inputmode="url"
              [value]="c.website_url ?? ''"
              (input)="setText('website_url', $event)"
            />
          </ui-field>
          <ui-field label="Scorecard link">
            <input
              type="url"
              inputmode="url"
              [value]="c.scorecard_url ?? ''"
              (input)="setText('scorecard_url', $event)"
            />
          </ui-field>
          <ui-field label="Directions link">
            <input
              type="url"
              inputmode="url"
              [value]="c.directions_url ?? ''"
              (input)="setText('directions_url', $event)"
            />
          </ui-field>
        </ui-card>

        @for (tee of c.tees; track $index; let t = $index) {
          <ui-card>
            <details>
              <summary>
                <ui-list-row [title]="tee.name || 'New tee'" [detail]="summary(tee)" chevron />
              </summary>
              <div class="quad">
                <ui-field label="Tee">
                  <input [value]="tee.name" (input)="setTeeName(t, $event)" />
                </ui-field>
                <ui-field label="Yards" class="compact">
                  <input
                    inputmode="numeric"
                    [value]="tee.yards ?? ''"
                    (input)="setTeeNumber(t, 'yards', $event)"
                  />
                </ui-field>
                <ui-field label="Rating" class="compact">
                  <input
                    inputmode="decimal"
                    [value]="tee.rating ?? ''"
                    (input)="setTeeNumber(t, 'rating', $event)"
                  />
                </ui-field>
                <ui-field label="Slope" class="compact">
                  <input
                    inputmode="numeric"
                    [value]="tee.slope ?? ''"
                    (input)="setTeeNumber(t, 'slope', $event)"
                  />
                </ui-field>
              </div>
              <div class="holes" role="table" [attr.aria-label]="tee.name + ' holes'">
                <div class="hole head" role="row">
                  <span role="columnheader">Hole</span>
                  <span role="columnheader">Par</span>
                  <span role="columnheader">SI</span>
                  <span role="columnheader">Yards</span>
                </div>
                @for (par of tee.par; track $index; let h = $index) {
                  <div class="hole" role="row">
                    <span role="rowheader">{{ h + 1 }}</span>
                    <input
                      class="cell"
                      inputmode="numeric"
                      [attr.aria-label]="'Hole ' + (h + 1) + ' par'"
                      [value]="par"
                      (input)="setHole(t, 'par', h, $event)"
                    />
                    <input
                      class="cell"
                      inputmode="numeric"
                      [attr.aria-label]="'Hole ' + (h + 1) + ' stroke index'"
                      [value]="tee.stroke_index[h]"
                      (input)="setHole(t, 'stroke_index', h, $event)"
                    />
                    <input
                      class="cell"
                      inputmode="numeric"
                      [attr.aria-label]="'Hole ' + (h + 1) + ' yards'"
                      [value]="tee.hole_yards?.[h] ?? ''"
                      (input)="setHole(t, 'hole_yards', h, $event)"
                    />
                  </div>
                }
              </div>
              <div class="remove">
                <button ui-button variant="text" type="button" (click)="removeTee(t)">
                  Remove this tee
                </button>
              </div>
            </details>
          </ui-card>
        }
        <button ui-button variant="outline" type="button" (click)="addTee()">Add tee</button>

        @if (c.source === 'opengolfapi') {
          <ui-card aria-label="Source">
            <ui-list-row [title]="credit" [detail]="checked() ? 'Checked ' + checked() : null">
              @if (c.source_ref && !changes()) {
                <button
                  ui-button
                  size="small"
                  variant="outline"
                  type="button"
                  [busy]="busy() === 'refresh'"
                  [disabled]="!!busy()"
                  (click)="refresh()"
                >
                  {{ busy() === 'refresh' ? 'Checking…' : 'Refresh' }}
                </button>
              }
            </ui-list-row>
            @if (changes(); as list) {
              @for (change of list; track $index) {
                <ui-list-row
                  [title]="change.tee + ' · ' + change.what"
                  [detail]="change.from + ' → ' + change.to"
                />
              }
              <ui-list-row>
                <button
                  ui-button
                  size="small"
                  type="button"
                  [disabled]="!!busy()"
                  (click)="resolve(true)"
                >
                  Apply changes
                </button>
                <button
                  ui-button
                  size="small"
                  variant="outline"
                  type="button"
                  [disabled]="!!busy()"
                  (click)="resolve(false)"
                >
                  Keep mine
                </button>
              </ui-list-row>
            }
          </ui-card>
        }

        @if (error(); as text) {
          <p class="error-text" role="alert">{{ text }}</p>
        }
        <button
          ui-button
          type="button"
          [busy]="busy() === 'save'"
          [disabled]="!!busy()"
          (click)="save()"
        >
          {{ busy() === 'save' ? 'Saving…' : c.id ? 'Save' : 'Add to library' }}
        </button>
      } @else if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      } @else {
        <ui-skeleton shape="block" height="300px" />
      }
    </main>
  `,
  // The hole-by-hole grid is this screen's own layout: 18 rows of bare cells, like the card.
  styles: `
    .photo {
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      border-radius: var(--radius-card);
    }
    summary {
      cursor: pointer;
      list-style: none;
    }
    summary::-webkit-details-marker {
      display: none;
    }
    .quad {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr 1fr;
      gap: var(--s2);
      padding: var(--s1) var(--s4) var(--s4);
    }
    .hole {
      display: grid;
      grid-template-columns: 56px 1fr 1fr 1.4fr;
      align-items: center;
      border-top: 1px solid var(--line);
      text-align: center;
    }
    .hole.head {
      padding: var(--s2) 0;
      font-size: 12px;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--muted);
    }
    .cell {
      width: 100%;
      min-width: 0;
      height: var(--tap);
      border: 0;
      border-left: 1px solid var(--line);
      border-radius: 0;
      background: transparent;
      color: var(--ink);
      text-align: center;
    }
    .remove {
      padding: var(--s1) var(--s4);
      border-top: 1px solid var(--line);
    }
  `,
})
export class CourseEdit {
  /** A course id, or 'new' for a course arriving from "Add a course". */
  readonly id = input.required<string>();

  private readonly data = inject(AdminData);
  private readonly store = inject(DraftStore);
  private readonly router = inject(Router);

  protected readonly credit = OPENGOLF_CREDIT;
  protected readonly draft = signal<CourseDraft | null>(null);
  protected readonly gaps = signal<ImportGaps>({ par: false, strokeIndex: false });
  protected readonly busy = signal<'save' | 'refresh' | 'photo' | null>(null);
  protected readonly error = signal<string | null>(null);

  /** What a Refresh found, waiting for Apply or Keep mine. */
  protected readonly changes = signal<TeeChange[] | null>(null);
  private fresh: TeeDraft[] = [];
  private removed: string[] = [];
  private photoVersion = signal(0);

  protected readonly photoUrl = computed(() => {
    const url = this.data.photoUrl(this.draft()?.photo_path ?? null);
    return url ? `${url}?v=${this.photoVersion()}` : null;
  });

  /** True while any tee's stroke index is the in-order placeholder an import leaves when the source has none. */
  protected readonly needsIndex = computed(() =>
    (this.draft()?.tees ?? []).some((tee) => isPlaceholderIndex(tee.stroke_index)),
  );

  protected readonly checked = computed(() => {
    const at = this.draft()?.ratings_checked_at;
    return at
      ? new Intl.DateTimeFormat('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }).format(new Date(at))
      : '';
  });

  constructor() {
    effect(() => void this.load(this.id()));
  }

  protected summary(tee: TeeDraft): string {
    return [
      tee.yards ? `${tee.yards.toLocaleString('en-US')} yds` : '',
      tee.rating && tee.slope ? `${tee.rating} / ${tee.slope}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }

  // ── Editing ────────────────────────────────────────────────────────────────

  private value(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  private number(event: Event): number | null {
    const text = this.value(event).trim();
    const n = Number(text);
    return text === '' || Number.isNaN(n) ? null : n;
  }

  private update(change: (course: CourseDraft) => CourseDraft): void {
    this.draft.update((c) => (c ? change(c) : c));
    this.error.set(null);
  }

  private updateTee(index: number, change: (tee: TeeDraft) => TeeDraft): void {
    this.update((c) => ({ ...c, tees: c.tees.map((tee, i) => (i === index ? change(tee) : tee)) }));
  }

  protected setText(key: CourseText, event: Event): void {
    const value = this.value(event);
    this.update((c) => ({ ...c, [key]: key === 'name' ? value : value.trim() || null }));
  }

  protected setYear(event: Event): void {
    const year = this.number(event);
    this.update((c) => ({ ...c, year_opened: year }));
  }

  protected setTeeName(index: number, event: Event): void {
    const name = this.value(event);
    this.updateTee(index, (tee) => ({ ...tee, name }));
  }

  protected setTeeNumber(index: number, key: TeeNumber, event: Event): void {
    const value = this.number(event);
    this.updateTee(index, (tee) => ({ ...tee, [key]: value }));
  }

  protected setHole(index: number, field: HoleField, hole: number, event: Event): void {
    const value = this.number(event);
    this.updateTee(index, (tee) => {
      if (field === 'hole_yards') {
        const yards = [...(tee.hole_yards ?? Array<number | null>(tee.par.length).fill(null))];
        yards[hole] = value;
        return { ...tee, hole_yards: yards.every((y) => y === null) ? null : yards };
      }
      const values = [...tee[field]];
      values[hole] = value ?? 0;
      return { ...tee, [field]: values };
    });
  }

  protected addTee(): void {
    this.update((c) => ({
      ...c,
      tees: [...c.tees, blankTee(c.tees[0]?.par.length ?? 18, c.tees[0])],
    }));
  }

  protected removeTee(index: number): void {
    const id = this.draft()?.tees[index]?.id;
    if (id) this.removed.push(id);
    this.update((c) => ({ ...c, tees: c.tees.filter((_, i) => i !== index) }));
  }

  // ── Saving ─────────────────────────────────────────────────────────────────

  /** The first thing wrong with the card, in words, or null. */
  private problem(course: CourseDraft): string | null {
    if (!course.name.trim()) return 'Give the course a name.';
    for (const tee of course.tees) {
      const name = tee.name.trim() || 'A tee';
      if (!tee.name.trim()) return 'Every tee needs a name.';
      if (tee.par.some((p) => !Number.isInteger(p) || p < 3 || p > 6))
        return `${name}: every par is 3, 4, 5 or 6.`;
      if (!isPermutation(tee.stroke_index))
        return `${name}: the stroke index uses each number from 1 to ${tee.par.length} once.`;
      if (
        tee.hole_yards &&
        tee.hole_yards.some((y) => y === null || !Number.isInteger(y) || y <= 0)
      )
        return `${name}: fill in the yards for every hole, or clear them all.`;
      if (tee.rating !== null && (tee.rating < 20 || tee.rating > 90))
        return `${name}: that rating doesn't look right.`;
      if (tee.slope !== null && (!Number.isInteger(tee.slope) || tee.slope < 55 || tee.slope > 155))
        return `${name}: slope is a whole number from 55 to 155.`;
      if (tee.yards !== null && (!Number.isInteger(tee.yards) || tee.yards <= 0))
        return `${name}: yards is a whole number.`;
    }
    return null;
  }

  protected async save(): Promise<boolean> {
    const course = this.draft();
    if (!course || this.busy()) return false;
    const problem = this.problem(course);
    if (problem) {
      this.error.set(problem);
      return false;
    }
    this.busy.set('save');
    try {
      const tidy = {
        ...course,
        name: course.name.trim(),
        tees: course.tees.map((tee) => ({ ...tee, name: tee.name.trim() })),
      };
      const id = await this.data.saveCourse(tidy, this.removed);
      this.removed = [];
      this.gaps.set({ par: false, strokeIndex: false });
      if (course.id) this.draft.set(await this.data.course(id));
      else if (takeReturn()) await this.router.navigateByUrl(`${takeReturn(true)}?course=${id}`);
      else await this.router.navigate(['/courses', id], { replaceUrl: true });
      return true;
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't save the course.");
      return false;
    } finally {
      this.busy.set(null);
    }
  }

  // ── Refresh from OpenGolf ──────────────────────────────────────────────────

  protected async refresh(): Promise<void> {
    const course = this.draft();
    if (!course?.source_ref || this.busy()) return;
    this.busy.set('refresh');
    this.error.set(null);
    try {
      const { draft: pulled, gaps } = await fetchOpenGolf(course.source_ref);
      // Where the source has no pars or stroke index, ours are not "changed": keep them.
      const ours = (name: string) =>
        course.tees.find((t) => t.name.toLowerCase() === name.toLowerCase()) ?? course.tees[0];
      this.fresh = pulled.tees.map((tee) => ({
        ...tee,
        par: gaps.par && ours(tee.name) ? ours(tee.name).par : tee.par,
        stroke_index:
          gaps.strokeIndex && ours(tee.name) ? ours(tee.name).stroke_index : tee.stroke_index,
      }));
      const changes = diffTees(course.tees, this.fresh);
      this.busy.set(null);
      if (changes.length) this.changes.set(changes);
      else await this.resolve(false);
    } catch {
      this.error.set("Couldn't reach OpenGolf. Try again in a moment.");
    } finally {
      this.busy.set(null);
    }
  }

  /** Ends a Refresh: take the new values or keep ours. Either way the course was checked today. */
  protected async resolve(apply: boolean): Promise<void> {
    this.update((c) => ({
      ...c,
      tees: apply ? applyFresh(c.tees, this.fresh) : c.tees,
      ratings_checked_at: new Date().toISOString(),
    }));
    this.changes.set(null);
    await this.save();
  }

  // ── Photo ──────────────────────────────────────────────────────────────────

  protected async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    const id = this.draft()?.id;
    input.value = '';
    if (!file || !id || this.busy()) return;
    this.busy.set('photo');
    this.error.set(null);
    try {
      const path = await this.data.uploadPhoto(id, await resizePhoto(file));
      this.draft.update((c) => (c ? { ...c, photo_path: path } : c));
      this.photoVersion.set(Date.now());
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't read that photo.");
    } finally {
      this.busy.set(null);
    }
  }

  private async load(id: string): Promise<void> {
    this.removed = [];
    this.changes.set(null);
    if (id === 'new') {
      const pending = this.store.take();
      if (!pending) {
        await this.router.navigateByUrl('/courses/add', { replaceUrl: true });
        return;
      }
      this.draft.set(pending.draft);
      this.gaps.set(pending.gaps);
      return;
    }
    try {
      this.draft.set(await this.data.course(id));
      this.gaps.set({ par: false, strokeIndex: false });
    } catch (e) {
      this.error.set(e instanceof AdminError ? e.message : "Couldn't load that course.");
    }
  }
}

/**
 * Where to go once a new course is saved, when a round setup sent us here ("+ Add a course"):
 * back to that round, with the course picked. `take` clears it.
 */
export function takeReturn(take = false): string | null {
  try {
    const to = sessionStorage.getItem(COURSE_RETURN);
    if (take) sessionStorage.removeItem(COURSE_RETURN);
    return to && to.startsWith('/trip/') ? to : null;
  } catch {
    return null;
  }
}

export const COURSE_RETURN = 'teed.course-return';
