import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateTestCertificates } from './fixtures/certs.ts';
import { FIXTURE_SPECS, startFixture } from './fixtures/mongo.ts';

// Pure checks of the generated test PKI (no container needed); runs with `npm run test:int`.

const PEM_CERT = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----\n?/g;
const PEM_KEY = /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/;

function parse(hosts: readonly string[]) {
  const certs = generateTestCertificates(hosts);
  const serverPems = certs.serverCertKey.match(PEM_CERT) ?? [];
  const keyPem = certs.serverCertKey.match(PEM_KEY)?.[0];
  return {
    certs,
    serverPems,
    keyPem,
    ca: new X509Certificate(certs.caCert),
    server: new X509Certificate(serverPems[0] ?? ''),
  };
}

describe('generateTestCertificates', () => {
  const hosts = ['localhost', '127.0.0.1', '::1'] as const;
  const { certs, serverPems, keyPem, ca, server } = parse(hosts);

  it('returns exactly one CA certificate and one server certificate plus its private key', () => {
    expect(certs.caCert.match(PEM_CERT)).toHaveLength(1);
    expect(serverPems).toHaveLength(1);
    expect(keyPem).toBeDefined();
    // mongod reads the certificate first, then the key, from --tlsCertificateKeyFile.
    expect(certs.serverCertKey.indexOf('BEGIN CERTIFICATE')).toBeLessThan(
      certs.serverCertKey.indexOf('PRIVATE KEY'),
    );
    expect(certs.caCert).not.toMatch(/PRIVATE KEY/);
  });

  it('marks the CA as a CA and the server certificate as a leaf', () => {
    expect(ca.ca).toBe(true);
    expect(server.ca).toBe(false);
    expect(ca.subject).toBe(ca.issuer);
    expect(ca.subject).toContain('CN=Thicket Test CA');
  });

  it('signs the server certificate with the CA (and the CA is self-signed)', () => {
    expect(server.checkIssued(ca)).toBe(true);
    expect(server.verify(ca.publicKey)).toBe(true);
    expect(ca.verify(ca.publicKey)).toBe(true);
    expect(server.verify(server.publicKey)).toBe(false);
  });

  it('pairs the server certificate with the bundled private key', () => {
    const key = createPrivateKey(keyPem ?? '');
    expect(server.checkPrivateKey(key)).toBe(true);
    expect(ca.checkPrivateKey(key)).toBe(false);
    expect(createPublicKey(key).export({ type: 'spki', format: 'pem' })).toBe(
      server.publicKey.export({ type: 'spki', format: 'pem' }),
    );
    expect(key.asymmetricKeyDetails?.modulusLength).toBe(2048);
  });

  it('lists every host as subjectAltName: DNS names as DNS, IPv4 and IPv6 literals as IP', () => {
    expect(server.checkHost('localhost')).toBe('localhost');
    expect(server.checkIP('127.0.0.1')).toBe('127.0.0.1');
    expect(server.checkIP('::1')).toBe('::1');
    expect(server.subjectAltName).toContain('DNS:localhost');
    expect(server.subjectAltName).toContain('IP Address:127.0.0.1');
    expect(server.subjectAltName).not.toContain('DNS:127.0.0.1');
    expect(server.subjectAltName).not.toContain('DNS:::1');
    expect(server.checkHost('example.test')).toBeUndefined();
    expect(server.checkIP('10.0.0.1')).toBeUndefined();
    expect(server.subject).toContain('CN=localhost');
  });

  it('allows server and client authentication for the server certificate', () => {
    expect(server.keyUsage).toEqual(
      expect.arrayContaining(['1.3.6.1.5.5.7.3.1', '1.3.6.1.5.5.7.3.2']),
    );
  });

  it('is valid now (backdated against clock skew) and short-lived', () => {
    const now = Date.now();
    for (const cert of [ca, server]) {
      const from = Date.parse(cert.validFrom);
      const to = Date.parse(cert.validTo);
      expect(from).toBeLessThan(now - 60 * 60 * 1000);
      expect(to).toBeGreaterThan(now + 60 * 60 * 1000);
      expect(to - now).toBeLessThanOrEqual(3 * 24 * 60 * 60 * 1000);
    }
  });

  it('creates a new CA, key and positive unique serial on every call', () => {
    const other = parse(hosts);
    expect(other.ca.fingerprint256).not.toBe(ca.fingerprint256);
    expect(other.server.serialNumber).not.toBe(server.serialNumber);
    expect(other.keyPem).not.toBe(keyPem);
    // A certificate from one run is not trusted by another run's CA.
    expect(other.server.verify(ca.publicKey)).toBe(false);
    for (const s of [server.serialNumber, other.server.serialNumber]) {
      expect(Number.parseInt(s.slice(0, 2), 16)).toBeLessThan(0x80);
    }
  });

  it('uses the first host as common name and falls back to localhost without hosts', () => {
    expect(parse(['db.example.test', '192.0.2.10']).server.subject).toContain('CN=db.example.test');
    const empty = parse([]);
    expect(empty.server.subject).toContain('CN=localhost');
    expect(empty.server.verify(empty.ca.publicKey)).toBe(true);
  });
});

describe('startFixture', () => {
  it('refuses a TLS fixture without certificates before starting a container', async () => {
    await expect(startFixture(FIXTURE_SPECS.mongo8tls, undefined)).rejects.toThrow(
      'TLS fixture needs certificates',
    );
  });
});
