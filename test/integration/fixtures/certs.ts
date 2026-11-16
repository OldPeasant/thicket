import { generateKeyPairSync, randomBytes } from 'node:crypto';
import forge from 'node-forge';

/** PEM text of a test CA and a server certificate it signed. Generated per test run, never committed. */
export interface TestCertificates {
  /** CA certificate (PEM): what a client passes as `tlsCAFile`. */
  caCert: string;
  /** Server certificate followed by its private key (PEM): mongod's `--tlsCertificateKeyFile`. */
  serverCertKey: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** RSA key pair from Node's native crypto (fast), converted to node-forge objects. */
function rsaKeyPair(): {
  privateKey: forge.pki.rsa.PrivateKey;
  publicKey: forge.pki.rsa.PublicKey;
} {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return {
    privateKey: forge.pki.privateKeyFromPem(privateKey) as forge.pki.rsa.PrivateKey,
    publicKey: forge.pki.publicKeyFromPem(publicKey) as forge.pki.rsa.PublicKey,
  };
}

function newCertificate(
  publicKey: forge.pki.rsa.PublicKey,
  validDays: number,
): forge.pki.Certificate {
  const cert = forge.pki.createCertificate();
  cert.publicKey = publicKey;
  // Positive serial: leading byte below 0x80.
  cert.serialNumber = '01' + randomBytes(15).toString('hex');
  const now = Date.now();
  cert.validity.notBefore = new Date(now - DAY_MS);
  cert.validity.notAfter = new Date(now + validDays * DAY_MS);
  return cert;
}

/**
 * Creates a CA and a server certificate for `hosts` (DNS names or IPv4/IPv6 literals, used as
 * subjectAltName). The CA's key is discarded: nothing else can be signed with it.
 */
export function generateTestCertificates(hosts: readonly string[]): TestCertificates {
  const ca = rsaKeyPair();
  const caCert = newCertificate(ca.publicKey, 2);
  const caName = [{ name: 'commonName', value: 'Thicket Test CA' }];
  caCert.setSubject(caName);
  caCert.setIssuer(caName);
  caCert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  caCert.sign(ca.privateKey, forge.md.sha256.create());

  const server = rsaKeyPair();
  const serverCert = newCertificate(server.publicKey, 1);
  serverCert.setSubject([{ name: 'commonName', value: hosts[0] ?? 'localhost' }]);
  serverCert.setIssuer(caName);
  serverCert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
    {
      name: 'subjectAltName',
      altNames: hosts.map((host) =>
        isIpLiteral(host) ? { type: 7, ip: host } : { type: 2, value: host },
      ),
    },
  ]);
  serverCert.sign(ca.privateKey, forge.md.sha256.create());

  return {
    caCert: forge.pki.certificateToPem(caCert),
    serverCertKey:
      forge.pki.certificateToPem(serverCert) + forge.pki.privateKeyToPem(server.privateKey),
  };
}

function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}
