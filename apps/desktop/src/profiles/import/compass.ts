import { profileDraft, type ProfileDraft } from '@thicket/contract';
import { mask } from '@thicket/core/uri';

import { profileFromUri, type ImportedConnection, type ImportedSecret } from './uri';

/** One connection of an import file, ready to be saved. */
export interface ImportEntry extends ImportedConnection {
  /** How the entry is named in notices: its name in the file, or its position. */
  source: string;
}

/** Something about an entry the user should know: why it was skipped, or what was left out. */
export interface ImportNotice {
  source: string;
  reason: string;
}

/** What an import file contains. */
export interface ParsedImportFile {
  entries: ImportEntry[];
  /** Entries that can't be imported at all. */
  skipped: ImportNotice[];
  /** Imported entries with something left out (e.g. encrypted credentials). */
  notices: ImportNotice[];
}

/** The file is not a Compass or Thicket connections export. */
export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFileError';
  }
}

/** `type` of a Thicket profiles export (`exportFile`). */
export const THICKET_EXPORT_TYPE = 'Thicket Connections';
/** `type` of a Compass connections export (Compass ≥ 1.39, "Export connections"). */
export const COMPASS_EXPORT_TYPE = 'Compass Connections';

/**
 * Compass's favorite colors (`favorite.color` is `color1` … `color10`) as CSS colors. Compass
 * stores only the key; the values approximate its palette. Hex colors are taken as they are.
 */
export const COMPASS_COLORS: Readonly<Record<string, string>> = {
  color1: '#5fc86e',
  color2: '#326fde',
  color3: '#deb342',
  color4: '#d4366e',
  color5: '#59c1e2',
  color6: '#2c487c',
  color7: '#7442ca',
  color8: '#643a1f',
  color9: '#cc6b23',
  color10: '#a5aaaf',
};

/** Byte order mark some editors put before the JSON. */
const BOM = String.fromCharCode(0xfeff);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** `1` or the canonical EJSON `{ "$numberInt": "1" }` Compass writes. */
function versionOf(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (isRecord(value)) {
    const raw = value['$numberInt'] ?? value['$numberLong'] ?? value['$numberDouble'];
    if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw)))
      return Number(raw);
  }
  return undefined;
}

/** EJSON number (`{ "$numberInt": "22" }`) or plain number/string as a port. */
function portOf(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number(value) : (versionOf(value) ?? Number.NaN);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : undefined;
}

function colorOf(value: unknown): string | undefined {
  const color = str(value);
  if (color === undefined) return undefined;
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(color)) return color;
  return COMPASS_COLORS[color];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Adds a secret unless one of its kind is already there. */
function addSecret(secrets: ImportedSecret[], kind: ImportedSecret['kind'], value: unknown): void {
  if (typeof value === 'string' && value !== '' && !secrets.some((s) => s.kind === kind))
    secrets.push({ kind, value });
}

/** One entry of `connections`, or a notice why it can't be imported. */
function compassEntry(
  raw: unknown,
  index: number,
  notices: ImportNotice[],
): ImportEntry | ImportNotice {
  const position = `connection ${String(index + 1)}`;
  if (!isRecord(raw)) return { source: position, reason: 'not a connection object' };
  const favorite = isRecord(raw['favorite']) ? raw['favorite'] : {};
  const name = str(favorite['name']);
  const source = name ?? position;
  const options = raw['connectionOptions'];
  const uri = isRecord(options) ? str(options['connectionString']) : undefined;
  if (!isRecord(options) || uri === undefined)
    return { source, reason: 'it has no connection string' };

  let imported: ImportedConnection;
  try {
    imported = profileFromUri(uri, name);
  } catch (error) {
    return { source, reason: messageOf(error) };
  }
  const { draft, secrets } = imported;
  const color = colorOf(favorite['color']);
  if (color !== undefined) draft.color = color;

  const ssh = options['sshTunnel'];
  if (isRecord(ssh)) {
    const host = str(ssh['host']);
    const username = str(ssh['username']);
    if (host === undefined || username === undefined) {
      return { source, reason: 'its SSH tunnel has no host or user name' };
    }
    if (draft.proxy) {
      return { source, reason: 'it uses both an SSH tunnel and a SOCKS5 proxy' };
    }
    const keyFile = str(ssh['identityKeyFile']);
    draft.ssh = {
      host,
      port: portOf(ssh['port']) ?? 22,
      username,
      method: keyFile !== undefined ? 'privateKey' : 'password',
    };
    if (keyFile !== undefined) {
      draft.ssh.privateKeyFile = keyFile;
      addSecret(secrets, 'sshKeyPassphrase', ssh['identityKeyPassphrase']);
    } else {
      addSecret(secrets, 'sshPassword', ssh['password']);
    }
  }

  if (str(raw['connectionSecrets']) !== undefined) {
    notices.push({
      source,
      reason:
        'its saved credentials are encrypted with a passphrase and were not imported; ' +
        'enter them when connecting or in the connection editor',
    });
  }
  return { source, draft, secrets };
}

