import type { ResultOf } from '@thicket/contract';

export type UpdateCheck = ResultOf<'app.checkForUpdate'>;

/** GitHub repository whose releases are checked (`owner/name`). */
export const RELEASE_REPO = 'OldPeasant/thicket';
/** GitHub's releases API for `RELEASE_REPO` (newest first; drafts are only visible to owners). */
export const RELEASES_API = `https://api.github.com/repos/${RELEASE_REPO}/releases?per_page=30`;
/** Only links below this prefix are shown in the notice and opened in the browser. */
export const RELEASE_PAGE_PREFIX = `https://github.com/${RELEASE_REPO}/releases/`;
/** A successful answer is reused this long (several windows, a reload) before asking again. */
export const UPDATE_CACHE_MS = 60 * 60 * 1000;
/** A request that takes longer than this counts as a network error. */
export const UPDATE_TIMEOUT_MS = 15_000;

/** The part of `fetch` the checker uses (injectable for tests). */
export type FetchLike = (
  url: string,
  init: { headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface UpdateCheckerOptions {
  /** The running app's version (`app.getVersion()`). */
  current: string;
  /** The `checkForUpdates` setting, read on every check: when false no request is made. */
  enabled: () => boolean;
  fetch?: FetchLike;
  log?: (message: string) => void;
  now?: () => number;
}

interface Version {
  core: [number, number, number];
  pre: string[];
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Parses a semantic version (`1.2.3`, `v1.2.3-beta.1`); `undefined` when it is not one. */
export function parseVersion(text: string): Version | undefined {
  const match = VERSION.exec(text.trim());
  if (!match) return undefined;
  const core = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  if (!core.every(Number.isSafeInteger)) return undefined;
  return { core, pre: match[4] ? match[4].split('.') : [] };
}

/** Semantic-version order: negative when `a` is older than `b`. */
export function compareVersions(a: Version, b: Version): number {
  for (const [i, part] of a.core.entries()) {
    const diff = part - b.core[i as 0 | 1 | 2];
    if (diff !== 0) return Math.sign(diff);
  }
  // A version without pre-release identifiers is newer than one with them.
  if (a.pre.length === 0 || b.pre.length === 0) return Math.sign(b.pre.length - a.pre.length);
  for (const [i, x] of a.pre.entries()) {
    const y = b.pre[i];
    if (y === undefined) break;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return Math.sign(diff);
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return Math.sign(a.pre.length - b.pre.length);
}

/** Whether `url` is a release page of `RELEASE_REPO` (the only external link the notice opens). */
export function isReleaseUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.href.toLowerCase().startsWith(RELEASE_PAGE_PREFIX.toLowerCase())
    );
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface Release {
  version: Version;
  name: string;
  url: string;
}

/** The newest published, non-pre-release entry of a GitHub releases list. */
export function latestStable(body: unknown): Release | undefined {
  if (!Array.isArray(body)) return undefined;
  let best: Release | undefined;
  for (const entry of body) {
    if (!isRecord(entry) || entry['draft'] === true || entry['prerelease'] !== false) continue;
    const tag = entry['tag_name'];
    const url = entry['html_url'];
    if (typeof tag !== 'string' || !isReleaseUrl(url)) continue;
    const version = parseVersion(tag);
    // A tag like v1.0.0-rc.1 published without the pre-release flag is still a pre-release.
    if (!version || version.pre.length > 0) continue;
    if (!best || compareVersions(version, best.version) > 0) {
      best = { version, name: version.core.join('.'), url };
    }
  }
  return best;
}

/**
 * Asks the GitHub releases API whether a newer stable release than the running app exists.
 * Pre-releases and drafts are ignored. Any failure (offline, timeout, HTTP error, unexpected body)
 * is silent: the result then says "no update" and only the log mentions it. With the setting off
 * nothing is requested. Concurrent checks share one request; a successful answer is cached for
 * `UPDATE_CACHE_MS`.
 */
export class UpdateChecker {
  private readonly fetch: FetchLike;
  private readonly log: (message: string) => void;
  private readonly now: () => number;
  private cached: { at: number; result: UpdateCheck } | undefined;
  private pending: Promise<UpdateCheck> | undefined;

  constructor(private readonly options: UpdateCheckerOptions) {
    this.fetch = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.log = options.log ?? (() => undefined);
    this.now = options.now ?? Date.now;
  }

  private none(): UpdateCheck {
    return { current: this.options.current, latest: null, updateAvailable: false, url: null };
  }

  check(): Promise<UpdateCheck> {
    if (!this.options.enabled()) return Promise.resolve(this.none());
    if (this.cached && this.now() - this.cached.at < UPDATE_CACHE_MS) {
      return Promise.resolve({ ...this.cached.result });
    }
    this.pending ??= this.request().finally(() => {
      this.pending = undefined;
    });
    return this.pending.then((result) => ({ ...result }));
  }

  private async request(): Promise<UpdateCheck> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPDATE_TIMEOUT_MS);
    try {
      const response = await this.fetch(RELEASES_API, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'Thicket' },
        signal: controller.signal,
      });
      if (!response.ok) {
        this.log(`update check: GitHub answered HTTP ${response.status}`);
        return this.none();
      }
      const result = this.evaluate(await response.json());
      this.cached = { at: this.now(), result };
      return result;
    } catch (error) {
      this.log(`update check failed: ${error instanceof Error ? error.message : String(error)}`);
      return this.none();
    } finally {
      clearTimeout(timer);
    }
  }

  private evaluate(body: unknown): UpdateCheck {
    const latest = latestStable(body);
    if (!latest) return this.none();
    const current = parseVersion(this.options.current);
    const updateAvailable = current !== undefined && compareVersions(latest.version, current) > 0;
    return {
      current: this.options.current,
      latest: latest.name,
      updateAvailable,
      url: latest.url,
    };
  }
}
