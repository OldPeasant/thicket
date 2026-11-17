import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { describeHostKey, hostPattern, KnownHosts } from './known-hosts';

/** A fictitious wire-format public key: `string type` + random key bytes. */
function wireKey(type = 'ssh-ed25519', body: Buffer = randomBytes(32)): Buffer {
  const name = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(name.length);
  const bodyLength = Buffer.alloc(4);
  bodyLength.writeUInt32BE(body.length);
  return Buffer.concat([length, name, bodyLength, body]);
}

/** A hashed OpenSSH host field (`|1|salt|hmac-sha1(salt, pattern)`). */
function hashed(pattern: string, salt: Buffer = randomBytes(20)): string {
  const hash = createHmac('sha1', salt).update(pattern).digest('base64');
  return `|1|${salt.toString('base64')}|${hash}`;
}

function line(hosts: string, key: Buffer, type = 'ssh-ed25519'): string {
  return `${hosts} ${type} ${key.toString('base64')}`;
}

let dir: string;
let file: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'thicket-known-hosts-'));
  file = join(dir, 'known_hosts');
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('hostPattern', () => {
  it('writes the bare host for port 22 and [host]:port otherwise, lower-cased', () => {
    expect(hostPattern('Bastion.Example.TEST', 22)).toBe('bastion.example.test');
    expect(hostPattern('Bastion.Example.TEST', 2222)).toBe('[bastion.example.test]:2222');
    expect(hostPattern('127.0.0.1', 1)).toBe('[127.0.0.1]:1');
  });
});

describe('describeHostKey', () => {
  it('reads the key type and the OpenSSH SHA256 fingerprint (unpadded base64)', () => {
    const key = wireKey('ecdsa-sha2-nistp256');
    const info = describeHostKey(key);
    expect(info.keyType).toBe('ecdsa-sha2-nistp256');
    const expected = createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
    expect(info.fingerprint).toBe(`SHA256:${expected}`);
    expect(info.fingerprint).not.toMatch(/=$/);
  });

  it.each([
    ['shorter than a length field', Buffer.from([0, 0, 1])],
    ['a zero-length type', Buffer.from([0, 0, 0, 0, 1, 2])],
    ['a type length over 64', Buffer.concat([Buffer.from([0, 0, 0, 65]), Buffer.alloc(65, 97)])],
    ['a type length beyond the buffer', Buffer.from([0, 0, 0, 10, 97, 98])],
  ])('names the key type "unknown" for %s', (_label, key) => {
    expect(describeHostKey(key).keyType).toBe('unknown');
    expect(describeHostKey(key).fingerprint).toMatch(/^SHA256:/);
  });
});

