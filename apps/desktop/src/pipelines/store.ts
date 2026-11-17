import {
  savedPipeline as savedPipelineSchema,
  type SavedPipeline,
  type SavedStage,
} from '@thicket/contract';
import { randomUUID } from 'node:crypto';
import * as nodeFs from 'node:fs/promises';

/** Version of the `pipelines.json` layout; bump it and add a step to `load` when it changes. */
export const PIPELINES_VERSION = 1;

/** The file operations the store needs; injectable so tests can simulate failures and crashes. */
export interface PipelinesFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  /** Must not return before the data is on disk (`flush`). */
  writeFile(path: string, data: string, options: { flush: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface PipelinesStoreOptions {
  /** Path of `pipelines.json` (in `userData`). */
  file: string;
  fs?: PipelinesFs;
  log?: (message: string) => void;
  /** Clock for `updatedAt` and the backup file name of a corrupt file. */
  now?: () => Date;
  /** Id generator for new pipelines. */
  newId?: () => string;
}

/** The collection a pipeline belongs to. */
export interface PipelineNamespace {
  profileId: string;
  db: string;
  coll: string;
}

/** The saved pipeline does not exist. */
export class PipelineNotFoundError extends Error {
  constructor(readonly pipelineId: string) {
    super(`No saved pipeline with id ${pipelineId}`);
    this.name = 'PipelineNotFoundError';
  }
}

/** Another pipeline of the same collection already has the name. */
export class PipelineNameTakenError extends Error {
  constructor(name: string) {
    super(`A saved pipeline named "${name}" already exists for this collection`);
    this.name = 'PipelineNameTakenError';
  }
}

/** `pipelines.json` was written by a newer Thicket; it is read but never overwritten. */
export class PipelinesReadOnlyError extends Error {
  constructor(version: number) {
    super(
      `pipelines.json has version ${version}, written by a newer Thicket; ` +
        'saved pipelines cannot be changed with this version',
    );
    this.name = 'PipelinesReadOnlyError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error['code'] === 'string' ? error['code'] : undefined;
}

function sameNamespace(p: PipelineNamespace, ns: PipelineNamespace): boolean {
  return p.profileId === ns.profileId && p.db === ns.db && p.coll === ns.coll;
}

/** Names are compared ignoring case (and surrounding spaces). */
function sameName(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

/** Stored entries keep only the schema's keys (unknown keys of a result are stripped). */
function normalize(entry: SavedPipeline): SavedPipeline {
  return savedPipelineSchema.parse(entry);
}

interface Loaded {
  pipelines: SavedPipeline[];
  /** Set when the file is from a newer version: changes are refused. */
  readOnlyVersion?: number;
}

/**
 * `pipelines.json` in `userData`: the saved aggregation pipelines of every collection
 * (`{ "version": 1, "pipelines": [...] }`, in the order they were created). Lives in `main`.
 *
 * - Loaded on first use and kept in memory. A missing file means no saved pipelines.
 * - A file that is not JSON, has no known layout or contains an invalid pipeline is renamed to
 *   `pipelines.json.corrupt-<time>` (kept for the user) and the store starts empty. A file that
 *   exists but can't be read (EACCES, ...) makes every operation fail, so it is never overwritten.
 * - A file from a newer version is read (entries valid in this version only) and never written:
 *   changes throw `PipelinesReadOnlyError`.
 * - Writes are atomic like `settings.json`'s: the content goes to `pipelines.json.tmp`
 *   (flushed), which is then renamed over `pipelines.json`. A crash in between leaves the
 *   previous file intact; the stale temp file is removed on the next load.
 * - Operations run one after another, so concurrent changes never interleave.
 * - A pipeline is saved under a name per collection (profile id, database, collection). Names
 *   are unique per collection, ignoring case: saving under a taken name replaces that pipeline
 *   (it keeps its id); renaming to a taken name is refused.
 */
export class PipelinesStore {
  readonly file: string;
  private readonly fs: PipelinesFs;
  private readonly log: (message: string) => void;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private data: Loaded | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: PipelinesStoreOptions) {
    this.file = options.file;
    this.fs = options.fs ?? nodeFs;
    this.log = options.log ?? (() => undefined);
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
  }

  get tempFile(): string {
    return `${this.file}.tmp`;
  }

  /** The saved pipelines of a collection, sorted by name (ignoring case). */
  list(ns: PipelineNamespace): Promise<SavedPipeline[]> {
    return this.run(async () =>
      (await this.load()).pipelines
        .filter((p) => sameNamespace(p, ns))
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
            a.name.localeCompare(b.name),
        )
        .map(copy),
    );
  }

  /**
   * Saves `stages` under `name` for the collection: replaces the collection's pipeline with that
   * name (ignoring case; it keeps its id and takes the new spelling) or adds a new one.
   */
  save(ns: PipelineNamespace, name: string, stages: readonly SavedStage[]): Promise<SavedPipeline> {
    return this.run(async () => {
      const loaded = await this.writable();
      const index = loaded.pipelines.findIndex(
        (p) => sameNamespace(p, ns) && sameName(p.name, name),
      );
      const next = normalize({
        pipelineId: loaded.pipelines[index]?.pipelineId ?? this.newId(),
        name,
        profileId: ns.profileId,
        db: ns.db,
        coll: ns.coll,
        stages: stages.map((s) => ({ stage: s.stage, enabled: s.enabled })),
        updatedAt: this.now().toISOString(),
      });
      const pipelines = [...loaded.pipelines];
      if (index < 0) pipelines.push(next);
      else pipelines[index] = next;
      await this.write(pipelines);
      return copy(next);
    });
  }

  /**
   * Renames a saved pipeline; throws `PipelineNotFoundError`, or `PipelineNameTakenError` when
   * another pipeline of its collection has the name. A change of case only is allowed.
   */
  rename(pipelineId: string, name: string): Promise<SavedPipeline> {
    return this.run(async () => {
      const loaded = await this.writable();
      const index = loaded.pipelines.findIndex((p) => p.pipelineId === pipelineId);
      const current = loaded.pipelines[index];
      if (!current) throw new PipelineNotFoundError(pipelineId);
      const taken = loaded.pipelines.some(
        (p) => p.pipelineId !== pipelineId && sameNamespace(p, current) && sameName(p.name, name),
      );
      if (taken) throw new PipelineNameTakenError(name.trim());
      const next = normalize({ ...current, name, updatedAt: this.now().toISOString() });
      const pipelines = [...loaded.pipelines];
      pipelines[index] = next;
      await this.write(pipelines);
      return copy(next);
    });
  }

  /** Deletes a saved pipeline; throws `PipelineNotFoundError`. */
  delete(pipelineId: string): Promise<void> {
    return this.run(async () => {
      const loaded = await this.writable();
      if (!loaded.pipelines.some((p) => p.pipelineId === pipelineId))
        throw new PipelineNotFoundError(pipelineId);
      await this.write(loaded.pipelines.filter((p) => p.pipelineId !== pipelineId));
    });
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async writable(): Promise<Loaded> {
    const loaded = await this.load();
    if (loaded.readOnlyVersion !== undefined)
      throw new PipelinesReadOnlyError(loaded.readOnlyVersion);
    return loaded;
  }

  private async write(pipelines: SavedPipeline[]): Promise<void> {
    const text = `${JSON.stringify({ version: PIPELINES_VERSION, pipelines }, null, 2)}\n`;
    try {
      await this.fs.writeFile(this.tempFile, text, { flush: true });
      await this.fs.rename(this.tempFile, this.file);
    } catch (error) {
      await this.fs.unlink(this.tempFile).catch(() => undefined);
      throw error;
    }
    this.data = { pipelines };
  }

  private async load(): Promise<Loaded> {
    if (this.data) return this.data;
    await this.removeStaleTemp();
    let text: string;
    try {
      text = await this.fs.readFile(this.file, 'utf8');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error;
      this.data = { pipelines: [] };
      return this.data;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return this.corrupt('it is not JSON');
    }
    if (!isRecord(parsed)) return this.corrupt('it has no known layout');
    const { version, pipelines: entries } = parsed;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
      return this.corrupt('it has no known layout');
    if (!Array.isArray(entries)) return this.corrupt('it has no known layout');

    if (version > PIPELINES_VERSION) {
      this.log(`${this.file} has version ${version}; reading it without changing it`);
      const pipelines = entries.flatMap((entry) => {
        const result = savedPipelineSchema.safeParse(entry);
        return result.success ? [result.data] : [];
      });
      this.data = { pipelines, readOnlyVersion: version };
      return this.data;
    }

    const pipelines: SavedPipeline[] = [];
    const ids = new Set<string>();
    for (const entry of entries) {
      const result = savedPipelineSchema.safeParse(entry);
      if (!result.success || ids.has(result.data.pipelineId))
        return this.corrupt('it contains an invalid pipeline');
      ids.add(result.data.pipelineId);
      pipelines.push(result.data);
    }
    this.data = { pipelines };
    return this.data;
  }

  private async corrupt(reason: string): Promise<Loaded> {
    const backup = `${this.file}.corrupt-${this.now().toISOString().replace(/[:.]/g, '-')}`;
    await this.fs.rename(this.file, backup);
    this.log(`${this.file} is not valid (${reason}); moved it to ${backup}, starting empty`);
    this.data = { pipelines: [] };
    return this.data;
  }

  private async removeStaleTemp(): Promise<void> {
    try {
      await this.fs.unlink(this.tempFile);
      this.log(`removed the unfinished write ${this.tempFile}`);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT')
        this.log(`could not remove ${this.tempFile}: ${String(error)}`);
    }
  }
}

function copy(pipeline: SavedPipeline): SavedPipeline {
  return structuredClone(pipeline);
}