function parseCompass(file: Record<string, unknown>): ParsedImportFile {
  const version = versionOf(file['version']);
  if (version !== 1) {
    throw new ImportFileError(
      `Unsupported Compass export version ${String(version ?? file['version'])}`,
    );
  }
  const connections = file['connections'];
  if (!Array.isArray(connections))
    throw new ImportFileError('The Compass export has no connections list');
  const result: ParsedImportFile = { entries: [], skipped: [], notices: [] };
  connections.forEach((raw, index) => {
    const entry = compassEntry(raw, index, result.notices);
    if ('draft' in entry) result.entries.push(entry);
    else result.skipped.push(entry);
  });
  return result;
}

function parseThicket(file: Record<string, unknown>): ParsedImportFile {
  if (file['version'] !== 1)
    throw new ImportFileError(`Unsupported Thicket export version ${String(file['version'])}`);
  const profiles = file['profiles'];
  if (!Array.isArray(profiles))
    throw new ImportFileError('The Thicket export has no profiles list');
  const result: ParsedImportFile = { entries: [], skipped: [], notices: [] };
  profiles.forEach((raw, index) => {
    const name = isRecord(raw) ? str(raw['name']) : undefined;
    const source = name ?? `profile ${String(index + 1)}`;
    const parsed = profileDraft.safeParse(raw);
    if (!parsed.success) {
      result.skipped.push({
        source,
        reason: parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'profile'}: ${issue.message}`)
          .join('; '),
      });
      return;
    }
    const draft: ProfileDraft = { ...parsed.data };
    delete draft.id;
    result.entries.push({ source, draft, secrets: [] });
  });
  return result;
}

/**
 * Reads a connections file: a Compass export (`{ type: 'Compass Connections', version: 1,
 * connections: [{ connectionOptions: { connectionString, sshTunnel? }, favorite?: { name,
 * color }, connectionSecrets? }] }`, as Compass's "Export connections" writes it, the version
 * possibly as EJSON) or a Thicket export (`exportFile`). Passwords in a plain Compass export
 * (connection string, SSH tunnel) become secrets; `connectionSecrets` (encrypted with a
 * passphrase) can't be read, so such entries are imported without credentials and with a notice.
 * Throws `ImportFileError` for anything else.
 */
export function parseImportFile(text: string): ParsedImportFile {
  let file: unknown;
  try {
    file = JSON.parse(text.startsWith(BOM) ? text.slice(1) : text);
  } catch {
    throw new ImportFileError('The file is not JSON');
  }
  if (isRecord(file) && file['type'] === COMPASS_EXPORT_TYPE) return parseCompass(file);
  if (isRecord(file) && file['type'] === THICKET_EXPORT_TYPE) return parseThicket(file);
  throw new ImportFileError(
    'The file is not a Compass or Thicket connections export ' +
      `("type": "${COMPASS_EXPORT_TYPE}" or "${THICKET_EXPORT_TYPE}")`,
  );
}

/**
 * Entries from a list of connection strings; blank entries are ignored. Each is named by its
 * masked connection string (no password in notices).
 */
export function parseUriList(uris: readonly string[]): ParsedImportFile {
  const result: ParsedImportFile = { entries: [], skipped: [], notices: [] };
  uris.forEach((raw) => {
    const uri = raw.trim();
    if (uri === '') return;
    const source = mask(uri);
    try {
      result.entries.push({ source, ...profileFromUri(uri) });
    } catch (error) {
      result.skipped.push({ source, reason: messageOf(error) });
    }
  });
  return result;
}
