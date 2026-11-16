// Field order of explorer objects.
//
// The explorer walks plain JS objects, and JS objects always list
// integer-like keys ("0", "42") first, whatever order they were added in. A
// MongoDB document keeps its field order, so an object whose real order
// differs from `Object.keys` carries it in a hidden (non-enumerable) symbol
// property. `JSON.stringify`, `Object.keys/entries` and spreads don't see it;
// `orderedKeys` and `fromExplorerValue` do. Edits made with `withEntry`,
// `withoutEntry` and `moveEntry` keep it; code that rebuilds an object any
// other way falls back to `Object.keys` order (only integer-like keys move).

const KEY_ORDER = Symbol('thicket.keyOrder');

type Ordered = Record<string, unknown> & { [KEY_ORDER]?: readonly string[] };

/** The keys of `obj` in document order. */
export function orderedKeys(obj: object): string[] {
  const keys = Object.keys(obj);
  const order = (obj as Ordered)[KEY_ORDER];
  if (!order) return keys;
  const present = new Set(keys);
  const out = order.filter((k) => present.has(k));
  if (out.length === keys.length) return out;
  // Keys added without keeping the order: after the known ones.
  const known = new Set(out);
  return [...out, ...keys.filter((k) => !known.has(k))];
}

/** The entries of `obj` in document order. */
export function orderedEntries(obj: object): [string, unknown][] {
  return orderedKeys(obj).map((k) => [k, (obj as Record<string, unknown>)[k]]);
}

/**
 * A plain object with these entries in this order. A later repeated key
 * replaces the earlier one's value (at the earlier position). "__proto__"
 * stays an ordinary key.
 */
export function objectFromEntries(
  entries: Iterable<readonly [string, unknown]>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const order: string[] = [];
  for (const [key, value] of entries) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) order.push(key);
    Object.defineProperty(out, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  const natural = Object.keys(out);
  if (natural.some((k, i) => k !== order[i])) {
    Object.defineProperty(out, KEY_ORDER, { value: Object.freeze(order), enumerable: false });
  }
  return out;
}

/** `obj` with `key` set to `value`: an existing key keeps its place, a new one goes last. */
export function withEntry(
  obj: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  const entries = orderedEntries(obj);
  const at = entries.findIndex(([k]) => k === key);
  if (at < 0) entries.push([key, value]);
  else entries[at] = [key, value];
  return objectFromEntries(entries);
}

/** `obj` without `key`, the other keys in their order. */
export function withoutEntry(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  return objectFromEntries(orderedEntries(obj).filter(([k]) => k !== key));
}

/** `obj` with `key` moved to position `to` (clamped); unchanged when `key` is absent. */
export function moveEntry(
  obj: Record<string, unknown>,
  key: string,
  to: number,
): Record<string, unknown> {
  const entries = orderedEntries(obj);
  const from = entries.findIndex(([k]) => k === key);
  if (from < 0) return obj;
  const target = Math.max(0, Math.min(entries.length - 1, to));
  if (target === from) return obj;
  const [moved] = entries.splice(from, 1);
  entries.splice(target, 0, moved as [string, unknown]);
  return objectFromEntries(entries);
}
