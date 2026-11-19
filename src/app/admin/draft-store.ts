import { Injectable } from '@angular/core';
import { CourseDraft, ImportGaps } from './opengolf';

/** Hands a course picked on "Add a course" to the editor, where it is checked before saving. */
@Injectable({ providedIn: 'root' })
export class DraftStore {
  private pending: { draft: CourseDraft; gaps: ImportGaps } | null = null;

  put(draft: CourseDraft, gaps: ImportGaps): void {
    this.pending = { draft, gaps };
  }

  take(): { draft: CourseDraft; gaps: ImportGaps } | null {
    const pending = this.pending;
    this.pending = null;
    return pending;
  }
}

export function blankCourse(): CourseDraft {
  return {
    name: '',
    short_name: null,
    location: null,
    architect: null,
    year_opened: null,
    description: null,
    website_url: null,
    scorecard_url: null,
    directions_url: null,
    photo_path: null,
    source: 'manual',
    source_ref: null,
    ratings_checked_at: null,
    tees: [blankTee(18)],
  };
}

export function blankTee(holes: number, like?: { par: number[]; stroke_index: number[] }) {
  return {
    name: '',
    yards: null,
    rating: null,
    slope: null,
    par: like ? [...like.par] : Array<number>(holes).fill(4),
    stroke_index: like ? [...like.stroke_index] : Array.from({ length: holes }, (_, i) => i + 1),
    hole_yards: null,
  };
}
