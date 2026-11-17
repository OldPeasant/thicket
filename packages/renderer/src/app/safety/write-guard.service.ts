import { Injectable, inject } from '@angular/core';
import type { ParamsOf, ResultOf } from '@thicket/contract';

import { ApiError } from '../api/api-error';
import { ApiService, type RequestOptions } from '../api/api.service';
import { ConfirmService, type ConfirmRequest } from './confirm.service';
import { describeWrite } from './operation';
import { ProfileSafetyService } from './profile-safety.service';
import { BULK_WRITES, TYPE_TO_CONFIRM_ABOVE, type WriteMethodName } from './safety.types';

/** Params of a write without the `confirmed` flag: only `WriteGuard` sets it. */
export type GuardedParams<M extends WriteMethodName> = Omit<ParamsOf<M>, 'confirmed'>;

/** How the confirm dialog describes a write. Everything is optional except where noted. */
export interface WriteOptions extends RequestOptions {
  /** Heading of the dialog; defaults to a description of the method. */
  title?: string;
  /** Confirm button text; defaults to "Confirm". */
  confirmLabel?: string;
  /** One line about the effect (e.g. "Matches 1 204 documents."). */
  detail?: string;
  /** Number of documents the write affects (bulk writes: the preview's matched count). */
  count?: number;
  /** Destructive (delete, drop); defaults by method. */
  destructive?: boolean;
  /**
   * Ask the user to type this text before confirming. Defaults to the collection name for
   * `docs.deleteMany` over `TYPE_TO_CONFIRM_ABOVE` documents.
   */
  typeToConfirm?: string;
  /** Ask even where the rules do not require it (e.g. deleting one document). */
  alwaysConfirm?: boolean;
}

const DESTRUCTIVE: readonly WriteMethodName[] = [
  'docs.delete',
  'docs.deleteMany',
  'coll.drop',
  'db.drop',
  'idx.drop',
  'admin.killOp',
  'gridfs.delete',
  'admin.dropUser',
  'admin.dropRole',
  'admin.revokeRoles',
];

const TITLES: Partial<Record<WriteMethodName, string>> = {
  'docs.insert': 'Insert documents',
  'docs.update': 'Update document',
  'docs.replace': 'Replace document',
  'docs.delete': 'Delete document',
  'docs.updateMany': 'Update documents',
  'docs.deleteMany': 'Delete documents',
  'coll.create': 'Create collection',
  'coll.drop': 'Drop collection',
  'coll.rename': 'Rename collection',
  'coll.validator.set': 'Change validation',
  'db.create': 'Create database',
  'db.drop': 'Drop database',
  'idx.create': 'Create index',
  'idx.drop': 'Drop index',
  'idx.hide': 'Change index visibility',
  'agg.run': 'Run aggregation with $out/$merge',
  'agg.createView': 'Create view',
  'admin.killOp': 'Kill operation',
  'admin.createUser': 'Create user',
  'admin.updateUser': 'Change user',
  'admin.dropUser': 'Drop user',
  'admin.createRole': 'Create role',
  'admin.updateRole': 'Change role',
  'admin.dropRole': 'Drop role',
  'admin.grantRoles': 'Grant roles',
  'admin.revokeRoles': 'Revoke roles',
  'io.import': 'Import documents',
  'gridfs.upload': 'Upload file',
  'gridfs.delete': 'Delete file',
};

/** Error of a write the user cancelled in the confirm dialog (`code: 'CANCELLED'`). */
export function writeCancelled(): ApiError {
  return new ApiError({ code: 'CANCELLED', message: 'The write was cancelled.' });
}

/**
 * The one way write UIs send writes (SPEC.md M1 "Safety"):
 * - read-only profile: refused with `READ_ONLY` before anything is sent;
 * - production profile, `docs.updateMany` / `docs.deleteMany`, or `alwaysConfirm`: the confirm
 *   dialog shows the exact operation in shell syntax; only after the user confirms is the request
 *   sent, with `confirmed: true`. Cancelling rejects with `CANCELLED` and sends nothing;
 * - `docs.deleteMany` over 1 000 documents also needs the collection name typed;
 * - other writes are sent without `confirmed`.
 * The backend enforces the same rules (`guardWrites`), so a write that bypasses this fails closed.
 */
@Injectable({ providedIn: 'root' })
export class WriteGuard {
  private readonly api = inject(ApiService);
  private readonly confirmer = inject(ConfirmService);
  private readonly profiles = inject(ProfileSafetyService);

  /** Whether `method` on `profileId` asks first. */
  needsConfirmation(method: WriteMethodName, profileId: string): boolean {
    return BULK_WRITES.includes(method) || this.profiles.production(profileId)();
  }

  /** Sends the write `method` after the checks above; resolves with its result. */
  async run<M extends WriteMethodName>(
    method: M,
    params: GuardedParams<M>,
    options: WriteOptions = {},
  ): Promise<ResultOf<M>> {
    const approved = await this.approve(method, params, options);
    return this.api.request(method, approved, { signal: options.signal });
  }

