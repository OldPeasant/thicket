import { settings as settingsSchema, type Settings } from '@thicket/contract';
import * as nodeFs from 'node:fs/promises';

/** Version of the `settings.json` layout; bump it and add a step to `migrate` when it changes. */
export const SETTINGS_VERSION = 1;

/** Settings of a fresh install (and of every key that is missing or invalid in the file). */
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  style: 'business',
  mode: 'system',
  pageSize: 50,
  nestedPageSize: 100,
  defaultIntegerType: 'int32',
  dateDisplay: 'local',
  checkForUpdates: true,
  schemaSampleSize: 1000,
});

/** The file operations the store needs; injectable so tests can simulate failures and crashes. */
export interface SettingsFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  /** Must not return before the data is on disk (`flush`). */
  writeFile(path: string, data: string, options: { flush: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface SettingsStoreOptions {
  fs?: SettingsFs;
  log?: (message: string) => void;
  /** Clock for the backup file name of a corrupt or unreadable file. */
  now?: () => Date;
}

export type SettingsListener = (settings: Settings) => void;

const KEYS = Object.keys(settingsSchema.shape) as (keyof Settings)[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error['code'] === 'string' ? error['code'] : undefined;
}

/**
 * Keeps the known keys whose value is valid; every other known key gets its default. Unknown keys
 * (from a newer version, a removed setting or a hand edit) are dropped.
 */
export function sanitize(raw: Readonly<Record<string, unknown>>): Settings {
  const result: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of KEYS) {
    if (!Object.hasOwn(raw, key)) continue;
    const parsed = settingsSchema.shape[key].safeParse(raw[key]);
    if (parsed.success) result[key] = parsed.data;
  }
  return result as Settings;
}

/**
 * Brings a parsed file to the current layout. Returns the raw settings record, or `undefined` when
 * the file does not have a recognizable layout (it is then treated as corrupt).
 */
export function migrate(file: unknown): Record<string, unknown> | undefined {
  if (!isRecord(file)) return undefined;
  const { version, settings } = file;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return undefined;
  if (!isRecord(settings)) return undefined;
  // Version 1 is the first layout; a newer version is read leniently (known keys only).
  return settings;
}

function sameSettings(a: Settings, b: Settings): boolean {
  return KEYS.every((key) => Object.is(a[key], b[key]));
}

/**
 * `settings.json` in the user-data folder: `{ "version": 1, "settings": { ... } }`.
 *
 * - A missing file gives the defaults. A file that is not JSON or not in that layout is renamed to
 *   `settings.json.corrupt-<time>` (kept for the user) and the defaults are used.
 * - A file that exists but cannot be read (EACCES, a lock, ...) also gives the defaults. Before the
 *   first write it is moved to `settings.json.unreadable-<time>` so the write does not destroy it;
 *   if that move fails (other than ENOENT) the set fails and the next set tries again.
 * - Writes are atomic: the new content goes to `settings.json.tmp` (flushed), which is then renamed
 *   over `settings.json`. A crash in between leaves the previous file intact; the stale temp file
 *   is removed on the next start.
 * - Writes are serialized; listeners get the full settings after every change that was saved.
 */
export class SettingsStore {
  readonly file: string;
  private readonly fs: SettingsFs;
  private readonly log: (message: string) => void;
  private readonly now: () => Date;
  private current: Settings = { ...DEFAULT_SETTINGS };
  private readonly listeners = new Set<SettingsListener>();
  private queue: Promise<unknown> = Promise.resolve();
  /** The file could not be read at start; it must be moved aside before the first write. */
  private unreadable = false;

  private constructor(file: string, options: SettingsStoreOptions) {
    this.file = file;
    this.fs = options.fs ?? nodeFs;
    this.log = options.log ?? (() => undefined);
    this.now = options.now ?? (() => new Date());
  }

  /** Opens the store and loads `file` (see the class comment for missing or corrupt files). */
  static async open(file: string, options: SettingsStoreOptions = {}): Promise<SettingsStore> {
    const store = new SettingsStore(file, options);
    await store.load();
    return store;
  }

  get tempFile(): string {
    return `${this.file}.tmp`;
  }

  /** A copy of the current settings. */
  get(): Settings {
    return { ...this.current };
  }

  /**
   * Applies `changes` (keys left out or `undefined` keep their value), saves and notifies the
   * listeners. Nothing is written and nobody notified when no value changes. If the write fails
   * the settings stay as they were and the error is thrown.
   */
  set(changes: Partial<Settings>): Promise<Settings> {
    const run = this.queue.then(() => this.apply(changes));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Listens to saved changes; returns a function that removes the listener. */
  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async apply(changes: Partial<Settings>): Promise<Settings> {
    const defined = Object.fromEntries(
      Object.entries(changes).filter(
        ([key, value]) => value !== undefined && KEYS.includes(key as keyof Settings),
      ),
    );
    const next = settingsSchema.parse({ ...this.current, ...defined });
    if (sameSettings(next, this.current)) return this.get();
    await this.write(next);
    this.current = next;
    for (const listener of [...this.listeners]) {
      try {
        listener(this.get());
      } catch (error) {
        this.log(`settings listener failed: ${String(error)}`);
      }
    }
    return this.get();
  }

  private async write(value: Settings): Promise<void> {
    if (this.unreadable) await this.backUpUnreadable();
    const text = `${JSON.stringify({ version: SETTINGS_VERSION, settings: value }, null, 2)}\n`;
    await this.fs.writeFile(this.tempFile, text, { flush: true });
    await this.fs.rename(this.tempFile, this.file);
  }

  private async load(): Promise<void> {
    await this.removeStaleTemp();
    let text: string;
    try {
      text = await this.fs.readFile(this.file, 'utf8');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        this.unreadable = true;
        this.log(`could not read ${this.file}, using the defaults: ${String(error)}`);
      }
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const raw = parsed === undefined ? undefined : migrate(parsed);
    if (!raw) {
      await this.backUpCorrupt();
      return;
    }
    if (
      isRecord(parsed) &&
      typeof parsed['version'] === 'number' &&
      parsed['version'] > SETTINGS_VERSION
    ) {
      this.log(`${this.file} has version ${parsed['version']}; reading the known settings only`);
    }
    this.current = sanitize(raw);
  }

  private backupName(kind: 'corrupt' | 'unreadable'): string {
    const stamp = this.now().toISOString().replace(/[:.]/g, '-');
    return `${this.file}.${kind}-${stamp}`;
  }

  /** Moves the file that could not be read at start aside; throws (no write) if that fails. */
  private async backUpUnreadable(): Promise<void> {
    const backup = this.backupName('unreadable');
    try {
      await this.fs.rename(this.file, backup);
      this.log(`moved the unreadable ${this.file} to ${backup} before writing`);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        this.log(`could not move the unreadable ${this.file} aside, not writing: ${String(error)}`);
        throw error;
      }
    }
    this.unreadable = false;
  }

  private async backUpCorrupt(): Promise<void> {
    const backup = this.backupName('corrupt');
    try {
      await this.fs.rename(this.file, backup);
      this.log(`${this.file} is not valid; moved it to ${backup} and using the defaults`);
    } catch (error) {
      this.log(`${this.file} is not valid and could not be moved aside: ${String(error)}`);
    }
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
