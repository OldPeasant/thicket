/** Sort direction of one key, as in a MongoDB sort document. */
export type SortDirection = 1 | -1;

/** One key of a sort, in sort order. */
export interface SortKey {
  /** Dotted field path, e.g. `_id` or `customer.name`. */
  readonly field: string;
  readonly direction: SortDirection;
}

/** A sort as an ordered list of keys (a MongoDB sort document keeps key order). */
export type SortSpec = readonly SortKey[];

/** The sort used when the user gave none: `{_id: 1}`. */
export const DEFAULT_SORT: SortSpec = [{ field: '_id', direction: 1 }];

/**
 * Converts a sort document (`{a: 1, b: -1}`) into a {@link SortSpec}.
 * Accepts `1`/`-1` (also as strings) and `"asc"`/`"desc"`/`"ascending"`/`"descending"`.
 * Returns `null` when a key has another value (e.g. `{score: {$meta: "textScore"}}`): such a sort
 * can only be paged with skip/limit. An empty document yields an empty spec.
 */
export function parseSort(sort: Readonly<Record<string, unknown>> | undefined): SortSpec | null {
  if (sort === undefined) return [];
  const keys: SortKey[] = [];
  for (const [field, value] of Object.entries(sort)) {
    const direction = parseDirection(value);
    if (direction === null || field === '') return null;
    keys.push({ field, direction });
  }
  return keys;
}

function parseDirection(value: unknown): SortDirection | null {
  if (value === 1 || value === '1') return 1;
  if (value === -1 || value === '-1') return -1;
  if (typeof value === 'string') {
    const v = value.toLowerCase();
    if (v === 'asc' || v === 'ascending') return 1;
    if (v === 'desc' || v === 'descending') return -1;
  }
  return null;
}

/** Converts a {@link SortSpec} back into a sort document (key order preserved). */
export function sortDocument(sort: SortSpec): Record<string, SortDirection> {
  const doc: Record<string, SortDirection> = {};
  for (const key of sort) doc[key.field] = key.direction;
  return doc;
}

/** The same keys with every direction flipped (used to read the last page, or backwards). */
export function reverseSort(sort: SortSpec): SortSpec {
  return sort.map((k) => ({ field: k.field, direction: k.direction === 1 ? -1 : 1 }));
}

/** True when both specs have the same keys in the same order with the same directions. */
export function sameSort(a: SortSpec, b: SortSpec): boolean {
  return (
    a.length === b.length &&
    a.every((k, i) => k.field === b[i]?.field && k.direction === b[i]?.direction)
  );
}

/**
 * A unique index usable for range paging, given by its key fields. Callers pass only plain unique
 * indexes: sparse or partial unique indexes do not make a sort unique (several documents may lack
 * the field) and must be left out. `_id` is always unique and need not be listed.
 */
export type UniqueIndexKeys = readonly string[];

/**
 * True when `sort` can be paged by range: every key has a plain direction and the sort keys
 * include all fields of some unique index (`_id` counts as one), so the sort-key tuple identifies
 * exactly one document and "after the last row" is well defined.
 * An empty sort counts as the default `{_id: 1}`.
 */
export function isRangePageable(
  sort: SortSpec | null,
  uniqueIndexes: readonly UniqueIndexKeys[] = [],
): boolean {
  if (sort === null) return false;
  const effective = sort.length === 0 ? DEFAULT_SORT : sort;
  const fields = new Set(effective.map((k) => k.field));
  if (fields.size !== effective.length) return false;
  return [['_id'], ...uniqueIndexes].some(
    (index) => index.length > 0 && index.every((f) => fields.has(f)),
  );
}
