import { reverseSort, type SortSpec } from './sort';

/**
 * Sort-key values of one row, keyed by the sort fields' dotted paths, e.g.
 * `{"_id": ObjectId(...)}` or `{"lastName": "Lee", "_id": 7}` (the shape of `after`/`before` in
 * `docs.find`). Values are whatever the caller's document model uses (EJSON-parsed BSON values in
 * the backend); this module only places them into a filter.
 */
export type SortKeyValues = Readonly<Record<string, unknown>>;

/** A MongoDB query filter document. */
export type Filter = Record<string, unknown>;

/** Which side of the bound a range page lies on, in the order of the requested sort. */
export type RangeSide = 'after' | 'before';

/**
 * Reads the value at a dotted path (`a.b.c`) of a document. Missing fields yield `null`, which is
 * how MongoDB sorts them. Arrays along the path are not expanded (sorting on array fields can't be
 * range paged).
 */
export function valueAtPath(doc: unknown, path: string): unknown {
  let current: unknown = doc;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, part)) {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current === undefined ? null : current;
}

/** The sort-key values of `doc` for `sort`, ready to pass as `after`/`before`. */
export function sortKeyValues(doc: unknown, sort: SortSpec): SortKeyValues {
  const values: Record<string, unknown> = {};
  for (const key of sort) values[key.field] = valueAtPath(doc, key.field);
  return values;
}

/** Comparison of one key: strictly after or strictly before the bound value. */
function strictBeyond(value: unknown, greater: boolean): Record<string, unknown> {
  if (value === null) {
    // Only MinKey sorts below null; everything but null/missing (and MinKey) sorts above it.
    // `$gt: null` / `$lt: null` would match nothing because of type bracketing.
    return greater ? { $ne: null, $not: { $type: 'minKey' } } : { $type: 'minKey' };
  }
  return greater ? { $gt: value } : { $lt: value };
}

/**
 * Filter that selects the rows strictly after (or before) the row whose sort-key values are
 * `bound`, in the order given by `sort`. For keys `k1..kn` this is the lexicographic condition
 *
 *     k1 > v1  OR  (k1 = v1 AND k2 > v2)  OR ...  OR  (k1 = v1 AND ... AND kn > vn)
 *
 * where ">" means "later in sort order": `$gt` for ascending keys, `$lt` for descending ones
 * (flipped for `before`). With more than one key, the first key also gets a non-strict bound
 * (`$gte`/`$lte`) at top level so the server can narrow the index scan.
 *
 * The sort must be range pageable (see `isRangePageable`), `bound` must hold a value for every sort
 * key, and the sort keys should hold values of one BSON type: `$gt`/`$lt` compare within one type.
 */
export function rangeFilter(sort: SortSpec, bound: SortKeyValues, side: RangeSide): Filter {
  if (sort.length === 0) throw new Error('rangeFilter needs at least one sort key');
  for (const key of sort) {
    if (!Object.hasOwn(bound, key.field)) {
      throw new Error(`range bound has no value for sort key "${key.field}"`);
    }
  }
  const clauses: Filter[] = sort.map((key, i) => {
    const clause: Filter = {};
    for (const prev of sort.slice(0, i)) clause[prev.field] = { $eq: bound[prev.field] };
    const greater = (key.direction === 1) === (side === 'after');
    clause[key.field] = strictBeyond(bound[key.field], greater);
    return clause;
  });
  if (clauses.length === 1) return clauses[0] as Filter;

  const first = sort[0] as SortSpec[number];
  const firstValue = bound[first.field];
  const filter: Filter = { $or: clauses };
  if (firstValue !== null) {
    const greater = (first.direction === 1) === (side === 'after');
    filter[first.field] = greater ? { $gte: firstValue } : { $lte: firstValue };
  }
  return filter;
}

/**
 * What to send to the server for one range page: the extra filter, the sort to run with, and
 * whether the returned rows must be reversed to get display order. Reading `before` a bound runs
 * the reversed sort (so `limit` takes the rows closest to the bound) and reverses the result.
 */
export interface RangeQuery {
  readonly filter: Filter;
  readonly sort: SortSpec;
  readonly reverseResults: boolean;
}

/** Builds the {@link RangeQuery} for the page after or before `bound`. */
export function rangeQuery(sort: SortSpec, bound: SortKeyValues, side: RangeSide): RangeQuery {
  return {
    filter: rangeFilter(sort, bound, side),
    sort: side === 'after' ? sort : reverseSort(sort),
    reverseResults: side === 'before',
  };
}

/** Combines the user's filter with a range filter (`$and`; the range alone when the filter is empty). */
export function andFilter(filter: Filter | undefined, range: Filter): Filter {
  if (filter === undefined || Object.keys(filter).length === 0) return range;
  return { $and: [filter, range] };
}
