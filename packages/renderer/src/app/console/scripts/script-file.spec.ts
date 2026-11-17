import { describe, expect, it } from 'vitest';

import {
  MAX_SCRIPT_BYTES,
  readScriptFile,
  SCRIPT_ACCEPT,
  scriptFileProblem,
  type ScriptSource,
} from './script-file';

/** A chosen file with fictitious content. */
function file(name: string, text: string | (() => Promise<string>), size?: number): ScriptSource {
  return {
    name,
    size: size ?? (typeof text === 'string' ? new TextEncoder().encode(text).length : 0),
    text: typeof text === 'string' ? () => Promise.resolve(text) : text,
  };
}

describe('SCRIPT_ACCEPT', () => {
  it('offers .js and .mongodb files in the chooser', () => {
    expect(SCRIPT_ACCEPT).toBe('.js,.mongodb');
  });
});

describe('scriptFileProblem', () => {
  it('accepts .js and .mongodb files, whatever the case of the extension', () => {
    expect(scriptFileProblem({ name: 'seed.js', size: 10 })).toBeNull();
    expect(scriptFileProblem({ name: 'insert-three.mongodb', size: 10 })).toBeNull();
    expect(scriptFileProblem({ name: 'SEED.JS', size: 10 })).toBeNull();
    expect(scriptFileProblem({ name: 'Playground.MongoDB', size: 10 })).toBeNull();
  });

  it('refuses other files and names the file and the allowed kinds', () => {
    for (const name of ['notes.txt', 'data.json', 'seed.js.txt', 'seedjs', 'run.mongodbx', '']) {
      expect(scriptFileProblem({ name, size: 10 })).toBe(
        `${name} is not a script: choose a .js or .mongodb file`,
      );
    }
  });

  it('accepts a script of exactly the size limit and refuses one byte more', () => {
    expect(scriptFileProblem({ name: 'big.js', size: MAX_SCRIPT_BYTES })).toBeNull();
    expect(scriptFileProblem({ name: 'big.js', size: MAX_SCRIPT_BYTES + 1 })).toBe(
      'big.js is too large to run: it is larger than 5 MB',
    );
    expect(scriptFileProblem({ name: 'huge.mongodb', size: 12 * 1024 * 1024 })).toBe(
      'huge.mongodb is too large to run: it is larger than 5 MB',
    );
  });

  it('reports the wrong extension before the size', () => {
    expect(scriptFileProblem({ name: 'dump.bson', size: MAX_SCRIPT_BYTES * 2 })).toContain(
      'is not a script',
    );
  });

  it('allows an empty file through the check (reading it reports it as empty)', () => {
    expect(scriptFileProblem({ name: 'empty.js', size: 0 })).toBeNull();
  });
});

describe('readScriptFile', () => {
  it('returns the name, the text and the number of lines', async () => {
    const code = "db.items.insertOne({ a: 1 });\nprint('done');";
    expect(await readScriptFile(file('seed.js', code))).toEqual({
      name: 'seed.js',
      code,
      lines: 2,
    });
  });

  it('counts lines without the final line break, for \\n and \\r\\n', async () => {
    expect((await readScriptFile(file('a.js', 'x = 1'))).lines).toBe(1);
    expect((await readScriptFile(file('a.js', 'x = 1\n'))).lines).toBe(1);
    expect((await readScriptFile(file('a.js', 'x = 1\r\n'))).lines).toBe(1);
    expect((await readScriptFile(file('a.js', 'x = 1\r\ny = 2\r\nz = 3\r\n'))).lines).toBe(3);
    // Only one final break is dropped: a trailing blank line still counts.
    expect((await readScriptFile(file('a.js', 'x = 1\n\n'))).lines).toBe(2);
  });

  it('keeps the text as it is (no trimming), so line numbers in errors match the file', async () => {
    const code = '\n\n  x = 1  \n';
    expect((await readScriptFile(file('a.js', code))).code).toBe(code);
  });

  it('drops a UTF-8 byte order mark', async () => {
    const script = await readScriptFile(file('bom.js', '\uFEFFprint(1)'));
    expect(script.code).toBe('print(1)');
    expect(script.lines).toBe(1);
  });

  it('refuses a file that is not a script without reading it', async () => {
    let read = false;
    const source = file('photo.png', () => {
      read = true;
      return Promise.resolve('x');
    });
    await expect(readScriptFile(source)).rejects.toThrow(
      'photo.png is not a script: choose a .js or .mongodb file',
    );
    expect(read).toBe(false);
  });

  it('refuses a too large file without reading it', async () => {
    let read = false;
    const source = file(
      'big.js',
      () => {
        read = true;
        return Promise.resolve('x');
      },
      MAX_SCRIPT_BYTES + 1,
    );
    await expect(readScriptFile(source)).rejects.toThrow(/big\.js is too large to run/);
    expect(read).toBe(false);
  });

  it('reports a file that could not be read', async () => {
    const source = file('gone.js', () => Promise.reject(new DOMException('NotReadableError')));
    await expect(readScriptFile(source)).rejects.toThrow('gone.js could not be read');
  });

  it('refuses an empty, blank or BOM-only file', async () => {
    for (const text of ['', '   \n\t\r\n', '\uFEFF', '\uFEFF  \n']) {
      await expect(readScriptFile(file('empty.mongodb', text))).rejects.toThrow(
        'empty.mongodb is empty',
      );
    }
  });

  it('throws Error instances (the console shows their message)', async () => {
    const error = await readScriptFile(file('x.txt', 'y')).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
  });
});
