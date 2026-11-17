import vm from 'node:vm';

import { shellOutput } from '@thicket/contract';
import { BSON } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { errorOutput, printOutput, printableText, resultOutput, toEjson } from './output';

/** Evaluates `code` in a fresh `vm` context: values of another realm, like the shell's. */
const foreign = (code: string): unknown => vm.runInNewContext(code);

describe('printableText', () => {
  it('keeps strings as they are and inspects everything else', () => {
    expect(printableText('hello')).toBe('hello');
    expect(printableText(42)).toBe('42');
    expect(printableText({ a: 1, b: 'x' })).toBe("{ a: 1, b: 'x' }");
    expect(printableText(null)).toBe('null');
  });
});

describe('printOutput', () => {
  it('joins the printed values with spaces (print, console.log)', () => {
    expect(
      printOutput([
        { type: null, printable: 'hello' },
        { type: null, printable: 1 },
        { type: null, printable: { b: 2 } },
      ]),
    ).toEqual({ kind: 'print', text: 'hello 1 { b: 2 }' });
  });

  it('printjson inspects strings too (quoted)', () => {
    expect(printOutput([{ type: null, printable: 'a' }], 'printjson')).toEqual({
      kind: 'print',
      text: "'a'",
    });
  });

  it('an empty print() is an empty line', () => {
    expect(printOutput([])).toEqual({ kind: 'print', text: '' });
  });
});

describe('resultOutput', () => {
  it('shows nothing for undefined without a type (a declaration)', () => {
    expect(resultOutput({ type: null, printable: undefined })).toBeUndefined();
  });

  it('a document result: canonical EJSON value, inspected text and the mongosh type', () => {
    const id = new BSON.ObjectId('64b7f0c2a1b2c3d4e5f60718');
    const output = resultOutput({ type: 'Document', printable: { _id: id, n: 1, d: 1.5 } });
    expect(output).toEqual({
      kind: 'result',
      text: expect.stringContaining('n: 1') as unknown,
      value:
        '{"_id":{"$oid":"64b7f0c2a1b2c3d4e5f60718"},"n":{"$numberInt":"1"},"d":{"$numberDouble":"1.5"}}',
      type: 'Document',
    });
    expect(shellOutput.safeParse(output).success).toBe(true);
  });

  it('a primitive without a type: text and EJSON, no type key', () => {
    expect(resultOutput({ type: null, printable: 84 })).toEqual({
      kind: 'result',
      text: '84',
      value: '{"$numberInt":"84"}',
    });
    expect(resultOutput({ type: null, printable: 'yes' })).toEqual({
      kind: 'result',
      text: 'yes',
      value: '"yes"',
    });
    expect(resultOutput({ type: null, printable: null })).toEqual({
      kind: 'result',
      text: 'null',
      value: 'null',
    });
  });

  it('a cursor batch: the documents as an EJSON array, inspected text', () => {
    const output = resultOutput({
      type: 'Cursor',
      printable: { cursorHasMore: false, documents: [{ a: 1 }, { a: 2 }] },
    });
    expect(output).toEqual({
      kind: 'result',
      text: '[ { a: 1 }, { a: 2 } ]',
      value: '[{"a":{"$numberInt":"1"}},{"a":{"$numberInt":"2"}}]',
      type: 'Cursor',
    });
    expect(shellOutput.safeParse(output).success).toBe(true);
  });

  it('a cursor batch with more documents ends its text with the "it" hint', () => {
    expect(
      resultOutput({
        type: 'AggregationCursor',
        printable: { cursorHasMore: true, documents: [{ a: 1 }] },
      }),
    ).toEqual({
      kind: 'result',
      text: '[ { a: 1 } ]\nType "it" for more',
      value: '[{"a":{"$numberInt":"1"}}]',
      type: 'AggregationCursor',
    });
  });

  it('an empty cursor batch: no text, an empty EJSON array; only the hint when more follow', () => {
    expect(
      resultOutput({ type: 'Cursor', printable: { cursorHasMore: false, documents: [] } }),
    ).toEqual({ kind: 'result', text: '', value: '[]', type: 'Cursor' });
    expect(
      resultOutput({
        type: 'CursorIterationResult',
        printable: { cursorHasMore: true, documents: [] },
      }),
    ).toEqual({
      kind: 'result',
      text: 'Type "it" for more',
      value: '[]',
      type: 'CursorIterationResult',
    });
  });

  it('an object that only looks partly like a batch is treated as plain data', () => {
    // `documents` without `cursorHasMore`: a user document, not a cursor batch.
    const output = resultOutput({ type: 'Document', printable: { documents: [1] } });
    expect(output?.kind === 'result' && output.value).toBe('{"documents":[{"$numberInt":"1"}]}');
  });

  it.each(['Help', 'ShowBannerResult'])('%s results are text only (no value)', (type) => {
    const output = resultOutput({
      type,
      printable: { help: 'Shell Help', docs: 'https://x.test' },
    });
    expect(output).toEqual({
      kind: 'result',
      text: expect.stringContaining('Shell Help') as unknown,
      type,
    });
    expect(output && 'value' in output).toBe(false);
  });

  it('a value that is not data (a function) has text but no value', () => {
    const output = resultOutput({
      type: null,
      printable: foreign('(function twice(x) { return 2 * x; })'),
    });
    expect(output).toEqual({ kind: 'result', text: '[Function: twice]' });
  });

  it('a typed undefined result is still shown (type kept, no value)', () => {
    expect(resultOutput({ type: 'ShowCollectionsResult', printable: undefined })).toEqual({
      kind: 'result',
      text: 'undefined',
      type: 'ShowCollectionsResult',
    });
  });
});

