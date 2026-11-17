import { inject, Injectable, signal } from '@angular/core';
import { MAX_VALIDATOR_CHECK_IDS } from '@thicket/contract';
import { parseEJson, stringifyEJson } from '@thicket/core/bson';

import { ApiError, describeError } from '../api/api-error';
import { ApiService } from '../api/api.service';

/** A collection. */
export interface ValidatorTarget {
  profileId: string;
  db: string;
  coll: string;
}

function nsKey(t: ValidatorTarget): string {
  return JSON.stringify([t.profileId, t.db, t.coll]);
}

/**
 * Tells open collection tabs that a collection's validator changed (saved in its validator tab),
 * so they check their shown documents again.
 */
@Injectable({ providedIn: 'root' })
export class ValidatorChanges {
  private readonly versions = signal<ReadonlyMap<string, number>>(new Map());

  /** A number that grows each time the validator of `target` is changed here. */
  version(target: ValidatorTarget): number {
    return this.versions().get(nsKey(target)) ?? 0;
  }

  changed(target: ValidatorTarget): void {
    const key = nsKey(target);
    this.versions.update((map) => new Map(map).set(key, (map.get(key) ?? 0) + 1));
  }
}

/** The canonical EJSON keys (as `documentKey` prints them) of an `invalid` id array. */
export function invalidKeys(invalid: string): Set<string> {
  const parsed = parseEJson(invalid);
  if (parsed.type !== 'array') return new Set();
  return new Set(parsed.items.map((item) => stringifyEJson(item)));
}

/**
 * Which of a collection tab's shown documents fail the collection's validator. The server decides
 * (`coll.validator.check`, a `$nor` query), never a client-side schema check; the answer is about
 * the documents as stored, not their unsaved edits. Provided per collection tab.
 */
@Injectable()
export class ValidatorMarks {
  private readonly api = inject(ApiService);

  /** `_id` keys of the shown documents that fail the validator. */
  readonly invalid = signal<ReadonlySet<string>>(new Set());
  /** The collection has a validator (only then are documents marked). */
  readonly hasValidator = signal(false);
  /** Why the last check failed (e.g. no `listCollections` privilege); marks are cleared then. */
  readonly error = signal<string | null>(null);

  private controller: AbortController | null = null;

  /** Checks the documents with these `_id` keys (canonical EJSON); an older answer is dropped. */
  async check(target: ValidatorTarget, keys: readonly (string | null)[]): Promise<void> {
    this.controller?.abort();
    const ids = keys.filter((k): k is string => k !== null).slice(0, MAX_VALIDATOR_CHECK_IDS);
    if (ids.length === 0 || target.profileId === '') {
      this.controller = null;
      this.invalid.set(new Set());
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    try {
      const result = await this.api.request(
        'coll.validator.check',
        { ...target, ids: `[${ids.join(',')}]` },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      this.hasValidator.set(result.hasValidator);
      this.invalid.set(invalidKeys(result.invalid));
      this.error.set(null);
    } catch (e) {
      if (controller.signal.aborted || (e instanceof ApiError && e.code === 'CANCELLED')) return;
      this.invalid.set(new Set());
      this.error.set(describeError(e));
    }
  }

  /** Stops a running check (the tab closes). */
  stop(): void {
    this.controller?.abort();
    this.controller = null;
  }
}
