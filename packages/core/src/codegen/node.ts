import { base64ToHex } from '../bson/ejson';
import { formatIsoDate } from '../bson/iso-date';
import { INT32_MAX, INT32_MIN, type BsonDocument, type BsonValue } from '../bson/model';
import { concat, layout, list, type Node } from './layout';
import { DEFAULT_URI, findParts, type CodegenOptions, type CodegenQuery } from './model';
import { jsKey } from './shell';

const q = (s: string): string => JSON.stringify(s);

/** Prints values for the Node.js driver and records which `mongodb` exports they use. */
class NodePrinter {
  readonly imports = new Set<string>(['MongoClient']);

  private use(name: string): string {
    this.imports.add(name);
    return name;
  }

  doc(d: BsonDocument): Node {
    return list(
      '{',
      d.fields.map((f) => concat(jsKey(f.key), ': ', this.value(f.value))),
      '}',
      true,
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
        return String(v.value);
      case 'null':
        return 'null';
      case 'undefined':
        return 'undefined';
      case 'int':
        // The driver writes integral numbers in the Int32 range as Int32.
        return String(v.value);
      case 'long':
        return `${this.use('Long')}.fromString(${q(String(v.value))})`;
      case 'double':
        return this.double(v.value);
      case 'decimal':
        return `${this.use('Decimal128')}.fromString(${q(v.value)})`;
      case 'objectId':
        return `new ${this.use('ObjectId')}(${q(v.hex)})`;
      case 'date':
        return date(v.ms);
      case 'binary':
        if (v.subtype === 4 && v.base64.length === 24) {
          return `new ${this.use('UUID')}(${q(uuidText(v.base64))})`;
        }
        return `${this.use('Binary')}.createFromBase64(${q(v.base64)}, ${v.subtype})`;
      case 'regex':
        return `new ${this.use('BSONRegExp')}(${q(v.pattern)}, ${q(v.options)})`;
      case 'timestamp':
        return `new ${this.use('Timestamp')}({ t: ${v.t}, i: ${v.i} })`;
      case 'javascript':
        return `new ${this.use('Code')}(${q(v.code)})`;
      case 'javascriptWithScope':
        return list(`new ${this.use('Code')}(`, [q(v.code), this.doc(v.scope)], ')');
      case 'symbol':
        return `new ${this.use('BSONSymbol')}(${q(v.value)})`;
      case 'dbPointer':
        return `new ${this.use('DBRef')}(${q(v.ref)}, new ${this.use('ObjectId')}(${q(v.hex)}))`;
      case 'minKey':
        return `new ${this.use('MinKey')}()`;
      case 'maxKey':
        return `new ${this.use('MaxKey')}()`;
    }
  }

  /** Integral numbers in the Int32 range (and -0) would be written as Int32: wrap them. */
  private double(n: number): string {
    if (Object.is(n, -0) || (Number.isInteger(n) && n >= INT32_MIN && n <= INT32_MAX)) {
      return `new ${this.use('Double')}(${Object.is(n, -0) ? '-0' : n})`;
    }
    return String(n); // NaN, Infinity, -Infinity are globals; else shortest round-trip decimal
  }
}

function date(ms: bigint): string {
  try {
    return `new Date(${q(formatIsoDate(ms))})`;
  } catch {
    // A JS Date can't hold it; the driver would write an invalid date. Keep the value visible.
    return `new Date(NaN /* ${ms} ms is outside the JS Date range */)`;
  }
}

export function uuidText(base64: string): string {
  const h = base64ToHex(base64);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A CommonJS program for the `mongodb` package that prints each result as one line of EJSON. */
export function generateNode(query: CodegenQuery, options: CodegenOptions = {}): string {
  const p = new NodePrinter();
  const step = '  ';
  const indent = step.repeat(2);
  const coll = `const coll = client.db(${q(query.database)}).collection(${q(query.collection)});`;
  let call: Node;
  if (query.kind === 'aggregate') {
    call = concat(
      'const cursor = coll.aggregate(',
      list(
        '[',
        query.pipeline.map((s) => p.doc(s)),
        ']',
      ),
      ');',
    );
  } else {
    const parts = findParts(query);
    const opts: Node[] = [];
    if (parts.projection) opts.push(concat('projection: ', p.doc(parts.projection)));
    if (parts.sort) opts.push(concat('sort: ', p.doc(parts.sort)));
    if (parts.collation) opts.push(concat('collation: ', p.doc(parts.collation)));
    if (parts.skip !== undefined) opts.push(`skip: ${parts.skip}`);
    if (parts.limit !== undefined) opts.push(`limit: ${parts.limit}`);
    const args = [p.doc(query.filter)];
    if (opts.length > 0) args.push(list('{', opts, '}', true));
    call = concat('const cursor = coll.find', list('(', args, ')'), ';');
  }
  const body = layout(call, indent, step);
  p.imports.add('BSON');
  const imports = [...p.imports].sort();
  return `${[
    `const { ${imports.join(', ')} } = require('mongodb');`,
    '',
    'async function main() {',
    `  const client = new MongoClient(${q(options.uri ?? DEFAULT_URI)});`,
    '  try {',
    `${indent}${coll}`,
    `${indent}${body}`,
    `${indent}for await (const doc of cursor) {`,
    `${indent}  console.log(BSON.EJSON.stringify(doc));`,
    `${indent}}`,
    '  } finally {',
    '    await client.close();',
    '  }',
    '}',
    '',
    'main().catch((error) => {',
    '  console.error(error);',
    '  process.exitCode = 1;',
    '});',
  ].join('\n')}\n`;
}
