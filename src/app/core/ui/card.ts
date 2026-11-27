import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiIcon } from './icon';

/**
 * A card. Rows (ui-list-row, ui-section-head) run edge to edge; add `pad` for a card that is one
 * block of content. Give `link` and the whole card is a link.
 */
@Component({
  selector: 'ui-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, NgTemplateOutlet],
  host: { '[class.pad]': 'pad()' },
  template: `
    <ng-template #body><ng-content /></ng-template>
    @if (link(); as to) {
      <a class="all" [routerLink]="to"><ng-container *ngTemplateOutlet="body" /></a>
    } @else {
      <ng-container *ngTemplateOutlet="body" />
    }
  `,
  styles: `
    :host {
      display: block;
      background: var(--card);
      border-radius: var(--radius-card);
      box-shadow: var(--shadow-card);
      overflow: hidden;
    }
    :host(.pad),
    :host(.pad) .all {
      display: flex;
      flex-direction: column;
      gap: var(--s3);
    }
    :host(.pad) {
      padding: var(--s4);
    }
    .all {
      display: block;
      color: inherit;
      text-decoration: none;
    }
  `,
})
export class UiCard {
  readonly pad = input(false, { transform: booleanAttribute });
  readonly link = input<string | readonly unknown[]>();
}

/**
 * The head of a card: a title, with an optional note and chevron at the right. Put the Edit pill
 * (or another small action) inside with the `action` attribute: it sits beside the title.
 */
@Component({
  selector: 'ui-section-head',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [UiIcon],
  template: `
    <h2><ng-content select="[lead]" />{{ title() }}</h2>
    @if (note()) {
      <span class="note">{{ note() }}</span>
    }
    @if (chevron()) {
      <ui-icon name="chevron-right" />
    }
    <ng-content select="[action]" />
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--s2);
      min-height: 48px;
      padding: var(--s3) var(--s4) var(--s1);
    }
    :host-context(ui-card.pad) {
      min-height: 0;
      padding: 0;
    }
    h2 {
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      gap: var(--s2);
      font-size: 20px;
    }
    .note {
      font-size: 14px;
      font-weight: 500;
      color: var(--muted);
    }
    ui-icon {
      color: var(--muted);
      width: 20px;
      height: 20px;
    }
  `,
})
export class UiSectionHead {
  readonly title = input.required<string>();
  readonly note = input<string>();
  readonly chevron = input(false, { transform: booleanAttribute });
}
