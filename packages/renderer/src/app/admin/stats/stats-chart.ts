import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { linePath, niceMax } from './server-stats.model';

/** One line of a chart. `slot` picks the categorical color (`--series-<slot>`), fixed per entity. */
export interface ChartSeries {
  readonly key: string;
  readonly label: string;
  readonly slot: number;
  /** Oldest first; `null` leaves a gap. */
  readonly values: readonly (number | null)[];
}

const WIDTH = 600;
const HEIGHT = 120;

/**
 * A small live line chart (inline SVG, one y-axis): recessive grid at 0, ½ and the nice maximum,
 * 2 px lines, a legend with each series' latest value, and a hover crosshair whose tooltip lists
 * the values at that time. The newest point is always at the right edge; `slots` points fill
 * the width, so the lines scroll in from the right while the history fills up.
 */
@Component({
  selector: 'app-stats-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="chart" [attr.data-testid]="'chart-' + name()">
      <figcaption class="head">
        <span class="title">{{ title() }}</span>
        <ul class="legend">
          @for (s of series(); track s.key) {
            <li [attr.data-testid]="'legend-' + name() + '-' + s.key">
              <span class="swatch" [attr.data-slot]="s.slot"></span>
              <span class="label">{{ s.label }}</span>
              <span class="value">{{ latest(s) }}</span>
            </li>
          }
        </ul>
      </figcaption>
      <div class="plot">
        <span class="tick top">{{ format()(max()) }}</span>
        <span class="tick mid">{{ format()(max() / 2) }}</span>
        <span class="tick zero">0</span>
        <div class="area">
          <svg
            [attr.viewBox]="'0 0 ' + width + ' ' + height"
            preserveAspectRatio="none"
            role="img"
            [attr.aria-label]="ariaLabel()"
            (mousemove)="hover($event)"
            (mouseleave)="hoverIndex.set(null)"
          >
            <line class="grid" x1="0" [attr.x2]="width" y1="0.5" y2="0.5" />
            <line
              class="grid"
              x1="0"
              [attr.x2]="width"
              [attr.y1]="height / 2"
              [attr.y2]="height / 2"
            />
            <line
              class="axis"
              x1="0"
              [attr.x2]="width"
              [attr.y1]="height - 0.5"
              [attr.y2]="height - 0.5"
            />
            @for (p of paths(); track p.key) {
              <path
                class="line"
                [attr.data-slot]="p.slot"
                [attr.d]="p.d"
                [attr.data-testid]="'line-' + name() + '-' + p.key"
              />
            }
            @if (cursor(); as c) {
              <line class="cursor" [attr.x1]="c.x" [attr.x2]="c.x" y1="0" [attr.y2]="height" />
            }
          </svg>
          @if (cursor(); as c) {
            <div
              class="tip"
              role="status"
              [attr.data-testid]="'tip-' + name()"
              [style.left.%]="c.leftPct"
              [class.flip]="c.leftPct > 60"
            >
              @if (c.time) {
                <div class="time">{{ c.time }}</div>
              }
              @for (row of c.rows; track row.key) {
                <div class="row">
                  <span class="swatch" [attr.data-slot]="row.slot"></span>
                  <span class="label">{{ row.label }}</span>
                  <span class="value">{{ row.value }}</span>
                </div>
              }
            </div>
          }
          @if (empty()) {
            <div class="waiting" [attr.data-testid]="'waiting-' + name()">{{ emptyText() }}</div>
          }
        </div>
      </div>
    </figure>
  `,
  styleUrl: './stats-chart.css',
})
export class StatsChart {
  /** Short id for test ids (`ops`, `connections`, `memory`). */
  readonly name = input.required<string>();
  readonly title = input.required<string>();
  readonly series = input.required<readonly ChartSeries[]>();
  /** Point times (ms), same length as the series values; shown in the tooltip. */
  readonly times = input<readonly number[]>([]);
  /** How many points fill the width. */
  readonly slots = input(60);
  /** Lowest axis maximum (so a quiet server doesn't magnify noise). */
  readonly floor = input(1);
  readonly format = input<(value: number) => string>((v) => String(v));
  readonly emptyText = input('Collecting samples…');

  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;
  protected readonly hoverIndex = signal<number | null>(null);

  protected readonly length = computed(() =>
    Math.max(0, ...this.series().map((s) => s.values.length)),
  );
  protected readonly empty = computed(() => this.length() === 0);
  protected readonly max = computed(() => {
    let max = 0;
    for (const s of this.series()) {
      for (const v of s.values) if (v !== null && v > max) max = v;
    }
    return niceMax(max, this.floor());
  });
  private readonly span = computed(() => Math.max(this.slots(), this.length()));
  protected readonly paths = computed(() =>
    this.series().map((s) => ({
      key: s.key,
      slot: s.slot,
      d: linePath(s.values, WIDTH, HEIGHT, this.max(), this.span()),
    })),
  );
  protected readonly ariaLabel = computed(
    () =>
      `${this.title()}: ` +
      this.series()
        .map((s) => `${s.label} ${this.latest(s)}`)
        .join(', '),
  );
  protected readonly cursor = computed(() => {
    const index = this.hoverIndex();
    const length = this.length();
    if (index === null || length === 0) return null;
    const span = this.span();
    const step = span > 1 ? WIDTH / (span - 1) : 0;
    const x = (span - length + index) * step;
    const at = this.times()[index];
    return {
      x,
      leftPct: (x / WIDTH) * 100,
      time: at === undefined ? '' : new Date(at).toLocaleTimeString(),
      rows: this.series().map((s) => {
        const v = s.values[index];
        return {
          key: s.key,
          slot: s.slot,
          label: s.label,
          value: v === null || v === undefined ? '–' : this.format()(v),
        };
      }),
    };
  });

  protected latest(s: ChartSeries): string {
    const v = s.values.at(-1);
    return v === null || v === undefined ? '–' : this.format()(v);
  }

  /** Picks the point nearest to the pointer. */
  protected hover(event: MouseEvent): void {
    const svg = event.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const length = this.length();
    if (length === 0 || box.width <= 0) {
      this.hoverIndex.set(null);
      return;
    }
    this.hoverIndex.set(this.indexAt((event.clientX - box.left) / box.width));
  }

  /** The point index under a horizontal position (0…1 of the width). */
  indexAt(fraction: number): number | null {
    const length = this.length();
    if (length === 0) return null;
    const span = this.span();
    const slot = Math.round(Math.min(1, Math.max(0, fraction)) * (span - 1));
    return Math.min(length - 1, Math.max(0, slot - (span - length)));
  }

  /** Shows the tooltip of point `index` (`null` hides it); also for keyboard/tests. */
  showPoint(index: number | null): void {
    this.hoverIndex.set(index);
  }
}
