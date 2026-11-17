/**
 * Script files for the mongosh console (SPEC M4 "Run a script file in the shell"). The user picks
 * the file with the renderer's own file input, so no path ever crosses the bridge: the renderer
 * reads the text and the session evaluates it like typed input (`shell.eval`), in the session's
 * current database and with its variables.
 */

/** Extensions the file chooser offers (mongosh scripts and MongoDB playgrounds). */
export const SCRIPT_EXTENSIONS = ['.js', '.mongodb'] as const;

/** `accept` of the file input. */
export const SCRIPT_ACCEPT = SCRIPT_EXTENSIONS.join(',');

/** Largest script the console runs (the whole text travels in one `shell.eval` request). */
export const MAX_SCRIPT_BYTES = 5 * 1024 * 1024;

/** The limit in MB, as the "too large" message names it (exact, so a file just over it is clear). */
const MAX_SCRIPT_MB = MAX_SCRIPT_BYTES / (1024 * 1024);

/** A script read from a file, ready to evaluate. */
export interface ScriptFile {
  readonly name: string;
  readonly code: string;
  /** Lines of the script (for the transcript). */
  readonly lines: number;
}

/** The minimal `File` the reader needs (a `File` from an `<input type="file">`). */
export interface ScriptSource {
  readonly name: string;
  readonly size: number;
  text(): Promise<string>;
}

/** Why a chosen file is not run; `null` when it may be. */
export function scriptFileProblem(file: Pick<ScriptSource, 'name' | 'size'>): string | null {
  const name = file.name.toLowerCase();
  if (!SCRIPT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return `${file.name} is not a script: choose a .js or .mongodb file`;
  }
  if (file.size > MAX_SCRIPT_BYTES) {
    return `${file.name} is too large to run: it is larger than ${MAX_SCRIPT_MB} MB`;
  }
  return null;
}

/** Reads a chosen script; throws an `Error` with a user-facing message when it can't be run. */
export async function readScriptFile(file: ScriptSource): Promise<ScriptFile> {
  const problem = scriptFileProblem(file);
  if (problem !== null) throw new Error(problem);
  let code: string;
  try {
    code = await file.text();
  } catch {
    throw new Error(`${file.name} could not be read`);
  }
  // A UTF-8 byte order mark is not JavaScript.
  if (code.startsWith('\uFEFF')) code = code.slice(1);
  if (code.trim() === '') throw new Error(`${file.name} is empty`);
  return { name: file.name, code, lines: countLines(code) };
}

function countLines(code: string): number {
  const trimmed = code.replace(/\r?\n$/, '');
  return trimmed.split(/\r?\n/).length;
}
