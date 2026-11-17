// Same default import as ./testing, so vi.spyOn targets the object the helper calls through.
import ssh2 from 'ssh2';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { generateTestKeyPair, type TestKeyPair } from './testing';

const PASSPHRASE = 'fictitious-key-passphrase';
const COMMENT = 'fictitious-tester@example.invalid';
const ENCRYPTED = { passphrase: PASSPHRASE, cipher: 'aes256-ctr', rounds: 4 };

const realGenerate = ssh2.utils.generateKeyPairSync.bind(ssh2.utils);

function parses(key: string, passphrase?: string): boolean {
  return !(ssh2.utils.parseKey(key, passphrase) instanceof Error);
}

/**
 * A real ssh2 ed25519 pair that ssh2 cannot parse (the public key lost its leading zero byte, so
 * it is 31 bytes). About 1 in 300 keys; the bound makes a miss practically impossible.
 */
function findUnparseableRealKey(): TestKeyPair {
  for (let i = 0; i < 100_000; i++) {
    const pair = realGenerate('ed25519');
    if (!parses(pair.private)) return pair;
  }
  throw new Error('no unparseable ssh2 ed25519 key found');
}

let badPair: TestKeyPair;

beforeAll(() => {
  badPair = findUnparseableRealKey();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateTestKeyPair', () => {
  it('returns a plain ed25519 pair whose private and public halves both parse', () => {
    const pair = generateTestKeyPair();

    const priv = ssh2.utils.parseKey(pair.private);
    const pub = ssh2.utils.parseKey(pair.public);
    expect(priv).not.toBeInstanceOf(Error);
    expect(pub).not.toBeInstanceOf(Error);
    expect((priv as ssh2.ParsedKey).type).toBe('ssh-ed25519');
    expect((priv as ssh2.ParsedKey).isPrivateKey()).toBe(true);
    expect((pub as ssh2.ParsedKey).isPrivateKey()).toBe(false);
    expect(pair.public.startsWith('ssh-ed25519 ')).toBe(true);
  });

  it('returns an encrypted pair that parses only with its passphrase', () => {
    const pair = generateTestKeyPair(ENCRYPTED);

    expect(parses(pair.private, PASSPHRASE)).toBe(true);
    expect(parses(pair.private)).toBe(false);
    expect(parses(pair.private, 'fictitious-wrong-passphrase')).toBe(false);
    expect(parses(pair.public)).toBe(true);
  });

  it('keeps the requested comment on both halves', () => {
    const pair = generateTestKeyPair({ comment: COMMENT });

    expect((ssh2.utils.parseKey(pair.private) as ssh2.ParsedKey).comment).toBe(COMMENT);
    expect(pair.public.endsWith(` ${COMMENT}`)).toBe(true);
  });

  it('keeps the comment on an encrypted pair', () => {
    const pair = generateTestKeyPair({ ...ENCRYPTED, comment: COMMENT });

    expect((ssh2.utils.parseKey(pair.private, PASSPHRASE) as ssh2.ParsedKey).comment).toBe(COMMENT);
  });

  it('the bad fixture is a real ssh2 key that ssh2 cannot parse', () => {
    expect(parses(badPair.private)).toBe(false);
    // Wire format: string "ssh-ed25519" (4 + 11 bytes), then string <public key>.
    const blob = Buffer.from(badPair.public.split(' ')[1] ?? '', 'base64');
    expect(blob.readUInt32BE(15)).toBe(31);
  });

  it('retries after an unparseable private key and returns the next parseable pair', () => {
    const options = { comment: COMMENT };
    const spy = vi
      .spyOn(ssh2.utils, 'generateKeyPairSync')
      .mockReturnValueOnce(badPair)
      .mockImplementation(realGenerate);

    const pair = generateTestKeyPair(options);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'ed25519', options);
    expect(spy).toHaveBeenNthCalledWith(2, 'ed25519', options);
    expect(pair).not.toBe(badPair);
    expect(parses(pair.private)).toBe(true);
    expect(parses(pair.public)).toBe(true);
  });

  it('retries when only the public half is unparseable', () => {
    const good = realGenerate('ed25519');
    const badPublic: TestKeyPair = { private: good.private, public: 'ssh-ed25519 not-base64!' };
    const spy = vi
      .spyOn(ssh2.utils, 'generateKeyPairSync')
      .mockReturnValueOnce(badPublic)
      .mockReturnValueOnce(good);

    expect(generateTestKeyPair()).toBe(good);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('checks an encrypted private key with the given passphrase and retries on a mismatch', () => {
    const wrongPassphrase = realGenerate('ed25519', {
      ...ENCRYPTED,
      passphrase: 'fictitious-other-passphrase',
    });
    const right = realGenerate('ed25519', ENCRYPTED);
    const spy = vi
      .spyOn(ssh2.utils, 'generateKeyPairSync')
      .mockReturnValueOnce(wrongPassphrase)
      .mockReturnValueOnce(right);

    expect(generateTestKeyPair(ENCRYPTED)).toBe(right);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('throws after 100 attempts when every generated key is unparseable', () => {
    const spy = vi.spyOn(ssh2.utils, 'generateKeyPairSync').mockReturnValue(badPair);

    expect(() => generateTestKeyPair()).toThrow('no parseable ed25519 key pair after 100 attempts');
    expect(spy).toHaveBeenCalledTimes(100);
  });
});
