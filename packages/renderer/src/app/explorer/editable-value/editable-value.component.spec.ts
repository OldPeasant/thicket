import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BsonLeaf, type BsonLeafValue } from '../bson-value.util';
import { EditModeService } from '../services/edit-mode.service';
import { NumberDefaultService } from '../services/number-default.service';
import { SchemaService } from '../services/schema.service';
import { EditableValueComponent } from './editable-value.component';

// The type dropdown of one value under a schema: only the BSON types that
// count as one of the schema's JSON types are offered, plus the current one.
describe('EditableValueComponent type dropdown with a schema', () => {
  let allowed: readonly string[] | undefined;
  let emitted: unknown[];

  beforeEach(() => {
    allowed = undefined;
    TestBed.configureTestingModule({
      imports: [EditableValueComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: SchemaService,
          useValue: {
            typesFor: () => allowed,
            readOnlyFor: () => false,
            choicesFor: () => undefined,
          },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(EditModeService).reset();
  });

  const create = async (value: unknown) => {
    const fixture = TestBed.createComponent(EditableValueComponent);
    emitted = [];
    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('uid', '.x');
    fixture.componentInstance.valueChange.subscribe((v: unknown) => emitted.push(v));
    const editMode = TestBed.inject(EditModeService);
    if (!editMode.enabled()) editMode.toggle();
    await fixture.whenStable();
    return fixture;
  };
  const targets = async (value: unknown) =>
    (await create(value)).componentInstance.typeOptions.map((o) => o.target);
  const int = (value: number) => new BsonLeaf({ type: 'int', value });

  it('without a schema, offers every creatable type', async () => {
    expect(await targets(int(1))).toHaveLength(18);
  });

  it('"integer" allows Int32 and Int64', async () => {
    allowed = ['integer'];
    expect(await targets(int(1))).toEqual(['int', 'long']);
  });

  it('"number" allows every numeric type', async () => {
    allowed = ['number'];
    expect(await targets(int(1))).toEqual(['int', 'long', 'double', 'decimal']);
  });

  it('maps string, boolean, null, object and array to their BSON types', async () => {
    allowed = ['string', 'boolean', 'null', 'object', 'array'];
    expect(await targets('')).toEqual(['string', 'bool', 'object', 'array', 'null']);
  });

  it('keeps the current type even when the schema does not allow it', async () => {
    allowed = ['string'];
    const date: BsonLeafValue = { type: 'date', ms: 0n };
    expect(await targets(new BsonLeaf(date))).toEqual(['string', 'date']);
    const uuid = new BsonLeaf({ type: 'binary', subtype: 4, base64: 'ABEiM0RVZneImaq7zN3u/w==' });
    expect(await targets(uuid)).toEqual(['string', 'uuid']);
  });

  it('types without a JSON counterpart are offered only when current', async () => {
    allowed = ['integer', 'number', 'string', 'boolean', 'null', 'object', 'array'];
    const offered = await targets('');
    for (const t of ['date', 'objectId', 'uuid', 'binary', 'regex', 'javascript', 'timestamp']) {
      expect(offered).not.toContain(t);
    }
  });

  it('hides the dropdown when the schema leaves a single type', async () => {
    allowed = ['string'];
    const fixture = await create('abc');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('select.type-select')).toBeNull();
  });

  it('marks the current type and disables impossible conversions in the DOM', async () => {
    allowed = ['number', 'string'];
    const fixture = await create(new BsonLeaf({ type: 'double', value: 1.5 }));
    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      'select.type-select',
    );
    const options = [...(select?.options ?? [])];
    expect(options.map((o) => [o.value, o.disabled])).toEqual([
      ['string', false],
      ['int', true],
      ['long', true],
      ['double', false],
      ['decimal', false],
    ]);
    expect(select?.getAttribute('data-bson-type')).toBe('double');
    expect(options.find((o) => o.value === 'int')?.title).toContain('not an integer');
  });

  // CR-2: the options are computed once per value and schema type list.
  it('reuses the options while the value and the schema types stay the same', async () => {
    const fixture = await create(int(1));
    const ev = fixture.componentInstance;
    const first = ev.typeOptions;
    expect(ev.typeOptions).toBe(first);
    allowed = ['integer'];
    const filtered = ev.typeOptions;
    expect(filtered.map((o) => o.target)).toEqual(['int', 'long']);
    expect(ev.typeOptions).toBe(filtered);
    fixture.componentRef.setInput('value', new BsonLeaf({ type: 'long', value: 1n }));
    await fixture.whenStable();
    expect(ev.typeOptions).not.toBe(filtered);
    expect(ev.typeOptions.map((o) => o.target)).toEqual(['int', 'long']);
  });

  // Round 2: choosing the current type, or a disabled (stale) option, changes nothing.
  it('emits nothing for the current type or a conversion that is not possible', async () => {
    const fixture = await create(new BsonLeaf({ type: 'double', value: 1.5 }));
    const select = (fixture.nativeElement as HTMLElement).querySelector<HTMLSelectElement>(
      'select.type-select[data-bson-type]',
    );
    expect(select).not.toBeNull();
    if (!select) return;
    for (const target of ['double', 'int']) {
      select.value = target;
      select.dispatchEvent(new Event('change'));
    }
    expect(emitted).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve));
    expect(select.value).toBe('double');
    select.value = 'long';
    select.dispatchEvent(new Event('change'));
    expect(emitted).toEqual([]);
    select.value = 'decimal';
    select.dispatchEvent(new Event('change'));
    expect(emitted).toEqual([new BsonLeaf({ type: 'decimal', value: '1.5' })]);
  });

  it('a deprecated scalar keeps the one-line value in edit mode', async () => {
    const fixture = await create(
      new BsonLeaf({ type: 'dbPointer', ref: 'db.c', hex: 'a'.repeat(24) }),
    );
    const val = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.val.bson');
    expect(val?.classList.contains('scalar')).toBe(true);
    expect(val?.classList.contains('deprecated')).toBe(true);
  });

  it('a plain number typed becomes the configured BSON number', async () => {
    TestBed.inject(NumberDefaultService).integers.set('int64');
    const fixture = await create(1);
    fixture.componentInstance.commitNumber('40');
    fixture.componentInstance.commitNumber('1');
    expect(emitted).toEqual([new BsonLeaf({ type: 'long', value: 40n })]);
  });
});

