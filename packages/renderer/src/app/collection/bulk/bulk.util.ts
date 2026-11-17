import type { BsonValue } from '@thicket/core/bson';
import { stringifyEJson } from '@thicket/core/bson';
import { parseShellSyntax } from '@thicket/core/shellsyntax';

import { shell } from '../../safety/operation';
import { TYPE_TO_CONFIRM_ABOVE } from '../../safety/safety.types';

/** What the bulk panel does to the documents of the current filter. */
export type BulkMode = 'update' | 'delete';

/** The collection a bulk write targets. */
export interface BulkTarget {
  profileId: string;
  db: string;
  coll: string;
}

/** The query bar's part a bulk write uses (canonical EJSON, as in `ParsedQuery`). */
export interface BulkQuery {
  filter: string;
  collation?: string;
}

export type UpdateParse = { ok: true; update: string } | { ok: false; error: string };

/**
 * Parses the update typed in shell syntax: an update document of operators only
 * (`{ $set: { … } }`) or an update pipeline (`[{ $set: … }, …]`). The canonical EJSON text is
 * what `docs.updateMany` sends. A document with a plain field would replace documents, which
 * `updateMany` refuses: it is reported here instead of by the server.
 */
export function parseUpdate(text: string): UpdateParse {
  if (text.trim() === '') {
    return { ok: false, error: 'Type an update, e.g. { $set: { status: "archived" } }' };
  }
  let value: BsonValue;
  try {
    value = parseShellSyntax(text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (value.type === 'object') {
    if (value.fields.length === 0) return { ok: false, error: 'The update document is empty' };
    const plain = value.fields.find((f) => !f.key.startsWith('$'));
    if (plain !== undefined) {
      return {
        ok: false,
        error: `"${plain.key}" is not an update operator: use { $set: { ${plain.key}: … } }`,
      };
    }
    return { ok: true, update: stringifyEJson(value) };
  }
  if (value.type === 'array') {
    if (value.items.length === 0) return { ok: false, error: 'The update pipeline is empty' };
    if (value.items.some((item) => item.type !== 'object')) {
      return { ok: false, error: 'Every stage of an update pipeline must be a document' };
    }
    return { ok: true, update: stringifyEJson(value) };
  }
  return { ok: false, error: 'Expected an update document ({ $set: … }) or a pipeline ([ … ])' };
}

/** Whether a bulk write of `count` documents asks for the collection name to be typed. */
export function needsTypedName(count: number): boolean {
  return count > TYPE_TO_CONFIRM_ABOVE;
}

/**
 * The call the panel runs, one line, as the head of the panel shows it:
 * `db.orders.updateMany({ status: "open" }, { $set: { … } })`.
 */
export function describeBulk(
  coll: string,
  mode: BulkMode,
  query: BulkQuery,
  update: string | null,
): string {
  const target = /^[A-Za-z_$][\w$]*$/.test(coll) ? `db.${coll}` : `db[${JSON.stringify(coll)}]`;
  const args = [shell(query.filter, 0)];
  if (mode === 'update') args.push(update === null ? '<update>' : shell(update, 0));
  if (query.collation !== undefined) args.push(`{ collation: ${shell(query.collation, 0)} }`);
  return `${target}.${mode === 'update' ? 'updateMany' : 'deleteMany'}(${args.join(', ')})`;
}
