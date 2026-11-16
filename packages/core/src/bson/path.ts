import { BsonModelError, type BsonArray, type BsonDocument, type BsonValue } from './model';

/**
 * Immutable path operations. A path is a list of segments: a field name (string) inside a
 * document, an index (number) inside an array. Every operation returns a new root and shares
 * the untouched parts of the tree; the input is never modified. With repeated keys, a name
 * segment addresses the first field with that name.
 */
export type PathSegment = string | number;
export type BsonPath = readonly PathSegment[];

type Container = BsonDocument | BsonArray;

function pathError(path: BsonPath, msg: string): never {
  throw new BsonModelError(`${formatPath(path)}: ${msg}`);
}

/** Dotted form for messages: `a.b.0.c`. */
export function formatPath(path: BsonPath): string {
  return path.length === 0 ? '(root)' : path.join('.');
}

/** Index of the segment inside the container, or -1 if absent. */
function indexIn(container: Container, segment: PathSegment, path: BsonPath): number {
  if (container.type === 'object') {
    if (typeof segment !== 'string') return pathError(path, 'document fields are named');
    return container.fields.findIndex((f) => f.key === segment);
  }
  if (typeof segment !== 'number' || !Number.isInteger(segment) || segment < 0) {
    return pathError(path, 'array items are addressed by a non-negative integer');
  }
  return segment < container.items.length ? segment : -1;
}

function child(container: Container, index: number): BsonValue {
  return container.type === 'object'
    ? (container.fields[index] as { value: BsonValue }).value
    : (container.items[index] as BsonValue);
}

function asContainer(value: BsonValue | undefined, path: BsonPath): Container {
  if (value?.type === 'object' || value?.type === 'array') return value;
  return pathError(path, value ? `is a ${value.type}, not a document or array` : 'does not exist');
}

export function getAt(root: BsonValue, path: BsonPath): BsonValue | undefined {
  let current: BsonValue = root;
  for (const segment of path) {
    if (current.type !== 'object' && current.type !== 'array') return undefined;
    const mistyped =
      current.type === 'object'
        ? typeof segment !== 'string'
        : typeof segment !== 'number' || !Number.isInteger(segment) || segment < 0;
    if (mistyped) return undefined;
    const i = indexIn(current, segment, path);
    if (i < 0) return undefined;
    current = child(current, i);
  }
  return current;
}

/** Replaces the container at `path` with `fn(container)`, rebuilding the ancestors. */
function updateContainer(
  root: BsonValue,
  path: BsonPath,
  fn: (c: Container) => Container,
): BsonValue {
  const rec = (value: BsonValue, depth: number): BsonValue => {
    const container = asContainer(value, path.slice(0, depth));
    if (depth === path.length) return fn(container);
    const segment = path[depth] as PathSegment;
    const i = indexIn(container, segment, path.slice(0, depth + 1));
    if (i < 0) pathError(path.slice(0, depth + 1), 'does not exist');
    return replaceChild(container, i, rec(child(container, i), depth + 1));
  };
  return rec(root, 0);
}

function replaceChild(container: Container, index: number, value: BsonValue): Container {
  if (container.type === 'object') {
    const fields = container.fields.slice();
    fields[index] = { key: (fields[index] as { key: string }).key, value };
    return { type: 'object', fields };
  }
  const items = container.items.slice();
  items[index] = value;
  return { type: 'array', items };
}

function splitPath(path: BsonPath): [BsonPath, PathSegment] {
  if (path.length === 0) throw new BsonModelError('The root has no parent');
  return [path.slice(0, -1), path[path.length - 1] as PathSegment];
}

/**
 * Sets the value at `path`. An existing field or item keeps its position; a missing document
 * field is appended; an array index may be at most the array length (append).
 */
export function setAt(root: BsonValue, path: BsonPath, value: BsonValue): BsonValue {
  if (path.length === 0) return value;
  const [parent, last] = splitPath(path);
  return updateContainer(root, parent, (c) => {
    const i = indexIn(c, last, path);
    if (i >= 0) return replaceChild(c, i, value);
    if (c.type === 'object')
      return { type: 'object', fields: [...c.fields, { key: last as string, value }] };
    if (last !== c.items.length) pathError(path, 'index out of range');
    return { type: 'array', items: [...c.items, value] };
  });
}

/**
 * Inserts a new field or item. For a document the last segment is the new key (must not exist
 * yet) and `position` is where it goes (default: end). For an array the last segment is the
 * index the new item gets (0..length).
 */
export function insertAt(
  root: BsonValue,
  path: BsonPath,
  value: BsonValue,
  position?: number,
): BsonValue {
  const [parent, last] = splitPath(path);
  return updateContainer(root, parent, (c) => {
    if (c.type === 'object') {
      if (indexIn(c, last, path) >= 0) pathError(path, 'field already exists');
      const at = position ?? c.fields.length;
      if (!Number.isInteger(at) || at < 0 || at > c.fields.length) {
        pathError(path, `position ${at} out of range`);
      }
      const fields = c.fields.slice();
      fields.splice(at, 0, { key: last as string, value });
      return { type: 'object', fields };
    }
    if (typeof last !== 'number' || !Number.isInteger(last) || last < 0 || last > c.items.length) {
      return pathError(path, 'index out of range');
    }
    const items = c.items.slice();
    items.splice(last, 0, value);
    return { type: 'array', items };
  });
}

/** Removes a field (or array item, shifting the following items). */
export function removeAt(root: BsonValue, path: BsonPath): BsonValue {
  const [parent, last] = splitPath(path);
  return updateContainer(root, parent, (c) => {
    const i = indexIn(c, last, path);
    if (i < 0) pathError(path, 'does not exist');
    return c.type === 'object'
      ? { type: 'object', fields: c.fields.filter((_, j) => j !== i) }
      : { type: 'array', items: c.items.filter((_, j) => j !== i) };
  });
}

/** Moves a field or item to another position (0-based, after removal) in the same parent. */
export function moveAt(root: BsonValue, path: BsonPath, toIndex: number): BsonValue {
  const [parent, last] = splitPath(path);
  return updateContainer(root, parent, (c) => {
    const i = indexIn(c, last, path);
    if (i < 0) pathError(path, 'does not exist');
    const length = c.type === 'object' ? c.fields.length : c.items.length;
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= length) {
      pathError(path, `position ${toIndex} out of range`);
    }
    if (c.type === 'object') {
      const fields = c.fields.slice();
      fields.splice(toIndex, 0, ...fields.splice(i, 1));
      return { type: 'object', fields };
    }
    const items = c.items.slice();
    items.splice(toIndex, 0, ...items.splice(i, 1));
    return { type: 'array', items };
  });
}

/** Renames a document field in place (keeps its position); the new name must not exist. */
export function renameAt(root: BsonValue, path: BsonPath, newKey: string): BsonValue {
  const [parent, last] = splitPath(path);
  return updateContainer(root, parent, (c) => {
    if (c.type !== 'object') return pathError(path, 'array items have no name');
    const i = indexIn(c, last, path);
    if (i < 0) pathError(path, 'does not exist');
    if (newKey !== last && c.fields.some((f) => f.key === newKey)) {
      pathError(path, `field "${newKey}" already exists`);
    }
    const fields = c.fields.slice();
    fields[i] = { key: newKey, value: child(c, i) };
    return { type: 'object', fields };
  });
}
