import { createPrivateKey } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import forge from 'node-forge';
import { MongoClient } from 'mongodb';

import { generateTestPki, newCertificate, rsaKeyPair, type TestIssuer } from './certs.ts';
import { startFixture, type StartedFixture } from './mongo.ts';

/**
 * X.509 fixture (task x509-proxy): a MongoDB 8 server with access control and `requireTLS`, its own
 * per-run CA, and client certificates written to a temporary folder. Nothing is committed: keys,
 * passphrase and root password are generated when the fixture starts.
 */
export interface X509Fixture {
  fixture: StartedFixture;
  /** Connection string (no TLS options; the test adds them). */
  uri: string;
  dir: string;
  caFile: string;
  /** Subject of the user that exists in `$external` (RFC 2253, as the server prints it). */
  userSubject: string;
  /** PEM bundle: certificate + unencrypted key of `userSubject`. */
  userBundle: string;
  /** PEM bundle: certificate + key encrypted with `passphrase`, same subject. */
  encryptedBundle: string;
  /** Separate certificate and encrypted key files of `userSubject` (key encrypted with `passphrase`). */
  userCert: string;
  userKey: string;
  passphrase: string;
  /** PEM bundle signed by the same CA, for a subject that has no user. */
  unknownBundle: string;
  /** PEM bundle for `userSubject`, but signed by an unrelated CA. */
  foreignBundle: string;
  stop(): Promise<void>;
}

export const X509_USER_SUBJECT = 'CN=thicket-x509-user,OU=ThicketClients,O=Thicket Test';
const UNKNOWN_SUBJECT = 'CN=thicket-x509-stranger,OU=ThicketClients,O=Thicket Test';

/** forge subject attributes from an RFC 2253 string such as `CN=a,OU=b,O=c` (no escaping). */
function subjectOf(rfc2253: string): forge.pki.CertificateField[] {
  const names: Record<string, string> = {
    CN: 'commonName',
    OU: 'organizationalUnitName',
    O: 'organizationName',
  };
  return rfc2253
    .split(',')
    .reverse()
    .map((part) => {
      const [key = '', value = ''] = part.split('=');
      const name = names[key];
      if (!name) throw new Error(`unsupported subject attribute ${key}`);
      return { name, value };
    });
}

/** A client certificate (`clientAuth`) for `subject` signed by `issuer`, and its private key. */
export function issueClientCertificate(
  issuer: TestIssuer,
  subject: string,
): { certPem: string; keyPem: string } {
  const keys = rsaKeyPair();
  const cert = newCertificate(keys.publicKey, 1);
  cert.setSubject(subjectOf(subject));
  cert.setIssuer(issuer.name);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', clientAuth: true },
  ]);
  cert.sign(issuer.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

/** The key as encrypted PKCS#8 PEM (AES-256-CBC), as OpenSSL writes it for `-passout`. */
export function encryptKey(keyPem: string, passphrase: string): string {
  return createPrivateKey(keyPem)
    .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase })
    .toString();
}

function secret(): string {
  return forge.util.bytesToHex(forge.random.getBytesSync(16));
}

/** Starts the X.509 server and creates the `$external` user of `X509_USER_SUBJECT`. */
export async function startX509Fixture(): Promise<X509Fixture> {
  const { certs, issuer } = generateTestPki(['localhost', '127.0.0.1', '::1']);
  const root = { username: 'x509root', password: secret() };
  const passphrase = secret();

  const dir = await mkdtemp(join(tmpdir(), 'thicket-int-x509-'));
  const write = async (name: string, content: string): Promise<string> => {
    const path = join(dir, name);
    await writeFile(path, content, { mode: 0o600 });
    return path;
  };

  let fixture: StartedFixture | undefined;
  try {
    const user = issueClientCertificate(issuer, X509_USER_SUBJECT);
    const unknown = issueClientCertificate(issuer, UNKNOWN_SUBJECT);
    const foreign = issueClientCertificate(
      generateTestPki(['localhost']).issuer,
      X509_USER_SUBJECT,
    );
    const encryptedKey = encryptKey(user.keyPem, passphrase);
    const caFile = await write('ca.pem', certs.caCert);
    const paths = {
      userBundle: await write('user.pem', user.certPem + user.keyPem),
      encryptedBundle: await write('user-encrypted.pem', user.certPem + encryptedKey),
      userCert: await write('user-cert.pem', user.certPem),
      userKey: await write('user-key.pem', encryptedKey),
      unknownBundle: await write('unknown.pem', unknown.certPem + unknown.keyPem),
      foreignBundle: await write('foreign.pem', foreign.certPem + foreign.keyPem),
    };

    fixture = await startFixture({ version: '8', tls: true, auth: root }, certs);
    const uri = fixture.info.uri;
    const admin = new MongoClient(uri, {
      tls: true,
      tlsCAFile: caFile,
      auth: root,
      authSource: 'admin',
      serverSelectionTimeoutMS: 30_000,
    });
    try {
      await admin.db('$external').command({
        createUser: X509_USER_SUBJECT,
        roles: [{ role: 'readAnyDatabase', db: 'admin' }],
      });
    } finally {
      await admin.close();
    }

    const started = fixture;
    return {
      fixture: started,
      uri,
      dir,
      caFile,
      userSubject: X509_USER_SUBJECT,
      passphrase,
      ...paths,
      stop: async () => {
        await started.container.stop().catch(() => undefined);
        await rm(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await fixture?.container.stop().catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
