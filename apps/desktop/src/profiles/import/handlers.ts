import { RpcError, type Handler } from '@thicket/backend';
import type {
  ParsedParamsOf,
  Profile,
  ProfileDraft,
  ResultOf,
  SecretKind,
  SecretStorageStatus,
} from '@thicket/contract';
import * as nodeFs from 'node:fs/promises';

import type { NativeDialogs } from '../../dialogs';
import { ProfilesReadOnlyError } from '../store';
import {
  ImportFileError,
  SECRET_LABELS,
  parseImportFile,
  parseUriList,
  secretAdvice,
  type ImportNotice,
  type ParsedImportFile,
} from './compass';
import { exportFile } from './export';

/** What the import needs from the `ProfilesStore`. */
export interface ImportProfilesAccess {
  list(): Promise<Profile[]>;
  save(draft: ProfileDraft): Promise<Profile>;
}

/** What the import needs from the `SecretsStore`. */
export interface ImportSecretsAccess {
  status(): Promise<SecretStorageStatus>;
  set(profileId: string, kind: SecretKind, value: string): Promise<void>;
}

/** File access of import and export; injectable for tests. */
export interface ImportExportFs {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, data: string, options: { encoding: 'utf8'; mode: number }): Promise<void>;
  stat(path: string): Promise<{ size: number }>;
}

export interface ImportExportDeps {
  profiles: ImportProfilesAccess;
  secrets: ImportSecretsAccess;
  dialogs: NativeDialogs;
  fs?: ImportExportFs;
  log?: (message: string) => void;
}

/** Largest connections file read (a Compass export of a few hundred connections is ~100 KB). */
export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

const JSON_FILTER = [{ name: 'JSON', extensions: ['json'] }];

/** `name`/`connectionString` key of a profile, to skip entries that are already there. */
function sameKey(p: { name: string; connectionString: string }): string {
  return JSON.stringify([p.name, p.connectionString]);
}

/**
 * Saves the parsed entries as new profiles, in file order. Secrets go to `secrets.bin` only when
 * the keychain is `secure`; otherwise (or when storing one fails) they are dropped, the profile
 * asks for its password, and a notice says so. Entries equal (name and connection string) to an
 * existing profile or an earlier entry are skipped, so importing a file twice adds nothing.
 */
async function saveEntries(
  deps: ImportExportDeps,
  parsed: ParsedImportFile,
): Promise<ResultOf<'profiles.importUris'>> {
  const log = deps.log ?? (() => undefined);
  const imported: Profile[] = [];
  const skipped: ImportNotice[] = [...parsed.skipped];
  const notices: ImportNotice[] = [...parsed.notices];
  const known = new Set((await deps.profiles.list()).map(sameKey));
  const needsSecrets = parsed.entries.some((e) => e.secrets.length > 0);
  const storage = needsSecrets ? await deps.secrets.status() : undefined;
  const secure = storage?.level === 'secure';

  for (const entry of parsed.entries) {
    const key = sameKey(entry.draft);
    if (known.has(key)) {
      skipped.push({
        source: entry.source,
        reason: 'a connection with this name and address exists',
      });
      continue;
    }
    const draft = structuredClone(entry.draft);
    if (!secure && entry.secrets.length > 0) {
      if (draft.auth?.secretMode === 'saved') draft.auth.secretMode = 'ask';
      notices.push({
        source: entry.source,
        reason:
          `${entry.secrets.map((s) => SECRET_LABELS[s.kind]).join(', ')} not saved: ` +
          `the system keychain is not secure (${storage?.backend ?? 'unknown'}); ` +
          secretAdvice(entry.secrets.map((s) => s.kind)),
      });
    }
    let saved = await deps.profiles.save(draft);
    known.add(key);
    if (secure) {
      const failed: SecretKind[] = [];
      for (const secret of entry.secrets) {
        try {
          await deps.secrets.set(saved.id, secret.kind, secret.value);
        } catch (error) {
          log(`could not save the ${secret.kind} of imported ${saved.id}: ${String(error)}`);
          failed.push(secret.kind);
        }
      }
      if (failed.length > 0) {
        if (failed.includes('password') && saved.auth?.secretMode === 'saved') {
          saved = await deps.profiles.save({
            ...saved,
            auth: { ...saved.auth, secretMode: 'ask' },
          });
        }
        notices.push({
          source: entry.source,
          reason: `${failed.map((k) => SECRET_LABELS[k]).join(', ')} could not be saved; ${secretAdvice(failed)}`,
        });
      }
    }
    imported.push(saved);
  }
  return { imported, skipped, notices };
}

async function guard<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ImportFileError) throw new RpcError('INVALID_PARAMS', error.message);
    if (error instanceof ProfilesReadOnlyError) throw new RpcError('UNSUPPORTED', error.message);
    throw error;
  }
}

/**
 * `profiles.importCompass` (a Compass or Thicket connections file chosen with the native open
 * dialog), `profiles.importUris` and `profiles.export` (selected or all profiles into a file
 * chosen with the native save dialog, without secrets). Served by `main`: the renderer never
 * names a file.
 */
export function importExportHandlers(deps: ImportExportDeps): Record<string, Handler> {
  const fs = deps.fs ?? nodeFs;
  return {
    'profiles.importCompass': (): Promise<ResultOf<'profiles.importCompass'>> =>
      guard(async () => {
        const answer = await deps.dialogs.showOpenDialog({
          title: 'Import connections (Compass or Thicket export)',
          filters: JSON_FILTER,
          properties: ['openFile'],
        });
        const [file] = answer.filePaths;
        if (answer.canceled || !file) return null;
        const { size } = await fs.stat(file);
        if (size > MAX_IMPORT_FILE_BYTES) {
          throw new ImportFileError(
            `The file is too large for a connections export (${String(size)} bytes)`,
          );
        }
        return saveEntries(deps, parseImportFile(await fs.readFile(file, 'utf8')));
      }),
    'profiles.importUris': (
      params: ParsedParamsOf<'profiles.importUris'>,
    ): Promise<ResultOf<'profiles.importUris'>> =>
      guard(() => saveEntries(deps, parseUriList(params.uris))),
    'profiles.export': (
      params: ParsedParamsOf<'profiles.export'>,
    ): Promise<ResultOf<'profiles.export'>> =>
      guard(async () => {
        const all = await deps.profiles.list();
        const ids = params.profileIds;
        const missing = ids?.filter((id) => !all.some((p) => p.id === id)) ?? [];
        if (missing.length > 0)
          throw new RpcError('NOT_FOUND', `No profile with id ${missing.join(', ')}`);
        const chosen = ids ? all.filter((p) => ids.includes(p.id)) : all;
        const answer = await deps.dialogs.showSaveDialog({
          title: 'Export connections (without passwords)',
          defaultPath: 'thicket-connections.json',
          filters: JSON_FILTER,
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        });
        if (answer.canceled || !answer.filePath) return { path: null, exported: 0 };
        await fs.writeFile(answer.filePath, exportFile(chosen), { encoding: 'utf8', mode: 0o644 });
        return { path: answer.filePath, exported: chosen.length };
      }),
  };
}
