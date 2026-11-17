import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { parseJsonLines } from '../json-lines.util';
import { FilterService } from '../services/filter.service';
import { JsonLinesService } from '../services/json-lines.service';
import { SchemaService } from '../services/schema.service';
import { JsonLinesComponent } from './json-lines.component';

// The JSON Lines view after the copy: the template now reads each line with `@if (lines[i]; as
// line)` and the component falls back to an empty document when the service has none.
describe('JsonLinesComponent', () => {
  let fixture: ComponentFixture<JsonLinesComponent>;
  const el = () => fixture.nativeElement as HTMLElement;
  const lineNumbers = () =>
    [...el().querySelectorAll('.line-no')].map((n) => n.textContent?.trim());

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [JsonLinesComponent],
      providers: [provideZonelessChangeDetection()],
    });
  });

  const render = async (text?: string) => {
    TestBed.inject(JsonLinesService).set(text === undefined ? undefined : parseJsonLines(text));
    fixture = TestBed.createComponent(JsonLinesComponent);
    await fixture.whenStable();
  };

  it('shows the empty state instead of failing when there is no document', async () => {
    await render();
    expect(el().querySelector('.none')?.textContent).toBe('The file has no lines.');
    expect(el().querySelector('.line')).toBeNull();
  });

  it('renders JSON lines as tables and other lines as text, numbered by file line', async () => {
    await render('{"name":"Ada Example"}\n\nnot json\n{"name":"Bo Example"}\n');
    // The blank second line is kept in the file but not shown.
    expect(lineNumbers()).toEqual(['line 1', 'line 3', 'line 4']);
    expect(el().querySelectorAll('.line-body > app-json-table')).toHaveLength(2);
    expect(el().querySelector('.text-line')?.textContent).toContain('not json');
    expect(el().textContent).toContain('Ada Example');
    expect(el().textContent).toContain('Bo Example');
  });

  it('renders JSON lines as forms in the form layout', async () => {
    await render('{"name":"Ada Example"}\n{"name":"Bo Example"}\n');
    fixture.componentRef.setInput('layout', 'form');
    await fixture.whenStable();
    expect(el().querySelectorAll('.line-body > app-json-form')).toHaveLength(2);
    expect(el().querySelector('app-json-table')).toBeNull();
  });

  it('labels the shape of each line only when there is more than one shape', async () => {
    await render('{"a":1}\n{"a":2}\n');
    expect(el().querySelector('.line-group')).toBeNull();

    await render('{"a":1,"b":2}\n[1,2,3]\n');
    expect([...el().querySelectorAll('.line-group')].map((g) => g.textContent?.trim())).toEqual([
      'shape A',
      'shape B',
    ]);
  });

  it('keeps only the lines a search matches, and says so when none does', async () => {
    await render('{"name":"Ada Example"}\nplain words\n{"name":"Bo Example"}\n');
    const filter = TestBed.inject(FilterService);

    filter.set('bo example');
    await fixture.whenStable();
    expect(lineNumbers()).toEqual(['line 3']);

    filter.set('words');
    await fixture.whenStable();
    expect(lineNumbers()).toEqual(['line 2']);

    filter.set('no such thing');
    await fixture.whenStable();
    expect(el().querySelector('.none')?.textContent).toBe('No line matches.');
  });

  it('counts the schema problems of each line', async () => {
    const text = '{"n":1}\n{"n":"x"}\n';
    const schema = TestBed.inject(SchemaService);
    expect(schema.load('{"properties":{"n":{"type":"number"}}}', 'n.schema.json')).toBe(true);
    const doc = parseJsonLines(text);
    schema.setLines(doc?.lines.map((l) => (l.kind === 'json' ? l.value : undefined)) ?? []);
    await render(text);
    const badges = [...el().querySelectorAll('.line')].map(
      (l) => l.querySelector('.line-problems')?.textContent?.trim() ?? '',
    );
    expect(badges).toEqual(['', '⚠ 1']);
  });

  it('pages long files with a pager', async () => {
    const text = Array.from({ length: 200 }, (_, i) => JSON.stringify({ n: i })).join('\n');
    await render(text);
    expect(lineNumbers()).toHaveLength(50);
    const pager = () => el().querySelector('[data-testid="nested-pager"]');
    expect(pager()?.querySelector('[data-testid="pager-range"]')?.textContent?.trim()).toBe(
      '1–50 of 200 lines',
    );

    pager()?.querySelector<HTMLButtonElement>('[data-testid="pager-next"]')?.click();
    await fixture.whenStable();
    expect(lineNumbers()).toHaveLength(50);
    expect(pager()?.querySelector('[data-testid="pager-range"]')?.textContent?.trim()).toBe(
      '51–100 of 200 lines',
    );

    pager()?.querySelector<HTMLButtonElement>('[data-testid="pager-last"]')?.click();
    await fixture.whenStable();
    expect(pager()?.querySelector('[data-testid="pager-range"]')?.textContent?.trim()).toBe(
      '151–200 of 200 lines',
    );
  });

  it('emits the edited line with its index', async () => {
    await render('{"a":1}\n{"a":2}\n');
    const seen: { index: number; value: unknown }[] = [];
    fixture.componentInstance.lineChange.subscribe((e) => seen.push(e));
    // The second line's table re-emits a changed value through the line wrapper.
    const debug = fixture.debugElement.queryAll(
      (d) =>
        d.name === 'app-json-table' &&
        (d.parent?.nativeElement as HTMLElement | undefined)?.classList.contains('line-body') ===
          true,
    );
    expect(debug).toHaveLength(2);
    (debug[1]?.componentInstance as { valueChange: { emit(v: unknown): void } }).valueChange.emit({
      a: 3,
    });
    expect(seen).toEqual([{ index: 1, value: { a: 3 } }]);
  });
});
