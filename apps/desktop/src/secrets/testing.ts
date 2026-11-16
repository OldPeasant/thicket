import type { SafeStorageLike } from './store';

const MAGIC = Buffer.from('FAKE-SAFE-STORAGE:');
const VERSION_LENGTH = 3;

export interface FakeSafeStorageOptions {
  /** What `getSelectedStorageBackend()` answers (Linux). */
  backend?: string;
  /** Encryption available (default true; on `basic_text` only after `setUsePlainTextEncryption`). */
  available?: boolean;
  /** `decryptStringAsync` reports `shouldReEncrypt`. */
  shouldReEncrypt?: boolean;
}

/**
 * A stand-in for Electron's `safeStorage` in unit tests: "encrypts" by XOR-ing behind Chromium's
 * version prefix (`v10` on basic_text, `v11` otherwise) and a magic marker, so the plain text never
 * appears in the bytes, and decrypting anything without the marker throws like a real key mismatch. Like Electron, a `basic_text` backend is only available
 * after `setUsePlainTextEncryption(true)`.
 */
export class FakeSafeStorage implements SafeStorageLike {
  backend: string;
  available: boolean;
  shouldReEncrypt: boolean;
  plainText = false;
  encryptCalls = 0;

  constructor(options: FakeSafeStorageOptions = {}) {
    this.backend = options.backend ?? 'gnome_libsecret';
    this.available = options.available ?? true;
    this.shouldReEncrypt = options.shouldReEncrypt ?? false;
  }

  isAsyncEncryptionAvailable(): Promise<boolean> {
    if (this.backend === 'basic_text') return Promise.resolve(this.available && this.plainText);
    return Promise.resolve(this.available);
  }

  encryptStringAsync(plainText: string): Promise<Buffer> {
    this.encryptCalls++;
    // Chromium's os_crypt prefixes: `v10` for basic_text (hard-coded key), `v11` for a keyring.
    const version = Buffer.from(this.backend === 'basic_text' ? 'v10' : 'v11');
    const bytes = Buffer.from(Buffer.from(plainText, 'utf8').map((byte) => byte ^ 0x5a));
    return Promise.resolve(Buffer.concat([version, MAGIC, bytes]));
  }

  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }> {
    const start = VERSION_LENGTH + MAGIC.length;
    if (!encrypted.subarray(VERSION_LENGTH, start).equals(MAGIC))
      return Promise.reject(new Error('Error while decrypting the ciphertext provided'));
    const bytes = Buffer.from(encrypted.subarray(start).map((byte) => byte ^ 0x5a));
    return Promise.resolve({
      result: bytes.toString('utf8'),
      shouldReEncrypt: this.shouldReEncrypt,
    });
  }

  getSelectedStorageBackend(): string {
    return this.backend;
  }

  setUsePlainTextEncryption(usePlainText: boolean): void {
    this.plainText = usePlainText;
  }
}
