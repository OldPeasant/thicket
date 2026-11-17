import type { ResultOf } from '@thicket/contract';

import type { Document } from 'mongodb';

import { canonical, runCommand } from '../../browse/browse';
import type { ClientLike } from '../../connections/manager';
import { RpcError } from '../../server/rpc';

/**
 * Server stats dashboard data (SPEC M6 "Could"): `serverStatus` and `replSetGetStatus` on the
 * connection's default server (the primary of a replica set, the server itself with
 * `directConnection`), as canonical EJSON. `dbStats` is `db.stats` (browse). Server errors become
 * `toBrowseError`s.
 */

/** `NoReplicationEnabled`: `replSetGetStatus` on a standalone. */
const NO_REPLICATION_ENABLED = 76;
/** `CommandNotFound`: `replSetGetStatus` on mongos. */
const COMMAND_NOT_FOUND = 59;

function isPlainObject(value: unknown): value is Document {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * `doc` without fields whose name starts with `$`, at any depth (BSON values stay as they are).
 * `serverStatus` has such fields (`metrics.operatorCounters.match.$regex`, …): EJSON would read
 * `{"$regex": …}` back as a regular expression (and fail), so the text could not be parsed.
 */
export function withoutDollarFields(doc: Document): Document {
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip);
    if (!isPlainObject(value)) return value;
    const out: Document = {};
    for (const [key, inner] of Object.entries(value)) {
      if (!key.startsWith('$')) out[key] = strip(inner);
    }
    return out;
  };
  return strip(doc) as Document;
}

/** `admin.serverStatus`: the `serverStatus` command on `admin` (without `$`-named fields). */
export async function serverStatus(client: ClientLike): Promise<ResultOf<'admin.serverStatus'>> {
  const status = await runCommand(client, 'admin', { serverStatus: 1 });
  return { status: canonical(withoutDollarFields(status)) };
}

/** Whether a `toBrowseError` answer means "this server is not a replica set member". */
function isNotReplicaSet(error: unknown): boolean {
  if (!(error instanceof RpcError) || error.code !== 'SERVER_ERROR') return false;
  const detail = error.detail as { serverCode?: unknown; codeName?: unknown } | undefined;
  return (
    detail?.serverCode === NO_REPLICATION_ENABLED ||
    detail?.serverCode === COMMAND_NOT_FOUND ||
    detail?.codeName === 'NoReplicationEnabled' ||
    detail?.codeName === 'CommandNotFound'
  );
}

/**
 * `admin.replSetStatus`: `replSetGetStatus` on `admin`; `null` on a standalone or mongos (not a
 * replica set member). Other refusals (e.g. `Unauthorized`) are answered as errors.
 */
export async function replSetStatus(client: ClientLike): Promise<ResultOf<'admin.replSetStatus'>> {
  let status: Document;
  try {
    status = await runCommand(client, 'admin', { replSetGetStatus: 1 });
  } catch (error) {
    if (isNotReplicaSet(error)) return { status: null };
    throw error;
  }
  return { status: canonical(withoutDollarFields(status)) };
}
