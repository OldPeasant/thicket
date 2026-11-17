// Default import: ssh2 is CommonJS, and Node's ESM loader (Playwright e2e) has no named `utils`.
import ssh2 from 'ssh2';

export type TestKeyPairOptions = ssh2.utils.KeyPairOptions;
export type TestKeyPair = ssh2.utils.KeyPairReturn;

const MAX_ATTEMPTS = 100;

/**
 * An ed25519 `ssh2.utils.generateKeyPairSync` for tests, retried until `ssh2.utils.parseKey`
 * accepts both halves. ssh2 drops a leading zero byte of the public key (about 1 key in 300), and
 * ssh2 then cannot parse its own private key ("Malformed OpenSSH private key").
 */
export function generateTestKeyPair(options: TestKeyPairOptions = {}): TestKeyPair {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const pair = ssh2.utils.generateKeyPairSync('ed25519', options);
    const passphrase = 'passphrase' in options ? options.passphrase : undefined;
    const parsed = ssh2.utils.parseKey(pair.private, passphrase);
    if (!(parsed instanceof Error) && !(ssh2.utils.parseKey(pair.public) instanceof Error)) {
      return pair;
    }
  }
  throw new Error(`no parseable ed25519 key pair after ${MAX_ATTEMPTS} attempts`);
}
