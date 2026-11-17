import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// `ng test` runs from the workspace folder (packages/renderer).
const RENDERER = process.cwd();
const ROOT = resolve(RENDERER, '../..');
const ENTRY = join(RENDERER, 'src/app/raw-editor/index.ts');

/** Export conditions of a browser bundle, in the order esbuild (Angular's builder) tries them. */
const CONDITIONS = ['browser', 'import', 'module', 'default', 'require'];
const EXTENSIONS = ['', '.ts', '.mjs', '.js', '.cjs', '/index.ts', '/index.mjs', '/index.js'];

/** Code that runs text as JavaScript. */
const EVAL =
  /(?<![\w$.])eval\s*\(|\bnew\s+Function\s*\(|(?<![\w$.])Function\s*\(\s*['"`]|\b(?:setTimeout|setInterval)\s*\(\s*['"`]/;

/** Module specifiers a file loads at run time (`import type` is erased, so it doesn't count). */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const statement =
    /(?:^|[;\s}])(?:import|export)\s+(?!type\s)(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/gm;
  // Dynamic imports and CommonJS requires (esbuild bundles both).
  const dynamic = /(?<![\w$.])(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of [...source.matchAll(statement), ...source.matchAll(dynamic)]) {
    if (match[1] !== undefined) found.push(match[1]);
  }
  return found;
}

function file(path: string): string | null {
  for (const ext of EXTENSIONS) {
    const candidate = path + ext;
    // Workspace packages are symlinks in node_modules: name them by their real path.
    if (existsSync(candidate) && statSync(candidate).isFile()) return realpathSync(candidate);
  }
  return null;
}

function pick(target: unknown): string | null {
  if (typeof target === 'string') return target;
  if (target === null || typeof target !== 'object') return null;
  const map = target as Record<string, unknown>;
  for (const condition of CONDITIONS) {
    if (condition in map) {
      const picked = pick(map[condition]);
      if (picked !== null) return picked;
    }
  }
  return null;
}

/** The file a bare specifier (`@codemirror/view`, `@thicket/core/bson`) loads in the browser. */
function resolvePackage(specifier: string, from: string): string | null {
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? '');
  const subpath = '.' + specifier.slice(name.length);
  for (let dir = dirname(from); ; dir = dirname(dir)) {
    const pkgDir = join(dir, 'node_modules', name);
    if (existsSync(join(pkgDir, 'package.json'))) {
      const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as {
        exports?: unknown;
        module?: string;
        main?: string;
      };
      let target: string | null;
      if (pkg.exports !== undefined) {
        const exports = pkg.exports as Record<string, unknown>;
        const isMap = typeof exports === 'object' && Object.keys(exports)[0]?.startsWith('.');
        target = pick(isMap ? exports[subpath] : subpath === '.' ? exports : null);
      } else {
        target = subpath === '.' ? (pkg.module ?? pkg.main ?? 'index.js') : subpath;
      }
      return target === null ? null : file(join(pkgDir, target));
    }
    if (dir === dirname(dir)) return null;
  }
}

/** Every file the raw editor's entry loads at run time, followed through packages. */
function moduleGraph(entry: string): { files: Set<string>; unresolved: string[] } {
  const files = new Set<string>();
  const unresolved: string[] = [];
  const queue = [entry];
  for (let path = queue.pop(); path !== undefined; path = queue.pop()) {
    if (files.has(path)) continue;
    files.add(path);
    for (const specifier of specifiers(readFileSync(path, 'utf8'))) {
      const target = specifier.startsWith('.')
        ? file(resolve(dirname(path), specifier))
        : resolvePackage(specifier, path);
      if (target === null) unresolved.push(`${specifier} (from ${relative(ROOT, path)})`);
      else if (!files.has(target)) queue.push(target);
    }
  }
  return { files, unresolved };
}

// SPEC.md §6 / ARCHITECTURE "Conventions": shell syntax and EJSON are read by a parser, never
// evaluated. This follows every import of the raw editor (its own code, core's parsers, the BSON
// library, CodeMirror and Lezer) and fails on anything that runs text as code.
describe('raw editor bundle path', () => {
  const graph = moduleGraph(ENTRY);
  const names = [...graph.files].map((path) => relative(ROOT, path));

  it('resolves every import of the editor', () => {
    expect(graph.unresolved).toEqual([]);
    for (const expected of [
      'packages/renderer/src/app/raw-editor/raw-editor.ts',
      'packages/core/src/shellsyntax/syntax.ts',
      'packages/core/src/bson/ejson.ts',
      'node_modules/@codemirror/view/dist/index.js',
      'node_modules/@codemirror/state/dist/index.js',
      'node_modules/@codemirror/lang-javascript/dist/index.js',
      'node_modules/@lezer/lr/dist/index.js',
      'node_modules/bson/lib/bson.mjs',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it.each(names.map((name) => [name]))('%s has no eval or new Function', (name) => {
    const source = readFileSync(join(ROOT, name), 'utf8');
    expect(source.split('\n').filter((line) => EVAL.test(line))).toEqual([]);
  });

  it('would catch a package that compiles code (Ajv, used by the explorer, not the editor)', () => {
    const ajv = resolvePackage('ajv', join(RENDERER, 'src/main.ts'));
    if (ajv === null) throw new Error('ajv not found');
    const ajvGraph = moduleGraph(ajv);
    const hits = [...ajvGraph.files].filter((path) => EVAL.test(readFileSync(path, 'utf8')));
    expect(hits.length).toBeGreaterThan(0);
    expect(names.some((name) => name.includes('node_modules/ajv/'))).toBe(false);
  });

  it('the pattern flags the usual ways of running text as code', () => {
    for (const code of [
      'eval("1")',
      'x = eval (src)',
      'new Function("a", "return a")',
      'new  Function(body)',
      "Function('return this')()",
      'setTimeout("alert(1)", 0)',
      'setInterval(`x`, 5)',
    ]) {
      expect(EVAL.test(code), code).toBe(true);
    }
    for (const code of ['retrieval(x)', 'obj.eval(x)', 'isFunction(x)', 'setTimeout(fn, 0)']) {
      expect(EVAL.test(code), code).toBe(false);
    }
  });
});
