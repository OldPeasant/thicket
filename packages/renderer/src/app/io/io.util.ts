import type { BsonDocument } from '@thicket/core/bson';
import { parseEJsonDocument } from '@thicket/core/bson';
import type { CsvType, IoProgress, ParamsOf } from '@thicket/contract';
import { printShellSyntax } from '@thicket/core/shellsyntax';

import type { ParsedQuery } from '../collection/query.util';

/** File formats of the import and export panels. */
export type FileFormat = 'json' | 'jsonl' | 'csv' | 'bson';
export type EjsonMode = 'relaxed' | 'canonical';

export const FILE_FORMATS: readonly { value: FileFormat; label: string; hint: string }[] = [
  { value: 'json', label: 'JSON', hint: 'One array of documents' },
  { value: 'jsonl', label: 'JSON Lines', hint: 'One document per line' },
  { value: 'csv', label: 'CSV', hint: 'One row per document, one column per field' },
  {
    value: 'bson',
    label: 'BSON dump',
    hint: 'mongodump-compatible .bson file with its .metadata.json',
  },
];

/** The types a CSV column can be imported as, in the order the mapping offers them. */
export const CSV_TYPE_OPTIONS: readonly { value: CsvType; label: string; token: string }[] = [
  { value: 'auto', label: 'Auto', token: '--text-faint' },
  { value: 'string', label: 'String', token: '--bson-string' },
  { value: 'int', label: 'Int32', token: '--bson-int' },
  { value: 'long', label: 'Int64', token: '--bson-long' },
  { value: 'double', label: 'Double', token: '--bson-double' },
  { value: 'decimal', label: 'Decimal128', token: '--bson-decimal' },
  { value: 'bool', label: 'Boolean', token: '--bson-bool' },
  { value: 'date', label: 'Date', token: '--bson-date' },
  { value: 'objectId', label: 'ObjectId', token: '--bson-object-id' },
  { value: 'json', label: 'Extended JSON', token: '--bson-object' },
];

/** One CSV column in the import mapping (what the panel edits). */
export interface CsvColumnRow {
  column: string;
  include: boolean;
  path: string;
  type: CsvType;
  /** The cell of the first row, as written in the file. */
  example: string;
}

/**
 * The default mapping: every named column under its own name, `auto` (like the backend's
 * default). Columns whose name is no valid path (`a.`), or repeats or overlaps the name of an
 * earlier included column (`a,a` or `a,a.b`), start unchecked: the user maps them.
 */
export function defaultCsvRows(
  columns: readonly string[],
  rows: readonly string[][],
): CsvColumnRow[] {
  const taken: string[] = [];
  const overlaps = (a: string, b: string) =>
    a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
  return columns.map((column, i) => {
    const usable =
      column.trim() !== '' &&
      !column.split('.').some((s) => s === '') &&
      !taken.some((t) => overlaps(t, column));
    if (usable) taken.push(column);
    return { column, include: usable, path: column, type: 'auto', example: rows[0]?.[i] ?? '' };
  });
}

/**
 * The first problem of a mapping (no column, an empty or repeated path, overlapping paths), or
 * `null` when it can be sent.
 */
export function csvMappingProblem(rows: readonly CsvColumnRow[]): string | null {
  const used = rows.filter((r) => r.include);
  if (used.length === 0) return 'Choose at least one column to import.';
  const paths = new Set<string>();
  for (const row of used) {
    const path = row.path.trim();
    if (path === '' || path.split('.').some((s) => s === '')) {
      return `Column ${JSON.stringify(row.column)} needs a field path such as name or address.city.`;
    }
    if (paths.has(path)) return `Field ${JSON.stringify(path)} is used by two columns.`;
    paths.add(path);
  }
  for (const a of paths) {
    for (const b of paths) {
      if (b.startsWith(`${a}.`)) {
        return `Fields ${JSON.stringify(a)} and ${JSON.stringify(b)} overlap: ${a} would be both a value and a document.`;
      }
    }
  }
  return null;
}

/**
 * `io.import`'s `csvMapping` for the included columns. `rows` are in header order (one per
 * column), so each entry names its column by index too: a repeated header name is imported from
 * the column the user chose.
 */
export function csvMapping(
  rows: readonly CsvColumnRow[],
): NonNullable<ParamsOf<'io.import'>['csvMapping']> {
  return rows.flatMap((r, index) =>
    r.include ? [{ column: r.column, index, path: r.path.trim(), bsonType: r.type }] : [],
  );
}

