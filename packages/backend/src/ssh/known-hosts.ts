import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Result of looking a server's host key up in `known_hosts`. */
export type HostKeyStatus =
  /** The host is listed with exactly this key. */
  | 'trusted'
  /** The host is not listed: ask the user. */
  | 'unknown'
  /** The host is listed, but with other keys only: refuse (possible man-in-the-middle). */
  | 'changed';

/** A server's public host key, as the SSH protocol sends it (wire format). */
export interface HostKeyInfo {
  /** `ssh-ed25519`, `ecdsa-sha2-nistp256`, `ssh-rsa`, ... */
  keyType: string;
  /** OpenSSH style SHA-256 fingerprint: `SHA256:` + unpadded base64. */
  fingerprint: string;
}

/** Key type and fingerprint of a wire-format public key. */
export function describeHostKey(key: Buffer): HostKeyInfo {
  return {
    keyType: keyTypeOf(key),
    fingerprint: `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`,
  };
}

/** The key type name at the start of a wire-format public key (`string` = uint32 length + bytes). */
function keyTypeOf(key: Buffer): string {
  if (key.length < 4) return 'unknown';
  const length = key.readUInt32BE(0);
  if (length === 0 || length > 64 || key.length < 4 + length) return 'unknown';
  return key.subarray(4, 4 + length).toString('latin1');
}

/** The host pattern OpenSSH writes: `host`, or `[host]:port` for ports other than 22. */
export function hostPattern(host: string, port: number): string {
  return port === 22 ? host.toLowerCase() : `[${host.toLowerCase()}]:${port}`;
}

/**
 * `known_hosts` in OpenSSH format (one `hosts keytype base64key` per line), kept in Thicket's
 * `userData`. Reads plain and hashed (`|1|salt|hash`) host names, comma separated lists and
 * `[host]:port`; lines with markers (`@cert-authority`, `@revoked`) and wildcard patterns are
 * ignored. New hosts are appended in plain text. A missing file means "nothing known".
 */
export class KnownHosts {
  /** Serializes appends, so concurrent connects don't interleave lines. */
  private writing: Promise<void> = Promise.resolve();

  constructor(readonly file: string) {}

  /** Looks up `host:port` with the key the server presented. */
  async check(host: string, port: number, key: Buffer): Promise<HostKeyStatus> {
    await this.writing;
    const pattern = hostPattern(host, port);
    let known = false;
    for (const entry of await this.entries()) {
      if (!entry.matches(pattern)) continue;
      if (entry.key.equals(key)) return 'trusted';
      known = true;
    }
    return known ? 'changed' : 'unknown';
  }

  /** Adds `host:port` with `key` (the user trusted it). */
  trust(host: string, port: number, key: Buffer): Promise<void> {
    const line = `${hostPattern(host, port)} ${keyTypeOf(key)} ${key.toString('base64')}\n`;
    const write = this.writing.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      await appendFile(this.file, line, { mode: 0o600 });
    });
    this.writing = write.catch(() => undefined);
    return write;
  }

  private async entries(): Promise<Entry[]> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const entries: Entry[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const entry = parseLine(raw);
      if (entry) entries.push(entry);
    }
    return entries;
  }
}

interface Entry {
  key: Buffer;
  matches(pattern: string): boolean;
}

function parseLine(raw: string): Entry | undefined {
  const line = raw.trim();
  if (line === '' || line.startsWith('#') || line.startsWith('@')) return undefined;
  const [hosts, , base64] = line.split(/\s+/);
  if (hosts === undefined || base64 === undefined) return undefined;
  const key = Buffer.from(base64, 'base64');
  if (key.length === 0) return undefined;
  if (hosts.startsWith('|1|')) {
    const [salt, hash] = hosts.slice(3).split('|');
    if (salt === undefined || hash === undefined) return undefined;
    const saltBytes = Buffer.from(salt, 'base64');
    const hashBytes = Buffer.from(hash, 'base64');
    return {
      key,
      matches: (pattern) => {
        const actual = createHmac('sha1', saltBytes).update(pattern).digest();
        return actual.length === hashBytes.length && timingSafeEqual(actual, hashBytes);
      },
    };
  }
  const names = hosts
    .toLowerCase()
    .split(',')
    .filter((name) => !name.startsWith('!') && !/[*?]/.test(name));
  return { key, matches: (pattern) => names.includes(pattern) };
}
