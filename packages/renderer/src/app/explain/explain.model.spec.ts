import { describe, expect, it } from 'vitest';

import { type PlanNode, summarizeExplain, toPlain } from './explain.model';
import aggGroup from './fixtures/agg-group-8.2.json';
import aggIxscan from './fixtures/agg-ixscan-8.2.json';
import findCollscan from './fixtures/find-collscan-8.2.json';
import findIxscan from './fixtures/find-ixscan-8.2.json';

/** Stage names top-down, depth first. */
function stages(node: PlanNode): string[] {
  return [node.stage, ...node.children.flatMap(stages)];
}

describe('summarizeExplain (captured MongoDB 8.2 output)', () => {
  it('find without an index: COLLSCAN, no index, totals', () => {
    const s = summarizeExplain(JSON.stringify(findCollscan));
    expect(s.engine).toBe('classic');
    expect(s.collscan).toBe(true);
    expect(s.indexes).toEqual([]);
    expect(s.executed).toBe(true);
    expect(s.nReturned).toBe(1425);
    expect(s.docsExamined).toBe(2000);
    expect(s.keysExamined).toBe(0);
    expect(stages(s.root)).toContain('COLLSCAN');
    const scan = s.root.stage === 'COLLSCAN' ? s.root : s.root.children[0];
    expect(scan?.docsExamined).toBe(2000);
    expect(scan?.details.some((d) => d.label === 'filter')).toBe(true);
  });

  it('the same find with an index: FETCH over IXSCAN on status_1_n_1', () => {
    const s = summarizeExplain(JSON.stringify(findIxscan));
    expect(stages(s.root)).toEqual(['FETCH', 'IXSCAN']);
    expect(s.collscan).toBe(false);
    expect(s.indexes).toEqual(['status_1_n_1']);
    expect(s.keysExamined).toBe(1425);
    expect(s.docsExamined).toBe(1425);
    const ixscan = s.root.children[0];
    expect(ixscan?.indexName).toBe('status_1_n_1');
    expect(ixscan?.keysExamined).toBe(1425);
    expect(ixscan?.details.map((d) => d.label)).toEqual(expect.arrayContaining(['key', 'bounds']));
  });

  it('aggregate with $group pushed to SBE: chain of stages, numbers by planNodeId', () => {
    const s = summarizeExplain(JSON.stringify(aggGroup));
    expect(s.engine).toBe('sbe');
    expect(stages(s.root)).toEqual(['$sort', '$cursor', 'GROUP', 'COLLSCAN']);
    expect(s.root.nReturned).toBe(7);
    expect(s.nReturned).toBe(7);
    expect(s.docsExamined).toBe(2000);
    expect(s.collscan).toBe(true);
    const group = s.root.children[0]?.children[0];
    expect(group?.nReturned).toBe(7);
    // The scan's output: the outermost SBE stage of plan node 1 (the filter).
    expect(group?.children[0]?.nReturned).toBe(1500);
    expect(s.root.details[0]).toEqual({ label: 'spec', value: '{"sortKey":{"total":-1}}' });
  });

  it('aggregate answered by the query layer alone: classic tree with the index', () => {
    const s = summarizeExplain(aggIxscan);
    expect(stages(s.root)).toEqual(['LIMIT', 'PROJECTION_SIMPLE', 'FETCH', 'IXSCAN']);
    expect(s.indexes).toEqual(['status_1_n_1']);
    expect(s.nReturned).toBe(5);
  });
});

describe('summarizeExplain (other shapes)', () => {
  it('queryPlanner only: the winning plan without numbers', () => {
    const s = summarizeExplain({
      queryPlanner: { winningPlan: { stage: 'IDHACK' } },
    });
    expect(s.executed).toBe(false);
    expect(s.indexes).toEqual(['_id_']);
    expect(s.nReturned).toBeUndefined();
  });

  it('sharded find: SHARD_MERGE with one node per shard', () => {
    const s = summarizeExplain({
      queryPlanner: { winningPlan: { stage: 'SHARD_MERGE' } },
      executionStats: {
        nReturned: { $numberInt: '3' },
        executionStages: {
          stage: 'SHARD_MERGE',
          nReturned: 3,
          shards: [
            {
              shardName: 'rs0',
              nReturned: 2,
              totalDocsExamined: 10,
              executionStages: { stage: 'COLLSCAN', nReturned: 2, docsExamined: 10 },
            },
            {
              shardName: 'rs1',
              nReturned: 1,
              executionStages: { stage: 'IXSCAN', indexName: 'a_1', keysExamined: 1 },
            },
          ],
        },
      },
    });
    expect(stages(s.root)).toEqual(['SHARD_MERGE', 'shard rs0', 'COLLSCAN', 'shard rs1', 'IXSCAN']);
    expect(s.indexes).toEqual(['a_1']);
    expect(s.collscan).toBe(true);
  });

  it('sharded aggregate: one part per shard, totals summed', () => {
    const part = (n: number) => ({
      queryPlanner: { winningPlan: { stage: 'COLLSCAN' } },
      executionStats: {
        nReturned: n,
        totalDocsExamined: n * 2,
        totalKeysExamined: 0,
        executionTimeMillis: n,
        executionStages: { stage: 'COLLSCAN', nReturned: n, docsExamined: n * 2 },
      },
    });
    const s = summarizeExplain({ mergeType: 'mongos', shards: { a: part(2), b: part(3) } });
    expect(s.root.stage).toBe('merge shards');
    expect(s.root.children.map((c) => c.stage)).toEqual(['shard a', 'shard b']);
    expect(s.nReturned).toBe(5);
    expect(s.docsExamined).toBe(10);
    expect(s.timeMs).toBe(3);
  });

  it('refuses what is not an explain output', () => {
    expect(() => summarizeExplain('[1]')).toThrow(/not a document/);
    expect(() => summarizeExplain('{"ok":1}')).toThrow(/no query plan/);
    expect(() => summarizeExplain('{')).toThrow();
  });

  it('toPlain unwraps EJSON numbers and keeps other wrappers', () => {
    expect(
      toPlain({
        a: { $numberLong: '12' },
        b: { $numberDouble: 'NaN' },
        c: { $oid: 'x' },
        d: [{ $numberInt: '1' }],
      }),
    ).toEqual({ a: 12, b: 'NaN', c: { $oid: 'x' }, d: [1] });
  });
});
