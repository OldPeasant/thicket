import { BsonModelError } from './model';

/**
 * Minimal strict JSON parser that keeps what `JSON.parse` loses: object key order (JS objects
 * move integer-like keys first), repeated keys, `__proto__` keys and the exact number text.
 */
export type JsonNode =
  | { readonly kind: 'object'; readonly entries: readonly (readonly [string, JsonNode])[] }
  | { readonly kind: 'array'; readonly items: readonly JsonNode[] }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'number'; readonly raw: string }
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'null' };

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WS = /[ \t\n\r]*/y;
const MAX_DEPTH = 1000;

export function parseJsonTree(text: string): JsonNode {
  let pos = 0;

  const fail = (msg: string): never => {
    throw new BsonModelError(`Invalid JSON at position ${pos}: ${msg}`);
  };
  const skipWs = (): void => {
    WS.lastIndex = pos;
    WS.exec(text);
    pos = WS.lastIndex;
  };
  const expect = (ch: string): void => {
    skipWs();
    if (text[pos] !== ch) fail(`expected '${ch}'`);
    pos++;
  };
  const literal = (word: string): void => {
    if (!text.startsWith(word, pos)) fail('unexpected token');
    pos += word.length;
  };

  const parseString = (): string => {
    const start = pos;
    pos++; // opening quote
    for (;;) {
      const ch = text.charCodeAt(pos);
      if (Number.isNaN(ch)) fail('unterminated string');
      if (ch === 0x22) break;
      if (ch < 0x20) fail('control character in string');
      pos += ch === 0x5c ? 2 : 1;
    }
    pos++;
    try {
      return JSON.parse(text.slice(start, pos)) as string;
    } catch {
      pos = start;
      return fail('invalid string escape');
    }
  };

  const parseValue = (depth: number): JsonNode => {
    if (depth > MAX_DEPTH) fail('nesting too deep');
    skipWs();
    const ch = text[pos];
    switch (ch) {
      case '{': {
        pos++;
        const entries: [string, JsonNode][] = [];
        skipWs();
        if (text[pos] === '}') {
          pos++;
          return { kind: 'object', entries };
        }
        for (;;) {
          skipWs();
          if (text[pos] !== '"') fail('expected a key');
          const key = parseString();
          expect(':');
          entries.push([key, parseValue(depth + 1)]);
          skipWs();
          if (text[pos] === ',') {
            pos++;
            continue;
          }
          expect('}');
          return { kind: 'object', entries };
        }
      }
      case '[': {
        pos++;
        const items: JsonNode[] = [];
        skipWs();
        if (text[pos] === ']') {
          pos++;
          return { kind: 'array', items };
        }
        for (;;) {
          items.push(parseValue(depth + 1));
          skipWs();
          if (text[pos] === ',') {
            pos++;
            continue;
          }
          expect(']');
          return { kind: 'array', items };
        }
      }
      case '"':
        return { kind: 'string', value: parseString() };
      case 't':
        literal('true');
        return { kind: 'bool', value: true };
      case 'f':
        literal('false');
        return { kind: 'bool', value: false };
      case 'n':
        literal('null');
        return { kind: 'null' };
      default: {
        NUMBER.lastIndex = pos;
        const m = NUMBER.exec(text);
        if (!m) return fail('unexpected token');
        pos = NUMBER.lastIndex;
        return { kind: 'number', raw: m[0] };
      }
    }
  };

  const root = parseValue(0);
  skipWs();
  if (pos !== text.length) fail('unexpected trailing characters');
  return root;
}
