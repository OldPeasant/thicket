import { describe, expect, it } from 'vitest';
import { BSON_TYPES, type BsonType } from '../bson/model';
import { CODEGEN_LANGUAGES, generateCode } from './index';
import { CODEGEN_SAMPLES, typesIn } from './samples';

describe('generateCode samples', () => {
  it('cover every BSON type and both query kinds', () => {
    const types = new Set<BsonType>();
    for (const { query } of CODEGEN_SAMPLES) {
      const docs =
        query.kind === 'find'
          ? [query.filter, query.projection, query.sort, query.collation]
          : query.pipeline;
      docs.forEach((d) => d && typesIn(d, types));
    }
    expect(BSON_TYPES.filter((t) => !types.has(t))).toEqual([]);
    expect(CODEGEN_SAMPLES).toHaveLength(10);
    expect(new Set(CODEGEN_SAMPLES.map((s) => s.query.kind))).toEqual(
      new Set(['find', 'aggregate']),
    );
  });

  for (const language of CODEGEN_LANGUAGES) {
    describe(language, () => {
      for (const { name, query } of CODEGEN_SAMPLES) {
        it(name, () => {
          expect(generateCode(query, language)).toMatchSnapshot();
        });
      }
    });
  }
});
