import { stringifyEJson } from '@thicket/core/bson';
import { describe, expect, it } from 'vitest';

import {
  parsePipeline,
  parseStage,
  printPipeline,
  type Stage,
  templateBody,
  writesOutput,
} from './pipeline.model';

const stage = (operator: string, body: string, enabled = true, id = 1): Stage => ({
  id,
  operator,
  body,
  enabled,
});

describe('pipeline model', () => {
  it('parses a stage into { operator: argument } with BSON types', () => {
    const parsed = parseStage(stage('$match', '{ at: ISODate("2026-01-01T00:00:00Z"), n: 5 }'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(stringifyEJson(parsed.stage)).toBe(
      '{"$match":{"at":{"$date":{"$numberLong":"1767225600000"}},"n":{"$numberInt":"5"}}}',
    );
    const limit = parseStage(stage('$limit', '10'));
    expect(limit.ok && stringifyEJson(limit.stage)).toBe('{"$limit":{"$numberInt":"10"}}');
  });

  it('reports syntax errors with line and column, and never evaluates', () => {
    const parsed = parseStage(stage('$match', '{\n  a: 1,\n  b: \n}'));
    expect(parsed).toMatchObject({ ok: false, error: { line: 4 } });
    const call = parseStage(stage('$match', '{ a: process.exit(1) }'));
    expect(call.ok).toBe(false);
    expect(parseStage(stage('match', '{}'))).toMatchObject({ ok: false });
    expect(parseStage(stage('$match', '  '))).toMatchObject({ ok: false });
  });

  it('prints and parses the full text, disabled stages as //- lines', () => {
    const stages = [
      stage('$match', '{ status: "open" }'),
      stage('$group', '{ _id: "$customer", n: { $sum: 1 } }', false),
      stage('$sort', '{ n: -1 }'),
    ];
    const text = printPipeline(stages);
    expect(text.split('\n').filter((l) => l.trimStart().startsWith('//-')).length).toBeGreaterThan(
      0,
    );
    const parsed = parsePipeline(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.stages.map((s) => [s.operator, s.enabled])).toEqual([
      ['$match', true],
      ['$group', false],
      ['$sort', true],
    ]);
    // Bodies round-trip to the same BSON.
    parsed.stages.forEach((s, i) => {
      const a = parseStage(s);
      const b = parseStage(stages[i] ?? s);
      expect(a.ok && b.ok && stringifyEJson(a.stage)).toBe(b.ok && stringifyEJson(b.stage));
    });
    expect(printPipeline([])).toBe('[]');
    expect(parsePipeline('[]')).toEqual({ ok: true, stages: [] });
  });

  it('a stage with an error is printed as typed', () => {
    const text = printPipeline([stage('$match', '{ a: ')]);
    expect(text).toContain('{ $match: { a:  }');
    expect(parsePipeline(text).ok).toBe(false);
  });

  it('refuses full text that is not an array of one-operator documents', () => {
    expect(parsePipeline('{ $match: {} }')).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('array') },
    });
    expect(parsePipeline('[{ $match: {}, $sort: {} }]')).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('Stage 1') },
    });
    expect(parsePipeline('[{ match: {} }]').ok).toBe(false);
    expect(parsePipeline('[1]').ok).toBe(false);
    expect(parsePipeline('[\n  { $match: {} },\n  { $limit: }\n]')).toMatchObject({
      ok: false,
      error: { line: 3 },
    });
  });

  it('knows templates and write stages', () => {
    expect(templateBody('$limit')).toBe('10');
    expect(templateBody('$unknownStage')).toBe('{}');
    const out = parseStage(stage('$out', '"x"'));
    const match = parseStage(stage('$match', '{}'));
    if (!out.ok || !match.ok) throw new Error('parse');
    expect(writesOutput([match.stage, out.stage])).toBe(true);
    expect(writesOutput([match.stage])).toBe(false);
  });
});
