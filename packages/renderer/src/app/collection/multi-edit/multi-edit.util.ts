import { type BsonDocument, type BsonValue } from '@thicket/core/bson';
import { diffDocuments, isAddressableKey } from '@thicket/core/diff';
import { parseShellSyntax, ShellSyntaxError } from '@thicket/core/shellsyntax';

/** What "Edit a field across selected rows" does to each selected document. */
export type FieldEdit =
  | { readonly action: 'set'; readonly path: string; readonly value: BsonValue }
  | { readonly action: 'unset'; readonly path: string };

/** The `docs.update` for one document, or why it gets none. */
export type FieldEditPlan =
  | { readonly kind: 'update'; readonly update: BsonDocument; readonly expected: BsonDocument }
  /** The document already has this value (or lacks the field to unset). */
  | { readonly kind: 'unchanged' }
  /** The edit can't apply to this document (e.g. a parent on the path is not a document). */
  | { readonly kind: 'invalid'; readonly reason: string };

/**
 * Checks a dotted field path typed by the user: its segments must be usable in an update (not
 * empty, no leading `$`) and it must not touch `_id`. Returns the error, or `null` when valid.
 */
export function fieldPathError(path: string): string | null {
  if (path.trim() === '') return 'Enter the field to change, e.g. status or address.city.';
  const segments = path.split('.');
  if (segments.some((s) => !isAddressableKey(s))) {
    return `"${path}" is not a field path: parts can't be empty or start with $.`;
  }
  if (segments[0] === '_id') return 'The _id of a document can’t be changed.';
  return null;
}

/** Parses the value typed in shell syntax (never evaluated). Throws `ShellSyntaxError`. */
export function parseFieldValue(text: string): BsonValue {
  if (text.trim() === '') throw new ShellSyntaxError('Enter a value in shell syntax.', text, 0);
  return parseShellSyntax(text);
}

/**
 * The update and conflict check for one document: the edit is applied to the loaded version and
 * diffed against it (`diffDocuments`), so the filter is `_id` plus the original value of the
 * changed top-level field, exactly as a Save of a single document.
 */
export function planFieldEdit(original: BsonDocument, edit: FieldEdit): FieldEditPlan {
  const segments = edit.path.split('.');
  const edited = editAt(original, segments, edit);
  if (typeof edited === 'string') return { kind: 'invalid', reason: edited };
  const diff = diffDocuments(original, edited);
  if (diff.kind === 'none') return { kind: 'unchanged' };
  if (diff.kind === 'replace') {
    // Only reachable when the document repeats a key on the path: never replace a whole document.
    return { kind: 'invalid', reason: 'its fields repeat a name on this path' };
  }
  return { kind: 'update', update: diff.update, expected: diff.expected };
}

/** `doc` with the edit applied below it, or the reason it can't be applied. */
function editAt(
  doc: BsonDocument,
  segments: readonly string[],
  edit: FieldEdit,
): BsonDocument | string {
  const [key, ...rest] = segments as [string, ...string[]];
  const index = doc.fields.findIndex((f) => f.key === key);
  const existing = index === -1 ? undefined : doc.fields[index]?.value;
  if (rest.length === 0) {
    if (edit.action === 'unset') {
      return index === -1 ? doc : { ...doc, fields: doc.fields.filter((_, i) => i !== index) };
    }
    return withField(doc, index, key, edit.value);
  }
  if (existing === undefined) {
    // Nothing to remove below a missing field; a set creates the documents on the way.
    if (edit.action === 'unset') return doc;
    const child = editAt({ type: 'object', fields: [] }, rest, edit);
    return typeof child === 'string' ? child : withField(doc, index, key, child);
  }
  if (existing.type !== 'object') return `${key} is not a document`;
  const child = editAt(existing, rest, edit);
  if (typeof child === 'string') return `${key}.${child}`;
  return child === existing ? doc : withField(doc, index, key, child);
}

function withField(doc: BsonDocument, index: number, key: string, value: BsonValue): BsonDocument {
  if (index === -1) return { ...doc, fields: [...doc.fields, { key, value }] };
  return { ...doc, fields: doc.fields.map((f, i) => (i === index ? { key, value } : f)) };
}
