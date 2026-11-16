import type { BsonDocument, BsonValue } from '../bson/model';
import { ShellSyntaxError } from './errors';
import { parseSyntax } from './syntax';
import { toBsonValue } from './value';

export { ShellSyntaxError, positionAt, type SourcePosition } from './errors';
export { printShellSyntax, type PrintOptions } from './print';

/**
 * Parses mongosh shell syntax (`{ _id: ObjectId("…"), at: ISODate("…"), n: NumberLong(5) }`,
 * unquoted keys, single quotes, regex literals, comments) into the BSON model. It never
 * evaluates anything: functions, `this`, operators, variables and calls other than the known
 * constructors are refused with a `ShellSyntaxError` carrying the line and column.
 */
export function parseShellSyntax(text: string): BsonValue {
  return toBsonValue(parseSyntax(text), text);
}

/** Parses shell syntax whose top level must be a document (a filter, projection, sort, …). */
export function parseShellSyntaxDocument(text: string): BsonDocument {
  const value = parseShellSyntax(text);
  if (value.type !== 'object') {
    const start = text.length - text.trimStart().length;
    throw new ShellSyntaxError('Expected a document ({ … })', text, start);
  }
  return value;
}
