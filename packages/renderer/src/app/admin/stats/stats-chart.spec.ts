import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ChartSeries, StatsChart } from './stats-chart';

const T0 = Date.parse('2026-01-02T03:04:05.000Z');

describe('StatsChart', () => {
  let fixture: ComponentFixture<StatsChart>;
  let chart: StatsChart;

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (id: string) => el().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const words = (e: Element | null): string => {
    if (!e) return '';
    const parts: string[] = [];
    const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const part = node.textContent?.replace(/\s+/g, ' ').trim();
      if (part) parts.push(part);
    }
    return parts.join(' ');
  };

  const render = async (
    series: ChartSeries[],
    extra: { slots?: number; times?: number[]; format?: (v: number) => string } = {},
  ) => {
    fixture = TestBed.createComponent(StatsChart);
    chart = fixture.componentInstance;
    fixture.componentRef.setInput('name', 'demo');
    fixture.componentRef.setInput('title', 'Demo');
    fixture.componentRef.setInput('series', series);
    if (extra.slots !== undefined) fixture.componentRef.setInput('slots', extra.slots);
    if (extra.times !== undefined) fixture.componentRef.setInput('times', extra.times);
    if (extra.format !== undefined) fixture.componentRef.setInput('format', extra.format);
    await fixture.whenStable();
  };
  const svg = () => el().querySelector('svg') as SVGSVGElement;
  /** Moves the pointer to `fraction` of a 300 px wide plot. */
  const pointAt = async (fraction: number, width = 300) => {
    const target = svg();
    target.getBoundingClientRect = () =>
      ({ left: 100, top: 0, width, height: 60, right: 100 + width, bottom: 60 }) as DOMRect;
    target.dispatchEvent(new MouseEvent('mousemove', { clientX: 100 + fraction * width }));
    await fixture.whenStable();
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [StatsChart],
      providers: [provideZonelessChangeDetection()],
    });
  });

  afterEach(() => fixture?.destroy());

  describe('indexAt', () => {
    it('is null without points', async () => {
      await render([{ key: 'a', label: 'a', slot: 1, values: [] }]);
      expect(chart.indexAt(0)).toBeNull();
      expect(chart.indexAt(1)).toBeNull();
    });

    it('maps the right edge to the newest point and the empty left part to the oldest', async () => {
      // 3 points in 5 slots: they occupy slots 2, 3, 4.
      await render([{ key: 'a', label: 'a', slot: 1, values: [1, 2, 3] }], { slots: 5 });
      expect(chart.indexAt(1)).toBe(2);
      expect(chart.indexAt(0.75)).toBe(1);
      expect(chart.indexAt(0.5)).toBe(0);
      expect(chart.indexAt(0)).toBe(0);
    });

    it('clamps positions outside the plot', async () => {
      await render([{ key: 'a', label: 'a', slot: 1, values: [1, 2, 3] }], { slots: 5 });
      expect(chart.indexAt(-0.5)).toBe(0);
      expect(chart.indexAt(7)).toBe(2);
    });

    it('spreads over the whole width when there are more points than slots', async () => {
      await render([{ key: 'a', label: 'a', slot: 1, values: [1, 2, 3, 4, 5] }], { slots: 2 });
      expect(chart.indexAt(0)).toBe(0);
      expect(chart.indexAt(0.5)).toBe(2);
      expect(chart.indexAt(1)).toBe(4);
    });

    it('uses the longest series when the series have different lengths', async () => {
      await render(
        [
          { key: 'a', label: 'a', slot: 1, values: [1] },
          { key: 'b', label: 'b', slot: 2, values: [1, 2, 3, 4] },
        ],
        { slots: 4 },
      );
      expect(chart.indexAt(0)).toBe(0);
      expect(chart.indexAt(1)).toBe(3);
    });
  });

  it('shows the waiting text and no tooltip until there are points', async () => {
    await render([{ key: 'a', label: 'a', slot: 1, values: [] }]);
    expect(words(q('waiting-demo'))).toBe('Collecting samples…');
    await pointAt(0.5);
    expect(q('tip-demo')).toBeNull();
  });

  it('shows the tooltip of the point under the pointer and hides it when the pointer leaves', async () => {
    await render(
      [
        { key: 'a', label: 'reads', slot: 1, values: [10, 20, null] },
        { key: 'b', label: 'writes', slot: 2, values: [1, 2, 3] },
      ],
      { slots: 3, times: [T0, T0 + 1000, T0 + 2000], format: (v) => `${v} ops` },
    );
    await pointAt(0.5);
    const tip = words(q('tip-demo'));
    expect(tip).toContain(new Date(T0 + 1000).toLocaleTimeString());
    expect(tip).toContain('reads 20 ops');
    expect(tip).toContain('writes 2 ops');
    expect(q('tip-demo')?.classList.contains('flip')).toBe(false);

    // A gap shows a dash; the right half flips the tooltip to stay inside the plot.
    await pointAt(1);
    expect(words(q('tip-demo'))).toContain('reads –');
    expect(q('tip-demo')?.classList.contains('flip')).toBe(true);

    svg().dispatchEvent(new MouseEvent('mouseleave'));
    await fixture.whenStable();
    expect(q('tip-demo')).toBeNull();
  });

  it('shows no tooltip while the plot has no width (hidden tab)', async () => {
    await render([{ key: 'a', label: 'a', slot: 1, values: [1, 2] }]);
    await pointAt(0.5, 0);
    expect(q('tip-demo')).toBeNull();
  });

  it('shows a dash for a series whose newest value is a gap, in the legend and the label', async () => {
    await render([
      { key: 'a', label: 'reads', slot: 1, values: [5, null] },
      { key: 'b', label: 'writes', slot: 2, values: [7] },
    ]);
    expect(words(q('legend-demo-a'))).toBe('reads –');
    expect(words(q('legend-demo-b'))).toBe('writes 7');
    expect(svg().getAttribute('aria-label')).toBe('Demo: reads –, writes 7');
  });

  it('leaves out the time row when no times are given', async () => {
    await render([{ key: 'a', label: 'a', slot: 1, values: [4] }]);
    chart.showPoint(0);
    await fixture.whenStable();
    expect(q('tip-demo')?.querySelector('.time')).toBeNull();
    expect(words(q('tip-demo'))).toBe('a 4');
  });
});
