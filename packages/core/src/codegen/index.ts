import { generateJava } from './java';
import type { CodegenLanguage, CodegenOptions, CodegenQuery } from './model';
import { generateNode } from './node';
import { generatePython } from './python';
import { generateShell } from './shell';

export {
  CODEGEN_LANGUAGES,
  CodegenError,
  DEFAULT_URI,
  type AggregateQuery,
  type CodegenLanguage,
  type CodegenOptions,
  type CodegenQuery,
  type FindQuery,
} from './model';

/**
 * Code for a find query or an aggregation pipeline: a mongosh statement, or a complete program
 * for the Node.js driver, PyMongo or the Java sync driver that prints each result as one line of
 * JSON. BSON values use each language's constructors (`NumberLong`, `Long`, `Int64`, `5L`, …) so
 * that the server receives the same types. Throws `CodegenError` for a query the language can't
 * express (an unknown collation option for Java, a negative limit).
 */
export function generateCode(
  query: CodegenQuery,
  language: CodegenLanguage,
  options: CodegenOptions = {},
): string {
  switch (language) {
    case 'shell':
      return generateShell(query);
    case 'node':
      return generateNode(query, options);
    case 'python':
      return generatePython(query, options);
    case 'java':
      return generateJava(query, options);
  }
}
