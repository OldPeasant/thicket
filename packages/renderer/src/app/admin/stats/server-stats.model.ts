/**
 * The server stats dashboard's data (pure): `serverStatus` samples (canonical EJSON text of
 * `admin.serverStatus`), the per-second rates between two samples, the history the charts draw,
 * the replica set members of `replSetGetStatus` and the chart geometry.
 */

type Json = Record<string, unknown>;

/** The operation counters of `serverStatus.opcounters`, in chart order. */
export const OP_KINDS = ['insert', 'query', 'update', 'delete', 'getmore', 'command'] as const;
export type OpKind = (typeof OP_KINDS)[number];

/** One `serverStatus` reduced to what the dashboard shows. */
export interface StatusSample {
  /** Server time of the sample (`localTime`), ms since the epoch. */
  readonly at: number;
  /** `uptimeMillis` (falls back to `uptime` seconds). */
  readonly uptimeMs: number;
  readonly host: string;
  readonly version: string;
  /** `mongod` or `mongos`. */
  readonly process: string;
  readonly storageEngine: string;
  readonly opcounters: Readonly<Record<OpKind, number>>;
  readonly connections: {
    readonly current: number;
    readonly available: number;
    readonly active: number | null;
  };
  /** Resident and virtual memory in MiB (`mem`), `null` when the platform doesn't report them. */
  readonly mem: { readonly resident: number | null; readonly virtual: number | null };
  readonly network: { readonly bytesIn: number; readonly bytesOut: number };
  /** Replica set name from `repl.setName`, `null` outside a replica set. */
  readonly setName: string | null;
  /** `repl.isWritablePrimary` (or `ismaster`); `null` outside a replica set. */
  readonly primary: boolean | null;
}

/** One chart point: the rates between two samples and the gauges of the later one. */
export interface StatsPoint {
  readonly at: number;
  /** Operations per second by kind. */
  readonly ops: Readonly<Record<OpKind, number>>;
  readonly connections: number;
  /** MiB; `null` when not reported. */
  readonly resident: number | null;
  readonly virtual: number | null;
  /** Bytes per second. */
  readonly bytesIn: number;
  readonly bytesOut: number;
}

/** How many points the charts keep (with a 2 s refresh: four minutes). */
export const HISTORY_SIZE = 120;