describe('KnownHosts.check', () => {
  it('a missing file means every host is unknown', async () => {
    const hosts = new KnownHosts(join(dir, 'does-not-exist', 'known_hosts'));
    expect(await hosts.check('bastion.example.test', 22, wireKey())).toBe('unknown');
  });

  it('a plain entry with the same key is trusted; the host with another key is changed', async () => {
    const key = wireKey();
    await writeFile(file, `${line('bastion.example.test', key)}\n`);
    const hosts = new KnownHosts(file);
    expect(await hosts.check('bastion.example.test', 22, key)).toBe('trusted');
    expect(await hosts.check('BASTION.example.test', 22, key)).toBe('trusted');
    expect(await hosts.check('bastion.example.test', 22, wireKey())).toBe('changed');
    expect(await hosts.check('other.example.test', 22, key)).toBe('unknown');
  });

  it('a different key type for a known host counts as changed (assumption: any key type)', async () => {
    await writeFile(file, `${line('bastion.example.test', wireKey('ssh-rsa'), 'ssh-rsa')}\n`);
    const hosts = new KnownHosts(file);
    expect(await hosts.check('bastion.example.test', 22, wireKey('ssh-ed25519'))).toBe('changed');
  });

  it('a host with several keys is trusted when any of them matches', async () => {
    const ed = wireKey('ssh-ed25519');
    const ecdsa = wireKey('ecdsa-sha2-nistp256');
    await writeFile(
      file,
      [
        line('bastion.example.test', ed),
        line('bastion.example.test', ecdsa, 'ecdsa-sha2-nistp256'),
      ].join('\n'),
    );
    const hosts = new KnownHosts(file);
    expect(await hosts.check('bastion.example.test', 22, ed)).toBe('trusted');
    expect(await hosts.check('bastion.example.test', 22, ecdsa)).toBe('trusted');
  });

  it('[host]:port entries only match that port; a bare host only matches port 22', async () => {
    const key = wireKey();
    await writeFile(
      file,
      `${line('[bastion.example.test]:2222', key)}\n${line('jump.example.test', key)}\n`,
    );
    const hosts = new KnownHosts(file);
    expect(await hosts.check('bastion.example.test', 2222, key)).toBe('trusted');
    expect(await hosts.check('bastion.example.test', 22, key)).toBe('unknown');
    expect(await hosts.check('bastion.example.test', 2223, key)).toBe('unknown');
    expect(await hosts.check('jump.example.test', 22, key)).toBe('trusted');
    expect(await hosts.check('jump.example.test', 2222, key)).toBe('unknown');
  });

  it('reads comma separated host lists (mixed case)', async () => {
    const key = wireKey();
    await writeFile(file, `${line('Bastion.example.test,192.0.2.10,[192.0.2.10]:2222', key)}\n`);
    const hosts = new KnownHosts(file);
    expect(await hosts.check('bastion.example.test', 22, key)).toBe('trusted');
    expect(await hosts.check('192.0.2.10', 22, key)).toBe('trusted');
    expect(await hosts.check('192.0.2.10', 2222, key)).toBe('trusted');
  });

  it('reads hashed entries for port 22 and [host]:port', async () => {
    const key = wireKey();
    await writeFile(
      file,
      `${line(hashed('bastion.example.test'), key)}\n${line(hashed('[jump.example.test]:2222'), key)}\n`,
    );
    const hosts = new KnownHosts(file);
    expect(await hosts.check('Bastion.Example.Test', 22, key)).toBe('trusted');
    expect(await hosts.check('bastion.example.test', 22, wireKey())).toBe('changed');
    expect(await hosts.check('jump.example.test', 2222, key)).toBe('trusted');
    expect(await hosts.check('jump.example.test', 22, key)).toBe('unknown');
    expect(await hosts.check('other.example.test', 22, key)).toBe('unknown');
  });

  it('ignores malformed hashed entries instead of failing', async () => {
    const key = wireKey();
    await writeFile(
      file,
      [
        line('|1|onlysalt', key),
        // A hash of the wrong length never matches (and does not throw in timingSafeEqual).
        line(`|1|${randomBytes(20).toString('base64')}|${randomBytes(5).toString('base64')}`, key),
      ].join('\n'),
    );
    const hosts = new KnownHosts(file);
    expect(await hosts.check('bastion.example.test', 22, key)).toBe('unknown');
  });

  it('ignores comments, blank lines, markers, wildcards, negations and incomplete lines', async () => {
    const key = wireKey();
    await writeFile(
      file,
      [
        '# a comment naming bastion.example.test',
        '',
        '   ',
        `@cert-authority bastion.example.test ssh-ed25519 ${key.toString('base64')}`,
        `@revoked bastion.example.test ssh-ed25519 ${wireKey().toString('base64')}`,
        line('*.example.test', wireKey()),
        line('bastion.example.t?st', wireKey()),
        line('!bastion.example.test', wireKey()),
        'bastion.example.test ssh-ed25519',
        'bastion.example.test',
        'bastion.example.test ssh-ed25519 ====',
      ].join('\r\n'),
    );
    const hosts = new KnownHosts(file);
    expect(await hosts.check('bastion.example.test', 22, key)).toBe('unknown');
  });

  it('a wildcard next to a literal name still lets the literal name match', async () => {
    const key = wireKey();
    await writeFile(file, `${line('*.example.test,bastion.example.test', key)}\n`);
    expect(await new KnownHosts(file).check('bastion.example.test', 22, key)).toBe('trusted');
  });

  it('accepts CRLF line endings and leading whitespace', async () => {
    const key = wireKey();
    await writeFile(file, `  ${line('bastion.example.test', key)}  \r\n`);
    expect(await new KnownHosts(file).check('bastion.example.test', 22, key)).toBe('trusted');
  });

  it('fails when the file exists but cannot be read (not "unknown")', async () => {
    await mkdir(file);
    await expect(new KnownHosts(file).check('bastion.example.test', 22, wireKey())).rejects.toThrow(
      /EISDIR/,
    );
  });
});

