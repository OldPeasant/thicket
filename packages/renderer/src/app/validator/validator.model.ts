import { VALIDATION_ACTIONS, VALIDATION_LEVELS } from '@thicket/contract';
import { parseEJsonDocument, stringifyEJson } from '@thicket/core/bson';
import { parseShellSyntaxDocument, printShellSyntax } from '@thicket/core/shellsyntax';

export type ValidationLevel = (typeof VALIDATION_LEVELS)[number];
export type ValidationAction = (typeof VALIDATION_ACTIONS)[number];

/** What each level and action does, for the select's hints. */
export const LEVEL_HINTS: Record<ValidationLevel, string> = {
  strict: 'Check every insert and update',
  moderate: 'Check inserts and updates of documents that are valid already',
  off: 'Check nothing',
};
export const ACTION_HINTS: Record<ValidationAction, string> = {
  error: 'Refuse invalid writes',
  warn: 'Allow invalid writes and log a warning',
  errorAndLog: 'Refuse invalid writes and log them (MongoDB 8.1+)',
};

/** The validator as shell syntax for the editor ('' when there is none). */
export function validatorText(validator: string | null): string {
  if (validator === null) return '';
  try {
    return printShellSyntax(parseEJsonDocument(validator), { indent: 2 });
  } catch {
    return validator;
  }
}

/** A starting point for a collection without a validator. */
export const SCHEMA_TEMPLATE = `{
  $jsonSchema: {
    bsonType: "object",
    required: [],
    properties: {}
  }
}`;

export type ParsedValidator = { ok: true; validator: string | null } | { ok: false; error: string };

/**
 * Parses the editor text (shell syntax, core's parser, never `eval`) into the canonical EJSON
 * `coll.validator.set` sends. Empty text or `{}` removes the validator (`null`).
 */
export function parseValidatorText(text: string): ParsedValidator {
  if (text.trim() === '') return { ok: true, validator: null };
  try {
    const doc = parseShellSyntaxDocument(text);
    return { ok: true, validator: doc.fields.length === 0 ? null : stringifyEJson(doc) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
