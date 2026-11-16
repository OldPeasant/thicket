import { describe, expect, it } from 'vitest';
import { SchemaModel, type JsonSchema } from './index';

// Inline stand-ins for JSON Canopy's samples/-based cases, which were not copied into Thicket.
// They cover the code paths the copy rewrote to pass the strict lint and type check (variantsAt,
// switchVariant, seed alternatives, mergeTwo, the closest-variant errors). All data is made up.

const workItems: JsonSchema = {
  type: 'object',
  properties: { items: { type: 'array', items: { $ref: '#/$defs/item' } } },
  $defs: {
    item: {
      type: 'object',
      required: ['id', 'type', 'title'],
      properties: {
        id: { type: 'integer', minimum: 1 },
        type: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'string' },
      },
      oneOf: [
        {
          title: 'To-do',
          properties: {
            type: { const: 'todo' },
            assignee: { type: 'string' },
            status: { enum: ['open', 'done'] },
          },
        },
        {
          title: 'Bug',
          properties: {
            type: { const: 'bug' },
            assignee: { type: 'string' },
            status: { enum: ['open', 'fixed'] },
          },
        },
        {
          title: 'Event',
          required: ['date'],
          properties: {
            type: { const: 'event' },
            date: { type: 'string', format: 'date' },
            status: { enum: ['scheduled', 'held'] },
          },
        },
      ],
      unevaluatedProperties: false,
    },
  },
};

const board = {
  items: [
    { id: 1, type: 'todo', title: 'Write copy', assignee: 'Alex Example', status: 'done' },
    { id: 2, type: 'bug', title: 'Fix login', status: 'fixed' },
    { id: 3, type: 'event', title: 'Demo day', date: '2030-01-02', status: 'held' },
  ],
};

