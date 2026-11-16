import type { SortSpec } from './sort';

/** A MongoDB find projection document. */
export type Projection = Readonly<Record<string, unknown>>;

const isIncluded = (v: unknown): boolean => v === true || (typeof v === 'number' && v !== 0);
const isExcluded = (v: unknown): boolean => v === 0 || v === false;

/** `$slice` / `$meta` alone neither restrict a projection to listed fields nor exclude any. */
function isNeutral(v: unknown): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 1 && (keys[0] === '$slice' || keys[0] === '$meta');
}

const isParentPath = (parent: string, path: string): boolean => path.startsWith(`${parent}.`);
const coversPath = (key: string, path: string): boolean => key === path || isParentPath(key, path);
const relatedPath = (key: string, path: string): boolean =>
  coversPath(key, path) || isParentPath(path, key);
const underId = (path: string): boolean => coversPath('_id', path);

/** True for an inclusion projection (only the listed fields, plus `_id`, are returned). */
function isInclusion(projection: Projection): boolean {
  const entries = Object.entries(projection).filter(([k]) => k !== '_id');
  if (entries.some(([, v]) => isIncluded(v) || (!isExcluded(v) && !isNeutral(v)))) return true;
  return !entries.some(([, v]) => isExcluded(v)) && isIncluded(projection['_id']);
}

/**
 * Returns a projection that keeps the user's projection but guarantees that every sort-key field
 * is present in the results. Range paging takes its bounds from the sort-key values of the loaded
 * rows (`pageLoaded`), and a missing key would read as `null` and produce wrong pages, so callers
 * that page in range mode must send this projection instead of the user's own. Pass `state.sort`.
 *
 * - `undefined`, an empty projection, an opaque (`null`) or empty sort: returned unchanged.
 * - Inclusion projection: a sort field is added as `1` unless it or a parent path is already
 *   included. Included child paths of a sort field are replaced by the field (MongoDB rejects
 *   overlapping paths), and an exclusion or operator/expression on the field or a parent path
 *   (e.g. `_id: 0`) is removed.
 * - Exclusion projection (including `_id: 0` alone): exclusions of a sort field, of a parent path
 *   of it or of a child path of it are removed, as are operators on those paths.
 *
 * Entries on other fields, including operators such as `$slice`, `$elemMatch`, `$meta` and
 * expressions, are kept as they are. The result is a new object; the input is not modified.
 */
export function projectionWithSortKeys(
  projection: Projection | undefined,
  sort: SortSpec | null,
): Projection | undefined {
  if (projection === undefined || sort === null || sort.length === 0) return projection;
  if (Object.keys(projection).length === 0) return projection;
  const inclusion = isInclusion(projection);
  let entries = Object.entries(projection);
  for (const { field } of sort) {
    entries = entries.filter(([key, value]) =>
      inclusion
        ? !((coversPath(key, field) && !isIncluded(value)) || isParentPath(field, key))
        : !(relatedPath(key, field) && !isIncluded(value)),
    );
    if (!inclusion) continue;
    const covered =
      entries.some(([k, v]) => coversPath(k, field) && isIncluded(v)) ||
      (underId(field) && !entries.some(([k]) => underId(k))); // `_id` is returned by default
    if (!covered) entries.push([field, 1]);
  }
  return Object.fromEntries(entries);
}
