import {
  type BsonDocument,
  type BsonField,
  type BsonValue,
  bool,
  doc,
  int32,
  INT32_MAX,
  str,
  stringifyEJson,
} from '@thicket/core/bson';
import { parseShellSyntaxDocument, printShellSyntax } from '@thicket/core/shellsyntax';

/** What one key field of an index is: a direction or a special index type. */
export type KeyType = '1' | '-1' | 'text' | '2dsphere' | '2d' | 'hashed';

export const KEY_TYPES: readonly { value: KeyType; label: string }[] = [
  { value: '1', label: 'Ascending (1)' },
  { value: '-1', label: 'Descending (-1)' },
  { value: 'text', label: 'Text' },
  { value: '2dsphere', label: '2dsphere' },
  { value: '2d', label: '2d' },
  { value: 'hashed', label: 'Hashed' },
];

export interface KeyFieldDraft {
  /** Field path; `$**` or `path.$**` makes a wildcard index. */
  field: string;
  type: KeyType;
}

/** The create form as typed. Document options are shell syntax; empty text means "not set". */
export interface IndexDraft {
  fields: readonly KeyFieldDraft[];
  name: string;
  unique: boolean;
  sparse: boolean;
  hidden: boolean;
  /** TTL in seconds (`expireAfterSeconds`). */
  ttl: string;
  partialFilter: string;
  collation: string;
  /** Text indexes only. */
  weights: string;
  defaultLanguage: string;
  /** Wildcard index on `$**` only. */
  wildcardProjection: string;
}

export function emptyDraft(): IndexDraft {
  return {
    fields: [{ field: '', type: '1' }],
    name: '',
    unique: false,
    sparse: false,
    hidden: false,
    ttl: '',
    partialFilter: '',
    collation: '',
    weights: '',
    defaultLanguage: '',
    wildcardProjection: '',
  };
}

/** Where an error belongs: an option of the form, `fields` (the key as a whole) or `field.<i>`. */
export type DraftErrorKey =
  | 'fields'
  | `field.${number}`
  | 'name'
  | 'unique'
  | 'sparse'
  | 'ttl'
  | 'partialFilter'
  | 'collation'
  | 'weights'
  | 'defaultLanguage'
  | 'wildcardProjection';

export type DraftErrors = Partial<Record<DraftErrorKey, string>>;

/** `idx.create` params: key and options as canonical EJSON. */
export interface IndexSpec {
  key: string;
  options?: string;
  /** The same as shell syntax, for the preview and the confirm dialog. */
  keyDoc: BsonDocument;
  optionsDoc: BsonDocument;
}

export type DraftResult =
  | { ok: true; spec: IndexSpec }
  | { ok: false; errors: DraftErrors; keyDoc: BsonDocument; optionsDoc: BsonDocument };

export function isWildcard(field: string): boolean {
  return field === '$**' || field.endsWith('.$**');
}

function fieldProblem(field: string): string | null {
  if (field === '') return 'Enter a field name.';
  if (isWildcard(field)) {
    const base = field === '$**' ? '' : field.slice(0, -4);
    if (base === '') return null;
    return fieldProblem(base);
  }
  if (field.split('.').some((part) => part === '')) return 'A field path has no empty parts.';
  if (field.startsWith('$')) return 'Field names do not start with $.';
  return null;
}

function keyValue(type: KeyType): BsonValue {
  if (type === '1') return int32(1);
  if (type === '-1') return int32(-1);
  return str(type);
}

/** Parses a shell-syntax document option; `null` when empty. Throws the parser's message. */
function parseDoc(text: string): BsonDocument | null {
  if (text.trim() === '') return null;
  return parseShellSyntaxDocument(text);
}

/**
 * Checks the draft and builds the `createIndex` key and options. Catches the combinations the
 * server refuses (sparse + partial, TTL on a compound key, unique hashed/wildcard, …) so the user
 * sees them next to the field instead of as a server error.
 */
