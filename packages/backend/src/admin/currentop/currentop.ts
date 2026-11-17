import type { ParsedParamsOf, ResultOf } from '@thicket/contract';

import { BSON, type Document } from 'mongodb';

import { canonical, runCommand } from '../../browse/browse';
import type { ClientLike } from '../../connections/manager';
import { RpcError } from '../../server/rpc';

/**
 * Running operations (`admin.currentOp`) and killing one (`admin.killOp`), SPEC M6. Both run on
 * the primary (the connection's default server), so the `opid` a list shows is killed on the
 * server that reported it. Server errors become `toBrowseError`s.
 */

const UNAUTHORIZED = 13;

/** Escapes `text` for use inside a regular expression. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The `currentOp` command for the params: `ns` is a namespace prefix on name boundaries (`shop`
 * matches `shop` and `shop.orders`, not `shopping.x`; `shop.orders` also matches
 * `shop.orders.archive`), `minSecsRunning` a lower bound on `secs_running`, `opType` the exact
 * `op` (`query`, `insert`, `command`, …), `all` adds idle connections and system operations.
 */
export function currentOpCommand(
  params: Omit<ParsedParamsOf<'admin.currentOp'>, 'profileId'>,
  ownOps = false,
): Document {
  const command: Document = { currentOp: 1 };
  if (params.all === true) command['$all'] = true;
  if (ownOps) command['$ownOps'] = true;
  const ns = params.ns?.trim();
  if (ns) command['ns'] = { $regex: `^${escapeRegExp(ns)}(\\.|$)` };
  if (params.minSecsRunning !== undefined && params.minSecsRunning > 0) {
    command['secs_running'] = { $gte: params.minSecsRunning };
  }
  const opType = params.opType?.trim();
  if (opType) command['op'] = opType;
  return command;
}

function isUnauthorized(error: unknown): boolean {
  if (!(error instanceof RpcError)) return false;
  const detail = error.detail as { serverCode?: number; codeName?: string } | undefined;
  return detail?.serverCode === UNAUTHORIZED || detail?.codeName === 'Unauthorized';
}

/** Whether `op` is the `currentOp` command that produced the list (not worth showing). */
function isOwnProbe(op: Document): boolean {
  const command = op['command'] as Document | undefined;
  return (
    command !== undefined &&
    command !== null &&
    typeof command === 'object' &&
    ('currentOp' in command ||
      (Array.isArray(command['pipeline']) &&
        (command['pipeline'] as Document[]).some((stage) => '$currentOp' in stage)))
  );
}

function runningMicros(op: Document): number {
  const value = op['microsecs_running'] as unknown;
  if (typeof value === 'number') return value;
  if (value !== null && typeof value === 'object' && 'toNumber' in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  return -1;
}

/**
 * `admin.currentOp`: the matching operations, longest running first (idle ones last), each as
 * canonical EJSON. A user without the `inprog` privilege gets their own operations (`$ownOps`).
 */
export async function currentOps(
  client: ClientLike,
  params: Omit<ParsedParamsOf<'admin.currentOp'>, 'profileId'>,
): Promise<ResultOf<'admin.currentOp'>> {
  let reply: Document;
  try {
    reply = await runCommand(client, 'admin', currentOpCommand(params));
  } catch (error) {
    if (!isUnauthorized(error)) throw error;
    reply = await runCommand(client, 'admin', currentOpCommand(params, true));
  }
  const inprog = Array.isArray(reply['inprog']) ? (reply['inprog'] as Document[]) : [];
  const ops = inprog
    .filter((op) => !isOwnProbe(op))
    .sort((a, b) => runningMicros(b) - runningMicros(a));
  return { ops: ops.map(canonical) };
}

/**
 * The `opid` of `admin.killOp` from its canonical EJSON text: a number (Int32, Int64, Double
 * with an integral value) or a `"shard:opid"` string (mongos). Anything else is `INVALID_PARAMS`.
 */
export function parseOpId(text: string): number | string | BSON.Int32 | BSON.Long {
  let value: unknown;
  try {
    value = BSON.EJSON.parse(text, { relaxed: false });
  } catch (error) {
    throw new RpcError('INVALID_PARAMS', `opId is not EJSON: ${(error as Error).message}`);
  }
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (value instanceof BSON.Int32 || value instanceof BSON.Long) return value;
  if (value instanceof BSON.Double && Number.isInteger(value.value)) return value.value;
  throw new RpcError('INVALID_PARAMS', 'opId must be an operation id (a number or "shard:opid")');
}

/** `admin.killOp`: asks the server to kill the operation `opId` (as listed by currentOp). */
export async function killOp(client: ClientLike, opId: string): Promise<ResultOf<'admin.killOp'>> {
  await runCommand(client, 'admin', { killOp: 1, op: parseOpId(opId) });
  return {};
}
