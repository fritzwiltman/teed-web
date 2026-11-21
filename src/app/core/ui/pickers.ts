import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  booleanAttribute,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { UiButton } from './button';
import { UiField } from './controls';
import { UiSheet } from './feedback';
import { UiIcon } from './icon';

/** One choice in a picker sheet. */
export interface PickerOption {
  value: string;
  title: string;
  /** A line under the title: "Palm Beach Gardens, FL", "6,412 yds · 71.2 / 131". */
  detail?: string | null;
}

/**
 * Picking one from a list that is too long for a segmented control (the design rule: up to four
 * choices are a segmented control, more are a sheet). With `searchable`, a search field sits on
 * top, focused as the sheet opens, and filters by title and detail as you type. Give `addLabel`
 * for a last row such as "+ Add a course".
 */
@Component({
  selector: 'ui-picker-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon, UiSheet],
  template: `
    <ui-sheet [(open)]="open" [label]="title()">
      <h2>{{ title() }}</h2>
      @if (searchable()) {
        <label class="search">
          <ui-icon name="search" />
          <input
            #search
            type="search"
            enterkeyhint="search"
            autocomplete="off"
            autocapitalize="none"
            [attr.aria-label]="'Search ' + title()"
            [value]="query()"
            (input)="query.set(text($event))"
          />
        </label>
      }
      <div class="list" role="listbox" [attr.aria-label]="title()">
        @for (option of shown(); track option.value) {
          <button
            type="button"
            class="row"
            role="option"
            [attr.aria-selected]="option.value === value()"
            (click)="pick(option.value)"
          >
            <span class="text">
              <span class="title">{{ option.title }}</span>
              @if (option.detail) {
                <span class="detail">{{ option.detail }}</span>
              }
            </span>
            @if (option.value === value()) {
              <ui-icon name="check" class="check" />
            }
          </button>
        } @empty {
          <p class="none">
            {{ query() ? 'Nothing matches "' + query() + '"' : 'Nothing to pick' }}
          </p>
        }
        @if (addLabel(); as label) {
          <button type="button" class="row add" (click)="add()">{{ label }}</button>
        }
      </div>
    </ui-sheet>
  `,
  styles: `
    h2 {
      font-size: 24px;
    }
    .search {
      display: flex;
      align-items: center;
      gap: var(--s2);
      min-height: 48px;
      padding: 0 var(--s3);
      border-radius: var(--radius-button);
      background: var(--chip);
      color: var(--muted);
    }
    .search ui-icon {
      width: 18px;
      height: 18px;
    }
    .search input {
      flex: 1;
      min-width: 0;
      border: 0;
      background: none;
      color: var(--ink);
      font: 600 17px var(--font-body);
      outline: none;
    }
    .list {
      display: flex;
      flex-direction: column;
    }
    .row {
      display: flex;
      align-items: center;
      gap: var(--s3);
      min-height: 56px;
      padding: var(--s3) 2px;
      border: 0;
      border-top: 1px solid var(--line);
      background: none;
      color: var(--ink);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .title {
      font-size: 17px;
    }
    .detail {
      font-size: 14px;
      font-weight: 500;
      color: var(--muted);
    }
    .check {
      color: var(--accent);
    }
    .add {
      color: var(--accent);
      font-weight: 700;
    }
    .none {
      padding: var(--s4) 2px;
      border-top: 1px solid var(--line);
      color: var(--muted);
      font-weight: 500;
    }
  `,
})
export class UiPickerSheet {
  readonly open = model(false);
  readonly title = input.required<string>();
  /** In the order to show them; for a search sheet, the recent ones first. */
  readonly options = input.required<PickerOption[]>();
  /** The current choice: checked. */
  readonly value = input<string | null>(null);
  readonly searchable = input(false, { transform: booleanAttribute });
  readonly addLabel = input<string>();
  readonly picked = output<string>();
  readonly added = output<void>();

