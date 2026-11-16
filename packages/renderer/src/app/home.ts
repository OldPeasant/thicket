import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

/** Start page. Placeholder until the app-layout task adds the real layout and welcome screen. */
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="shell">
      <h1>{{ title() }}</h1>
      <p>A desktop client for MongoDB.</p>
    </main>
  `,
  styles: `
    .shell {
      padding: 2rem;
    }
    h1 {
      margin: 0 0 0.5rem;
      font-size: 1.5rem;
      font-weight: 600;
    }
  `,
})
export class Home {
  protected readonly title = signal('Thicket');
}