/** A number from relaxed or canonical EJSON (`{"$numberLong": "5"}`, …); `null` otherwise. */
export function ejsonNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || typeof value !== 'object') return null;
  const v = value as Json;
  for (const key of ['$numberInt', '$numberLong', '$numberDouble', '$numberDecimal']) {
    const text = v[key];
    if (typeof text === 'string') {
      const n = Number(text);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

/** Milliseconds since the epoch of an EJSON date (`{"$date": …}`); `null` otherwise. */
export function ejsonDate(value: unknown): number | null {
  if (value === null || typeof value !== 'object') return null;
  const date = (value as Json)['$date'];
  if (typeof date === 'string') {
    const ms = Date.parse(date);
    return Number.isNaN(ms) ? null : ms;
  }
  return ejsonNumber(date);
}

function object(value: unknown): Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseObject(json: string): Json | null {
  try {
    const value: unknown = JSON.parse(json);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Json)
      : null;
  } catch {
    return null;
  }
}

/** A `serverStatus` sample from its canonical EJSON text; `null` when it isn't one. */
export function parseStatus(json: string, receivedAt = Date.now()): StatusSample | null {
  const doc = parseObject(json);
  if (doc === null) return null;
  const counters = object(doc['opcounters']);
  const connections = object(doc['connections']);
  const mem = object(doc['mem']);
  const network = object(doc['network']);
  const repl = object(doc['repl']);
  const uptimeMs = ejsonNumber(doc['uptimeMillis']) ?? (ejsonNumber(doc['uptime']) ?? 0) * 1000;
  const opcounters = Object.fromEntries(
    OP_KINDS.map((kind) => [kind, ejsonNumber(counters[kind]) ?? 0]),
  ) as Record<OpKind, number>;
  const setName = text(repl['setName']);
  const writable = repl['isWritablePrimary'] ?? repl['ismaster'];
  return {
    at: ejsonDate(doc['localTime']) ?? receivedAt,
    uptimeMs,
    host: text(doc['host']),
    version: text(doc['version']),
    process: text(doc['process']),
    storageEngine: text(object(doc['storageEngine'])['name']),
    opcounters,
    connections: {
      current: ejsonNumber(connections['current']) ?? 0,
      available: ejsonNumber(connections['available']) ?? 0,
      active: ejsonNumber(connections['active']),
    },
    mem: { resident: ejsonNumber(mem['resident']), virtual: ejsonNumber(mem['virtual']) },
    network: {
      bytesIn: ejsonNumber(network['bytesIn']) ?? 0,
      bytesOut: ejsonNumber(network['bytesOut']) ?? 0,
    },
    setName: setName.length > 0 ? setName : null,
    primary: setName.length > 0 && typeof writable === 'boolean' ? writable : null,
  };
}

/**
 * The point between two samples: counters as per-second rates over the server's uptime
 * difference. `null` when they can't be compared (the server restarted, or no time passed).
 */
export function pointBetween(prev: StatusSample, next: StatusSample): StatsPoint | null {
  const secs = (next.uptimeMs - prev.uptimeMs) / 1000;
  if (!(secs > 0)) return null;
  const rate = (a: number, b: number) => Math.max(0, (b - a) / secs);
  for (const kind of OP_KINDS) {
    if (next.opcounters[kind] < prev.opcounters[kind]) return null;
  }
  return {
    at: next.at,
    ops: Object.fromEntries(
      OP_KINDS.map((kind) => [kind, rate(prev.opcounters[kind], next.opcounters[kind])]),
    ) as Record<OpKind, number>,
    connections: next.connections.current,
    resident: next.mem.resident,
    virtual: next.mem.virtual,
    bytesIn: rate(prev.network.bytesIn, next.network.bytesIn),
    bytesOut: rate(prev.network.bytesOut, next.network.bytesOut),
  };
}

/** The live state of the charts: the last sample and the points so far (oldest first). */
export interface StatsHistory {
  readonly last: StatusSample | null;
  readonly points: readonly StatsPoint[];
}

export const EMPTY_HISTORY: StatsHistory = { last: null, points: [] };

/**
 * `history` with `sample` added: a point against the previous sample, at most `size` points.
 * A restart (counters went back) or another host starts the charts over.
 */
export function addSample(
  history: StatsHistory,
  sample: StatusSample,
  size = HISTORY_SIZE,
): StatsHistory {
  const prev = history.last;
  if (prev === null || prev.host !== sample.host) return { last: sample, points: [] };
  if (sample.uptimeMs === prev.uptimeMs) return history;
  const point = pointBetween(prev, sample);
  if (point === null) return { last: sample, points: [] };
  return { last: sample, points: [...history.points, point].slice(-size) };
}

/** Sum of the operation rates of a point. */
export function totalOps(point: StatsPoint): number {
  return OP_KINDS.reduce((sum, kind) => sum + point.ops[kind], 0);
}

// Replica set --------------------------------------------------------------------------------

export interface ReplMember {
  readonly id: number;
  readonly name: string;
  readonly state: string;
  /** `health` is 1. */
  readonly healthy: boolean;
  readonly self: boolean;
  readonly uptimeSecs: number | null;
  /** `optimeDate` in ms since the epoch. */
  readonly optime: number | null;
  /** Seconds behind the primary's optime; `null` for the primary or when unknown. */
  readonly lagSecs: number | null;
  readonly pingMs: number | null;
  readonly syncSource: string;
  /** `lastHeartbeatMessage`/`infoMessage`, if any. */
  readonly message: string;
}

export interface ReplSetView {
  readonly set: string;
  readonly members: readonly ReplMember[];
}

/** The replica set view of `replSetGetStatus` (canonical EJSON); `null` when it isn't one. */
export function parseReplSet(json: string): ReplSetView | null {
  const doc = parseObject(json);
  if (doc === null || !Array.isArray(doc['members'])) return null;
  const raw = (doc['members'] as unknown[]).map(object);
  const primary = raw.find((m) => text(m['stateStr']) === 'PRIMARY');
  const primaryOptime = primary ? ejsonDate(primary['optimeDate']) : null;
  const members = raw.map((m): ReplMember => {
    const state = text(m['stateStr']);
    const optime = ejsonDate(m['optimeDate']);
    const isPrimary = state === 'PRIMARY';
    return {
      id: ejsonNumber(m['_id']) ?? 0,
      name: text(m['name']),
      state,
      healthy: ejsonNumber(m['health']) === 1,
      self: m['self'] === true,
      uptimeSecs: ejsonNumber(m['uptime']),
      optime,
      lagSecs:
        !isPrimary && optime !== null && primaryOptime !== null
          ? Math.max(0, (primaryOptime - optime) / 1000)
          : null,
      pingMs: ejsonNumber(m['pingMs']),
      syncSource: text(m['syncSourceHost']),
      message: text(m['lastHeartbeatMessage']) || text(m['infoMessage']),
    };
  });
  return { set: text(doc['set']), members };
}

/** How a member's state reads: `good` (primary/secondary), `warn` (catching up), `bad`. */
export function memberLevel(member: ReplMember): 'good' | 'warn' | 'bad' {
  if (!member.healthy) return 'bad';
  if (member.state === 'PRIMARY' || member.state === 'SECONDARY' || member.state === 'ARBITER') {
    return member.lagSecs !== null && member.lagSecs >= 10 ? 'warn' : 'good';
  }
  if (member.state === 'STARTUP2' || member.state === 'RECOVERING' || member.state === 'STARTUP') {
    return 'warn';
  }
  return 'bad';
}

// Formatting ---------------------------------------------------------------------------------

/** `1.5 KB`, `12 MB` (1024 steps), `0 B`. */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${trimZeros(value.toFixed(digits))} ${units[unit]}`;
}

/** MiB as bytes text (`mem.resident` is in MiB). */
export function formatMebibytes(mib: number | null): string {
  return mib === null ? '–' : formatBytes(mib * 1024 * 1024);
}

/** A rate or count with at most three significant digits: `0`, `0.5`, `12.3`, `1.2k`, `3.4M`. */
export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '–';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trimZeros((value / 1e9).toFixed(1))}G`;
  if (abs >= 1e6) return `${trimZeros((value / 1e6).toFixed(1))}M`;
  if (abs >= 1e4) return `${trimZeros((value / 1e3).toFixed(1))}k`;
  if (abs >= 100 || Number.isInteger(value)) return String(Math.round(value));
  return trimZeros(value.toFixed(abs >= 10 ? 1 : 2));
}

