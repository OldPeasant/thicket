import { formatIsoDate } from '../bson/iso-date';
import { INT32_MAX, type BsonDocument, type BsonValue } from '../bson/model';
import { chain, concat, layout, list, type Node } from './layout';
import {
  CodegenError,
  DEFAULT_URI,
  findParts,
  type CodegenOptions,
  type CodegenQuery,
} from './model';
import { uuidText } from './node';

/**
 * JSON string escapes are valid Java escapes. Java turns `\uXXXX` into characters before
 * lexing, but JSON never writes `\u000a`/`\u000d`/`"`/`\`, and a backslash from the
 * text itself is doubled, so no escape changes meaning.
 */
const q = (s: string): string => JSON.stringify(s);

const IMPORTS: Record<string, string> = {
  Arrays: 'java.util.Arrays',
  Base64: 'java.util.Base64',
  Binary: 'org.bson.types.Binary',
  BsonBinary: 'org.bson.BsonBinary',
  BsonDbPointer: 'org.bson.BsonDbPointer',
  BsonRegularExpression: 'org.bson.BsonRegularExpression',
  BsonTimestamp: 'org.bson.BsonTimestamp',
  BsonUndefined: 'org.bson.BsonUndefined',
  Code: 'org.bson.types.Code',
  CodeWithScope: 'org.bson.types.CodeWithScope',
  Collation: 'com.mongodb.client.model.Collation',
  CollationAlternate: 'com.mongodb.client.model.CollationAlternate',
  CollationCaseFirst: 'com.mongodb.client.model.CollationCaseFirst',
  CollationMaxVariable: 'com.mongodb.client.model.CollationMaxVariable',
  CollationStrength: 'com.mongodb.client.model.CollationStrength',
  Date: 'java.util.Date',
  Decimal128: 'org.bson.types.Decimal128',
  Document: 'org.bson.Document',
  Instant: 'java.time.Instant',
  List: 'java.util.List',
  MaxKey: 'org.bson.types.MaxKey',
  MinKey: 'org.bson.types.MinKey',
  MongoClient: 'com.mongodb.client.MongoClient',
  MongoClients: 'com.mongodb.client.MongoClients',
  MongoCollection: 'com.mongodb.client.MongoCollection',
  ObjectId: 'org.bson.types.ObjectId',
  Symbol: 'org.bson.types.Symbol',
  UUID: 'java.util.UUID',
};

/** `Instant.parse` reads 4-digit years; other dates use the exact milliseconds. */
const FOUR_DIGIT_YEAR = /^\d{4}-/;

/** Prints values for the Java sync driver (`org.bson.Document`) and records the imports. */
class JavaPrinter {
  readonly imports = new Set<string>([
    'Document',
    'MongoClient',
    'MongoClients',
    'MongoCollection',
  ]);

  use(name: string): string {
    this.imports.add(name);
    return name;
  }

  doc(d: BsonDocument): Node {
    const [first, ...rest] = d.fields;
    if (!first) return 'new Document()';
    return chain(
      list('new Document(', [q(first.key), this.value(first.value)], ')'),
      rest.map((f) => list('.append(', [q(f.key), this.value(f.value)], ')')),
    );
  }

  value(v: BsonValue): Node {
    switch (v.type) {
      case 'object':
        return this.doc(v);
      case 'array':
        return list(
          `${this.use('Arrays')}.asList(`,
          v.items.map((i) => this.value(i)),
          ')',
        );
      case 'string':
        return q(v.value);
      case 'bool':
        return String(v.value);
      case 'null':
        return 'null';
      case 'undefined':
        return `new ${this.use('BsonUndefined')}()`;
      case 'int':
        return String(v.value);
      case 'long':
        return `${v.value}L`;
      case 'double':
        return javaDouble(v.value);
      case 'decimal':
        return `${this.use('Decimal128')}.parse(${q(v.value)})`;
      case 'objectId':
        return `new ${this.use('ObjectId')}(${q(v.hex)})`;
      case 'date':
        return this.date(v.ms);
      case 'binary':
        if (v.subtype === 4 && v.base64.length === 24) {
          return `new ${this.use('BsonBinary')}(${this.use('UUID')}.fromString(${q(uuidText(v.base64))}))`;
        }
        return `new ${this.use('Binary')}((byte) ${v.subtype}, ${this.use('Base64')}.getDecoder().decode(${q(v.base64)}))`;
      case 'regex':
        return `new ${this.use('BsonRegularExpression')}(${q(v.pattern)}, ${q(v.options)})`;
      case 'timestamp':
        if (v.t > INT32_MAX || v.i > INT32_MAX) {
          // The (int, int) constructor takes signed ints; the long one the raw 64 bits.
          const raw = BigInt.asIntN(64, (BigInt(v.t) << 32n) | BigInt(v.i));
          return `new ${this.use('BsonTimestamp')}(${raw}L)`;
        }
        return `new ${this.use('BsonTimestamp')}(${v.t}, ${v.i})`;
      case 'javascript':
        return `new ${this.use('Code')}(${q(v.code)})`;
      case 'javascriptWithScope':
        return list(`new ${this.use('CodeWithScope')}(`, [q(v.code), this.doc(v.scope)], ')');
      case 'symbol':
        return `new ${this.use('Symbol')}(${q(v.value)})`;
      case 'dbPointer':
        return `new ${this.use('BsonDbPointer')}(${q(v.ref)}, new ${this.use('ObjectId')}(${q(v.hex)}))`;
      case 'minKey':
        return `new ${this.use('MinKey')}()`;
      case 'maxKey':
        return `new ${this.use('MaxKey')}()`;
    }
  }