export function buildIndex(draft: IndexDraft): DraftResult {
  const errors: DraftErrors = {};
  const keyFields: BsonField[] = [];
  const seen = new Set<string>();
  const fields = draft.fields.map((f) => ({ field: f.field.trim(), type: f.type }));

  if (fields.length === 0) errors.fields = 'Add at least one field.';
  fields.forEach(({ field, type }, i) => {
    const problem = fieldProblem(field);
    if (problem !== null) errors[`field.${i}`] = problem;
    else if (seen.has(field)) errors[`field.${i}`] = `${field} is already in the key.`;
    else if (isWildcard(field) && type !== '1' && type !== '-1') {
      errors[`field.${i}`] = 'A wildcard field is ascending or descending.';
    }
    seen.add(field);
    keyFields.push({ key: field, value: keyValue(type) });
  });

  const types = fields.map((f) => f.type);
  const count = (t: KeyType) => types.filter((x) => x === t).length;
  const hasText = count('text') > 0;
  const hasWildcard = fields.some((f) => isWildcard(f.field));
  const special = (['2dsphere', '2d', 'hashed'] as const).filter((t) => count(t) > 0);
  if (errors.fields === undefined) {
    if (count('hashed') > 1) errors.fields = 'An index has at most one hashed field.';
    else if (count('2d') > 1) errors.fields = 'An index has at most one 2d field.';
    else if (hasText && special.length > 0) {
      errors.fields = `A text index cannot also have a ${special[0]} field.`;
    } else if (hasWildcard && (hasText || special.length > 0)) {
      errors.fields = 'A wildcard index has only ascending or descending fields.';
    } else if (fields.filter((f) => isWildcard(f.field)).length > 1) {
      errors.fields = 'An index has at most one wildcard field.';
    }
  }

  const options: BsonField[] = [];
  const name = draft.name.trim();
  if (name !== '') {
    if (name === '*') errors.name = 'The name * is reserved.';
    else options.push({ key: 'name', value: str(name) });
  }

  if (draft.unique) {
    if (count('hashed') > 0) errors.unique = 'A hashed index cannot be unique.';
    else if (hasWildcard) errors.unique = 'A wildcard index cannot be unique.';
    else options.push({ key: 'unique', value: bool(true) });
  }

  let partial: BsonDocument | null = null;
  try {
    partial = parseDoc(draft.partialFilter);
    if (partial !== null && partial.fields.length === 0) {
      errors.partialFilter = 'Enter a filter, or leave the field empty.';
    }
  } catch (e) {
    errors.partialFilter = (e as Error).message;
  }

  if (draft.sparse) {
    if (partial !== null) {
      errors.sparse = 'Use either sparse or a partial filter, not both.';
    } else options.push({ key: 'sparse', value: bool(true) });
  }
  if (draft.hidden) options.push({ key: 'hidden', value: bool(true) });

  const ttl = draft.ttl.trim();
  if (ttl !== '') {
    const seconds = Number(ttl);
    if (!/^\d+$/.test(ttl) || !Number.isSafeInteger(seconds) || seconds > INT32_MAX) {
      errors.ttl = 'Enter whole seconds (0 or more).';
    } else if (fields.length !== 1) {
      errors.ttl = 'A TTL index has exactly one field.';
    } else if (fields[0]?.field === '_id') {
      errors.ttl = 'The _id field cannot have a TTL.';
    } else if (types[0] !== '1' && types[0] !== '-1') {
      errors.ttl = 'A TTL field is ascending or descending (a date field).';
    } else if (hasWildcard) {
      errors.ttl = 'A wildcard index cannot have a TTL.';
    } else options.push({ key: 'expireAfterSeconds', value: int32(seconds) });
  }

  if (partial !== null && errors.partialFilter === undefined) {
    options.push({ key: 'partialFilterExpression', value: partial });
  }

  try {
    const collation = parseDoc(draft.collation);
    if (collation !== null) {
      const locale = collation.fields.find((f) => f.key === 'locale')?.value;
      if (locale?.type !== 'string' || locale.value === '') {
        errors.collation = 'A collation needs a locale, e.g. { locale: "en" }.';
      } else options.push({ key: 'collation', value: collation });
    }
  } catch (e) {
    errors.collation = (e as Error).message;
  }

  try {
    const weights = parseDoc(draft.weights);
    if (weights !== null) {
      if (!hasText) errors.weights = 'Weights apply to text indexes only.';
      else options.push({ key: 'weights', value: weights });
    }
  } catch (e) {
    errors.weights = (e as Error).message;
  }

  const language = draft.defaultLanguage.trim();
  if (language !== '') {
    if (!hasText) errors.defaultLanguage = 'The language applies to text indexes only.';
    else options.push({ key: 'default_language', value: str(language) });
  }

  try {
    const projection = parseDoc(draft.wildcardProjection);
    if (projection !== null) {
      if (!(fields.length >= 1 && fields.some((f) => f.field === '$**'))) {
        errors.wildcardProjection = 'A wildcard projection needs the field $**.';
      } else options.push({ key: 'wildcardProjection', value: projection });
    }
  } catch (e) {
    errors.wildcardProjection = (e as Error).message;
  }

  const keyDoc = doc(keyFields);
  const optionsDoc = doc(options);
  if (Object.keys(errors).length > 0) return { ok: false, errors, keyDoc, optionsDoc };
  const spec: IndexSpec = { key: stringifyEJson(keyDoc), keyDoc, optionsDoc };
  if (options.length > 0) spec.options = stringifyEJson(optionsDoc);
  return { ok: true, spec };
}

/** `db.coll.createIndex({ … }, { … })` for the preview. */
export function printCreateIndex(
  coll: string,
  keyDoc: BsonDocument,
  optionsDoc: BsonDocument,
): string {
  const key = printShellSyntax(keyDoc);
  const opts = optionsDoc.fields.length > 0 ? `, ${printShellSyntax(optionsDoc)}` : '';
  return `db.${coll}.createIndex(${key}${opts})`;
}
