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
    // Its docs examined: the reads of the SBE `scan` stage of plan node 1.
    expect(group?.children[0]?.docsExamined).toBe(2000);
    expect(group?.children[0]?.keysExamined).toBeUndefined();
    expect(group?.docsExamined).toBeUndefined();
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

describe('summarizeExplain (edge cases)', () => {
  /** A classic find explain with execution stats around `executionStages`. */
  const executed = (executionStages: object, totals: object = {}) => ({
    explainVersion: '1',
    queryPlanner: { winningPlan: { stage: 'IGNORED' } },
    executionStats: { executionStages, ...totals },
  });

  it('toPlain: $numberDecimal and Infinity become numbers; null and undefined become null', () => {
    expect(
      toPlain({
        dec: { $numberDecimal: '1.5' },
        inf: { $numberDouble: 'Infinity' },
        nil: null,
        none: undefined,
        flag: true,
        // A wrapper key with a non-string value is not a number wrapper.
        odd: { $numberInt: 1 },
        // Two keys: not a wrapper.
        two: { $numberInt: '1', x: '2' },
      }),
    ).toEqual({
      dec: 1.5,
      inf: Infinity,
      nil: null,
      none: null,
      flag: true,
      odd: { $numberInt: 1 },
      two: { $numberInt: '1', x: '2' },
    });
  });

  it('an already parsed array or primitive is refused like the text', () => {
    expect(() => summarizeExplain([])).toThrow(/not a document/);
    expect(() => summarizeExplain('1')).toThrow(/not a document/);
    expect(() => summarizeExplain('null')).toThrow(/not a document/);
  });

  it('an aggregate with no usable stages has no query plan', () => {
    expect(() => summarizeExplain({ stages: [] })).toThrow(/no query plan/);
    expect(() => summarizeExplain({ stages: [{ nReturned: 1 }, 'x'] })).toThrow(/no query plan/);
    expect(() => summarizeExplain({ shards: {} })).toThrow(/no query plan/);
    expect(() => summarizeExplain({ shards: { a: 1, b: { ok: 1 } } })).toThrow(/no query plan/);
  });

  it('stats without a winning plan: the tree comes from executionStages', () => {
    const s = summarizeExplain({
      executionStats: {
        nReturned: 1,
        executionStages: { stage: 'COLLSCAN', nReturned: 1, docsExamined: 3 },
      },
    });
    expect(s.root.stage).toBe('COLLSCAN');
    expect(s.executed).toBe(true);
    expect(s.engine).toBe('classic');
  });

  it('classic stats win over the winning plan for the tree (numbers per stage)', () => {
    const s = summarizeExplain(
      executed(
        { stage: 'FETCH', nReturned: 2, inputStage: { stage: 'IXSCAN', indexName: 'a_1' } },
        { nReturned: 2, totalKeysExamined: 2, totalDocsExamined: 2, executionTimeMillis: 0 },
      ),
    );
    expect(s.root.stage).toBe('FETCH');
    expect(s.root.nReturned).toBe(2);
    expect(s.timeMs).toBe(0);
  });

  it('OR with inputStages: every index once, in plan order, plus a COLLSCAN', () => {
    const s = summarizeExplain(
      executed({
        stage: 'SUBPLAN',
        inputStage: {
          stage: 'OR',
          inputStages: [
            { stage: 'IXSCAN', indexName: 'b_1' },
            { stage: 'IXSCAN', indexName: 'a_1' },
            { stage: 'IXSCAN', indexName: 'b_1' },
            { stage: 'COLLSCAN' },
            'not a stage',
          ],
        },
      }),
    );
    expect(s.indexes).toEqual(['b_1', 'a_1']);
    expect(s.collscan).toBe(true);
    expect(s.root.children[0]?.children.map((c) => c.stage)).toEqual([
      'IXSCAN',
      'IXSCAN',
      'IXSCAN',
      'COLLSCAN',
    ]);
  });

  it('joins: outer and inner stages in order', () => {
    const s = summarizeExplain(
      executed({
        stage: 'EQ_LOOKUP',
        foreignCollection: 'shop.customers',
        localField: 'customer',
        foreignField: '_id',
        strategy: 'IndexedLoopJoin',
        outerStage: { stage: 'COLLSCAN' },
        innerStage: { stage: 'IXSCAN', indexName: '_id_' },
      }),
    );
    expect(s.root.children.map((c) => c.stage)).toEqual(['COLLSCAN', 'IXSCAN']);
    expect(s.root.details).toEqual([
      { label: 'from', value: 'shop.customers' },
      { label: 'local field', value: 'customer' },
      { label: 'foreign field', value: '_id' },
      { label: 'strategy', value: 'IndexedLoopJoin' },
    ]);
  });

  it('express and _id stages read the _id index', () => {
    for (const stage of ['IDHACK', 'EXPRESS_IXSCAN', 'EXPRESS_CLUSTERED_IXSCAN']) {
      expect(summarizeExplain(executed({ stage })).indexes).toEqual(['_id_']);
    }
    // A named index wins over the _id default.
    expect(
      summarizeExplain(executed({ stage: 'EXPRESS_IXSCAN', indexName: 'x_1' })).indexes,
    ).toEqual(['x_1']);
  });

  it('details: default direction and usedDisk false are left out, the rest is shown', () => {
    const forward = summarizeExplain(
      executed({ stage: 'IXSCAN', indexName: 'a_1', direction: 'forward', usedDisk: false }),
    );
    expect(forward.root.details).toEqual([]);
    const backward = summarizeExplain(
      executed({
        stage: 'SORT',
        direction: 'backward',
        sortPattern: { a: { $numberInt: '-1' } },
        memLimit: { $numberInt: '104857600' },
        limitAmount: 5,
        usedDisk: true,
      }),
    );
    expect(backward.root.details).toEqual([
      { label: 'direction', value: 'backward' },
      { label: 'sort', value: '{"a":-1}' },
      { label: 'limit', value: '5' },
      { label: 'memory limit', value: '104857600' },
      { label: 'used disk', value: 'true' },
    ]);
  });

  it('a stage without a name is shown as "?"', () => {
    expect(summarizeExplain(executed({ nReturned: 1 })).root.stage).toBe('?');
  });

  it('slot-based plan without execution stats: the queryPlan tree, not executed', () => {
    const s = summarizeExplain({
      explainVersion: '2',
      queryPlanner: {
        winningPlan: {
          queryPlan: {
            stage: 'FETCH',
            planNodeId: 2,
            inputStage: { stage: 'IXSCAN', planNodeId: 1, indexName: 'a_1' },
          },
          slotBasedPlan: { stages: '...' },
        },
      },
    });
    expect(s.engine).toBe('sbe');
    expect(s.executed).toBe(false);
    expect(s.root.stage).toBe('FETCH');
    expect(s.root.nReturned).toBeUndefined();
    expect(s.indexes).toEqual(['a_1']);
  });

  it('slot-based numbers: the outermost SBE stage of a planNodeId wins', () => {
    const s = summarizeExplain({
      explainVersion: '2',
      queryPlanner: {
        winningPlan: { queryPlan: { stage: 'COLLSCAN', planNodeId: 1 } },
      },
      executionStats: {
        nReturned: 4,
        executionStages: {
          stage: 'filter',
          planNodeId: 1,
          nReturned: 4,
          executionTimeMillisEstimate: 3,
          inputStage: { stage: 'scan', planNodeId: 1, nReturned: 10 },
        },
      },
    });
    expect(s.root.nReturned).toBe(4);
    expect(s.root.timeMs).toBe(3);
  });

  it('slot-based keys/docs examined: the reads of the index and fetch stages per planNodeId', () => {
    const s = summarizeExplain({
      explainVersion: '2',
      queryPlanner: {
        winningPlan: {
          queryPlan: {
            stage: 'FETCH',
            planNodeId: 2,
            docsExamined: 99,
            inputStage: { stage: 'IXSCAN', planNodeId: 1, indexName: 'a_1' },
          },
        },
      },
      executionStats: {
        nReturned: 5,
        totalKeysExamined: 6,
        totalDocsExamined: 5,
        executionStages: {
          stage: 'nlj',
          planNodeId: 2,
          nReturned: 5,
          outerStage: {
            stage: 'nlj',
            planNodeId: 1,
            nReturned: 5,
            outerStage: { stage: 'ixseek', planNodeId: 1, numReads: { $numberLong: '4' } },
            innerStage: { stage: 'ixscan_generic', planNodeId: 1, numReads: 2 },
          },
          innerStage: { stage: 'seek', planNodeId: 2, numReads: 5 },
        },
      },
    });
    const fetch = s.root;
    const ixscan = fetch.children[0];
    // A number on the plan stage itself wins over the SBE reads.
    expect(fetch.docsExamined).toBe(99);
    expect(fetch.keysExamined).toBeUndefined();
    // Reads of several index stages of the same node add up.
    expect(ixscan?.keysExamined).toBe(6);
    expect(ixscan?.docsExamined).toBeUndefined();
    expect(ixscan?.nReturned).toBe(5);
    // Totals still come from the execution stats.
    expect(s.keysExamined).toBe(6);
    expect(s.docsExamined).toBe(5);
  });

  it('slot-based fetch without a plan-stage number takes the seek reads', () => {
    const s = summarizeExplain({
      explainVersion: '2',
      queryPlanner: { winningPlan: { queryPlan: { stage: 'FETCH', planNodeId: 2 } } },
      executionStats: {
        executionStages: {
          stage: 'nlj',
          planNodeId: 2,
          innerStage: { stage: 'seek', planNodeId: 2, numReads: 7 },
          outerStage: { stage: 'scan', planNodeId: 3 },
        },
      },
    });
    expect(s.root.docsExamined).toBe(7);
  });

  it('slot-based ixscan reads are keys examined; zero reads stay 0, not missing', () => {
    const s = summarizeExplain({
      explainVersion: '2',
      queryPlanner: {
        winningPlan: {
          queryPlan: {
            stage: 'FETCH',
            planNodeId: 2,
            inputStage: { stage: 'IXSCAN', planNodeId: 1, indexName: 'sku_1' },
          },
        },
      },
      executionStats: {
        executionStages: {
          stage: 'nlj',
          planNodeId: 2,
          outerStage: { stage: 'ixscan', planNodeId: 1, numReads: 3 },
          innerStage: { stage: 'seek', planNodeId: 2, numReads: 0 },
        },
      },
    });
    expect(s.root.docsExamined).toBe(0);
    expect(s.root.children[0]?.keysExamined).toBe(3);
    expect(s.root.children[0]?.docsExamined).toBeUndefined();
  });

  it('slot-based: stages without numReads, or that are not scans, add no keys/docs examined', () => {
    const s = summarizeExplain({
      explainVersion: '2',
      queryPlanner: { winningPlan: { queryPlan: { stage: 'COLLSCAN', planNodeId: 1 } } },
      executionStats: {
        executionStages: {
          stage: 'filter',
          planNodeId: 1,
          numReads: 50,
          inputStage: { stage: 'scan', planNodeId: 1 },
        },
      },
    });
    expect(s.root.docsExamined).toBeUndefined();
    expect(s.root.keysExamined).toBeUndefined();
  });

  it('slot-based: a stage without planNodeId or name is passed through to the scans below', () => {
    const s = summarizeExplain({
      explainVersion: '2',
      queryPlanner: { winningPlan: { queryPlan: { stage: 'COLLSCAN', planNodeId: 1 } } },
      executionStats: {
        executionStages: {
          stage: 'limit',
          inputStage: {
            planNodeId: 1,
            numReads: 9,
            inputStage: { stage: 'scan', planNodeId: 1, numReads: 4 },
          },
        },
      },
    });
    expect(s.root.docsExamined).toBe(4);
  });

  it('pipeline stages: stats keys and false flags are not details; other keys are', () => {
    const s = summarizeExplain({
      stages: [
        {
          $cursor: {
            queryPlanner: { winningPlan: { stage: 'COLLSCAN' } },
          },
        },
        {
          $lookup: { from: 'customers', as: 'c' },
          totalDocsExamined: 5,
          usedDisk: false,
          nReturned: 3,
          executionTimeMillisEstimate: 1,
        },
      ],
    });
    expect(s.root.stage).toBe('$lookup');
    expect(s.root.details).toEqual([
      { label: 'spec', value: '{"from":"customers","as":"c"}' },
      { label: 'totalDocsExamined', value: '5' },
    ]);
    // The pipeline stage has numbers, the $cursor was only planned: not executed.
    expect(s.executed).toBe(false);
    expect(s.nReturned).toBe(3);
  });

  it('a pipeline without $cursor (e.g. $documents) is executed when its stages have numbers', () => {
    const s = summarizeExplain({
      stages: [
        { $documents: [{ a: 1 }], nReturned: 1 },
        { $project: { a: 1 }, nReturned: 1, executionTimeMillisEstimate: 2 },
      ],
    });
    expect(s.root.stage).toBe('$project');
    expect(s.root.children[0]?.stage).toBe('$documents');
    expect(s.executed).toBe(true);
    expect(s.timeMs).toBe(2);
    expect(s.indexes).toEqual([]);
    expect(s.collscan).toBe(false);
  });

  it('a $cursor that is not a query plan keeps the chain but has no children', () => {
    const s = summarizeExplain({ stages: [{ $cursor: { foo: 1 } }, { $count: 'n' }] });
    expect(s.root.children[0]?.stage).toBe('$cursor');
    expect(s.root.children[0]?.children).toEqual([]);
  });

  it('sharded aggregate: one shard only planned makes the whole plan not executed', () => {
    const s = summarizeExplain({
      shards: {
        a: {
          queryPlanner: { winningPlan: { stage: 'COLLSCAN' } },
          executionStats: { nReturned: 2, executionStages: { stage: 'COLLSCAN' } },
        },
        b: { queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } },
      },
    });
    expect(s.executed).toBe(false);
    expect(s.nReturned).toBe(2);
    expect(s.keysExamined).toBeUndefined();
    expect(s.root.details).toEqual([]);
  });

  it('sharded aggregate on the slot-based engine reports sbe', () => {
    const s = summarizeExplain({
      shards: {
        a: { queryPlanner: { winningPlan: { queryPlan: { stage: 'COLLSCAN' } } } },
      },
    });
    expect(s.engine).toBe('sbe');
  });

  it('sharded find: a shard without a plan is a leaf, a nameless shard is "?"', () => {
    const s = summarizeExplain(
      executed({
        stage: 'SHARD_MERGE',
        shards: [{ nReturned: 0 }, { shardName: 'rs1', winningPlan: { stage: 'EOF' } }],
      }),
    );
    expect(s.root.children.map((c) => c.stage)).toEqual(['shard ?', 'shard rs1']);
    expect(s.root.children[0]?.children).toEqual([]);
    expect(s.root.children[1]?.children[0]?.stage).toBe('EOF');
  });
});