/** An object of canonical EJSON that is a type wrapper (`{"$oid": …}`), not a document. */
function isWrapper(value: object): boolean {
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((k) => k.startsWith('$'));
}

function collect(value: Record<string, unknown>, prefix: string, paths: Set<string>): void {
  for (const [key, v] of Object.entries(value)) {
    const path = prefix + key;
    if (
      typeof v === 'object' &&
      v !== null &&
      !Array.isArray(v) &&
      !isWrapper(v) &&
      Object.keys(v).length > 0
    ) {
      collect(v as Record<string, unknown>, `${path}.`, paths);
    } else {
      paths.add(path);
    }
  }
}

/**
 * The CSV columns of documents (canonical EJSON texts, e.g. the page shown): their field paths
 * in the order first seen, nested documents flattened to `a.b`; arrays stay one column.
 * Unreadable texts are skipped.
 */
export function csvFieldsOf(docs: readonly string[]): string[] {
  const paths = new Set<string>();
  for (const text of docs) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      collect(parsed as Record<string, unknown>, '', paths);
    }
  }
  return [...paths];
}

export const EJSON_MODES: readonly { value: EjsonMode; label: string; hint: string }[] = [
  { value: 'relaxed', label: 'Relaxed', hint: 'Plain numbers and dates where lossless' },
  { value: 'canonical', label: 'Canonical', hint: 'Every BSON type kept exactly' },
];

/** The namespace a tab works on. */
export interface IoTarget {
  profileId: string;
  db: string;
  coll: string;
}

/** `io.export` params for the query applied in a collection tab. */
export function exportParams(
  target: IoTarget,
  query: ParsedQuery,
  format: FileFormat,
  ejsonMode: EjsonMode,
  csvFields?: readonly string[],
): ParamsOf<'io.export'> {
  const source: Extract<ParamsOf<'io.export'>['source'], { kind: 'find' }> = {
    kind: 'find',
    filter: query.filter,
  };
  if (query.projection !== undefined) source.projection = query.projection;
  if (query.sort !== undefined) source.sort = query.sort;
  if (query.collation !== undefined) source.collation = query.collation;
  if (query.limit !== undefined && query.limit > 0) source.limit = query.limit;
  return {
    profileId: target.profileId,
    db: target.db,
    coll: target.coll,
    source,
    format,
    ejsonMode,
    ...(format === 'csv' && csvFields !== undefined && csvFields.length > 0
      ? { csvFields: [...csvFields] }
      : {}),
  };
}

/** Prints one canonical EJSON part in shell syntax; `fallback` when it is missing or unreadable. */
function shell(text: string | undefined, fallback: string): string {
  if (text === undefined) return fallback;
  try {
    return printShellSyntax(parseEJsonDocument(text));
  } catch {
    return text;
  }
}

/**
 * A collection in mongosh syntax: `db.orders` when the name is a JavaScript identifier, else
 * `db.getCollection("my-orders")` (quoted like `safety/operation.ts`).
 */
export function collRef(coll: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(coll)
    ? `db.${coll}`
    : `db.getCollection(${JSON.stringify(coll)})`;
}

/** The exported query as the mongosh call it runs: `db.orders.find({ a: 1 }).sort({ b: -1 })`. */
export function describeExport(coll: string, query: ParsedQuery): string {
  let call = `${collRef(coll)}.find(${shell(query.filter, '{}')}`;
  call += query.projection !== undefined ? `, ${shell(query.projection, '{}')})` : ')';
  if (query.sort !== undefined) call += `.sort(${shell(query.sort, '{}')})`;
  if (query.collation !== undefined) call += `.collation(${shell(query.collation, '{}')})`;
  if (query.limit !== undefined && query.limit > 0) call += `.limit(${query.limit})`;
  return call;
}

/** 1536 → "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const numbers = new Intl.NumberFormat();

/** 12431 → "12,431" (the locale's grouping, like the pager). */
export function formatNumber(n: number): string {
  return numbers.format(n);
}

/** A sample document printed in shell syntax (indented), or a note when it cannot be read. */
export function printSample(text: string): string {
  let doc: BsonDocument;
  try {
    doc = parseEJsonDocument(text);
  } catch {
    return '// unreadable document';
  }
  return printShellSyntax(doc, { indent: 2 });
}

/** An empty progress (nothing processed yet). */
export const NO_PROGRESS: IoProgress = { processed: 0, failed: 0, errors: [] };