  private date(ms: bigint): string {
    let iso = '';
    try {
      iso = formatIsoDate(ms);
    } catch {
      // beyond the JS Date range: java.util.Date still holds the milliseconds
    }
    if (FOUR_DIGIT_YEAR.test(iso)) {
      return `${this.use('Date')}.from(${this.use('Instant')}.parse(${q(iso)}))`;
    }
    return `new ${this.use('Date')}(${ms}L)`;
  }

  /** `Collation.builder()…build()`: `FindIterable#collation` takes a `Collation`, not a document. */
  collation(d: BsonDocument): Node {
    const calls = d.fields.map((f) => {
      const v = f.value;
      const str = (): string => {
        if (v.type !== 'string') throw new CodegenError(`collation.${f.key} must be a string`);
        return q(v.value);
      };
      const flag = (): string => {
        if (v.type !== 'bool') throw new CodegenError(`collation.${f.key} must be a boolean`);
        return String(v.value);
      };
      switch (f.key) {
        case 'locale':
          return `.locale(${str()})`;
        case 'caseLevel':
          return `.caseLevel(${flag()})`;
        case 'caseFirst':
          return `.collationCaseFirst(${this.use('CollationCaseFirst')}.fromString(${str()}))`;
        case 'strength': {
          const n =
            v.type === 'int' || v.type === 'double' || v.type === 'long' ? Number(v.value) : NaN;
          if (!Number.isInteger(n)) throw new CodegenError('collation.strength must be an integer');
          return `.collationStrength(${this.use('CollationStrength')}.fromInt(${n}))`;
        }
        case 'numericOrdering':
          return `.numericOrdering(${flag()})`;
        case 'alternate':
          return `.collationAlternate(${this.use('CollationAlternate')}.fromString(${str()}))`;
        case 'maxVariable':
          return `.collationMaxVariable(${this.use('CollationMaxVariable')}.fromString(${str()}))`;
        case 'normalization':
          return `.normalization(${flag()})`;
        case 'backwards':
          return `.backwards(${flag()})`;
        default:
          throw new CodegenError(`Unknown collation option "${f.key}"`);
      }
    });
    return chain(`${this.use('Collation')}.builder()`, [...calls, '.build()']);
  }
}

export function javaDouble(n: number): string {
  if (Number.isNaN(n)) return 'Double.NaN';
  if (n === Infinity) return 'Double.POSITIVE_INFINITY';
  if (n === -Infinity) return 'Double.NEGATIVE_INFINITY';
  if (Object.is(n, -0)) return '-0.0';
  const s = String(n);
  return /[.e]/.test(s) ? s : `${s}.0`;
}

/** A `Query` class for the Java sync driver that prints each result as one line of JSON. */
export function generateJava(query: CodegenQuery, options: CodegenOptions = {}): string {
  const p = new JavaPrinter();
  const step = '    ';
  const indent = step.repeat(3);
  let call: Node;
  if (query.kind === 'aggregate') {
    call = chain(
      concat(
        'coll.aggregate(',
        list(
          `${p.use('List')}.of(`,
          query.pipeline.map((s) => p.doc(s)),
          ')',
        ),
        ')',
      ),
      ['.forEach(doc -> System.out.println(doc.toJson()));'],
    );
  } else {
    const parts = findParts(query);
    const tails: Node[] = [];
    if (parts.projection) tails.push(concat('.projection(', p.doc(parts.projection), ')'));
    if (parts.sort) tails.push(concat('.sort(', p.doc(parts.sort), ')'));
    if (parts.collation) tails.push(concat('.collation(', p.collation(parts.collation), ')'));
    if (parts.skip !== undefined) tails.push(`.skip(${int(parts.skip, 'skip')})`);
    if (parts.limit !== undefined) tails.push(`.limit(${int(parts.limit, 'limit')})`);
    tails.push('.forEach(doc -> System.out.println(doc.toJson()));');
    call = chain(concat('coll.find(', p.doc(query.filter), ')'), tails);
  }
  const body = layout(call, indent, step);
  const imports = [...p.imports].map((n) => IMPORTS[n] ?? n).sort();
  return `${[
    ...imports.map((i) => `import ${i};`),
    '',
    'public class Query {',
    `${step}public static void main(String[] args) {`,
    `${step}${step}try (MongoClient client = MongoClients.create(${q(options.uri ?? DEFAULT_URI)})) {`,
    `${indent}MongoCollection<Document> coll =`,
    `${indent}${step}${step}client.getDatabase(${q(query.database)}).getCollection(${q(query.collection)});`,
    `${indent}${body}`,
    `${step}${step}}`,
    `${step}}`,
    '}',
  ].join('\n')}\n`;
}

function int(n: number, name: string): number {
  if (n > INT32_MAX) throw new CodegenError(`${name} ${n} is too large for the Java driver (int)`);
  return n;
}
