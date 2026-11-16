import type { ParamsOf } from '@thicket/contract';
import { parseEJson } from '@thicket/core/bson';
import { printShellSyntax } from '@thicket/core/shellsyntax';

import type { WriteMethodName } from './safety.types';

/** Text of an EJSON param in mongosh shell syntax (the EJSON text itself when it does not parse). */
export function shell(ejson: string, indent = 2): string {
  try {
    return printShellSyntax(parseEJson(ejson), { indent });
  } catch {
    return ejson;
  }
}

/** A JavaScript string literal (double quotes), as mongosh prints names. */
function str(text: string): string {
  return JSON.stringify(text);
}

function coll(db: string, name: string): string {
  return `db.getSiblingDB(${str(db)}).getCollection(${str(name)})`;
}

function database(db: string): string {
  return `db.getSiblingDB(${str(db)})`;
}

/** `{ _id: <id>, ...expected }`: the filter a single-document write sends (conflict check). */
function idFilter(id: string, expected?: string): string {
  const idText = shell(id, 0);
  const extra = expected ? shell(expected, 0).replace(/^\{\s*|\s*\}$/g, '') : '';
  return extra ? `{ _id: ${idText}, ${extra} }` : `{ _id: ${idText} }`;
}

/** Joins call arguments; multi-line ones start on their own line. */
function call(target: string, fn: string, args: string[]): string {
  return `${target}.${fn}(${args.join(', ')})`;
}

/**
 * The exact operation a write request performs, in mongosh shell syntax, for the confirm dialog
 * (SPEC.md M1 "Safety": "confirm dialog for every write showing the operation"). EJSON params are
 * printed with `printShellSyntax`, so `ObjectId("…")`, `ISODate("…")` etc. appear as in the shell.
 */
export function describeWrite<M extends WriteMethodName>(method: M, params: ParamsOf<M>): string {
  // The switch narrows `method`, not `params`: each case reads its own method's params.
  const p = params as Record<string, unknown> & { db: string; coll: string };
  switch (method as WriteMethodName) {
    case 'docs.insert': {
      const docs = (p['docs'] as string[]).map((d) => shell(d));
      const ordered = p['ordered'] === false ? ', { ordered: false }' : '';
      return docs.length === 1
        ? call(coll(p.db, p.coll), 'insertOne', [docs[0] ?? '{}'])
        : `${coll(p.db, p.coll)}.insertMany([${docs.join(', ')}]${ordered})`;
    }
    case 'docs.update':
      return call(coll(p.db, p.coll), 'updateOne', [
        idFilter(p['id'] as string, p['expected'] as string),
        shell(p['update'] as string),
      ]);
    case 'docs.replace':
      return call(coll(p.db, p.coll), 'replaceOne', [
        idFilter(p['id'] as string, p['expected'] as string | undefined),
        shell(p['doc'] as string),
      ]);
    case 'docs.delete':
      return call(coll(p.db, p.coll), 'deleteOne', [
        idFilter(p['id'] as string, p['expected'] as string | undefined),
      ]);
    case 'docs.updateMany': {
      const args = [shell(p['filter'] as string), shell(p['update'] as string)];
      if (p['collation']) args.push(`{ collation: ${shell(p['collation'] as string, 0)} }`);
      return call(coll(p.db, p.coll), 'updateMany', args);
    }
    case 'docs.deleteMany': {
      const args = [shell(p['filter'] as string)];
      if (p['collation']) args.push(`{ collation: ${shell(p['collation'] as string, 0)} }`);
      return call(coll(p.db, p.coll), 'deleteMany', args);
    }
    case 'coll.create': {
      const args = [str(p.coll)];
      if (p['options']) args.push(shell(p['options'] as string));
      return call(database(p.db), 'createCollection', args);
    }
    case 'coll.drop':
      return call(coll(p.db, p.coll), 'drop', []);
    case 'coll.rename': {
      const args = [str(p['newName'] as string)];
      if (p['dropTarget']) args.push('true');
      return call(coll(p.db, p.coll), 'renameCollection', args);
    }
    case 'coll.validator.set': {
      const validator = p['validator'] === null ? '{}' : shell(p['validator'] as string);
      return call(database(p.db), 'runCommand', [
        `{\n  collMod: ${str(p.coll)},\n  validator: ${validator.replace(/\n/g, '\n  ')},\n` +
          `  validationLevel: ${str(p['validationLevel'] as string)},\n` +
          `  validationAction: ${str(p['validationAction'] as string)}\n}`,
      ]);
    }
    case 'db.create':
      return call(database(p.db), 'createCollection', [str(p['firstCollection'] as string)]);
    case 'db.drop':
      return call(database(p.db), 'dropDatabase', []);
    case 'idx.create': {
      const args = [shell(p['key'] as string, 0)];
      if (p['options']) args.push(shell(p['options'] as string));
      return call(coll(p.db, p.coll), 'createIndex', args);
    }
    case 'idx.drop':
      return call(coll(p.db, p.coll), 'dropIndex', [str(p['name'] as string)]);
    case 'idx.hide':
      return call(coll(p.db, p.coll), p['hidden'] ? 'hideIndex' : 'unhideIndex', [
        str(p['name'] as string),
      ]);
    case 'agg.run': {
      const args = [shell(p['pipeline'] as string)];
      const options: string[] = [];
      if (p['collation']) options.push(`collation: ${shell(p['collation'] as string, 0)}`);
      if (p['hint'] !== undefined) options.push(`hint: ${shell(p['hint'] as string, 0)}`);
      if (p['allowDiskUse'] !== undefined) {
        options.push(`allowDiskUse: ${String(p['allowDiskUse'])}`);
      }
      if (p['maxTimeMS'] !== undefined) options.push(`maxTimeMS: ${String(p['maxTimeMS'])}`);
      if (p['batchSize'] !== undefined) {
        options.push(`batchSize: ${String(p['batchSize'])}`);
      }
      if (options.length) args.push(`{ ${options.join(', ')} }`);
      return call(coll(p.db, p.coll), 'aggregate', args);
    }
    case 'agg.createView': {
      const args = [
        str(p['view'] as string),
        str(p['viewOn'] as string),
        shell(p['pipeline'] as string),
      ];
      if (p['collation']) args.push(`{ collation: ${shell(p['collation'] as string, 0)} }`);
      return call(database(p.db), 'createView', args);
    }
    case 'admin.killOp':
      return `db.killOp(${shell(p['opId'] as string, 0)})`;
    case 'io.import': {
      const options: string[] = [];
      if (p['ordered'] !== undefined) options.push(`ordered: ${String(p['ordered'])}`);
      if (p['stopOnError'] !== undefined) options.push(`stopOnError: ${String(p['stopOnError'])}`);
      const suffix = options.length ? `, { ${options.join(', ')} }` : '';
      return `// Import the chosen file\n${coll(p.db, p.coll)}.insertMany(<file documents>${suffix})`;
    }
    default:
      return `// ${method}\n${JSON.stringify(params, null, 2)}`;
  }
}
