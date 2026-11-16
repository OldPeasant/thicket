import { base64ToHex } from '../bson/ejson';
import type { BsonDocument, BsonValue } from '../bson/model';
import { concat, layout, list, type Node } from './layout';
import { DEFAULT_URI, findParts, type CodegenOptions, type CodegenQuery } from './model';
import { uuidText } from './node';

/** JSON string escapes (`\n`, `\"`, `\\`, `\uXXXX`) are valid Python string escapes. */
const q = (s: string): string => JSON.stringify(s);

/** Python's `datetime` covers years 1..9999. */
const DATETIME_MIN_MS = -62_135_596_800_000n;
const DATETIME_MAX_MS = 253_402_300_799_999n;

/** Prints values for PyMongo and records the `bson` names they use. */
class PythonPrinter {
  readonly bson = new Set<string>();
  readonly modules = new Set<string>();

  private use(name: string): string {
    this.bson.add(name);
    return name;
  }

  /** A dict keeps the last value of a repeated key (so would `SON`, a dict subclass). */
  doc(d: BsonDocument): Node {
    return list(
      '{',
      d.fields.map((f) => concat(q(f.key), ': ', this.value(f.value))),
      '}',
    );
  }

  value(v: BsonValue): Node {
    switch (v.type) {
      case 'object':
        return this.doc(v);
      case 'array':
        return list(
          '[',
          v.items.map((i) => this.value(i)),
          ']',
        );
      case 'string':
        return q(v.value);
      case 'bool':
        return v.value ? 'True' : 'False';
      case 'null':
      case 'undefined': // PyMongo has no undefined; it reads it as None too
        return 'None';
      case 'int':
        // PyMongo writes an int in the Int32 range as Int32.
        return String(v.value);
      case 'long':
        return `${this.use('Int64')}(${v.value})`;
      case 'double':
        return pyFloat(v.value);
      case 'decimal':
        return `${this.use('Decimal128')}(${q(v.value)})`;
      case 'objectId':
        return `${this.use('ObjectId')}(${q(v.hex)})`;
      case 'date':
        return this.date(v.ms);
      case 'binary':
        if (v.subtype === 4 && v.base64.length === 24) {
          this.modules.add('from uuid import UUID');
          return `${this.use('Binary')}.from_uuid(UUID(${q(uuidText(v.base64))}))`;
        }
        return `${this.use('Binary')}(bytes.fromhex(${q(base64ToHex(v.base64))}), ${v.subtype})`;
      case 'regex':
        return `${this.use('Regex')}(${q(v.pattern)}, ${q(v.options)})`;
      case 'timestamp':
        return `${this.use('Timestamp')}(${v.t}, ${v.i})`;
      case 'javascript':
        return `${this.use('Code')}(${q(v.code)})`;
      case 'javascriptWithScope':
        return list(`${this.use('Code')}(`, [q(v.code), this.doc(v.scope)], ')');
      case 'symbol': // PyMongo reads symbols as str and has no type to write one
        return q(v.value);
      case 'dbPointer':
        return `${this.use('DBRef')}(${q(v.ref)}, ${this.use('ObjectId')}(${q(v.hex)}))`;
      case 'minKey':
        return `${this.use('MinKey')}()`;
      case 'maxKey':
        return `${this.use('MaxKey')}()`;
    }
  }

  private date(ms: bigint): string {
    if (ms < DATETIME_MIN_MS || ms > DATETIME_MAX_MS) return `${this.use('DatetimeMS')}(${ms})`;
    this.modules.add('from datetime import datetime, timezone');
    const d = new Date(Number(ms));
    const parts = [
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds() * 1000,
    ];
    while (parts.length > 3 && parts[parts.length - 1] === 0) parts.pop();
    return `datetime(${parts.join(', ')}, tzinfo=timezone.utc)`;
  }
}

export function pyFloat(n: number): string {
  if (Number.isNaN(n)) return 'float("nan")';
  if (n === Infinity) return 'float("inf")';
  if (n === -Infinity) return 'float("-inf")';
  if (Object.is(n, -0)) return '-0.0';
  const s = String(n);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/** A script for PyMongo that prints each result as one line of relaxed EJSON. */
export function generatePython(query: CodegenQuery, options: CodegenOptions = {}): string {
  const p = new PythonPrinter();
  const step = '    ';
  let call: Node;
  if (query.kind === 'aggregate') {
    call = concat(
      'cursor = coll.aggregate(',
      list(
        '[',
        query.pipeline.map((s) => p.doc(s)),
        ']',
      ),
      ')',
    );
  } else {
    const parts = findParts(query);
    const args: Node[] = [p.doc(query.filter)];
    if (parts.projection) args.push(p.doc(parts.projection));
    if (parts.sort) {
      // find(sort=…) takes (key, direction) pairs; that also keeps the order.
      args.push(
        concat(
          'sort=',
          list(
            '[',
            parts.sort.fields.map((f) => list('(', [q(f.key), p.value(f.value)], ')')),
            ']',
          ),
        ),
      );
    }
    if (parts.collation) args.push(concat('collation=', p.doc(parts.collation)));
    if (parts.skip !== undefined) args.push(`skip=${parts.skip}`);
    if (parts.limit !== undefined) args.push(`limit=${parts.limit}`);
    call = concat('cursor = coll.find', list('(', args, ')'));
  }
  const body = layout(call, step, step);
  p.bson.add('json_util');
  const lines = [...p.modules].sort();
  if (lines.length > 0) lines.push('');
  lines.push(`from bson import ${[...p.bson].sort().join(', ')}`);
  lines.push('from pymongo import MongoClient');
  return `${[
    ...lines,
    '',
    `client = MongoClient(${q(options.uri ?? DEFAULT_URI)})`,
    'try:',
    `${step}coll = client[${q(query.database)}][${q(query.collection)}]`,
    `${step}${body}`,
    `${step}for doc in cursor:`,
    `${step}${step}print(json_util.dumps(doc))`,
    'finally:',
    `${step}client.close()`,
  ].join('\n')}\n`;
}