  protected readonly query = signal('');
  private readonly search = viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly shown = computed(() => {
    const words = this.query().trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return this.options();
    return this.options().filter((option) => {
      const text = `${option.title} ${option.detail ?? ''}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
  });

  constructor() {
    // A fresh search every time, with the keyboard up.
    effect(() => {
      if (!this.open()) return this.query.set('');
      const field = this.search()?.nativeElement;
      if (field) setTimeout(() => field.focus());
    });
  }

  protected text(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected pick(value: string): void {
    this.picked.emit(value);
    this.open.set(false);
  }

  protected add(): void {
    this.added.emit();
    this.open.set(false);
  }
}

/** A set of tees, as a tees chip lists them. */
export interface TeeOption {
  id: string;
  name: string;
  yards: number | null;
  rating: number | null;
  slope: number | null;
}

/** "6,412 yds · 71.2 / 131" */
export function teeDetail(tee: TeeOption): string {
  return [
    tee.yards ? `${tee.yards.toLocaleString('en-US')} yds` : '',
    tee.rating && tee.slope ? `${tee.rating} / ${tee.slope}` : 'No rating',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * A player's tees, as a chip that reads like a dropdown (it always has its down chevron).
 * Tapping it opens a sheet of the course's tees with yards and rating / slope, the current one
 * checked. `changed` draws it bold: this player isn't on the round's tees.
 */
@Component({
  selector: 'ui-tees-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon, UiPickerSheet],
  template: `
    <button
      type="button"
      class="chip"
      [class.changed]="changed()"
      [disabled]="disabled()"
      [attr.aria-label]="label() + ': ' + (current()?.name ?? 'none')"
      (click)="open.set(true)"
    >
      <span>{{ current()?.name ?? 'Tees' }}</span>
      <ui-icon name="chevron-down" />
    </button>
    <ui-picker-sheet
      [(open)]="open"
      [title]="label()"
      [options]="options()"
      [value]="value()"
      (picked)="value.set($event)"
    />
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      min-height: 36px;
      padding: 0 var(--s2) 0 var(--s3);
      border: 0;
      border-radius: var(--radius-pill);
      background: var(--chip);
      color: var(--ink-2);
      font: 500 15px var(--font-body);
      cursor: pointer;
    }
    .chip.changed {
      color: var(--ink);
      font-weight: 700;
    }
    .chip:disabled {
      opacity: 0.6;
      cursor: default;
    }
    ui-icon {
      width: 18px;
      height: 18px;
    }
  `,
})
export class UiTeesChip {
  readonly tees = input.required<TeeOption[]>();
  readonly value = model<string | null>(null);
  /** The sheet's title: "Matt's tees". */
  readonly label = input('Tees');
  readonly changed = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });

  protected readonly open = signal(false);
  protected readonly current = computed(() => this.tees().find((t) => t.id === this.value()));
  protected readonly options = computed<PickerOption[]>(() =>
    this.tees().map((tee) => ({ value: tee.id, title: tee.name, detail: teeDetail(tee) })),
  );
}

/** A handicap index as typed: '16.9', '+1.2' (a plus handicap). Null when it isn't one. */
export function readIndex(typed: string): number | null | 'invalid' {
  const text = typed.trim();
  if (text === '') return null;
  const value = Number(text.replace('+', '-'));
  if (Number.isNaN(value) || value < -9.9 || value > 54) return 'invalid';
  return Math.round(value * 10) / 10;
}

/**
 * "Charlie's handicap index": one number on the decimal keypad and Save. Opened in place (from
 * the "!" on a round's player row, or from a scorecard that can't start without it), so the
 * screen underneath keeps whatever was being done. The page saves; this only asks.
 */
@Component({
  selector: 'ui-index-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiButton, UiField, UiSheet],
  template: `
    <ui-sheet [(open)]="open" [label]="title()">
      <form class="stack" (submit)="save($event)" novalidate>
        <h2>{{ title() }}</h2>
        <ui-field label="Handicap index" class="index">
          <input
            #field
            name="index"
            inputmode="decimal"
            autocomplete="off"
            placeholder="16.9"
            [value]="typed()"
            [attr.aria-invalid]="problem() ? 'true' : null"
            (input)="type($event)"
          />
        </ui-field>
        @if (problem() ?? error(); as text) {
          <p class="error-text" role="alert">{{ text }}</p>
        }
        <button ui-button type="submit" [busy]="busy()">Save</button>
      </form>
    </ui-sheet>
  `,
  styles: `
    h2 {
      font-size: 24px;
    }
    .index input {
      min-height: 56px;
      font: 700 26px var(--font-heading);
    }
  `,
})
export class UiIndexSheet {
  readonly open = model(false);
  /** Whose index: "Charlie". Empty for your own. */
  readonly name = input('');
  /** What it is now, if anything. */
  readonly value = input<number | null>(null);
  readonly busy = input(false, { transform: booleanAttribute });
  /** The page's own message when saving failed. */
  readonly error = input<string | null>(null);
  /** A valid index (null clears it, when `allowClear`). */
  readonly saved = output<number | null>();
  readonly allowClear = input(false, { transform: booleanAttribute });

  protected readonly typed = signal('');
  protected readonly problem = signal<string | null>(null);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');

  protected readonly title = computed(() =>
    this.name() ? `${this.name()}'s handicap index` : 'Your handicap index',
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const value = this.value();
      this.typed.set(value == null ? '' : value < 0 ? `+${-value}` : String(value));
      this.problem.set(null);
      const field = this.field()?.nativeElement;
      if (field) setTimeout(() => field.focus());
    });
  }

  protected type(event: Event): void {
    this.typed.set((event.target as HTMLInputElement).value);
    this.problem.set(null);
  }

  protected save(event: Event): void {
    event.preventDefault();
    const index = readIndex(this.typed());
    if (index === 'invalid') return this.problem.set('A handicap index is a number up to 54.0.');
    if (index === null && !this.allowClear()) return this.problem.set('Enter the index.');
    this.saved.emit(index);
  }
}
