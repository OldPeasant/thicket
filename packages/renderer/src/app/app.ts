import { ChangeDetectionStrategy, Component, signal } from '@angular/core';

/** Root component. Placeholder shell until the app-layout task adds the real layout. */
@Component({
  selector: 'app-root',
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
export class App {
  protected readonly title = signal('Thicket');
}
