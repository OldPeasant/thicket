import type { BsonDocument } from '../bson/model';

/** Target languages of the code export. */
export type CodegenLanguage = 'shell' | 'node' | 'python' | 'java';

export const CODEGEN_LANGUAGES: readonly CodegenLanguage[] = ['shell', 'node', 'python', 'java'];

/** A find query as the query bar holds it. Empty documents and zero skip/limit are left out. */
export interface FindQuery {
  readonly kind: 'find';
  readonly database: string;
  readonly collection: string;
  readonly filter: BsonDocument;
  readonly projection?: BsonDocument;
  readonly sort?: BsonDocument;
  readonly collation?: BsonDocument;
  readonly skip?: number;
  readonly limit?: number;
}

/** An aggregation pipeline (enabled stages only, in order). */
export interface AggregateQuery {
  readonly kind: 'aggregate';
  readonly database: string;
  readonly collection: string;
  readonly pipeline: readonly BsonDocument[];
}

export type CodegenQuery = FindQuery | AggregateQuery;

export interface CodegenOptions {
  /**
   * Connection string written into the Node, Python and Java programs. Default
   * `mongodb://localhost:27017`. Pass a string without credentials: it is copied verbatim.
   */
  readonly uri?: string;
}

export const DEFAULT_URI = 'mongodb://localhost:27017';

/** The query can't be written in the target language (e.g. an unknown collation option for Java). */
export class CodegenError extends Error {
  override readonly name = 'CodegenError';
}

/** The find options that are present (non-empty / non-zero), in a fixed order. */
export function findParts(q: FindQuery): {
  projection?: BsonDocument;
  sort?: BsonDocument;
  collation?: BsonDocument;
  skip?: number;
  limit?: number;
} {
  const nonEmpty = (d: BsonDocument | undefined): BsonDocument | undefined =>
    d && d.fields.length > 0 ? d : undefined;
  const count = (n: number | undefined, name: string): number | undefined => {
    if (n === undefined || n === 0) return undefined;
    if (!Number.isSafeInteger(n) || n < 0) {
      throw new CodegenError(`${name} must be a non-negative integer, got ${n}`);
    }
    return n;
  };
  const parts = {
    projection: nonEmpty(q.projection),
    sort: nonEmpty(q.sort),
    collation: nonEmpty(q.collation),
    skip: count(q.skip, 'skip'),
    limit: count(q.limit, 'limit'),
  };
  return Object.fromEntries(Object.entries(parts).filter(([, v]) => v !== undefined));
}
