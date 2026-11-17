import type { SchemaField } from '@thicket/contract';
import { parseEJson, type BsonDocument, type BsonValue } from '@thicket/core/bson';
import { parseShellSyntaxDocument, printShellSyntax } from '@thicket/core/shellsyntax';

/** Longest example text shown in a chip (the full text is its tooltip). */
export const EXAMPLE_TEXT_LIMIT = 48;

/** One example value of a type, ready to show and to filter with. */
export interface SchemaExample {
  readonly value: BsonValue;
  /** Shell syntax, cut to {@link EXAMPLE_TEXT_LIMIT}. */
  readonly text: string;
  /** The whole shell syntax. */
  readonly full: string;
}

export interface SchemaTypeRow {
  readonly bsonType: string;
  /** Share of the path's base (0..1). */
  readonly share: number;
  readonly count: number;
  /** The theme token coloring this type. */
  readonly color: string;
  readonly examples: readonly SchemaExample[];
}

export interface SchemaRow {
  readonly path: string;
  /** Last path segment (`[]` for array items). */
  readonly name: string;
  /** Nesting depth (0 for top-level fields). */
  readonly depth: number;
  /** Share of the parent having the field (0..1). */
  readonly share: number;
  /** `1 - share`. */
  readonly missing: number;
  readonly count: number;
  /** The query key a filter on this path uses (`a.[].b` → `a.b`). */
  readonly filterKey: string;
  readonly types: readonly SchemaTypeRow[];
}

/** The `$type` alias → the `--bson-*` theme token of that type. */
const TYPE_TOKENS: Readonly<Record<string, string>> = {
  binData: 'bin-data',
  dbPointer: 'db-pointer',
  javascriptWithScope: 'javascript',
  maxKey: 'max-key',
  minKey: 'min-key',
  objectId: 'object-id',
};

export function typeColor(bsonType: string): string {
  const token = TYPE_TOKENS[bsonType] ?? bsonType.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  return `var(--bson-${token}, var(--text-muted))`;
}

/** The query key for an analysis path: array item segments (`[]`) are left out. */
export function filterKeyOf(path: string): string {
  return path
    .split('.')
    .filter((segment) => segment !== '[]')
    .join('.');
}

function examplesOf(text: string): SchemaExample[] {
  let parsed: BsonValue;
  try {
    parsed = parseEJson(text);
  } catch {
    return [];
  }
  if (parsed.type !== 'array') return [];
  return parsed.items.map((value) => {
    const full = printShellSyntax(value);
    const text =
      full.length > EXAMPLE_TEXT_LIMIT ? `${full.slice(0, EXAMPLE_TEXT_LIMIT - 1)}…` : full;
    return { value, text, full };
  });
}

/** The rows the analysis table shows, in the backend's order (depth first). */
export function schemaRows(fields: readonly SchemaField[]): SchemaRow[] {
  return fields.map((field) => {
    const segments = field.path.split('.');
    return {
      path: field.path,
      name: segments[segments.length - 1] ?? field.path,
      depth: segments.length - 1,
      share: field.probability,
      missing: Math.max(0, 1 - field.probability),
      count: field.count,
      filterKey: filterKeyOf(field.path),
      types: field.types.map((type) => ({
        bsonType: type.bsonType,
        share: field.probability > 0 ? type.probability : 0,
        count: type.count,
        color: typeColor(type.bsonType),
        examples: examplesOf(type.examples),
      })),
    };
  });
}

/** `{ $type: "<alias>" }`: the condition matching values of one type. */
export function typeCondition(bsonType: string): BsonDocument {
  return { type: 'object', fields: [{ key: '$type', value: { type: 'string', value: bsonType } }] };
}

/**
 * The filter text with `key` set to `condition`, in shell syntax. The current filter keeps its
 * other fields (a field with the same key is replaced in place); when it is empty or can't be
 * parsed, the result holds only the new condition.
 */
export function withFilterField(current: string, key: string, condition: BsonValue): string {
  let doc: BsonDocument = { type: 'object', fields: [] };
  if (current.trim() !== '') {
    try {
      doc = parseShellSyntaxDocument(current);
    } catch {
      // An unreadable filter is replaced.
    }
  }
  const index = doc.fields.findIndex((f) => f.key === key);
  const fields =
    index === -1
      ? [...doc.fields, { key, value: condition }]
      : doc.fields.map((f, i) => (i === index ? { key, value: condition } : f));
  return printShellSyntax({ type: 'object', fields });
}

/** "37.5 %" style share text (whole numbers without decimals). */
export function percent(share: number): string {
  const value = Math.round(share * 1000) / 10;
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} %`;
}