describe('toEjson', () => {
  it('canonical EJSON keeps the BSON types', () => {
    expect(toEjson({ i: 1, l: new BSON.Long(5), d: new Date(0) })).toBe(
      '{"i":{"$numberInt":"1"},"l":{"$numberLong":"5"},"d":{"$date":{"$numberLong":"0"}}}',
    );
    expect(toEjson(5n)).toBe('{"$numberLong":"5"}');
    expect(toEjson(Number.NaN)).toBe('{"$numberDouble":"NaN"}');
  });

  it('values of the vm realm convert like local ones', () => {
    expect(toEjson(foreign('({ a: 1, nested: { d: new Date(0) }, list: [1.5] })'))).toBe(
      '{"a":{"$numberInt":"1"},"nested":{"d":{"$date":{"$numberLong":"0"}}},"list":[{"$numberDouble":"1.5"}]}',
    );
    expect(toEjson(foreign('new Date(0)'))).toBe('{"$date":{"$numberLong":"0"}}');
  });

  it('answers undefined for what is not data', () => {
    expect(toEjson(undefined)).toBeUndefined();
    expect(toEjson(() => 1)).toBeUndefined();
    expect(toEjson(Symbol('s'))).toBeUndefined();
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(toEjson(cyclic)).toBeUndefined();
    // BSON has no `g` flag: such a value stays text only instead of failing the evaluation.
    expect(toEjson({ re: /a/g })).toBeUndefined();
  });

  it('round-trips through EJSON.parse (canonical)', () => {
    const text = toEjson([{ _id: new BSON.ObjectId('64b7f0c2a1b2c3d4e5f60718'), n: 7 }]);
    const parsed = BSON.EJSON.parse(text ?? 'null', { relaxed: false }) as { n: unknown }[];
    expect(parsed[0]?.n).toEqual(new BSON.Int32(7));
  });
});

describe('errorOutput', () => {
  it('Name: message for errors', () => {
    expect(errorOutput(new TypeError('x is not a function'))).toEqual({
      kind: 'error',
      text: 'TypeError: x is not a function',
    });
  });

  it('errors of the vm realm (not instanceof Error here) keep their name and message', () => {
    const error = foreign('new RangeError("too far")');
    expect(error instanceof Error).toBe(false);
    expect(errorOutput(error)).toEqual({ kind: 'error', text: 'RangeError: too far' });
  });

  it('adds the server code name like mongosh: Name[codeName]: message', () => {
    const error = Object.assign(new Error('E11000 duplicate key error collection: shop.c'), {
      name: 'MongoServerError',
      code: 11000,
      codeName: 'DuplicateKey',
    });
    expect(errorOutput(error)).toEqual({
      kind: 'error',
      text: 'MongoServerError[DuplicateKey]: E11000 duplicate key error collection: shop.c',
    });
  });

  it('ignores a codeName that is not a string', () => {
    const error = Object.assign(new Error('boom'), { codeName: 11000 });
    expect(errorOutput(error)).toEqual({ kind: 'error', text: 'Error: boom' });
  });

  it('thrown non-errors are shown as Uncaught <value>', () => {
    expect(errorOutput('boom')).toEqual({ kind: 'error', text: 'Uncaught boom' });
    expect(errorOutput(5)).toEqual({ kind: 'error', text: 'Uncaught 5' });
    expect(errorOutput({ reason: 'x' })).toEqual({
      kind: 'error',
      text: "Uncaught { reason: 'x' }",
    });
    expect(errorOutput(null)).toEqual({ kind: 'error', text: 'Uncaught null' });
    // A name without a message is not an error.
    expect(errorOutput({ name: 'X' })).toEqual({ kind: 'error', text: "Uncaught { name: 'X' }" });
  });
});
