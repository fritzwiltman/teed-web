import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
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
  imports: [RouterLink],
  template: `
    <main class="page">
      <a class="back" routerLink="/admin/courses">‹ Course library</a>
      @if (draft(); as c) {
        <h1>{{ c.name || 'New course' }}</h1>

        @if (c.id) {
          @if (photoUrl(); as url) {
            <img class="photo" [src]="url" alt="" />
          }
          <label class="button quiet">
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

        @if (gaps().strokeIndex) {
          <p class="banner" role="status">
            OpenGolf has no stroke index for this course. Enter it from the scorecard.
          </p>
        }
        @if (gaps().par) {
          <p class="banner" role="status">
            OpenGolf has no hole pars for this course. Enter them from the scorecard.
          </p>
        }

        <section class="card pad fields">
          <label class="field"
            ><span class="label">Name</span
            ><input class="input" [value]="c.name" (input)="setText('name', $event)"
          /></label>
          <div class="pair">
            <label class="field"
              ><span class="label">Short name</span
              ><input
                class="input"
                [value]="c.short_name ?? ''"
                (input)="setText('short_name', $event)"
            /></label>
            <label class="field"
              ><span class="label">Location</span
              ><input
                class="input"
                [value]="c.location ?? ''"
                (input)="setText('location', $event)"
            /></label>
          </div>
          <div class="pair">
            <label class="field"
              ><span class="label">Architect</span
              ><input
                class="input"
                [value]="c.architect ?? ''"
                (input)="setText('architect', $event)"
            /></label>
            <label class="field"
              ><span class="label">Year opened</span
              ><input
                class="input mono"
                inputmode="numeric"
                [value]="c.year_opened ?? ''"
                (input)="setYear($event)"
            /></label>
          </div>
          <label class="field"
            ><span class="label">Description</span
            ><textarea
              class="input"
              [value]="c.description ?? ''"
              (input)="setText('description', $event)"
            ></textarea>
          </label>
          <label class="field"
            ><span class="label">Website</span
            ><input
              class="input"
              type="url"
              inputmode="url"
              [value]="c.website_url ?? ''"
              (input)="setText('website_url', $event)"
          /></label>
          <label class="field"
            ><span class="label">Scorecard link</span
            ><input
              class="input"
              type="url"
              inputmode="url"
              [value]="c.scorecard_url ?? ''"
              (input)="setText('scorecard_url', $event)"
          /></label>
          <label class="field"
            ><span class="label">Directions link</span
            ><input
              class="input"
              type="url"
              inputmode="url"
              [value]="c.directions_url ?? ''"
              (input)="setText('directions_url', $event)"
          /></label>
        </section>

        @for (tee of c.tees; track $index; let t = $index) {
          <details class="card tee">
            <summary class="row">
              <strong>{{ tee.name || 'New tee' }}</strong>
              <span class="label">{{ summary(tee) }}</span>
            </summary>
            <div class="row stack">
              <div class="quad">
                <label class="field"
                  ><span class="label">Tee</span
                  ><input class="input" [value]="tee.name" (input)="setTeeName(t, $event)"
                /></label>
                <label class="field"
                  ><span class="label">Yards</span
                  ><input
                    class="input mono"
                    inputmode="numeric"
                    [value]="tee.yards ?? ''"
                    (input)="setTeeNumber(t, 'yards', $event)"
                /></label>
                <label class="field"
                  ><span class="label">Rating</span
                  ><input
                    class="input mono"
                    inputmode="decimal"
                    [value]="tee.rating ?? ''"
                    (input)="setTeeNumber(t, 'rating', $event)"
                /></label>
                <label class="field"
                  ><span class="label">Slope</span
                  ><input
                    class="input mono"
                    inputmode="numeric"
                    [value]="tee.slope ?? ''"
                    (input)="setTeeNumber(t, 'slope', $event)"
                /></label>
              </div>
            </div>
            <div class="holes" role="table" [attr.aria-label]="tee.name + ' holes'">
              <div class="hole head" role="row">
                <span class="label" role="columnheader">Hole</span>
                <span class="label" role="columnheader">Par</span>
                <span class="label" role="columnheader">SI</span>
                <span class="label" role="columnheader">Yards</span>
              </div>
              @for (par of tee.par; track $index; let h = $index) {
                <div class="hole" role="row">
                  <span class="mono" role="rowheader">{{ h + 1 }}</span>
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
            <div class="row">
              <button type="button" class="link-button" (click)="removeTee(t)">
                Remove this tee
              </button>
            </div>
          </details>
        }
        <button type="button" class="button quiet" (click)="addTee()">+ Add tee</button>

        @if (c.source === 'opengolfapi') {
          <section class="card" aria-label="Source">
            <div class="row source">
              <span class="label"
                >{{ credit }}{{ checked() ? ' · checked ' + checked() : '' }}</span
              >
              @if (c.source_ref && !changes()) {
                <button
                  type="button"
                  class="button small quiet"
                  [disabled]="!!busy()"
                  (click)="refresh()"
                >
                  {{ busy() === 'refresh' ? 'Checking…' : 'Refresh' }}
                </button>
              }
            </div>
            @if (changes(); as list) {
              @for (change of list; track $index) {
                <div class="row change">
                  <span
                    ><strong>{{ change.tee }}</strong> · {{ change.what }}</span
                  >
                  <span class="mono">{{ change.from }} → {{ change.to }}</span>
                </div>
              }
              <div class="row actions">
                <button
                  type="button"
                  class="button small"
                  [disabled]="!!busy()"
                  (click)="resolve(true)"
                >
                  Apply changes
                </button>
                <button
                  type="button"
                  class="button small quiet"
                  [disabled]="!!busy()"
                  (click)="resolve(false)"
                >
                  Keep mine
                </button>
              </div>
            }
          </section>
        }

        @if (error(); as text) {
          <p class="error-text" role="alert">{{ text }}</p>
        }
        <button type="button" class="button" [disabled]="!!busy()" (click)="save()">
          {{ busy() === 'save' ? 'Saving…' : c.id ? 'Save' : 'Add to library' }}
        </button>
      } @else if (error(); as text) {
        <p class="error-text" role="alert">{{ text }}</p>
      }
    </main>
  `,
  styles: `
    .photo {
      width: 100%;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      border: 1.5px solid var(--frame);
      border-radius: var(--radius);
    }
    .fields {
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
    }
    .pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.6rem;
    }
    .quad {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr 1fr;
      gap: 0.4rem;
    }
    .quad .input {
      padding: 0 0.4rem;
    }
    summary {
      cursor: pointer;
      list-style: none;
      min-height: var(--tap);
      align-items: center;
    }
    summary::-webkit-details-marker {
      display: none;
    }
    summary strong {
      font-family: var(--font-heading);
    }
    .hole {
      display: grid;
      grid-template-columns: 3rem 1fr 1fr 1.4fr;
      align-items: center;
      border-top: 1px solid var(--line);
    }
    .hole > * {
      text-align: center;
      border-left: 1px solid var(--line);
    }
    .hole > :first-child {
      border-left: 0;
    }
    .hole.head > * {
      padding: 0.45rem 0;
    }
    .cell {
      width: 100%;
      min-height: 2.75rem;
      border-top: 0;
      border-right: 0;
      border-bottom: 0;
      border-radius: 0;
      background: var(--field);
      color: var(--ink);
      font: 500 1rem var(--font-mono);
    }
    .source,
    .change {
      align-items: center;
    }
    .change .mono {
      text-align: right;
      overflow-wrap: anywhere;
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
      else await this.router.navigate(['/admin/courses', id], { replaceUrl: true });
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
        await this.router.navigateByUrl('/admin/courses/add', { replaceUrl: true });
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
