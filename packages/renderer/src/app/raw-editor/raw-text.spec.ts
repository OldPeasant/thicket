import { parseEJsonDocument } from '@thicket/core/bson';
import { ALL_TYPES_EJSON } from '@thicket/core/testing';
import { describe, expect, it } from 'vitest';

import { describeRawError, parseRaw, printRaw, type RawFormat, unplacedError } from './raw-text';

const ID = '{"$oid":"65a1b2c3d4e5f60718293a4b"}';
const DOC = parseEJsonDocument(`{"_id":${ID},"name":"Ada","tags":["a"]}`);

describe('raw text', () => {
  describe('printRaw / parseRaw', () => {
    it('prints shell syntax and canonical EJSON with a 2-space indent', () => {
      expect(printRaw(DOC, 'shell')).toBe(
        '{\n  _id: ObjectId("65a1b2c3d4e5f60718293a4b"),\n  name: "Ada",\n  tags: [\n    "a"\n  ]\n}',
      );
      expect(printRaw(DOC, 'ejson')).toBe(
        `{\n  "_id": {"$oid":"65a1b2c3d4e5f60718293a4b"},\n  "name": "Ada",\n  "tags": [\n    "a"\n  ]\n}`,
      );
    });

    it.each<RawFormat>(['shell', 'ejson'])('reads its own %s text back losslessly', (format) => {
      const all = parseEJsonDocument(ALL_TYPES_EJSON);
      const parsed = parseRaw(printRaw(all, format), format);
      expect(parsed).toEqual({ ok: true, doc: all });
    });

    it.each<RawFormat>(['shell', 'ejson'])('refuses empty %s text', (format) => {
      expect(parseRaw('', format).ok).toBe(false);
      expect(parseRaw('   \n ', format).ok).toBe(false);
    });

    it('refuses an EJSON top level that is not a document', () => {
      expect(parseRaw('[1, 2]', 'ejson').ok).toBe(false);
    });
  });

  describe('error places', () => {
    it('takes a shell syntax error place from the parser, reason without the place', () => {
      const text = '{\n  a: 1,\n  b: foo(2)\n}';
      const parsed = parseRaw(text, 'shell');
      if (parsed.ok) throw new Error('expected an error');
      expect(parsed.error).toMatchObject({ offset: text.indexOf('foo'), line: 3, column: 6 });
      expect(parsed.error.reason).not.toMatch(/line \d/);
    });

    it('turns the JSON reader position into line and column, with a capitalized reason', () => {
      const text = `{\n  "_id": ${ID},\n  "a": 1,,\n}`;
      const parsed = parseRaw(text, 'ejson');
      if (parsed.ok) throw new Error('expected an error');
      expect(parsed.error).toMatchObject({ offset: text.indexOf(',,') + 1, line: 3, column: 10 });
      expect(parsed.error.reason).not.toMatch(/Invalid JSON at position/);
      expect(parsed.error.reason.charAt(0)).toBe(parsed.error.reason.charAt(0).toUpperCase());
    });

    it('counts EJSON columns in UTF-16 code units, like the editor', () => {
      // A surrogate pair before the error: offsets must match CodeMirror's.
      const text = '{"name": "\u{1F600}",,}';
      const parsed = parseRaw(text, 'ejson');
      if (parsed.ok) throw new Error('expected an error');
      expect(parsed.error).toMatchObject({ offset: text.indexOf(',,') + 1, line: 1 });
      expect(parsed.error.column).toBe(text.indexOf(',,') + 2);
    });

    it('counts CRLF line breaks as one line in EJSON errors', () => {
      const text = '{\r\n"a": 1,,\r\n}';
      const parsed = parseRaw(text, 'ejson');
      if (parsed.ok) throw new Error('expected an error');
      expect(parsed.error).toMatchObject({ line: 2, column: 8 });
    });

    it('reports EJSON value errors without a place', () => {
      const parsed = parseRaw(`{"_id":${ID},"a":{"$oid":"nope"}}`, 'ejson');
      if (parsed.ok) throw new Error('expected an error');
      expect(parsed.error).toMatchObject({ offset: null, line: null, column: null });
      expect(parsed.error.reason).toMatch(/oid/i);
    });
  });

  describe('describeRawError', () => {
    it('appends line and column when the error has a place', () => {
      expect(describeRawError({ reason: "Expected '}'", offset: 12, line: 3, column: 7 })).toBe(
        "Expected '}' (line 3, column 7)",
      );
    });

    it('shows the reason alone without a place', () => {
      const error = unplacedError('The _id of a document cannot be changed');
      expect(error).toEqual({
        reason: 'The _id of a document cannot be changed',
        offset: null,
        line: null,
        column: null,
      });
      expect(describeRawError(error)).toBe('The _id of a document cannot be changed');
    });
  });
});