function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** `3 d 4 h`, `2 h 5 min`, `4 min 10 s`, `12 s`. */
export function formatUptime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '–';
  const secs = Math.floor(ms / 1000);
  const d = Math.floor(secs / 86_400);
  const h = Math.floor((secs % 86_400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s} s`;
  return `${s} s`;
}

/** A replication lag: `0 s`, `12 s`, `3 min 4 s`. */
export function formatLag(secs: number | null): string {
  return secs === null ? '–' : formatUptime(Math.round(secs) * 1000);
}

// Chart geometry -----------------------------------------------------------------------------

/** A "nice" upper bound for an axis (1, 2, 2.5, 5 × 10ⁿ), at least `floor`. */
export function niceMax(max: number, floor = 1): number {
  const value = Math.max(max, floor);
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (value <= step * exp) return step * exp;
  }
  return 10 * exp;
}

/**
 * The SVG path of a line through `values` (`null` breaks the line) across `width`, scaled to
 * `max` over `height` (0 at the bottom). With one value: a dot-sized segment.
 */
export function linePath(
  values: readonly (number | null)[],
  width: number,
  height: number,
  max: number,
  slots = values.length,
): string {
  if (values.length === 0 || max <= 0) return '';
  const step = slots > 1 ? width / (slots - 1) : 0;
  const offset = (slots - values.length) * step;
  const y = (v: number) => round(height - (Math.min(v, max) / max) * height);
  let path = '';
  let pen = false;
  values.forEach((value, i) => {
    if (value === null) {
      pen = false;
      return;
    }
    const x = round(offset + i * step);
    path += `${pen ? 'L' : 'M'}${x} ${y(value)}`;
    pen = true;
  });
  return path;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
