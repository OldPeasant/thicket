import type { BsonValue } from '../bson/model';
import { printShellSyntax } from '../shellsyntax/print';
import { concat, layout, list, type Node } from './layout';
import { findParts, type CodegenQuery } from './model';

const BARE_KEY = /^[A-Za-z_$][\w$]*$/;
const q = (s: string): string => JSON.stringify(s);

/** An object literal key in JavaScript (mongosh and Node). */
export function jsKey(k: string): string {
  // `__proto__: v` (quoted or not) sets the prototype instead of creating a field.
  if (k === '__proto__') return `[${q(k)}]`;
  return BARE_KEY.test(k) ? k : q(k);
}

/** A value in mongosh syntax; scalars come from the shell-syntax printer (lossless round trip). */
export function shellValue(value: BsonValue): Node {
  switch (value.type) {
    case 'object':
      return list(
        '{',
        value.fields.map((f) => concat(jsKey(f.key), ': ', shellValue(f.value))),
        '}',
        true,
      );
    case 'array':
      return list('[', value.items.map(shellValue), ']');
    case 'javascriptWithScope':
      return list('Code(', [q(value.code), shellValue(value.scope)], ')');
    default:
      return printShellSyntax(value);
  }
}

/** `db.getSiblingDB(…).getCollection(…).find(…)…;` or `.aggregate([…]);` for mongosh. */
export function generateShell(query: CodegenQuery): string {
  const coll = `db.getSiblingDB(${q(query.database)}).getCollection(${q(query.collection)})`;
  let node: Node;
  if (query.kind === 'aggregate') {
    node = concat(coll, '.aggregate(', list('[', query.pipeline.map(shellValue), ']'), ')');
  } else {
    const p = findParts(query);
    const args = [shellValue(query.filter)];
    if (p.projection) args.push(shellValue(p.projection));
    const tail: Node[] = [];
    if (p.sort) tail.push(concat('.sort(', shellValue(p.sort), ')'));
    if (p.collation) tail.push(concat('.collation(', shellValue(p.collation), ')'));
    if (p.skip !== undefined) tail.push(`.skip(${p.skip})`);
    if (p.limit !== undefined) tail.push(`.limit(${p.limit})`);
    node = concat(coll, '.find', list('(', args, ')'), ...tail);
  }
  return `${layout(concat(node, ';'), '', '  ')}\n`;
}
