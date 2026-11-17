import { type BsonDocument, parseEJsonDocument, stringifyEJson } from '@thicket/core/bson';
import {
  parseShellSyntaxDocument,
  positionAt,
  printShellSyntax,
  ShellSyntaxError,
} from '@thicket/core/shellsyntax';

/** Text format of the raw editor: mongosh shell syntax or canonical EJSON v2. */
export type RawFormat = 'shell' | 'ejson';

/** Why raw text could not be read, with the place to mark when it is known. */
export interface RawError {
  /** The reason, without the position. */
  readonly reason: string;
  /** 0-based offset into the text, or `null` when the error has no place (e.g. a changed `_id`). */
  readonly offset: number | null;
  /** 1-based line and column of `offset`. */
  readonly line: number | null;
  readonly column: number | null;
}

export type RawParse =
  | { readonly ok: true; readonly doc: BsonDocument }
  | { readonly ok: false; readonly error: RawError };

/** Indent of the raw editor's text. */
export const RAW_INDENT = 2;

/** `doc` as raw editor text in `format`. */
export function printRaw(doc: BsonDocument, format: RawFormat): string {
  return format === 'shell'
    ? printShellSyntax(doc, { indent: RAW_INDENT })
    : stringifyEJson(doc, RAW_INDENT);
}

// core's JSON reader (behind parseEJson) reports syntax errors as
// "Invalid JSON at position N: <reason>"; EJSON value errors (a bad `$oid`, …) have no position.
const JSON_POSITION = /^Invalid JSON at position (\d+): (.*)$/s;

/**
 * Reads raw editor text in `format` as a document. Never evaluates the text: shell syntax goes
 * through core's parser, EJSON through core's JSON reader.
 */
export function parseRaw(text: string, format: RawFormat): RawParse {
  try {
    const doc = format === 'shell' ? parseShellSyntaxDocument(text) : parseEJsonDocument(text);
    return { ok: true, doc };
  } catch (error) {
    return { ok: false, error: rawError(error, text) };
  }
}

/** A `RawError` without a place in the text. */
export function unplacedError(reason: string): RawError {
  return { reason, offset: null, line: null, column: null };
}

function rawError(error: unknown, text: string): RawError {
  if (error instanceof ShellSyntaxError) {
    return { reason: error.reason, offset: error.offset, line: error.line, column: error.column };
  }
  const message = error instanceof Error ? error.message : String(error);
  const json = JSON_POSITION.exec(message);
  if (json) {
    const { offset, line, column } = positionAt(text, Number(json[1]));
    return { reason: capitalize(json[2] ?? ''), offset, line, column };
  }
  return unplacedError(message);
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Expected '}' (line 3, column 7)", or the reason alone without a place. */
export function describeRawError(error: RawError): string {
  return error.line === null
    ? error.reason
    : `${error.reason} (line ${error.line}, column ${error.column})`;
}