describe('variants (inline work-item schema)', () => {
  const m = new SchemaModel(workItems);

  it('infers the discriminator from const properties', () => {
    expect(m.discriminatorOf(m.nodesAt(['items', 0])[0] ?? {})).toEqual({
      property: 'type',
      values: [['todo'], ['bug'], ['event']],
    });
  });

  it('lists the variants with their titles and selecting values', () => {
    expect(m.variantsAt(['items', 0])).toEqual({
      property: 'type',
      variants: [
        { label: 'To-do', values: ['todo'] },
        { label: 'Bug', values: ['bug'] },
        { label: 'Event', values: ['event'] },
      ],
    });
    expect(m.variantsAt(['items'])).toBeUndefined();
    expect(m.variantsAt(['nowhere'])).toBeUndefined();
  });

  it('labels an untitled variant by its first selecting value (enum discriminator)', () => {
    const plain = new SchemaModel({
      oneOf: [
        { properties: { kind: { enum: ['a', 'b'] } } },
        { properties: { kind: { enum: ['c'] } } },
      ],
    });
    expect(plain.variantsAt([])).toEqual({
      property: 'kind',
      variants: [
        { label: 'a', values: ['a', 'b'] },
        { label: 'c', values: ['c'] },
      ],
    });
  });

  it('finds no discriminator when the selecting values overlap or there is one variant', () => {
    const overlap = new SchemaModel({
      oneOf: [
        { properties: { kind: { enum: ['a', 'b'] } } },
        { properties: { kind: { enum: ['b'] } } },
      ],
    });
    expect(overlap.variantsAt([])).toBeUndefined();
    const single = new SchemaModel({ oneOf: [{ properties: { k: { const: 1 } } }] });
    expect(single.variantsAt([])).toBeUndefined();
  });

  it('says which variant an object is', () => {
    expect(m.variantIndexAt(['items', 0], board)).toBe(0);
    expect(m.variantIndexAt(['items', 1], board)).toBe(1);
    expect(m.variantIndexAt(['items', 2], board)).toBe(2);
    expect(m.variantIndexAt(['items', 0], { items: [{ type: 'nope' }] })).toBeUndefined();
  });

  it('narrows to the selected variant, keeping both sides of a shared property', () => {
    expect(m.nodesAt(['items', 1], board)[0]?.title).toBe('Bug');
    // Base `type: string` and the variant's enum are both kept.
    expect(m.nodesAt(['items', 1, 'status'], board)[0]).toMatchObject({
      type: 'string',
      enum: ['open', 'fixed'],
    });
    expect(m.nodesAt(['items', 2, 'date'], board)[0]?.format).toBe('date');
  });

  it('reshapes a to-do into an event: drops, resets and adds keys', () => {
    expect(m.switchVariant(['items', 0], board, 'event')).toEqual({
      value: { id: 1, type: 'event', title: 'Write copy', status: 'scheduled', date: '' },
      dropped: ['assignee'],
      reset: ['status'],
      added: ['date'],
    });
  });

  it('keeps what the new variant also declares and only resets what no longer fits', () => {
    const r = m.switchVariant(['items', 0], board, 'bug');
    expect(r?.dropped).toEqual([]);
    expect(r?.reset).toEqual(['status']);
    expect(r?.added).toEqual([]);
    expect(r?.value).toEqual({
      id: 1,
      type: 'bug',
      title: 'Write copy',
      assignee: 'Alex Example',
      status: 'open',
    });

    const open = { items: [{ ...board.items[0], status: 'open' }] };
    const fits = m.switchVariant(['items', 0], open, 'bug');
    expect(fits?.reset).toEqual([]);
    expect(fits?.value['status']).toBe('open');
  });

  it('can leave the leftovers in place instead of dropping them', () => {
    const r = m.switchVariant(['items', 0], board, 'event', false);
    expect(r?.dropped).toEqual([]);
    expect(r?.value['assignee']).toBe('Alex Example');
    expect(r?.added).toEqual(['date']);
  });

  it('keeps the position of the discriminator among the keys', () => {
    const r = m.switchVariant(['items', 2], board, 'todo');
    expect(Object.keys(r?.value ?? {}).slice(0, 3)).toEqual(['id', 'type', 'title']);
    expect(r?.dropped).toEqual(['date']);
  });

  it('refuses a value that names no variant, a non-object, and objects without variants', () => {
    expect(m.switchVariant(['items', 0], board, 'nope')).toBeUndefined();
    expect(m.switchVariant(['items', 0], { items: ['just text'] }, 'bug')).toBeUndefined();
    expect(m.switchVariant(['items', 0], { items: [] }, 'bug')).toBeUndefined();
    expect(new SchemaModel({ type: 'object' }).switchVariant([], { a: 1 }, 'x')).toBeUndefined();
  });

  it('does not touch the data it was given', () => {
    const copy = structuredClone(board);
    m.switchVariant(['items', 0], board, 'event');
    m.switchVariant(['items', 2], board, 'todo', false);
    expect(board).toEqual(copy);
  });

  it('seeds a new item as the first variant with its required keys', () => {
    expect(m.seedItem(['items'], board)).toEqual({ id: 1, type: 'todo', title: '' });
    expect(m.seedItem(['items', 0], board)).toBeUndefined();
  });

  it('describes a single node, and leaves constraints out when several apply', () => {
    expect(m.metaAt(['items', 0, 'id'], board)).toMatchObject({
      type: 'integer',
      readOnly: false,
      deprecated: false,
      constraints: ['≥ 1'],
    });
    // Without data every variant's `status` applies, so there is no single list of constraints.
    expect(m.metaAt(['items', 0, 'status'])?.constraints).toEqual([]);
    expect(m.metaAt(['items', 0, 'nope'], board)).toBeUndefined();
  });
});

describe('seed with alternatives', () => {
  const m = new SchemaModel({});

  it('takes the first real alternative, preferring a value to null', () => {
    expect(
      m.seed({
        oneOf: [
          { type: 'null' },
          { type: 'object', required: ['email'], properties: { email: { type: 'string' } } },
        ],
      }),
    ).toEqual({ email: '' });
    expect(m.seed({ anyOf: [{ const: null }, { type: 'boolean' }] })).toBe(false);
  });

  it('falls back to the first alternative when every one is null', () => {
    expect(m.seed({ oneOf: [{ type: 'null' }] })).toBeNull();
  });

  it('treats an empty list of alternatives as none', () => {
    expect(m.seed({ type: 'number', oneOf: [] })).toBe(0);
  });

  it('merges the shared base into the chosen alternative', () => {
    expect(
      m.seed({
        type: 'object',
        required: ['driver'],
        properties: { driver: { type: 'string' } },
        oneOf: [
          {
            title: 'SQLite',
            required: ['file'],
            properties: { driver: { const: 'sqlite' }, file: { type: 'string' } },
          },
          {
            title: 'PostgreSQL',
            required: ['host'],
            properties: { driver: { const: 'postgres' }, host: { type: 'string' } },
          },
        ],
      }),
    ).toEqual({ driver: 'sqlite', file: '' });
  });

  it('prefers default, then const, then the first enum value, then the empty value', () => {
    expect(m.seed({ type: 'string', default: 'x', enum: ['y'] })).toBe('x');
    expect(m.seed({ const: 7 })).toBe(7);
    expect(m.seed({ enum: ['b', 'a'] })).toBe('b');
    expect(m.seed({ type: 'integer', minimum: 3 })).toBe(3);
    expect(m.seed({ type: ['null', 'array'] })).toEqual([]);
    expect(m.seed({ properties: { a: { type: 'string' } }, required: ['a', 'missing'] })).toEqual({
      a: '',
    });
    expect(m.seed({})).toBe('');
  });
});

