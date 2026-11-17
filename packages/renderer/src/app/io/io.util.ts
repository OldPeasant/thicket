import type { BsonDocument } from '@thicket/core/bson';
import { parseEJsonDocument } from '@thicket/core/bson';
import type { IoProgress, ParamsOf } from '@thicket/contract';
import { printShellSyntax } from '@thicket/core/shellsyntax';

import type { ParsedQuery } from '../collection/query.util';

/** File formats the basic import/export dialogs offer (CSV and BSON come with io-advanced). */
export type TextFormat = 'json' | 'jsonl';
export type EjsonMode = 'relaxed' | 'canonical';

export const TEXT_FORMATS: readonly { value: TextFormat; label: string; hint: string }[] = [
  { value: 'json', label: 'JSON', hint: 'One array of documents' },
  { value: 'jsonl', label: 'JSON Lines', hint: 'One document per line' },
];

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
  format: TextFormat,
  ejsonMode: EjsonMode,
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

/** The exported query as the mongosh call it runs: `db.orders.find({ a: 1 }).sort({ b: -1 })`. */
export function describeExport(coll: string, query: ParsedQuery): string {
  let call = `db.${coll}.find(${shell(query.filter, '{}')}`;
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