  /**
   * The checks of `run` without sending: resolves with the params to send (with `confirmed: true`
   * when the user confirmed), or rejects with `READ_ONLY` / `CANCELLED`. For writes sent another
   * way, e.g. `agg.run` with `$out` through `ApiService.stream`.
   */
  async approve<M extends WriteMethodName>(
    method: M,
    params: GuardedParams<M>,
    options: WriteOptions = {},
  ): Promise<ParamsOf<M>> {
    const { signal, ...describe } = options;
    const profileId = (params as { profileId: string }).profileId;
    if (this.profiles.readOnly(profileId)()) {
      const name = this.profiles.get(profileId)?.name ?? 'This connection';
      throw new ApiError({ code: 'READ_ONLY', message: `${name} is read-only.` });
    }
    // A caller-supplied `confirmed` must not skip the dialog.
    const plain = { ...params } as ParamsOf<M> & { confirmed?: unknown };
    delete plain.confirmed;
    if (!describe.alwaysConfirm && !this.needsConfirmation(method, profileId)) return plain;
    if (signal?.aborted) throw writeCancelled();
    const ok = await this.confirmer.confirm(this.request(method, plain, describe), signal);
    if (!ok || signal?.aborted) throw writeCancelled();
    return { ...plain, confirmed: true };
  }

  /**
   * `approve` for several writes of one kind saved together (e.g. one field edited across
   * selected rows): one read-only check and at most one confirm dialog for all of them, which
   * shows the document count (`count` defaults to the number of writes) and the operations (the
   * first `BATCH_SHOWN`, then how many more). Resolves with the params to send, in order.
   */
  async approveAll<M extends WriteMethodName>(
    method: M,
    paramsList: readonly GuardedParams<M>[],
    options: WriteOptions = {},
  ): Promise<ParamsOf<M>[]> {
    const first = paramsList[0];
    if (first === undefined) return [];
    const profileId = (first as { profileId: string }).profileId;
    if (paramsList.some((p) => (p as { profileId: string }).profileId !== profileId)) {
      throw new Error('WriteGuard.approveAll: all writes must go to the same profile');
    }
    const { signal, ...describe } = options;
    if (this.profiles.readOnly(profileId)()) {
      const name = this.profiles.get(profileId)?.name ?? 'This connection';
      throw new ApiError({ code: 'READ_ONLY', message: `${name} is read-only.` });
    }
    const plain = paramsList.map((params) => {
      const copy = { ...params } as ParamsOf<M> & { confirmed?: unknown };
      delete copy.confirmed;
      return copy as ParamsOf<M>;
    });
    if (!describe.alwaysConfirm && !this.needsConfirmation(method, profileId)) return plain;
    if (signal?.aborted) throw writeCancelled();
    const request = this.request(method, plain[0] as ParamsOf<M>, {
      count: plain.length,
      ...describe,
    });
    const shown = plain.slice(0, BATCH_SHOWN).map((p) => describeWrite(method, p));
    const more = plain.length - shown.length;
    if (more > 0) shown.push(`// … and ${formatCount(more)} more`);
    request.operation = shown.join('\n');
    const ok = await this.confirmer.confirm(request, signal);
    if (!ok || signal?.aborted) throw writeCancelled();
    return plain.map((p) => ({ ...p, confirmed: true }));
  }

  private request<M extends WriteMethodName>(
    method: M,
    params: ParamsOf<M>,
    options: Omit<WriteOptions, 'signal'>,
  ): ConfirmRequest {
    const p = params as { profileId: string; db?: string; coll?: string; expectedCount?: number };
    const profile = this.profiles.get(p.profileId);
    const count = options.count ?? p.expectedCount;
    let typeToConfirm = options.typeToConfirm;
    if (
      typeToConfirm === undefined &&
      method === 'docs.deleteMany' &&
      p.coll !== undefined &&
      count !== undefined &&
      count > TYPE_TO_CONFIRM_ABOVE
    ) {
      typeToConfirm = p.coll;
    }
    const request: ConfirmRequest = {
      title: options.title ?? TITLES[method] ?? method,
      operation: describeWrite(method, params),
      confirmLabel: options.confirmLabel ?? 'Confirm',
      destructive: options.destructive ?? DESTRUCTIVE.includes(method),
    };
    if (profile) request.connection = { name: profile.name, production: profile.production };
    if (p.db !== undefined) request.namespace = p.coll ? `${p.db}.${p.coll}` : p.db;
    const detail = options.detail ?? (count !== undefined ? affects(count) : undefined);
    if (detail !== undefined) request.detail = detail;
    if (typeToConfirm !== undefined) request.typeToConfirm = typeToConfirm;
    return request;
  }
}

/** How many operations of a batch the confirm dialog lists (`WriteGuard.approveAll`). */
export const BATCH_SHOWN = 10;

/** "Affects 12 431 documents." */
export function affects(count: number): string {
  return `Affects ${formatCount(count)} ${count === 1 ? 'document' : 'documents'}.`;
}

/** 12431 → "12 431" (narrow no-break space between thousands, as SPEC.md writes them). */
export function formatCount(count: number): string {
  return String(count).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