describe('KnownHosts.trust', () => {
  it('creates missing folders and a 0600 file with one plain OpenSSH line', async () => {
    const nested = join(dir, 'userData', 'nested', 'known_hosts');
    const hosts = new KnownHosts(nested);
    const key = wireKey('ssh-ed25519');
    await hosts.trust('Bastion.Example.TEST', 2222, key);
    expect(await readFile(nested, 'utf8')).toBe(
      `[bastion.example.test]:2222 ssh-ed25519 ${key.toString('base64')}\n`,
    );
    if (process.platform !== 'win32') {
      expect((await stat(nested)).mode & 0o777).toBe(0o600);
    }
    expect(await hosts.check('bastion.example.test', 2222, key)).toBe('trusted');
  });

  it('appends to an existing file and keeps its lines', async () => {
    const old = wireKey();
    await writeFile(file, `# kept\n${line('jump.example.test', old)}\n`);
    const hosts = new KnownHosts(file);
    const key = wireKey();
    await hosts.trust('bastion.example.test', 22, key);
    const text = await readFile(file, 'utf8');
    expect(text.startsWith(`# kept\n${line('jump.example.test', old)}\n`)).toBe(true);
    expect(await hosts.check('jump.example.test', 22, old)).toBe('trusted');
    expect(await hosts.check('bastion.example.test', 22, key)).toBe('trusted');
  });

  it('keeps both entries when the existing file has no trailing newline', async () => {
    // Users remove changed keys by hand (task assumption), and editors may drop the final newline.
    const old = wireKey();
    await writeFile(file, line('jump.example.test', old));
    const hosts = new KnownHosts(file);
    const key = wireKey();
    await hosts.trust('bastion.example.test', 22, key);
    expect(await hosts.check('jump.example.test', 22, old)).toBe('trusted');
    expect(await hosts.check('bastion.example.test', 22, key)).toBe('trusted');
  });

  it('serializes concurrent trusts into whole lines; check waits for pending writes', async () => {
    const hosts = new KnownHosts(file);
    const keys = Array.from({ length: 8 }, () => wireKey());
    const writes = keys.map((key, i) => hosts.trust(`host${String(i)}.example.test`, 22, key));
    // Started before the writes finished: still sees every one of them.
    const checks = keys.map((key, i) => hosts.check(`host${String(i)}.example.test`, 22, key));
    await Promise.all(writes);
    expect(await Promise.all(checks)).toEqual(keys.map(() => 'trusted'));
    const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
    expect(lines).toHaveLength(8);
    for (const [i, text] of lines.entries()) {
      expect(text).toBe(line(`host${String(i)}.example.test`, keys[i] ?? Buffer.alloc(0)));
    }
  });

  it('a failed write rejects, and later writes and checks still work', async () => {
    // The parent "folder" is a file: mkdir fails.
    const blocker = join(dir, 'blocker');
    await writeFile(blocker, 'not a folder');
    const hosts = new KnownHosts(join(blocker, 'known_hosts'));
    await expect(hosts.trust('bastion.example.test', 22, wireKey())).rejects.toThrow();
    await expect(hosts.check('bastion.example.test', 22, wireKey())).rejects.toThrow(/ENOTDIR/);

    // The folder becomes writable: the same instance writes again (the failure did not stick).
    await rm(blocker);
    const key = wireKey();
    await hosts.trust('bastion.example.test', 22, key);
    expect(await hosts.check('bastion.example.test', 22, key)).toBe('trusted');
  });

  it('writes the key type "unknown" for a key without a readable type', async () => {
    const hosts = new KnownHosts(file);
    const key = Buffer.from([1, 2, 3]);
    await hosts.trust('bastion.example.test', 22, key);
    expect(await readFile(file, 'utf8')).toBe(
      `bastion.example.test unknown ${key.toString('base64')}\n`,
    );
    expect(await hosts.check('bastion.example.test', 22, key)).toBe('trusted');
  });
});
