import type { BsonValue } from '../bson/model';

/**
 * Exact structural equality of two model values: same BSON type and same value, documents with
 * the same fields in the same order. Doubles compare with `Object.is` (so `-0 ≠ 0` and
 * `NaN = NaN`); `int 1`, `long 1` and `double 1` are different values.
 */
export function bsonEquals(a: BsonValue, b: BsonValue): boolean {
  if (a === b) return true;
  switch (a.type) {
    case 'object': {
      if (b.type !== 'object' || a.fields.length !== b.fields.length) return false;
      return a.fields.every((f, i) => {
        const g = b.fields[i];
        return g !== undefined && f.key === g.key && bsonEquals(f.value, g.value);
      });
    }
    case 'array': {
      if (b.type !== 'array' || a.items.length !== b.items.length) return false;
      return a.items.every((v, i) => {
        const w = b.items[i];
        return w !== undefined && bsonEquals(v, w);
      });
    }
    case 'double':
      return b.type === 'double' && Object.is(a.value, b.value);
    case 'string':
    case 'symbol':
    case 'bool':
    case 'int':
    case 'long':
    case 'decimal':
      return b.type === a.type && b.value === a.value;
    case 'javascript':
      return b.type === 'javascript' && b.code === a.code;
    case 'javascriptWithScope':
      return b.type === a.type && b.code === a.code && bsonEquals(a.scope, b.scope);
    case 'binary':
      return b.type === 'binary' && b.subtype === a.subtype && b.base64 === a.base64;
    case 'objectId':
      return b.type === 'objectId' && b.hex === a.hex;
    case 'date':
      return b.type === 'date' && b.ms === a.ms;
    case 'regex':
      return b.type === 'regex' && b.pattern === a.pattern && b.options === a.options;
    case 'dbPointer':
      return b.type === 'dbPointer' && b.ref === a.ref && b.hex === a.hex;
    case 'timestamp':
      return b.type === 'timestamp' && b.t === a.t && b.i === a.i;
    case 'undefined':
    case 'null':
    case 'minKey':
    case 'maxKey':
      return b.type === a.type;
  }
}
