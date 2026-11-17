import { parseEJsonDocument } from '@thicket/core/bson';
import { printShellSyntax } from '@thicket/core/shellsyntax';

/**
 * Running operations as `admin.currentOp` answers them (canonical EJSON text of `inprog`
 * entries), reduced to what the current operations tab shows.
 */

/** The filters of the tab (the params of `admin.currentOp` without the profile). */
export interface OpFilter {
  /** Namespace prefix (`shop`, `shop.orders`); empty for every namespace. */
  readonly ns: string;
  /** Only operations running at least this many seconds (0: all). */
  readonly minSecs: number;
  /** Exact `op` (`query`, `command`, …); empty for every type. */
  readonly opType: string;
  /** Include idle connections and system operations. */
  readonly all: boolean;
}

export const EMPTY_FILTER: OpFilter = { ns: '', minSecs: 0, opType: '', all: false };

/** The `op` values the server reports, for the type filter. */
export const OP_TYPES = [
  'query',
  'getmore',
  'insert',
  'update',
  'remove',
  'command',
  'killcursors',
  'none',
] as const;

export interface OpEntry {
  /** Canonical EJSON text of `opid`: what `admin.killOp` takes; `null` when there is none. */
  readonly opId: string | null;
  /** `opid` as shown (`123`, `shard01:123`). */
  readonly opIdLabel: string;
  readonly op: string;
  readonly ns: string;
  readonly active: boolean;
  /** Running time in seconds (fractional), `null` for idle connections. */
  readonly secs: number | null;
  readonly client: string;
  readonly appName: string;
  /** Connection or thread name (`conn12`, `TTLMonitor`). */
  readonly desc: string;
  /** Authenticated users as `user@db`. */
  readonly users: readonly string[];
  /** The command in shell syntax on one line, `''` when there is none. */
  readonly command: string;
  readonly planSummary: string;
  readonly waitingForLock: boolean;
}

type Json = Record<string, unknown>;

function parse(text: string): Json {
  const value: unknown = JSON.parse(text);
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A number in canonical EJSON (`$numberInt`, `$numberLong`, `$numberDouble`) or plain JSON. */
export function ejsonNumber(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Json;
  const text = v['$numberInt'] ?? v['$numberLong'] ?? v['$numberDouble'];
  if (typeof text !== 'string') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** The command as one line of shell syntax, cut after `max` characters. */
function commandText(value: unknown, max = 400): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return '';
  try {
    const text = printShellSyntax(parseEJsonDocument(JSON.stringify(value)), { indent: 0 })
      .replace(/\s*\n\s*/g, ' ')
      .trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  } catch {
    return '';
  }
}

function users(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((u): u is Json => typeof u === 'object' && u !== null)
    .map((u) => `${str(u['user'])}@${str(u['db'])}`)
    .filter((u) => u !== '@');
}

/** One `admin.currentOp` entry. */
export function toOpEntry(text: string): OpEntry {
  const doc = parse(text);
  const opid = doc['opid'];
  const opIdNumber = ejsonNumber(opid);
  const micros = ejsonNumber(doc['microsecs_running']);
  const secs = micros !== null ? micros / 1_000_000 : ejsonNumber(doc['secs_running']);
  const effective = users(doc['effectiveUsers']);
  return {
    opId: opid === undefined || opid === null ? null : JSON.stringify(opid),
    opIdLabel: opIdNumber !== null ? String(opIdNumber) : str(opid),
    op: str(doc['op']),
    ns: str(doc['ns']),
    active: doc['active'] === true,
    secs: doc['active'] === true ? secs : null,
    client: str(doc['client']) || str(doc['client_s']),
    appName: str(doc['appName']),
    desc: str(doc['desc']),
    users: effective.length > 0 ? effective : users(doc['users']),
    command: commandText(doc['command']),
    planSummary: str(doc['planSummary']),
    waitingForLock: doc['waitingForLock'] === true,
  };
}

/** A running time as `850 ms`, `12.4 s`, `3 min 05 s`, `2 h 07 min`. */
export function formatDuration(secs: number | null): string {
  if (secs === null) return 'idle';
  if (secs < 1) return `${Math.round(secs * 1000)} ms`;
  if (secs < 60) return `${secs.toFixed(1)} s`;
  const whole = Math.floor(secs);
  if (whole < 3600) {
    return `${Math.floor(whole / 60)} min ${String(whole % 60).padStart(2, '0')} s`;
  }
  return `${Math.floor(whole / 3600)} h ${String(Math.floor((whole % 3600) / 60)).padStart(2, '0')} min`;
}

/** How long-running an operation looks: `ok` below 10 s, `slow` below 60 s, `long` above. */
export function durationLevel(secs: number | null): 'idle' | 'ok' | 'slow' | 'long' {
  if (secs === null) return 'idle';
  if (secs < 10) return 'ok';
  return secs < 60 ? 'slow' : 'long';
}

/**
 * Width of a running time's bar in percent of the longest one (log scale, so a 2 s operation
 * still shows next to a 2 h one); 0 for idle operations.
 */
export function durationShare(secs: number | null, longest: number): number {
  if (secs === null || secs <= 0 || longest <= 0) return 0;
  const share = Math.log1p(secs) / Math.log1p(longest);
  return Math.max(2, Math.min(100, Math.round(share * 100)));
}

/** The mongosh call the filters stand for, e.g. `db.currentOp({ ns: /^shop(\.|$)/ })`. */
export function currentOpCall(filter: OpFilter): string {
  const parts: string[] = [];
  if (filter.all) parts.push('$all: true');
  const ns = filter.ns.trim();
  if (ns) parts.push(`ns: /^${ns.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(\\.|$)/`);
  if (filter.minSecs > 0) parts.push(`secs_running: { $gte: ${filter.minSecs} }`);
  if (filter.opType.trim()) parts.push(`op: ${JSON.stringify(filter.opType.trim())}`);
  return `db.currentOp(${parts.length ? `{ ${parts.join(', ')} }` : ''})`;
}
