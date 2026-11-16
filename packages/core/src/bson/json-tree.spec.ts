import { describe, expect, it } from 'vitest';

import { parseJsonTree } from './json-tree';
import { BsonModelError } from './model';

describe('parseJsonTree', () => {
  it('keeps key order, repeated keys, __proto__ and the exact number text', () => {
    expect(parseJsonTree('{"2":1,"1":2.50,"__proto__":-0,"2":1e3}')).toEqual({
      kind: 'object',
      entries: [
        ['2', { kind: 'number', raw: '1' }],
        ['1', { kind: 'number', raw: '2.50' }],
        ['__proto__', { kind: 'number', raw: '-0' }],
        ['2', { kind: 'number', raw: '1e3' }],
      ],
    });
  });

  it('does not pollute Object.prototype through __proto__ keys', () => {
    parseJsonTree('{"__proto__":{"polluted":true}}');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('accepts JSON whitespace everywhere and decodes string escapes', () => {
    expect(
      parseJsonTree(' \t\r\n{ "a" : [ true , false , null ] ,"b":"\\u00e9\\n\\"" }\n'),
    ).toEqual({
      kind: 'object',
      entries: [
        [
          'a',
          {
            kind: 'array',
            items: [
              { kind: 'bool', value: true },
              { kind: 'bool', value: false },
              { kind: 'null' },
            ],
          },
        ],
        ['b', { kind: 'string', value: 'é\n"' }],
      ],
    });
  });

  it('parses scalars at the top level', () => {
    expect(parseJsonTree('"x"')).toEqual({ kind: 'string', value: 'x' });
    expect(parseJsonTree('-12.5E-3')).toEqual({ kind: 'number', raw: '-12.5E-3' });
    expect(parseJsonTree('[]')).toEqual({ kind: 'array', items: [] });
    expect(parseJsonTree('{}')).toEqual({ kind: 'object', entries: [] });
  });

  it('accepts nesting up to the depth limit', () => {
    const depth = 1000;
    expect(() => parseJsonTree('['.repeat(depth) + ']'.repeat(depth))).not.toThrow();
  });

  it('rejects nesting beyond the depth limit instead of overflowing the stack', () => {
    const text = '['.repeat(1002) + ']'.repeat(1002);
    expect(() => parseJsonTree(text)).toThrow('nesting too deep');
  });

  it.each([
    ['', 'unexpected token'],
    ['   ', 'unexpected token'],
    ['x', 'unexpected token'],
    ['+1', 'unexpected token'],
    ['.5', 'unexpected token'],
    ['NaN', 'unexpected token'],
    ['nul', 'unexpected token'],
    ['[1,]', 'unexpected token'],
    ['{"a":1,}', 'expected a key'],
    ['{"a":1 "b":2}', "expected '}'"],
    ['1 2', 'trailing'],
    ['"tab\there"', 'control character'],
  ])('rejects %j (%s)', (text, message) => {
    expect(() => parseJsonTree(text)).toThrow(BsonModelError);
    expect(() => parseJsonTree(text)).toThrow(message);
  });

  it('reports the error position', () => {
    expect(() => parseJsonTree('[1,x]')).toThrow('Invalid JSON at position 3');
  });
});