describe('resolve: allOf parts sharing properties', () => {
  it('keeps both sides of a shared property and unions required keys', () => {
    const m = new SchemaModel({});
    const s = m.resolve({
      allOf: [
        { required: ['a'], properties: { a: { type: 'string' }, b: { type: 'number' } } },
        { required: ['a', 'c'], properties: { a: { maxLength: 3 }, c: { type: 'boolean' } } },
        { patternProperties: { '^x-': { type: 'string' } } },
      ],
    });
    expect(s.required).toEqual(['a', 'c']);
    expect(Object.keys(s.properties ?? {})).toEqual(['a', 'b', 'c']);
    expect(m.resolve(s.properties?.['a'] ?? {})).toEqual({ type: 'string', maxLength: 3 });
    expect(s.properties?.['b']).toEqual({ type: 'number' });
    expect(s.patternProperties).toEqual({ '^x-': { type: 'string' } });
  });

  it('does not mistake an inherited Object member for a declared property', () => {
    const m = new SchemaModel({});
    const s = m.resolve({
      allOf: [
        { properties: { a: { type: 'string' } } },
        { properties: { toString: { type: 'string' } } },
      ],
    });
    expect(m.resolve(s.properties?.['toString'] ?? {})).toEqual({ type: 'string' });
    const typed = new SchemaModel({
      allOf: [
        { properties: { a: { type: 'string' } } },
        { properties: { constructor: { type: 'number' } } },
      ],
    });
    expect(typed.typesAt(['constructor'])).toEqual(['number']);
    expect(typed.seed(typed.nodesAt(['constructor'])[0] ?? {})).toBe(0);
  });
});

describe('errors for alternatives (inline schemas)', () => {
  it('reports only the errors of the variant the value looks like', () => {
    const m = new SchemaModel({
      properties: {
        shape: {
          type: 'object',
          oneOf: [
            {
              title: 'Circle',
              required: ['kind', 'radius'],
              properties: { kind: { const: 'circle' }, radius: { type: 'number' } },
            },
            {
              title: 'Square',
              required: ['kind', 'side'],
              properties: { kind: { const: 'square' }, side: { type: 'number' } },
            },
          ],
        },
      },
    });
    const problems = m.validate({ shape: { kind: 'circle', radius: 'big' } });
    expect(problems.map((p) => `${p.path.join('.')} :: ${p.keyword}`)).toEqual([
      'shape.radius :: type',
    ]);
    expect(m.validate({ shape: { kind: 'square', side: 2 } })).toEqual([]);
  });

  const steps = new SchemaModel({
    properties: {
      step: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
        oneOf: [
          {
            title: 'Run',
            required: ['run', 'shell'],
            properties: { run: { type: 'string' }, shell: { type: 'string' } },
          },
          {
            title: 'Use',
            required: ['uses', 'with'],
            properties: { uses: { type: 'string' }, with: { type: 'object' } },
          },
        ],
      },
    },
  });

  it('names the closest option when the value fits none, also when it is not the first', () => {
    const problems = steps.validate({ step: { name: 'build', uses: 'example/action@v1' } });
    expect(problems.map((p) => p.message)).toContain(
      'fits none of the options (Run, Use); closest is Use',
    );
    const at = problems.map((p) => p.path.join('.'));
    expect(at).toContain('step.with');
    // The farther option's errors are left out.
    expect(at).not.toContain('step.run');
    expect(at).not.toContain('step.shell');
  });

  it('picks the first option on a tie and keeps the errors of the shared base', () => {
    const problems = steps.validate({ step: {} });
    expect(problems.map((p) => p.message)).toContain(
      'fits none of the options (Run, Use); closest is Run',
    );
    const at = problems.map((p) => p.path.join('.'));
    expect(at).toEqual(expect.arrayContaining(['step.name', 'step.run', 'step.shell']));
    expect(at).not.toContain('step.uses');
  });
});
