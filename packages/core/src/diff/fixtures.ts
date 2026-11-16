/**
 * Edit cases shared by the diff unit tests and the integration test that applies the produced
 * update to a real server (`test/integration/diff-ops.int.spec.ts`). Documents are EJSON text
 * (relaxed EJSON is accepted: integers are Int32, other numbers Double). Avoid integer-like keys:
 * the driver deserializes into JS objects, which would reorder them.
 */
export interface DiffCase {
  name: string;
  original: string;
  edited: string;
  /** Expected update document, or `'replace'` / `'none'`. */
  update: string | 'replace' | 'none';
  /** Expected `expected` query fragment (omitted for `'none'`). */
  expected?: string;
  /**
   * The document after the update is applied, when it differs from `edited` (fields that did
   * not exist in the original are appended at the end of their parent by MongoDB).
   */
  applied?: string;
}

const ID = '{"$oid":"65a1b2c3d4e5f60718293a4b"}';

export const DIFF_CASES: DiffCase[] = [
  {
    name: 'nested set',
    original: `{"_id":${ID},"a":{"b":{"c":1,"x":true},"d":"x"},"z":1}`,
    edited: `{"_id":${ID},"a":{"b":{"c":2,"x":true},"d":"x"},"z":1}`,
    update: '{"$set":{"a.b.c":2}}',
    expected: '{"a":{"$eq":{"b":{"c":1,"x":true},"d":"x"}}}',
  },
  {
    name: 'top-level set',
    original: `{"_id":${ID},"total":10,"name":"n"}`,
    edited: `{"_id":${ID},"total":12,"name":"n"}`,
    update: '{"$set":{"total":12}}',
    expected: '{"total":{"$eq":10}}',
  },
  {
    name: 'top-level unset',
    original: `{"_id":${ID},"a":1,"b":2}`,
    edited: `{"_id":${ID},"b":2}`,
    update: '{"$unset":{"a":""}}',
    expected: '{"a":{"$eq":1}}',
  },
  {
    name: 'nested unset',
    original: `{"_id":${ID},"a":{"b":1,"c":2}}`,
    edited: `{"_id":${ID},"a":{"c":2}}`,
    update: '{"$unset":{"a.b":""}}',
    expected: '{"a":{"$eq":{"b":1,"c":2}}}',
  },
  {
    name: 'new top-level field',
    original: `{"_id":${ID},"a":1}`,
    edited: `{"_id":${ID},"a":1,"note":"hi"}`,
    update: '{"$set":{"note":"hi"}}',
    expected: '{"note":{"$exists":false}}',
  },
  {
    name: 'new nested field',
    original: `{"_id":${ID},"a":{"b":1}}`,
    edited: `{"_id":${ID},"a":{"b":1,"c":{"d":null}}}`,
    update: '{"$set":{"a.c":{"d":null}}}',
    expected: '{"a":{"$eq":{"b":1}}}',
  },
  {
    name: 'rename top-level (= unset + set)',
    original: `{"_id":${ID},"name":"x","n":1}`,
    edited: `{"_id":${ID},"title":"x","n":1}`,
    update: '{"$set":{"title":"x"},"$unset":{"name":""}}',
    expected: '{"name":{"$eq":"x"},"title":{"$exists":false}}',
    applied: `{"_id":${ID},"n":1,"title":"x"}`,
  },
  {
    name: 'rename nested (= unset + set)',
    original: `{"_id":${ID},"a":{"old":[1,2],"k":true}}`,
    edited: `{"_id":${ID},"a":{"k":true,"new":[1,2]}}`,
    update: '{"$set":{"a.new":[1,2]},"$unset":{"a.old":""}}',
    expected: '{"a":{"$eq":{"old":[1,2],"k":true}}}',
  },
  {
    name: 'type change int → string',
    original: `{"_id":${ID},"v":5}`,
    edited: `{"_id":${ID},"v":"5"}`,
    update: '{"$set":{"v":"5"}}',
    expected: '{"v":{"$eq":5}}',
  },
  {
    name: 'type change int → double (same numeric value)',
    original: `{"_id":${ID},"v":{"$numberInt":"5"}}`,
    edited: `{"_id":${ID},"v":{"$numberDouble":"5.0"}}`,
    update: '{"$set":{"v":{"$numberDouble":"5.0"}}}',
    expected: '{"v":{"$eq":5}}',
  },
  {
    name: 'type change document → array',
    original: `{"_id":${ID},"a":{"b":{"c":1}}}`,
    edited: `{"_id":${ID},"a":{"b":["c",1]}}`,
    update: '{"$set":{"a.b":["c",1]}}',
    expected: '{"a":{"$eq":{"b":{"c":1}}}}',
  },
  {
    name: 'type change string → document',
    original: `{"_id":${ID},"a":"text"}`,
    edited: `{"_id":${ID},"a":{"t":"text"}}`,
    update: '{"$set":{"a":{"t":"text"}}}',
    expected: '{"a":{"$eq":"text"}}',
  },
  {
    name: 'array append → $push',
    original: `{"_id":${ID},"tags":["a","b"]}`,
    edited: `{"_id":${ID},"tags":["a","b","c",{"d":1}]}`,
    update: '{"$push":{"tags":{"$each":["c",{"d":1}]}}}',
    expected: '{"tags":{"$eq":["a","b"]}}',
  },
  {
    name: 'nested array append to empty array → $push',
    original: `{"_id":${ID},"a":{"list":[]}}`,
    edited: `{"_id":${ID},"a":{"list":[1]}}`,
    update: '{"$push":{"a.list":{"$each":[1]}}}',
    expected: '{"a":{"$eq":{"list":[]}}}',
  },
  {
    name: 'array item change → replace array',
    original: `{"_id":${ID},"tags":["a","b","c"]}`,
    edited: `{"_id":${ID},"tags":["a","B","c"]}`,
    update: '{"$set":{"tags":["a","B","c"]}}',
    expected: '{"tags":{"$eq":["a","b","c"]}}',
  },
  {
    name: 'array item change and append → replace array',
    original: `{"_id":${ID},"tags":["a","b"]}`,
    edited: `{"_id":${ID},"tags":["x","b","c"]}`,
    update: '{"$set":{"tags":["x","b","c"]}}',
    expected: '{"tags":{"$eq":["a","b"]}}',
  },
  {
    name: 'array item removed → replace array',
    original: `{"_id":${ID},"tags":["a","b","c"]}`,
    edited: `{"_id":${ID},"tags":["a","b"]}`,
    update: '{"$set":{"tags":["a","b"]}}',
    expected: '{"tags":{"$eq":["a","b","c"]}}',
  },
  {
    name: 'array reorder → replace array',
    original: `{"_id":${ID},"tags":["a","b"]}`,
    edited: `{"_id":${ID},"tags":["b","a"]}`,
    update: '{"$set":{"tags":["b","a"]}}',
    expected: '{"tags":{"$eq":["a","b"]}}',
  },
  {
    name: 'field inside an array item changed → replace array',
    original: `{"_id":${ID},"items":[{"sku":"a","qty":1},{"sku":"b","qty":2}]}`,
    edited: `{"_id":${ID},"items":[{"sku":"a","qty":1},{"sku":"b","qty":3}]}`,
    update: '{"$set":{"items":[{"sku":"a","qty":1},{"sku":"b","qty":3}]}}',
    expected: '{"items":{"$eq":[{"sku":"a","qty":1},{"sku":"b","qty":2}]}}',
  },
  {
    name: 'field reorder only → replace parent document',
    original: `{"_id":${ID},"a":{"x":1,"y":2,"z":3},"b":1}`,
    edited: `{"_id":${ID},"a":{"y":2,"x":1,"z":3},"b":1}`,
    update: '{"$set":{"a":{"y":2,"x":1,"z":3}}}',
    expected: '{"a":{"$eq":{"x":1,"y":2,"z":3}}}',
  },
  {
    name: 'deep field reorder → replace only the reordered document',
    original: `{"_id":${ID},"a":{"b":{"x":1,"y":2},"c":1}}`,
    edited: `{"_id":${ID},"a":{"b":{"y":2,"x":1},"c":1}}`,
    update: '{"$set":{"a.b":{"y":2,"x":1}}}',
    expected: '{"a":{"$eq":{"b":{"x":1,"y":2},"c":1}}}',
  },
  {
    name: 'reorder plus a change inside → replace parent document',
    original: `{"_id":${ID},"a":{"x":1,"y":2}}`,
    edited: `{"_id":${ID},"a":{"y":3,"x":1}}`,
    update: '{"$set":{"a":{"y":3,"x":1}}}',
    expected: '{"a":{"$eq":{"x":1,"y":2}}}',
  },
  {
    name: 'top-level field reorder → replace document',
    original: `{"_id":${ID},"a":1,"b":2}`,
    edited: `{"_id":${ID},"b":2,"a":1}`,
    update: 'replace',
    expected: '{"a":{"$eq":1},"b":{"$eq":2}}',
  },
  {
    name: 'several changes in one update',
    original: `{"_id":${ID},"total":1,"meta":{"by":"me","at":1},"tags":["a"],"gone":true}`,
    edited: `{"_id":${ID},"total":2,"meta":{"by":"you","at":1},"tags":["a","b"],"added":1}`,
    update:
      '{"$set":{"total":2,"meta.by":"you","added":1},"$unset":{"gone":""},"$push":{"tags":{"$each":["b"]}}}',
    expected:
      '{"total":{"$eq":1},"meta":{"$eq":{"by":"me","at":1}},"tags":{"$eq":["a"]},"gone":{"$eq":true},"added":{"$exists":false}}',
  },
  {
    name: 'double -0 → 0 is a change',
    original: `{"_id":${ID},"d":{"$numberDouble":"-0.0"}}`,
    edited: `{"_id":${ID},"d":{"$numberDouble":"0.0"}}`,
    update: '{"$set":{"d":{"$numberDouble":"0.0"}}}',
    expected: '{"d":{"$eq":{"$numberDouble":"-0.0"}}}',
  },
  {
    name: 'value with a regex, date and long',
    original: `{"_id":${ID},"r":{"$regularExpression":{"pattern":"^a","options":"i"}},"t":{"$date":{"$numberLong":"0"}}}`,
    edited: `{"_id":${ID},"r":{"$regularExpression":{"pattern":"^b","options":"i"}},"t":{"$date":{"$numberLong":"1000"}},"n":{"$numberLong":"9007199254740993"}}`,
    update:
      '{"$set":{"r":{"$regularExpression":{"pattern":"^b","options":"i"}},"t":{"$date":{"$numberLong":"1000"}},"n":{"$numberLong":"9007199254740993"}}}',
    expected:
      '{"r":{"$eq":{"$regularExpression":{"pattern":"^a","options":"i"}}},"t":{"$eq":{"$date":{"$numberLong":"0"}}},"n":{"$exists":false}}',
  },
  {
    name: 'changed nested key with a dot → replace parent document',
    original: `{"_id":${ID},"a":{"x.y":1,"k":2}}`,
    edited: `{"_id":${ID},"a":{"x.y":5,"k":2}}`,
    update: '{"$set":{"a":{"x.y":5,"k":2}}}',
    expected: '{"a":{"$eq":{"x.y":1,"k":2}}}',
  },
  {
    name: 'unchanged nested key with a dot does not matter',
    original: `{"_id":${ID},"a":{"x.y":1,"k":2}}`,
    edited: `{"_id":${ID},"a":{"x.y":1,"k":3}}`,
    update: '{"$set":{"a.k":3}}',
    expected: '{"a":{"$eq":{"x.y":1,"k":2}}}',
  },
  {
    name: 'changed top-level key with a dot → replace document, $expr check',
    original: `{"_id":${ID},"a.b":1,"c":1}`,
    edited: `{"_id":${ID},"a.b":2,"c":1}`,
    update: 'replace',
    expected:
      '{"$expr":{"$eq":[{"$getField":{"field":{"$literal":"a.b"},"input":"$$ROOT"}},{"$literal":1}]}}',
  },
  {
    name: 'two changed top-level keys with dots → replace document, $expr checks',
    original: `{"_id":${ID},"a.b":1,"c":1}`,
    edited: `{"_id":${ID},"a.b":3,"c":2,"x.y":1}`,
    update: 'replace',
    expected:
      '{"c":{"$eq":1},"$expr":{"$and":[' +
      '{"$eq":[{"$getField":{"field":{"$literal":"a.b"},"input":"$$ROOT"}},{"$literal":1}]},' +
      '{"$eq":[{"$type":{"$getField":{"field":{"$literal":"x.y"},"input":"$$ROOT"}}},"missing"]}]}}',
  },
  {
    name: 'new nested key with $ prefix → replace parent document',
    original: `{"_id":${ID},"a":{"k":1}}`,
    edited: `{"_id":${ID},"a":{"k":1,"$x":1}}`,
    update: '{"$set":{"a":{"k":1,"$x":1}}}',
    expected: '{"a":{"$eq":{"k":1}}}',
  },
  {
    name: 'nested document with $ prefixed keys in the conflict filter',
    original: `{"_id":${ID},"a":{"$x":1,"k":1}}`,
    edited: `{"_id":${ID},"a":{"$x":1,"k":2}}`,
    update: '{"$set":{"a.k":2}}',
    expected: '{"a":{"$eq":{"$x":1,"k":1}}}',
  },
  // --- Edge cases added by the test-writer -----------------------------------------------------
  {
    name: 'null → value (top-level)',
    original: `{"_id":${ID},"a":null,"b":1}`,
    edited: `{"_id":${ID},"a":"set","b":1}`,
    update: '{"$set":{"a":"set"}}',
    expected: '{"a":{"$eq":null}}',
  },
  {
    name: 'value → null is a set, not an unset',
    original: `{"_id":${ID},"a":{"b":1,"c":2}}`,
    edited: `{"_id":${ID},"a":{"b":null,"c":2}}`,
    update: '{"$set":{"a.b":null}}',
    expected: '{"a":{"$eq":{"b":1,"c":2}}}',
  },
  {
    name: 'empty nested document gets a field',
    original: `{"_id":${ID},"a":{}}`,
    edited: `{"_id":${ID},"a":{"b":1}}`,
    update: '{"$set":{"a.b":1}}',
    expected: '{"a":{"$eq":{}}}',
  },
  {
    name: 'last field of a nested document removed leaves an empty document',
    original: `{"_id":${ID},"a":{"b":1}}`,
    edited: `{"_id":${ID},"a":{}}`,
    update: '{"$unset":{"a.b":""}}',
    expected: '{"a":{"$eq":{"b":1}}}',
  },
  {
    name: 'array emptied → replace array',
    original: `{"_id":${ID},"l":[1,2]}`,
    edited: `{"_id":${ID},"l":[]}`,
    update: '{"$set":{"l":[]}}',
    expected: '{"l":{"$eq":[1,2]}}',
  },
  {
    name: 'append of an item equal to the last one → $push',
    original: `{"_id":${ID},"l":[1]}`,
    edited: `{"_id":${ID},"l":[1,1]}`,
    update: '{"$push":{"l":{"$each":[1]}}}',
    expected: '{"l":{"$eq":[1]}}',
  },
  {
    name: 'append of a nested array is pushed as one item',
    original: `{"_id":${ID},"m":[[1]]}`,
    edited: `{"_id":${ID},"m":[[1],[2,3]]}`,
    update: '{"$push":{"m":{"$each":[[2,3]]}}}',
    expected: '{"m":{"$eq":[[1]]}}',
  },
  {
    name: 'array → document of the same content is a type change',
    original: `{"_id":${ID},"a":[]}`,
    edited: `{"_id":${ID},"a":{}}`,
    update: '{"$set":{"a":{}}}',
    expected: '{"a":{"$eq":[]}}',
  },
  {
    name: 'decimal, binary and timestamp changes',
    original: `{"_id":${ID},"p":{"$numberDecimal":"1.10"},"bin":{"$binary":{"base64":"AQI=","subType":"00"}},"ts":{"$timestamp":{"t":1,"i":1}}}`,
    edited: `{"_id":${ID},"p":{"$numberDecimal":"1.1"},"bin":{"$binary":{"base64":"AQM=","subType":"00"}},"ts":{"$timestamp":{"t":1,"i":2}}}`,
    update:
      '{"$set":{"p":{"$numberDecimal":"1.1"},"bin":{"$binary":{"base64":"AQM=","subType":"00"}},"ts":{"$timestamp":{"t":1,"i":2}}}}',
    expected:
      '{"p":{"$eq":{"$numberDecimal":"1.10"}},"bin":{"$eq":{"$binary":{"base64":"AQI=","subType":"00"}}},"ts":{"$eq":{"$timestamp":{"t":1,"i":1}}}}',
  },
  {
    name: 'nested reorder plus a new sibling field and an unset elsewhere',
    original: `{"_id":${ID},"a":{"b":{"x":1,"y":2},"c":1},"d":true}`,
    edited: `{"_id":${ID},"a":{"b":{"y":2,"x":1},"c":1,"n":"new"}}`,
    update: '{"$set":{"a.b":{"y":2,"x":1},"a.n":"new"},"$unset":{"d":""}}',
    expected: '{"a":{"$eq":{"b":{"x":1,"y":2},"c":1}},"d":{"$eq":true}}',
  },
  {
    name: 'top-level reorder plus a value change → replace, filter checks only the changed field',
    original: `{"_id":${ID},"a":1,"b":2}`,
    edited: `{"_id":${ID},"b":3,"a":1}`,
    update: 'replace',
    expected: '{"b":{"$eq":2}}',
  },
  {
    name: 'new nested empty key → replace parent document',
    original: `{"_id":${ID},"a":{"k":1}}`,
    edited: `{"_id":${ID},"a":{"k":1,"":2}}`,
    update: '{"$set":{"a":{"k":1,"":2}}}',
    expected: '{"a":{"$eq":{"k":1}}}',
  },
  {
    name: 'changed top-level empty key → replace document, $expr check',
    original: `{"_id":${ID},"":1,"c":1}`,
    edited: `{"_id":${ID},"":2,"c":1}`,
    update: 'replace',
    expected:
      '{"$expr":{"$eq":[{"$getField":{"field":{"$literal":""},"input":"$$ROOT"}},{"$literal":1}]}}',
  },
  {
    name: 'removed top-level $-prefixed key → replace document, $expr check',
    original: `{"_id":${ID},"$k":{"x":1},"c":1}`,
    edited: `{"_id":${ID},"c":1}`,
    update: 'replace',
    expected:
      '{"$expr":{"$eq":[{"$getField":{"field":{"$literal":"$k"},"input":"$$ROOT"}},{"$literal":{"x":1}}]}}',
  },
  {
    name: 'top-level reorder in a document that keeps a $-prefixed key → replace',
    original: `{"_id":${ID},"$k":1,"a":1,"b":2}`,
    edited: `{"_id":${ID},"$k":1,"b":2,"a":1}`,
    update: 'replace',
    // A pure reorder checks every original field, the `$k` one through `$expr`.
    expected:
      '{"a":{"$eq":1},"b":{"$eq":2},' +
      '"$expr":{"$eq":[{"$getField":{"field":{"$literal":"$k"},"input":"$$ROOT"}},{"$literal":1}]}}',
  },
  {
    name: 'no change',
    original: `{"_id":${ID},"a":{"b":[1,{"c":2}]}}`,
    edited: `{"_id":${ID},"a":{"b":[1,{"c":2}]}}`,
    update: 'none',
  },
];
