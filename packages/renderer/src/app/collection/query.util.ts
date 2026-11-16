import type { BsonDocument, BsonValue } from '@thicket/core/bson';
import { stringifyEJson } from '@thicket/core/bson';
import { parseSort, type SortSpec } from '@thicket/core/paging';
import { parseShellSyntaxDocument, ShellSyntaxError } from '@thicket/core/shellsyntax';

/** What the user typed into the query bar (shell syntax; `limit` as typed). */
export interface QueryText {
  filter: string;
  projection: string;
  sort: string;
  collation: string;
  limit: string;
}

export type QueryField = keyof QueryText;

export const EMPTY_QUERY: QueryText = {
  filter: '',
  projection: '',
  sort: '',
  collation: '',
  limit: '',
};

/** A query ready to send: every document part as canonical EJSON text. */
export interface ParsedQuery {
  /** Always set (`{}` for an empty filter). */
  filter: string;
  projection?: string;
  sort?: string;
  collation?: string;
  /** Most documents the whole result may have (the shell's `.limit(n)`); `undefined`: no limit. */
  limit?: number;
  /** The sort for paging (`parseSort`): empty for none, `null` for an opaque sort (`$meta`). */
  sortSpec: SortSpec | null;
  /** The filter is empty, so the collection's estimated count is the result's count. */
  emptyFilter: boolean;
}

export type QueryErrors = Partial<Record<QueryField, string>>;

export type QueryParse = { ok: true; query: ParsedQuery } | { ok: false; errors: QueryErrors };

/** Parses one document field; empty text gives `undefined`. Throws `ShellSyntaxError`. */
function parseDocField(text: string): BsonDocument | undefined {
  return text.trim() === '' ? undefined : parseShellSyntaxDocument(text);
}

/** Readable error of one field. */
function problemOf(error: unknown): string {
  if (error instanceof ShellSyntaxError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

/** Parses the limit field: empty → none, else a non-negative integer (0 means none, as in mongosh). */
export function parseLimit(text: string): number | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  if (!/^\d+$/.test(t)) throw new Error('Limit must be a whole number (0 or more)');
  const n = Number(t);
  if (!Number.isSafeInteger(n)) throw new Error('Limit is too large');
  return n === 0 ? undefined : n;
}

/** The value of a sort key as `parseSort` reads it (numbers and strings; anything else is opaque). */
function sortValue(value: BsonValue): unknown {
  switch (value.type) {
    case 'int':
    case 'double':
      return value.value;
    case 'long':
      return Number(value.value);
    case 'string':
      return value.value;
    default:
      return {};
  }
}

/** The paging sort of a sort document; repeated keys are opaque (`null`). */
export function sortSpecOf(sort: BsonDocument | undefined): SortSpec | null {
  if (sort === undefined) return [];
  const record: Record<string, unknown> = {};
  for (const field of sort.fields) {
    if (Object.hasOwn(record, field.key)) return null;
    record[field.key] = sortValue(field.value);
  }
  return parseSort(record);
}

/**
 * Parses the query bar. Every field is checked, so all errors show at once; nothing is sent while
 * one field has an error.
 */
export function parseQuery(text: QueryText): QueryParse {
  const errors: QueryErrors = {};
  const docs: Partial<Record<'filter' | 'projection' | 'sort' | 'collation', BsonDocument>> = {};
  for (const field of ['filter', 'projection', 'sort', 'collation'] as const) {
    try {
      const doc = parseDocField(text[field]);
      if (doc !== undefined) docs[field] = doc;
    } catch (error) {
      errors[field] = problemOf(error);
    }
  }
  let limit: number | undefined;
  try {
    limit = parseLimit(text.limit);
  } catch (error) {
    errors.limit = problemOf(error);
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const filter = docs.filter ?? { type: 'object', fields: [] };
  const optional = (doc: BsonDocument | undefined): string | undefined =>
    doc === undefined || doc.fields.length === 0 ? undefined : stringifyEJson(doc);
  const query: ParsedQuery = {
    filter: stringifyEJson(filter),
    sortSpec: sortSpecOf(docs.sort),
    emptyFilter: filter.fields.length === 0,
  };
  const projection = optional(docs.projection);
  const sort = optional(docs.sort);
  const collation = optional(docs.collation);
  if (projection !== undefined) query.projection = projection;
  if (sort !== undefined) query.sort = sort;
  if (collation !== undefined) query.collation = collation;
  if (limit !== undefined) query.limit = limit;
  return { ok: true, query };
}