// table-number-wrap: which BSON values stay on one line (class `scalar`,
// `white-space: nowrap`) and which may still wrap (long binary, code, regex,
// symbol). Shown read-only (edit mode off), as in the Table view.
describe('EditableValueComponent scalar values never wrap mid-value', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [EditableValueComponent],
      providers: [provideZonelessChangeDetection()],
    });
  });

  afterEach(() => {
    TestBed.inject(EditModeService).reset();
  });

  const render = async (value: unknown) => {
    const fixture = TestBed.createComponent(EditableValueComponent);
    fixture.componentRef.setInput('value', value);
    fixture.componentRef.setInput('uid', '.x');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return { component: fixture.componentInstance, el, val: el.querySelector<HTMLElement>('.val') };
  };

  const UUID_BASE64 = 'ABEiM0RVZneImaq7zN3u/w=='; // 16 bytes
  const SCOPE = { type: 'object', fields: [] } as const;

  const scalars: [string, BsonLeafValue][] = [
    ['Int32', { type: 'int', value: 10421 }],
    ['Int64', { type: 'long', value: 9007199254740993n }],
    ['Double', { type: 'double', value: 0.125 }],
    ['Decimal128', { type: 'decimal', value: '149.90' }],
    ['ObjectId', { type: 'objectId', hex: '65a1f0c2e4b0a1b2c3d4e5f1' }],
    ['Date', { type: 'date', ms: 1700000000000n }],
    ['Date out of range', { type: 'date', ms: 9_000_000_000_000_000n }],
    ['Timestamp', { type: 'timestamp', t: 4294967295, i: 4294967295 }],
    ['UUID (binary subtype 4)', { type: 'binary', subtype: 4, base64: UUID_BASE64 }],
    ['MinKey', { type: 'minKey' }],
    ['MaxKey', { type: 'maxKey' }],
    ['Undefined (deprecated)', { type: 'undefined' }],
    ['DBPointer (deprecated)', { type: 'dbPointer', ref: 'shop.orders', hex: 'a'.repeat(24) }],
    ['Null held in a leaf', { type: 'null' }],
    ['Boolean held in a leaf', { type: 'bool', value: true }],
  ];

  const wrapping: [string, BsonLeafValue][] = [
    ['generic binary (subtype 0)', { type: 'binary', subtype: 0, base64: 'QUJD'.repeat(40) }],
    ['legacy UUID (binary subtype 3)', { type: 'binary', subtype: 3, base64: UUID_BASE64 }],
    ['subtype 4 that is not 16 bytes', { type: 'binary', subtype: 4, base64: 'QUJD' }],
    ['Regex', { type: 'regex', pattern: 'a'.repeat(80), options: 'i' }],
    ['Code', { type: 'javascript', code: 'function f() { return 1; }' }],
    ['Code w/ scope (deprecated)', { type: 'javascriptWithScope', code: 'x', scope: SCOPE }],
    ['Symbol (deprecated)', { type: 'symbol', value: 'a long symbol value' }],
    ['String held in a leaf', { type: 'string', value: 'a long string value' }],
  ];

  it.each(scalars)('%s is scalar and its value does not wrap', async (_name, bson) => {
    const { component, val } = await render(new BsonLeaf(bson));
    expect(component.scalar).toBe(true);
    expect(val?.classList.contains('bson')).toBe(true);
    expect(val?.classList.contains('scalar')).toBe(true);
    const style = getComputedStyle(val as HTMLElement);
    expect(style.whiteSpace).toBe('nowrap');
    expect(style.overflowWrap).toBe('normal');
  });

  it.each(wrapping)('%s is not scalar and may still wrap', async (_name, bson) => {
    const { component, val } = await render(new BsonLeaf(bson));
    expect(component.scalar).toBe(false);
    expect(val?.classList.contains('bson')).toBe(true);
    expect(val?.classList.contains('scalar')).toBe(false);
    const style = getComputedStyle(val as HTMLElement);
    expect(style.whiteSpace).toBe('pre-wrap');
    expect(style.overflowWrap).toBe('anywhere');
  });

  it('binary is scalar exactly when its badge says UUID', async () => {
    const uuid = await render(new BsonLeaf({ type: 'binary', subtype: 4, base64: UUID_BASE64 }));
    expect(uuid.el.querySelector('.badge')?.textContent?.trim()).toBe('UUID');
    expect(uuid.component.scalar).toBe(true);
    const short = await render(new BsonLeaf({ type: 'binary', subtype: 4, base64: 'QUJD' }));
    expect(short.el.querySelector('.badge')?.textContent?.trim()).toBe('Binary 0x04');
    expect(short.component.scalar).toBe(false);
  });

  it.each([
    ['plain integer', 10421, 'num'],
    ['plain fraction', 149.9, 'num'],
    ['plain boolean', false, 'bool'],
    ['null', null, 'null'],
  ] as const)('a %s is scalar and does not wrap', async (_name, value, cls) => {
    const { component, val } = await render(value);
    expect(component.scalar).toBe(true);
    expect(val?.classList.contains(cls)).toBe(true);
    expect(getComputedStyle(val as HTMLElement).whiteSpace).toBe('nowrap');
  });

  it('a plain string has no scalar class and wraps at word boundaries', async () => {
    const { val } = await render('Please deliver to the back door after five in the evening');
    expect(val?.classList.contains('str')).toBe(true);
    expect(val?.classList.contains('scalar')).toBe(false);
    const style = getComputedStyle(val as HTMLElement);
    expect(style.whiteSpace).toBe('pre-wrap');
    expect(style.overflowWrap).toBe('break-word');
  });

  it('updates the class when the value changes type', async () => {
    const fixture = TestBed.createComponent(EditableValueComponent);
    fixture.componentRef.setInput('value', new BsonLeaf({ type: 'int', value: 1 }));
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.val.bson')?.classList.contains('scalar')).toBe(true);
    fixture.componentRef.setInput(
      'value',
      new BsonLeaf({ type: 'regex', pattern: 'x', options: '' }),
    );
    await fixture.whenStable();
    expect(el.querySelector('.val.bson')?.classList.contains('scalar')).toBe(false);
  });
});
