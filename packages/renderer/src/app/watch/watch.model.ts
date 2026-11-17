import { parseEJsonDocument } from '@thicket/core/bson';
import { printShellSyntax } from '@thicket/core/shellsyntax';

/**
 * Change events as `admin.watch` streams them (canonical EJSON text), reduced to what the watch
 * tab shows.
 */

/** What the watch tab of a deployment, database or collection needs (the tab's `data`). */
export interface WatchTabData {
  readonly profileId: string;
  /** Without `db`: the whole deployment. */
  readonly db?: string;
  /** Needs `db`. */
  readonly coll?: string;
}

/** Stable id of the watch tab of a deployment, database or collection. */
export function watchTabId(profileId: string, db?: string, coll?: string): string {
  if (db === undefined) return `watch:${profileId}`;
  return coll === undefined ? `watch:${profileId}:${db}` : `watch:${profileId}:${db}.${coll}`;
}

/** Tab title: what is watched. */
export function watchTitle(data: WatchTabData): string {
  if (data.db === undefined) return 'Watch deployment';
  return `Watch ${data.coll === undefined ? data.db : `${data.db}.${data.coll}`}`;
}

/** How the row of an event is marked: by what happened to the data. */
export type EventKind = 'insert' | 'update' | 'delete' | 'other';

export interface WatchEntry {
  /** Arrival number, from 1. */
  readonly seq: number;
  /** `operationType` (`insert`, `update`, `drop`, …). */
  readonly op: string;
  readonly kind: EventKind;
  readonly db: string;
  readonly coll: string;
  /** Canonical EJSON text of `documentKey._id` (what `docs.get` takes), `null` when none. */
  readonly id: string | null;
  /** `_id` in shell syntax, `''` when none. */
  readonly idLabel: string;
  /** Server time of the change (`wallTime`, else `clusterTime`), `null` when unknown. */
  readonly time: Date | null;
  /** Short description: changed/removed fields of an update, `''` otherwise. */
  readonly summary: string;
  /** Whether the document can be opened (it has an `_id` and a collection). */
  readonly openable: boolean;
  /** The whole event in shell syntax (indented). */
  readonly text: string;
}

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function shell(value: unknown, indent: number): string {
  try {
    return printShellSyntax(parseEJsonDocument(JSON.stringify({ v: value })), { indent })
      .replace(/^\{\s*v:\s*/, '')
      .replace(/\s*\}$/, '');
  } catch {
    return JSON.stringify(value);
  }
}

/** The kind of an `operationType`. */
export function eventKind(op: string): EventKind {
  if (op === 'insert') return 'insert';
  if (op === 'update' || op === 'replace') return 'update';
  if (op === 'delete') return 'delete';
  return 'other';
}

function timeOf(event: Json): Date | null {
  const wall = obj(event['wallTime'])?.['$date'];
  const wallText = str(obj(wall)?.['$numberLong']) || (typeof wall === 'string' ? wall : '');
  if (wallText) {
    const date = /^-?\d+$/.test(wallText) ? new Date(Number(wallText)) : new Date(wallText);
    if (!Number.isNaN(date.getTime())) return date;
  }
  const t = obj(obj(event['clusterTime'])?.['$timestamp'])?.['t'];
  return typeof t === 'number' ? new Date(t * 1000) : null;
}

function updateSummary(event: Json, max = 200): string {
  const description = obj(event['updateDescription']);
  if (description === null) return '';
  const parts: string[] = [];
  const updated = Object.keys(obj(description['updatedFields']) ?? {});
  const removed = Array.isArray(description['removedFields'])
    ? description['removedFields'].map(str).filter(Boolean)
    : [];
  if (updated.length) parts.push(`set ${updated.join(', ')}`);
  if (removed.length) parts.push(`unset ${removed.join(', ')}`);
  const truncated = description['truncatedArrays'];
  if (Array.isArray(truncated) && truncated.length) parts.push('truncated arrays');
  const text = parts.join('; ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** One `admin.watch` event (canonical EJSON text) as the `seq`-th entry. */
export function toWatchEntry(text: string, seq: number): WatchEntry {
  let event: Json = {};
  try {
    event = obj(JSON.parse(text)) ?? {};
  } catch {
    // An unreadable event still shows up as a row.
  }
  const op = str(event['operationType']) || 'unknown';
  const ns = obj(event['ns']) ?? {};
  const key = obj(event['documentKey']);
  const idValue = key !== null && '_id' in key ? key['_id'] : undefined;
  const coll = str(ns['coll']);
  return {
    seq,
    op,
    kind: eventKind(op),
    db: str(ns['db']),
    coll,
    id: idValue === undefined ? null : JSON.stringify(idValue),
    idLabel: idValue === undefined ? '' : shell(idValue, 0),
    time: timeOf(event),
    summary: updateSummary(event),
    openable: idValue !== undefined && coll !== '',
    text: Object.keys(event).length ? shell(event, 2) : text,
  };
}

/** The `fullDocument` option of the stream. */
export type FullDocumentMode = 'default' | 'updateLookup';

/** The mongosh call that opens the same change stream, e.g. `db.orders.watch()`. */
export function watchCall(data: WatchTabData, fullDocument: FullDocumentMode): string {
  const options = fullDocument === 'updateLookup' ? `[], { fullDocument: 'updateLookup' }` : '';
  if (data.db === undefined) return `db.getMongo().watch(${options})`;
  if (data.coll === undefined)
    return `db.getSiblingDB(${JSON.stringify(data.db)}).watch(${options})`;
  const coll = /^[A-Za-z_$][\w$]*$/.test(data.coll)
    ? `.${data.coll}`
    : `.getCollection(${JSON.stringify(data.coll)})`;
  return `db.getSiblingDB(${JSON.stringify(data.db)})${coll}.watch(${options})`;
}

/** The time of an event as `14:03:07.250`. */
export function formatEventTime(date: Date | null): string {
  if (date === null) return '';
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}`;
}
