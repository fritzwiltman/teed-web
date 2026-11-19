import { NgTemplateOutlet } from '@angular/common';
import { Component, inject } from '@angular/core';
import { InstallService } from '../core/install';

/**
 * "Add to Home Screen" help for the browser this is running in. Shows nothing once the app is
 * running from the home screen, or on browsers where it can't be installed this way.
 */
@Component({
  selector: 'app-install-card',
  template: `
    @switch (install.platform()) {
      @case ('ios-safari') {
        <section class="card" aria-labelledby="install-title">
          <p class="label">Works best installed</p>
          <h2 id="install-title">Add Teed to your Home Screen</h2>
          <ol>
            <li>
              Tap <strong>Share</strong> <ng-container *ngTemplateOutlet="shareIcon" /> in Safari's
              toolbar.
            </li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong>, then open Teed from your Home Screen.</li>
          </ol>
          <ng-container *ngTemplateOutlet="clip" />
          <ng-container *ngTemplateOutlet="again" />
        </section>
      }
      @case ('ios-chrome') {
        <section class="card" aria-labelledby="install-title">
          <p class="label">Works best installed</p>
          <h2 id="install-title">Add Teed to your Home Screen</h2>
          <ol>
            <li>
              Tap <strong>Share</strong> <ng-container *ngTemplateOutlet="shareIcon" /> at the right
              of Chrome's address bar.
            </li>
            <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
            <li>Tap <strong>Add</strong>, then open Teed from your Home Screen.</li>
          </ol>
          <ng-container *ngTemplateOutlet="clip" />
          <ng-container *ngTemplateOutlet="again" />
        </section>
      }
      @case ('ios-other') {
        <section class="card" aria-labelledby="install-title">
          <p class="label">Works best installed</p>
          <h2 id="install-title">Add Teed to your Home Screen</h2>
          <p>
            Open this page in <strong>Safari</strong>, then tap <strong>Share</strong> and
            <strong>Add to Home Screen</strong>.
          </p>
          <ng-container *ngTemplateOutlet="again" />
        </section>
      }
      @case ('android') {
        <section class="card" aria-labelledby="install-title">
          <p class="label">Works best installed</p>
          <h2 id="install-title">Install Teed</h2>
          @if (install.canPrompt()) {
            <p>Put Teed on your Home screen so it opens like an app and works without signal.</p>
            <button type="button" class="button quiet" (click)="install.promptInstall()">
              Install
            </button>
          } @else {
            <p>
              Tap the <strong>⋮</strong> menu in Chrome, then <strong>Add to Home screen</strong> or
              <strong>Install app</strong>.
            </p>
          }
          <ng-container *ngTemplateOutlet="again" />
        </section>
      }
    }

    <ng-template #shareIcon>
      <svg class="share" viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3v12M8 7l4-4 4 4M6 11H5v9h14v-9h-1"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </ng-template>
    <!-- Placeholder for the short looping demo clip. Replace with <img src="..." alt="..."> when it's recorded. -->
    <ng-template #clip>
      <div class="clip" role="img" aria-label="A short demo of these steps will go here">
        Demo clip goes here
      </div>
    </ng-template>
    <ng-template #again>
      <p class="muted small">
        The installed app keeps its own login, so you'll enter your code once more there.
      </p>
    </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    h2 {
      font-size: 1.2rem;
    }
    ol {
      margin: 0;
      padding-left: 1.3rem;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .share {
      width: 1.15em;
      height: 1.15em;
      vertical-align: -0.2em;
      color: var(--brand);
    }
    .clip {
      display: grid;
      place-items: center;
      aspect-ratio: 16 / 9;
      border: 1px dashed var(--line);
      border-radius: 6px;
      color: var(--muted);
      font: 500 0.75rem var(--font-mono);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .small {
      font-size: 0.875rem;
    }
  `,
  imports: [NgTemplateOutlet],
})
export class InstallCard {
  protected readonly install = inject(InstallService);
}
