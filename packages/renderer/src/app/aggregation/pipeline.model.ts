import type { BsonDocument, BsonValue } from '@thicket/core/bson';
import { parseShellSyntax, printShellSyntax, ShellSyntaxError } from '@thicket/core/shellsyntax';

/** One stage of the builder: its operator (`$match`) and its argument as shell-syntax text. */
export interface Stage {
  /** Stable id for the list (survives reordering). */
  readonly id: number;
  readonly operator: string;
  readonly body: string;
  readonly enabled: boolean;
}

/** Where a parse error is, for marking it in the text (1-based line/column). */
export interface StageError {
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

export type StageParse =
  | { readonly ok: true; readonly stage: BsonDocument }
  | { readonly ok: false; readonly error: StageError };

/** Stage operators offered in the picker, with a starting argument each. */
export const STAGE_TEMPLATES: readonly { readonly operator: string; readonly body: string }[] = [
  { operator: '$match', body: '{}' },
  { operator: '$group', body: '{ _id: "$field", count: { $sum: 1 } }' },
  { operator: '$sort', body: '{ _id: 1 }' },
  { operator: '$project', body: '{ _id: 1 }' },
  { operator: '$addFields', body: '{}' },
  { operator: '$set', body: '{}' },
  { operator: '$unset', body: '"field"' },
  { operator: '$limit', body: '10' },
  { operator: '$skip', body: '0' },
  { operator: '$unwind', body: '"$field"' },
  { operator: '$lookup', body: '{ from: "", localField: "", foreignField: "", as: "" }' },
  { operator: '$count', body: '"count"' },
  { operator: '$facet', body: '{}' },
  { operator: '$bucket', body: '{ groupBy: "$field", boundaries: [0, 100], default: "other" }' },
  { operator: '$sample', body: '{ size: 10 }' },
  { operator: '$replaceRoot', body: '{ newRoot: "$field" }' },
  { operator: '$sortByCount', body: '"$field"' },
  { operator: '$out', body: '"collection"' },
  { operator: '$merge', body: '{ into: "collection" }' },
];

/** Stages that write their output (they need the write guard and end the pipeline). */
export const WRITE_STAGES: readonly string[] = ['$out', '$merge'];

/** The starting argument of a new stage with `operator`. */
export function templateBody(operator: string): string {
  return STAGE_TEMPLATES.find((t) => t.operator === operator)?.body ?? '{}';
}

const OPERATOR = /^\$[A-Za-z][A-Za-z0-9]*$/;

/** Parses one stage: `{ [operator]: body }`. Never evaluates the text. */
export function parseStage(stage: Pick<Stage, 'operator' | 'body'>): StageParse {
  const operator = stage.operator.trim();
  if (!OPERATOR.test(operator)) {
    return { ok: false, error: { message: `"${operator}" is not a stage operator ($name)` } };
  }
  if (stage.body.trim() === '') {
    return { ok: false, error: { message: `${operator} needs an argument` } };
  }
  try {
    const value = parseShellSyntax(stage.body);
    return { ok: true, stage: { type: 'object', fields: [{ key: operator, value }] } };
  } catch (e) {
    return { ok: false, error: toStageError(e) };
  }
}

function toStageError(e: unknown): StageError {
  if (e instanceof ShellSyntaxError) {
    return { message: e.message, line: e.line, column: e.column };
  }
  return { message: e instanceof Error ? e.message : String(e) };
}

/** The operator of a parsed stage document (its only key). */
export function operatorOf(stage: BsonDocument): string {
  return stage.fields[0]?.key ?? '';
}

/** Whether a pipeline writes ($out/$merge anywhere). */
export function writesOutput(pipeline: readonly BsonDocument[]): boolean {
  return pipeline.some((s) => WRITE_STAGES.includes(operatorOf(s)));
}

/** The builder's stage for a stage document (its argument printed in shell syntax). */
export function stageFromDocument(doc: BsonDocument, id: number, enabled = true): Stage {
  const field = doc.fields[0];
  return {
    id,
    operator: field?.key ?? '',
    body: field ? printShellSyntax(field.value, { indent: 2 }) : '{}',
    enabled,
  };
}

/** Line prefix of a disabled stage in the full-text mode (a comment for the parser). */
export const DISABLED_PREFIX = '//- ';

/**
 * The whole pipeline as one shell-syntax array, for the full-text mode. A disabled stage is
 * kept as comment lines starting with `//- `, so it survives a round trip through the text and
 * comes back disabled.
 */
export function printPipeline(stages: readonly Stage[]): string {
  if (stages.length === 0) return '[]';
  const lines: string[] = ['['];
  for (const stage of stages) {
    const parsed = parseStage(stage);
    const text = parsed.ok
      ? printShellSyntax(parsed.stage, { indent: 2 })
      : `{ ${stage.operator}: ${stage.body} }`;
    const indented = `${text},`.split('\n').map((line) => `  ${line}`);
    lines.push(
      ...(stage.enabled
        ? indented
        : indented.map((line) => `  ${DISABLED_PREFIX}${line.slice(2)}`)),
    );
  }
  lines.push(']');
  return lines.join('\n');
}

/** A marker key for a disabled stage while the full text is parsed (not a valid operator name). */
const DISABLED_KEY = '$thicket disabled';

/**
 * Turns runs of `//- ` lines into `{ "$thicket disabled": <stage> },` so the parser sees them.
 * Line breaks are kept, so error lines still point at the user's text.
 */
function uncommentDisabled(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let i = 0;
  const prefix = /^(\s*)\/\/- ?(.*)$/;
  while (i < lines.length) {
    const match = prefix.exec(lines[i] ?? '');
    if (!match) {
      out.push(lines[i] ?? '');
      i++;
      continue;
    }
    const run: string[] = [];
    while (i < lines.length) {
      const m = prefix.exec(lines[i] ?? '');
      if (!m) break;
      run.push(`${m[1] ?? ''}${m[2] ?? ''}`);
      i++;
    }
    const last = run.length - 1;
    run[last] = (run[last] ?? '').replace(/,\s*$/, '');
    run[0] = `{ ${JSON.stringify(DISABLED_KEY)}: ${run[0] ?? ''}`;
    run[last] = `${run[last] ?? ''} },`;
    out.push(...run);
  }
  return out.join('\n');
}

export type PipelineParse =
  | { readonly ok: true; readonly stages: readonly Omit<Stage, 'id'>[] }
  | { readonly ok: false; readonly error: StageError };

/** Parses the full-text mode: an array of stage documents (disabled ones as `//- ` lines). */
export function parsePipeline(text: string): PipelineParse {
  let value: BsonValue;
  try {
    value = parseShellSyntax(uncommentDisabled(text));
  } catch (e) {
    return { ok: false, error: toStageError(e) };
  }
  if (value.type !== 'array') {
    return { ok: false, error: { message: 'The pipeline must be an array of stages ([ … ])' } };
  }
  const stages: Omit<Stage, 'id'>[] = [];
  for (const [index, item] of value.items.entries()) {
    let doc: BsonValue = item;
    let enabled = true;
    if (doc.type === 'object' && doc.fields.length === 1 && doc.fields[0]?.key === DISABLED_KEY) {
      doc = doc.fields[0].value;
      enabled = false;
    }
    if (doc.type !== 'object' || doc.fields.length !== 1 || !OPERATOR.test(operatorOf(doc))) {
      return {
        ok: false,
        error: {
          message: `Stage ${index + 1} must be a document with one operator ({ $name: … })`,
        },
      };
    }
    const { operator, body } = stageFromDocument(doc, 0, enabled);
    stages.push({ operator, body, enabled });
  }
  return { ok: true, stages };
}
