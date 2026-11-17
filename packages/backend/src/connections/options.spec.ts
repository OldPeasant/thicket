import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProfileDraft } from '@thicket/contract';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RpcError } from '../server/rpc';
import { toConnectError } from './errors';
import { DEFAULT_APP_NAME, clientConfig } from './options';

/** Fictitious secret values; nothing here is a real credential. */
const PASSWORD = 'fictitious-Pa55word';

function draft(extra: Partial<ProfileDraft> = {}): ProfileDraft {
  return {
    name: 'Example',
    connectionString: 'mongodb://db.example.test:27017/?replicaSet=rs0',
    readOnly: false,
    production: false,
    ...extra,
  };
}

function errorOf(run: () => unknown): RpcError | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    expect(error).toBeInstanceOf(RpcError);
    return error as RpcError;
  }
}

describe('clientConfig', () => {
  it('keeps the saved connection string as the URI and sets the default appName', () => {
    const profile = draft({
      connectionString: 'mongodb+srv://cluster0.example.test/app?directConnection=false',
    });
    expect(clientConfig(profile, {})).toEqual({
      uri: 'mongodb+srv://cluster0.example.test/app?directConnection=false',
      options: { appName: DEFAULT_APP_NAME },
    });
    expect(DEFAULT_APP_NAME).toBe('Thicket');
  });

  it('passes appName, read preference and timeouts from the profile', () => {
    const { options } = clientConfig(
      draft({
        appName: 'Reporting',
        readPreference: 'secondaryPreferred',
        connectTimeoutMS: 1500,
        serverSelectionTimeoutMS: 2500,
      }),
      {},
    );
    expect(options).toEqual({
      appName: 'Reporting',
      readPreference: 'secondaryPreferred',
      connectTimeoutMS: 1500,
      serverSelectionTimeoutMS: 2500,
    });
  });

  it.each(['SCRAM-SHA-1', 'SCRAM-SHA-256'] as const)(
    'passes user, password, %s and authSource as driver options (not in the URI)',
    (mechanism) => {
      const { uri, options } = clientConfig(
        draft({
          auth: { mechanism, username: 'alice', authSource: 'admin', secretMode: 'saved' },
        }),
        { password: PASSWORD },
      );
      expect(uri).not.toContain(PASSWORD);
      expect(options).toMatchObject({
        auth: { username: 'alice', password: PASSWORD },
        authMechanism: mechanism,
        authSource: 'admin',
      });
    },
  );

  it('uses the (decoded) user name of the connection string when the form has none', () => {
    const { options } = clientConfig(
      draft({
        connectionString: 'mongodb://al%40ice@db.example.test:27017',
        auth: { mechanism: 'SCRAM-SHA-256', secretMode: 'ask' },
      }),
      { password: PASSWORD },
    );
    expect(options.auth).toEqual({ username: 'al@ice', password: PASSWORD });
  });

  it('uses the URI user name with a password also without an auth section', () => {
    const { options } = clientConfig(draft({ connectionString: 'mongodb://bob@db.example.test' }), {
      password: PASSWORD,
    });
    expect(options.auth).toEqual({ username: 'bob', password: PASSWORD });
    expect(options.authMechanism).toBeUndefined();
  });

  it('sets no auth without a user name (password alone is ignored)', () => {
    const { options } = clientConfig(draft(), { password: PASSWORD });
    expect(options.auth).toBeUndefined();
    expect(JSON.stringify(options)).not.toContain(PASSWORD);
  });

  it.each(['saved', 'ask'] as const)(
    'answers AUTH_FAILED "No password" for secretMode %s with a user and no password',
    (secretMode) => {
      const error = errorOf(() =>
        clientConfig(
          draft({ auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode } }),
          {},
        ),
      );
      expect(error?.code).toBe('AUTH_FAILED');
      expect(error?.message).toMatch(/^No password for user alice/);
    },
  );

  it('answers AUTH_FAILED when only the URI names the user and the profile needs a password', () => {
    const error = errorOf(() =>
      clientConfig(
        draft({
          connectionString: 'mongodb://carol@db.example.test',
          auth: { mechanism: 'SCRAM-SHA-1', secretMode: 'saved' },
        }),
        { tlsKeyPassphrase: 'fictitious-passphrase' },
      ),
    );
    expect(error?.code).toBe('AUTH_FAILED');
    expect(error?.message).toContain('carol');
  });

  it('secretMode none sends the user name only and ignores a stored password', () => {
    const { options } = clientConfig(
      draft({ auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'none' } }),
      { password: PASSWORD },
    );
    expect(options.auth).toEqual({ username: 'alice' });
    expect(options.authMechanism).toBe('SCRAM-SHA-256');
  });

  it('mechanism NONE sets no auth options even with a user and password', () => {
    const { options } = clientConfig(
      draft({
        connectionString: 'mongodb://dave@db.example.test',
        auth: { mechanism: 'NONE', username: 'dave', authSource: 'admin', secretMode: 'saved' },
      }),
      { password: PASSWORD },
    );
    expect(options).toEqual({ appName: DEFAULT_APP_NAME });
  });

  it('does not throw for a connection string it cannot parse (the driver reports it)', () => {
    const { uri, options } = clientConfig(draft({ connectionString: 'mongodb://' }), {});
    expect(uri).toBe('mongodb://');
    expect(options.auth).toBeUndefined();
  });

  it('maps PLAIN (LDAP) to $external with the user and password as driver options', () => {
    const { uri, options } = clientConfig(
      draft({
        auth: { mechanism: 'PLAIN', username: 'alice', secretMode: 'saved', authSource: 'admin' },
      }),
      { password: PASSWORD },
    );
    expect(uri).not.toContain(PASSWORD);
    expect(options).toMatchObject({
      authMechanism: 'PLAIN',
      authSource: '$external',
      auth: { username: 'alice', password: PASSWORD },
    });
    // The real driver accepts the mapping.
    expect(() => new MongoClient(uri, options)).not.toThrow();
  });

  it('PLAIN: the driver resolves the decoded URI user against $external, overriding URI auth options', () => {
    const { uri, options } = clientConfig(
      draft({
        connectionString:
          'mongodb://carol%40corp.example.test@db.example.test:27017/?authSource=admin&authMechanism=SCRAM-SHA-256',
        auth: { mechanism: 'PLAIN', secretMode: 'saved' },
      }),
      { password: PASSWORD },
    );
    expect(options.auth).toEqual({ username: 'carol@corp.example.test', password: PASSWORD });
    const credentials = new MongoClient(uri, options).options.credentials;
    expect(credentials?.mechanism).toBe('PLAIN');
    expect(credentials?.source).toBe('$external');
    expect(credentials?.username).toBe('carol@corp.example.test');
    expect(credentials?.password).toBe(PASSWORD);
  });

  it('PLAIN: keeps the TLS options next to the LDAP credentials', () => {
    const { options } = clientConfig(
      draft({
        auth: { mechanism: 'PLAIN', username: 'alice', secretMode: 'ask' },
        tls: { enabled: true, caFile: '/fictitious/ca.pem' },
      }),
      { password: PASSWORD },
    );
    expect(options).toMatchObject({
      tls: true,
      tlsCAFile: '/fictitious/ca.pem',
      authMechanism: 'PLAIN',
      authSource: '$external',
      auth: { username: 'alice', password: PASSWORD },
    });
  });

  it.each([
    ['no password', { username: 'alice', secretMode: 'saved' as const }, {}],
    [
      "secretMode 'none'",
      { username: 'alice', secretMode: 'none' as const },
      { password: PASSWORD },
    ],
    ['no user name anywhere', { secretMode: 'saved' as const }, { password: PASSWORD }],
  ])('PLAIN: answers AUTH_FAILED with %s', (_case, auth, secrets) => {
    const error = errorOf(() =>
      clientConfig(draft({ auth: { mechanism: 'PLAIN', ...auth } }), secrets),
    );
    expect(error?.code).toBe('AUTH_FAILED');
    expect(error?.message).not.toContain(PASSWORD);
  });

  it('PLAIN: an unparseable connection string without a profile user is AUTH_FAILED, not a crash', () => {
    const error = errorOf(() =>
      clientConfig(
        draft({
          connectionString: 'mongodb://',
          auth: { mechanism: 'PLAIN', secretMode: 'saved' },
        }),
        { password: PASSWORD },
      ),
    );
    expect(error?.code).toBe('AUTH_FAILED');
  });

  it('answers UNSUPPORTED for mechanism GSSAPI', () => {
    const error = errorOf(() =>
      clientConfig(
        draft({ auth: { mechanism: 'GSSAPI', username: 'alice', secretMode: 'saved' } }),
        { password: PASSWORD },
      ),
    );
    expect(error?.code).toBe('UNSUPPORTED');
    expect(error?.message).toContain('GSSAPI');
  });

  it('answers UNSUPPORTED for MONGODB-OIDC without a sign-in callback', () => {
    const error = errorOf(() =>
      clientConfig(draft({ auth: { mechanism: 'MONGODB-OIDC', secretMode: 'none' } }), {}),
    );
    expect(error?.code).toBe('UNSUPPORTED');
    expect(error?.message).toContain('OIDC');
  });

  it('maps MONGODB-OIDC to the human callback in $external, with an optional principal name', () => {
    const callback = () => Promise.resolve({ accessToken: 'x' });
    const { uri, options } = clientConfig(
      draft({ auth: { mechanism: 'MONGODB-OIDC', username: 'alice', secretMode: 'none' } }),
      {},
      undefined,
      callback,
    );
    expect(uri).toBe(draft().connectionString);
    expect(options).toMatchObject({
      authMechanism: 'MONGODB-OIDC',
      authSource: '$external',
      auth: { username: 'alice' },
    });
    expect(options.authMechanismProperties?.OIDC_HUMAN_CALLBACK).toBe(callback);
    const anonymous = clientConfig(
      draft({ auth: { mechanism: 'MONGODB-OIDC', secretMode: 'none' } }),
      {},
      undefined,
      callback,
    );
    expect(anonymous.options.auth).toBeUndefined();
  });

  describe('MONGODB-OIDC trusted endpoint (ALLOWED_HOSTS)', () => {
    const callback = () => Promise.resolve({ accessToken: 'x' });
    const oidc = (connectionString: string, oidcTrustedEndpoint?: boolean) =>
      clientConfig(
        draft({
          connectionString,
          auth: {
            mechanism: 'MONGODB-OIDC',
            secretMode: 'none',
            ...(oidcTrustedEndpoint !== undefined ? { oidcTrustedEndpoint } : {}),
          },
        }),
        {},
        undefined,
        callback,
      );

    it('keeps the driver default (Atlas and local servers) unless the endpoint is trusted', () => {
      const uri = 'mongodb://db.corp.example.test:27017';
      expect(oidc(uri).options.authMechanismProperties).not.toHaveProperty('ALLOWED_HOSTS');
      expect(oidc(uri, false).options.authMechanismProperties).not.toHaveProperty('ALLOWED_HOSTS');
    });

    it("a trusted endpoint allows the connection string's own hosts (lower case, no port)", () => {
      const { options } = oidc('mongodb://DB1.corp.example.test:27017,[::2]:27018,10.0.0.5', true);
      expect(options.authMechanismProperties?.ALLOWED_HOSTS).toEqual([
        'db1.corp.example.test',
        '::2',
        '10.0.0.5',
      ]);
    });

    it("a trusted mongodb+srv endpoint allows the SRV name's domain (where its hosts must be)", () => {
      expect(
        oidc('mongodb+srv://cluster0.corp.example.test/', true).options.authMechanismProperties
          ?.ALLOWED_HOSTS,
      ).toEqual(['*.corp.example.test']);
      expect(
        oidc('mongodb+srv://corp.example/', true).options.authMechanismProperties?.ALLOWED_HOSTS,
      ).toEqual(['*.corp.example']);
    });

    it('a trusted mongodb+srv name is lower-cased like plain hosts', () => {
      expect(
        oidc('mongodb+srv://Cluster0.CORP.Example.test/', true).options.authMechanismProperties
          ?.ALLOWED_HOSTS,
      ).toEqual(['*.corp.example.test']);
    });

    it('an unparseable connection string keeps the driver default (the driver reports it)', () => {
      const { options } = oidc('not a connection string', true);
      expect(options.authMechanismProperties).not.toHaveProperty('ALLOWED_HOSTS');
      expect(options.authMechanismProperties?.OIDC_HUMAN_CALLBACK).toBe(callback);
    });

    it('the driver accepts the option', () => {
      const { uri, options } = oidc('mongodb://db.corp.example.test:27017', true);
      const client = new MongoClient(uri, options);
      expect(client.options.credentials?.mechanismProperties.ALLOWED_HOSTS).toEqual([
        'db.corp.example.test',
      ]);
    });

    // 127.0.0.2 is not in the driver's default list; nothing listens on port 9 (discard).
    const untrusted = 'mongodb://127.0.0.2:9/?serverSelectionTimeoutMS=300&connectTimeoutMS=300';

    it('the driver refuses a host outside the default list: AUTH_FAILED naming the option', async () => {
      const { uri, options } = oidc(untrusted);
      const client = new MongoClient(uri, options);
      try {
        const error = await client.connect().then(
          () => undefined,
          (e: unknown) => e,
        );
        const failure = toConnectError(error, [], true);
        expect(failure.code).toBe('AUTH_FAILED');
        expect(failure.message).toMatch(
          /^Authentication failed: Host '127\.0\.0\.2:9' is not valid/,
        );
        expect(failure.message).toContain('oidcTrustedEndpoint');
      } finally {
        await client.close();
      }
    });

    it('a trusted endpoint passes the host check (the connect then fails to reach it)', async () => {
      const { uri, options } = oidc(untrusted, true);
      const client = new MongoClient(uri, options);
      try {
        const error = await client.connect().then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain('ALLOWED_HOSTS');
        expect(toConnectError(error, [], true).code).not.toBe('AUTH_FAILED');
      } finally {
        await client.close();
      }
    });
  });

  it('maps MONGODB-AWS explicit keys to a credential provider, never to auth or the URI', async () => {
    const profile = draft({
      auth: { mechanism: 'MONGODB-AWS', username: 'AKIAFICTITIOUS', secretMode: 'saved' },
    });
    const { uri, options } = clientConfig(profile, {
      awsSecretAccessKey: 'fictitious-secret-key',
      awsSessionToken: 'fictitious-session-token',
    });
    expect(uri).toBe(profile.connectionString);
    expect(options.auth).toBeUndefined();
    expect(options.authMechanism).toBe('MONGODB-AWS');
    expect(options.authSource).toBe('$external');
    expect(await options.authMechanismProperties?.AWS_CREDENTIAL_PROVIDER?.()).toEqual({
      accessKeyId: 'AKIAFICTITIOUS',
      secretAccessKey: 'fictitious-secret-key',
      sessionToken: 'fictitious-session-token',
    });
    // The driver accepts the options as they are.
    new MongoClient(uri, options);
  });

  it('maps MONGODB-AWS without an access key ID to the default credential chain', () => {
    const { uri, options } = clientConfig(
      draft({ auth: { mechanism: 'MONGODB-AWS', secretMode: 'none' } }),
      { password: PASSWORD },
    );
    expect(options.auth).toBeUndefined();
    expect(options.authMechanism).toBe('MONGODB-AWS');
    expect(options.authMechanismProperties).toBeUndefined();
    new MongoClient(uri, options);
  });

  describe('SSH tunnels', () => {
    const ssh = {
      host: 'bastion.example.test',
      port: 22,
      username: 'ops',
      method: 'agent' as const,
    };
    const tunnel = {
      proxyHost: '127.0.0.1',
      proxyPort: 40123,
      proxyUsername: 'tunnel-user',
      proxyPassword: 'tunnel-pass',
    };

    it('needs the open tunnel of an SSH profile', () => {
      const error = errorOf(() => clientConfig(draft({ ssh }), {}));
      expect(error?.code).toBe('INTERNAL');
      expect(error?.message).toMatch(/SSH tunnel/);
    });

    it("routes the driver through the tunnel's local SOCKS port, keeping the URI", () => {
      const { uri, options } = clientConfig(
        draft({
          connectionString: 'mongodb+srv://cluster0.example.test/?replicaSet=rs0',
          ssh,
        }),
        {},
        tunnel,
      );
      expect(uri).toBe('mongodb+srv://cluster0.example.test/?replicaSet=rs0');
      expect(options).toMatchObject(tunnel);
    });

    it('refuses SSH together with a SOCKS5 proxy', () => {
      const error = errorOf(() =>
        clientConfig(draft({ ssh, proxy: { host: 'proxy.example.test', port: 1080 } }), {}, tunnel),
      );
      expect(error?.code).toBe('INVALID_PARAMS');
    });

    it('ignores tunnel options for a profile without SSH', () => {
      const { options } = clientConfig(draft({}), {}, tunnel);
      expect(options.proxyHost).toBeUndefined();
    });
  });

  it('passes TLS CA file, client certificate with passphrase and allow-invalid flags', () => {
    const { options } = clientConfig(
      draft({
        tls: {
          enabled: true,
          caFile: '/tmp/fictitious/ca.pem',
          certificateKeyFile: '/tmp/fictitious/client.pem',
          allowInvalidHostnames: true,
          allowInvalidCertificates: false,
        },
      }),
      { tlsKeyPassphrase: 'fictitious-passphrase' },
    );
    expect(options).toEqual({
      appName: DEFAULT_APP_NAME,
      tls: true,
      tlsCAFile: '/tmp/fictitious/ca.pem',
      tlsCertificateKeyFile: '/tmp/fictitious/client.pem',
      tlsCertificateKeyFilePassword: 'fictitious-passphrase',
      tlsAllowInvalidHostnames: true,
      tlsAllowInvalidCertificates: false,
    });
  });

  it('TLS with a CA file only sets no client certificate options', () => {
    const { options } = clientConfig(
      draft({ tls: { enabled: true, caFile: '/tmp/fictitious/ca.pem' } }),
      { tlsKeyPassphrase: 'fictitious-passphrase' },
    );
    expect(options).toEqual({
      appName: DEFAULT_APP_NAME,
      tls: true,
      tlsCAFile: '/tmp/fictitious/ca.pem',
    });
  });

  it('passes a client certificate without passphrase when none is stored', () => {
    const { options } = clientConfig(
      draft({ tls: { enabled: true, certificateKeyFile: '/tmp/fictitious/client.pem' } }),
      {},
    );
    expect(options.tlsCertificateKeyFile).toBe('/tmp/fictitious/client.pem');
    expect(options).not.toHaveProperty('tlsCertificateKeyFilePassword');
    expect(options).not.toHaveProperty('tlsCAFile');
  });

  it('TLS disabled sends tls: false and ignores the other TLS fields', () => {
    const { options } = clientConfig(
      draft({
        tls: { enabled: false, caFile: '/tmp/fictitious/ca.pem', allowInvalidCertificates: true },
      }),
      { tlsKeyPassphrase: 'fictitious-passphrase' },
    );
    expect(options).toEqual({ appName: DEFAULT_APP_NAME, tls: false });
  });

  describe('MONGODB-X509', () => {
    const tls = { enabled: true, certificateKeyFile: '/tmp/fictitious/client.pem' };

    it('authenticates from $external with the certificate, without password', () => {
      const { options } = clientConfig(
        draft({ auth: { mechanism: 'MONGODB-X509', secretMode: 'none' }, tls }),
        { password: PASSWORD },
      );
      expect(options).toMatchObject({
        authMechanism: 'MONGODB-X509',
        authSource: '$external',
        tlsCertificateKeyFile: '/tmp/fictitious/client.pem',
      });
      expect(options.auth).toBeUndefined();
      expect(JSON.stringify(options)).not.toContain(PASSWORD);
    });

    it('passes a user name (the certificate subject) and replaces another authSource', () => {
      const { options } = clientConfig(
        draft({
          auth: {
            mechanism: 'MONGODB-X509',
            username: 'CN=alice,O=Example',
            authSource: 'admin',
            secretMode: 'saved',
          },
          tls,
        }),
        {},
      );
      expect(options.auth).toEqual({ username: 'CN=alice,O=Example', password: '' });
      expect(options.authSource).toBe('$external');
    });

    it.each([
      ['without TLS', undefined],
      ['with TLS off', { ...tls, enabled: false }],
      ['without a client certificate', { enabled: true }],
    ])('answers AUTH_FAILED %s', (_label, tlsOptions) => {
      const error = errorOf(() =>
        clientConfig(
          draft({
            auth: { mechanism: 'MONGODB-X509', secretMode: 'none' },
            ...(tlsOptions ? { tls: tlsOptions } : {}),
          }),
          {},
        ),
      );
      expect(error?.code).toBe('AUTH_FAILED');
      expect(error?.message).toMatch(/X509.*client certificate/);
    });
  });

  describe('separate certificate and key files', () => {
    let dir = '';
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), 'thicket-options-'));
      await writeFile(join(dir, 'cert.pem'), 'fictitious certificate');
      await writeFile(join(dir, 'key.pem'), 'fictitious key');
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('reads both files and passes them with the passphrase', () => {
      const { options } = clientConfig(
        draft({
          tls: {
            enabled: true,
            certificateKeyFile: join(dir, 'cert.pem'),
            keyFile: join(dir, 'key.pem'),
          },
        }),
        { tlsKeyPassphrase: 'fictitious-passphrase' },
      );
      expect(options).toMatchObject({
        cert: 'fictitious certificate',
        key: 'fictitious key',
        passphrase: 'fictitious-passphrase',
      });
      expect(options).not.toHaveProperty('tlsCertificateKeyFile');
      expect(options).not.toHaveProperty('tlsCertificateKeyFilePassword');
    });

    it('answers TLS_ERROR for a key file that cannot be read', () => {
      const error = errorOf(() =>
        clientConfig(
          draft({
            tls: {
              enabled: true,
              certificateKeyFile: join(dir, 'cert.pem'),
              keyFile: join(dir, 'missing.pem'),
            },
          }),
          {},
        ),
      );
      expect(error?.code).toBe('TLS_ERROR');
      expect(error?.message).toContain('missing.pem');
      expect(error?.message).toContain('ENOENT');
    });
  });

  describe('SOCKS5 proxy', () => {
    it('passes host and port', () => {
      const { options } = clientConfig(
        draft({ proxy: { host: 'proxy.example.test', port: 1080 } }),
        {},
      );
      expect(options).toEqual({
        appName: DEFAULT_APP_NAME,
        proxyHost: 'proxy.example.test',
        proxyPort: 1080,
      });
    });

    it('passes user and stored proxy password', () => {
      const { uri, options } = clientConfig(
        draft({ proxy: { host: 'proxy.example.test', port: 1080, username: 'pat' } }),
        { proxyPassword: 'fictitious-proxy-pass' },
      );
      expect(options).toMatchObject({
        proxyUsername: 'pat',
        proxyPassword: 'fictitious-proxy-pass',
      });
      expect(uri).not.toContain('fictitious-proxy-pass');
    });

    it('answers AUTH_FAILED for a proxy user without a stored password', () => {
      const error = errorOf(() =>
        clientConfig(
          draft({ proxy: { host: 'proxy.example.test', port: 1080, username: 'pat' } }),
          { password: PASSWORD },
        ),
      );
      expect(error?.code).toBe('AUTH_FAILED');
      expect(error?.message).toMatch(/proxy user pat/);
    });
  });

  it('passes read preference tag sets in order and the write concern', () => {
    const { options } = clientConfig(
      draft({
        readPreference: 'secondaryPreferred',
        readPreferenceTags: [
          [
            { name: 'dc', value: 'east' },
            { name: 'rack', value: '1' },
          ],
          [],
        ],
        writeConcern: { w: 'majority', journal: true, wtimeoutMS: 5000 },
      }),
      {},
    );
    expect(options.readPreferenceTags).toEqual([{ dc: 'east', rack: '1' }, {}]);
    expect(options.writeConcern).toEqual({ w: 'majority', journal: true, wtimeoutMS: 5000 });
  });

  it('passes only the write concern fields the profile sets', () => {
    const { options } = clientConfig(draft({ writeConcern: { w: 2 } }), {});
    expect(options.writeConcern).toEqual({ w: 2 });
  });
});

describe('clientConfig edge cases (task x509-proxy)', () => {
  let dir = '';
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'thicket-options-edge-'));
    await writeFile(join(dir, 'cert.pem'), 'fictitious certificate');
    await writeFile(join(dir, 'key.pem'), 'fictitious key');
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('separate certificate and key files', () => {
    it('passes no passphrase when none is stored', () => {
      const { options } = clientConfig(
        draft({
          tls: {
            enabled: true,
            certificateKeyFile: join(dir, 'cert.pem'),
            keyFile: join(dir, 'key.pem'),
          },
        }),
        { password: PASSWORD },
      );
      expect(options).toMatchObject({ cert: 'fictitious certificate', key: 'fictitious key' });
      expect(options).not.toHaveProperty('passphrase');
    });

    it('answers TLS_ERROR naming the certificate file when it cannot be read', () => {
      const error = errorOf(() =>
        clientConfig(
          draft({
            tls: {
              enabled: true,
              certificateKeyFile: join(dir, 'no-such-cert.pem'),
              keyFile: join(dir, 'key.pem'),
            },
          }),
          {},
        ),
      );
      expect(error?.code).toBe('TLS_ERROR');
      expect(error?.message).toMatch(/client certificate file .*no-such-cert\.pem \(ENOENT\)/);
    });

    it('answers TLS_ERROR (not INTERNAL) for a directory given as key file', () => {
      const error = errorOf(() =>
        clientConfig(
          draft({
            tls: { enabled: true, certificateKeyFile: join(dir, 'cert.pem'), keyFile: dir },
          }),
          {},
        ),
      );
      expect(error?.code).toBe('TLS_ERROR');
      expect(error?.message).toContain('EISDIR');
    });

    it('reads no file while TLS is off', () => {
      const { options } = clientConfig(
        draft({
          tls: {
            enabled: false,
            certificateKeyFile: join(dir, 'missing-cert.pem'),
            keyFile: join(dir, 'missing-key.pem'),
          },
        }),
        {},
      );
      expect(options).toEqual({ appName: DEFAULT_APP_NAME, tls: false });
    });

    it('ignores a key file without a certificate file', () => {
      const { options } = clientConfig(
        draft({ tls: { enabled: true, keyFile: join(dir, 'missing-key.pem') } }),
        {},
      );
      expect(options).toEqual({ appName: DEFAULT_APP_NAME, tls: true });
    });
  });

  describe('MONGODB-X509', () => {
    it('works with separate certificate and key files', () => {
      const { options } = clientConfig(
        draft({
          auth: { mechanism: 'MONGODB-X509', secretMode: 'none' },
          tls: {
            enabled: true,
            certificateKeyFile: join(dir, 'cert.pem'),
            keyFile: join(dir, 'key.pem'),
          },
        }),
        { tlsKeyPassphrase: 'fictitious-passphrase' },
      );
      expect(options).toMatchObject({
        authMechanism: 'MONGODB-X509',
        authSource: '$external',
        cert: 'fictitious certificate',
        key: 'fictitious key',
        passphrase: 'fictitious-passphrase',
      });
    });

    it('answers AUTH_FAILED with only a key file (no client certificate)', () => {
      const error = errorOf(() =>
        clientConfig(
          draft({
            auth: { mechanism: 'MONGODB-X509', secretMode: 'none' },
            tls: { enabled: true, keyFile: join(dir, 'key.pem') },
          }),
          {},
        ),
      );
      expect(error?.code).toBe('AUTH_FAILED');
    });

    it.each(['saved', 'ask'] as const)(
      'secretMode %s needs no password and never sends one',
      (secretMode) => {
        const { options } = clientConfig(
          draft({
            auth: { mechanism: 'MONGODB-X509', username: 'CN=alice', secretMode },
            tls: { enabled: true, certificateKeyFile: '/tmp/fictitious/client.pem' },
          }),
          { password: PASSWORD },
        );
        expect(options.auth).toEqual({ username: 'CN=alice', password: '' });
        expect(JSON.stringify(options)).not.toContain(PASSWORD);
      },
    );

    it('leaves a URI user name to the driver when the profile names none', () => {
      const { uri, options } = clientConfig(
        draft({
          connectionString: 'mongodb://CN%3Dbob@db.example.test:27017',
          auth: { mechanism: 'MONGODB-X509', secretMode: 'none' },
          tls: { enabled: true, certificateKeyFile: '/tmp/fictitious/client.pem' },
        }),
        {},
      );
      expect(uri).toBe('mongodb://CN%3Dbob@db.example.test:27017');
      expect(options.auth).toBeUndefined();
      expect(options.authSource).toBe('$external');
    });
  });

  describe('SOCKS5 proxy', () => {
    it('sends no proxy credentials without a proxy user, even with a stored proxy password', () => {
      const { options } = clientConfig(
        draft({ proxy: { host: 'proxy.example.test', port: 1080 } }),
        { proxyPassword: 'fictitious-proxy-pass' },
      );
      expect(options).not.toHaveProperty('proxyUsername');
      expect(options).not.toHaveProperty('proxyPassword');
      expect(JSON.stringify(options)).not.toContain('fictitious-proxy-pass');
    });

    it('does not take the database password as proxy password', () => {
      const error = errorOf(() =>
        clientConfig(
          draft({
            auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'saved' },
            proxy: { host: 'proxy.example.test', port: 1080, username: 'pat' },
          }),
          { password: PASSWORD },
        ),
      );
      expect(error?.code).toBe('AUTH_FAILED');
      expect(error?.message).not.toContain(PASSWORD);
    });

    it('combines with database auth and keeps both passwords out of the URI', () => {
      const { uri, options } = clientConfig(
        draft({
          auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'saved' },
          proxy: { host: 'proxy.example.test', port: 1080, username: 'pat' },
        }),
        { password: PASSWORD, proxyPassword: 'fictitious-proxy-pass' },
      );
      expect(options).toMatchObject({
        auth: { username: 'alice', password: PASSWORD },
        proxyUsername: 'pat',
        proxyPassword: 'fictitious-proxy-pass',
      });
      expect(uri).not.toContain(PASSWORD);
      expect(uri).not.toContain('fictitious-proxy-pass');
    });
  });

  describe('write concern', () => {
    it('keeps falsy values: w 0, journal false, wtimeoutMS 0', () => {
      const { options } = clientConfig(
        draft({ writeConcern: { w: 0, journal: false, wtimeoutMS: 0 } }),
        {},
      );
      expect(options.writeConcern).toEqual({ w: 0, journal: false, wtimeoutMS: 0 });
    });

    it('leaves w to the server default when only journal or wtimeoutMS is set', () => {
      const { options } = clientConfig(
        draft({ writeConcern: { journal: true, wtimeoutMS: 1000 } }),
        {},
      );
      expect(options.writeConcern).toEqual({ journal: true, wtimeoutMS: 1000 });
      expect(options.writeConcern).not.toHaveProperty('w');
    });

    it('passes a custom write concern name as it is', () => {
      const { options } = clientConfig(draft({ writeConcern: { w: 'multiDC' } }), {});
      expect(options.writeConcern).toEqual({ w: 'multiDC' });
    });

    it('sets no write concern or tags when the profile has none', () => {
      const { options } = clientConfig(draft({ readPreference: 'nearest' }), {});
      expect(options).not.toHaveProperty('writeConcern');
      expect(options).not.toHaveProperty('readPreferenceTags');
    });
  });

  describe('accepted by the driver (MongoClient constructor, no connect)', () => {
    function construct(profile: ProfileDraft, secrets: Record<string, string> = {}): MongoClient {
      const { uri, options } = clientConfig(profile, secrets);
      return new MongoClient(uri, options);
    }

    it('X.509 with a PEM bundle and a user name', () => {
      const client = construct(
        draft({
          auth: { mechanism: 'MONGODB-X509', username: 'CN=alice,O=Example', secretMode: 'none' },
          tls: { enabled: true, certificateKeyFile: join(dir, 'cert.pem') },
        }),
      );
      expect(client.options.credentials).toMatchObject({
        mechanism: 'MONGODB-X509',
        source: '$external',
        username: 'CN=alice,O=Example',
      });
    });

    it('X.509 without a user name (subject from the certificate)', () => {
      const client = construct(
        draft({
          auth: { mechanism: 'MONGODB-X509', secretMode: 'none' },
          tls: { enabled: true, certificateKeyFile: join(dir, 'cert.pem') },
        }),
      );
      expect(client.options.credentials).toMatchObject({
        mechanism: 'MONGODB-X509',
        source: '$external',
      });
    });

    it('SOCKS5 proxy with user and password', () => {
      const client = construct(
        draft({ proxy: { host: 'proxy.example.test', port: 1080, username: 'pat' } }),
        { proxyPassword: 'fictitious-proxy-pass' },
      );
      expect(client.options).toMatchObject({
        proxyHost: 'proxy.example.test',
        proxyPort: 1080,
        proxyUsername: 'pat',
        proxyPassword: 'fictitious-proxy-pass',
      });
    });

    it('read preference with tag sets and the write concern', () => {
      const client = construct(
        draft({
          readPreference: 'secondaryPreferred',
          readPreferenceTags: [[{ name: 'dc', value: 'b' }], []],
          writeConcern: { w: 'majority', journal: true, wtimeoutMS: 5000 },
        }),
      );
      expect(client.readPreference.mode).toBe('secondaryPreferred');
      expect(client.readPreference.tags).toEqual([{ dc: 'b' }, {}]);
      expect(client.writeConcern).toMatchObject({ w: 'majority', journal: true, wtimeoutMS: 5000 });
    });
  });
});

describe('clientConfig MONGODB-AWS (task aws-auth)', () => {
  /** Fictitious AWS values; none of them is a real credential. */
  const KEY_ID = 'AKIAFICTITIOUSKEY456';
  const AWS_SECRET = 'fictitious/aws+Secret+Key6';
  const AWS_TOKEN = 'fictitious-aws-session-Token5';

  it('answers AUTH_FAILED for a user name in the connection string, before the driver sees it', () => {
    const error = errorOf(() =>
      clientConfig(
        draft({
          connectionString: `mongodb://${KEY_ID}@db.example.test:27017/?authMechanism=MONGODB-AWS`,
          auth: { mechanism: 'MONGODB-AWS', secretMode: 'none' },
        }),
        {},
      ),
    );
    expect(error?.code).toBe('AUTH_FAILED');
    expect(error?.message).toContain('connection string');
  });

  it('replaces another authSource, also one in the connection string, with $external', () => {
    const profile = draft({
      connectionString: 'mongodb://db.example.test:27017/?authSource=admin',
      auth: {
        mechanism: 'MONGODB-AWS',
        username: KEY_ID,
        secretMode: 'saved',
        authSource: 'admin',
      },
    });
    const { uri, options } = clientConfig(profile, { awsSecretAccessKey: AWS_SECRET });
    expect(options.authSource).toBe('$external');
    const client = new MongoClient(uri, options);
    expect(client.options.credentials).toMatchObject({
      mechanism: 'MONGODB-AWS',
      source: '$external',
    });
  });

  it('keeps appName, TLS and proxy options next to the AWS options', async () => {
    const { uri, options } = clientConfig(
      draft({
        appName: 'Reporting',
        auth: { mechanism: 'MONGODB-AWS', username: KEY_ID, secretMode: 'saved' },
        tls: { enabled: true, allowInvalidHostnames: false },
        proxy: { host: 'proxy.example.test', port: 1080 },
      }),
      { awsSecretAccessKey: AWS_SECRET, awsSessionToken: AWS_TOKEN },
    );
    expect(options).toMatchObject({
      appName: 'Reporting',
      authMechanism: 'MONGODB-AWS',
      authSource: '$external',
      tls: true,
      tlsAllowInvalidHostnames: false,
      proxyHost: 'proxy.example.test',
      proxyPort: 1080,
    });
    expect(options.auth).toBeUndefined();
    expect(uri).not.toContain(AWS_SECRET);
    expect(await options.authMechanismProperties?.AWS_CREDENTIAL_PROVIDER?.()).toEqual({
      accessKeyId: KEY_ID,
      secretAccessKey: AWS_SECRET,
      sessionToken: AWS_TOKEN,
    });
    const client = new MongoClient(uri, options);
    expect(client.options.credentials).toMatchObject({ mechanism: 'MONGODB-AWS' });
    // The driver keeps the provider, not the secret, in its credentials.
    expect(JSON.stringify(client.options.credentials)).not.toContain(AWS_SECRET);
  });

  describe('through an SSH tunnel (after task ssh-tunnel)', () => {
    const ssh = {
      host: 'bastion.example.test',
      port: 22,
      username: 'ops',
      method: 'agent' as const,
    };
    const tunnel = {
      proxyHost: '127.0.0.1',
      proxyPort: 40555,
      proxyUsername: 'tunnel-user',
      proxyPassword: 'fictitious-tunnel-Pw7',
    };

    it('combines the tunnel proxy with the AWS options; the driver accepts both', async () => {
      const { uri, options } = clientConfig(
        draft({
          connectionString: 'mongodb+srv://cluster0.example.test/?retryWrites=true',
          auth: { mechanism: 'MONGODB-AWS', username: KEY_ID, secretMode: 'saved' },
          ssh,
        }),
        { awsSecretAccessKey: AWS_SECRET, awsSessionToken: AWS_TOKEN },
        tunnel,
      );
      expect(uri).toBe('mongodb+srv://cluster0.example.test/?retryWrites=true');
      expect(options).toMatchObject({
        ...tunnel,
        authMechanism: 'MONGODB-AWS',
        authSource: '$external',
      });
      expect(options.auth).toBeUndefined();
      // The tunnel's proxy password is not mistaken for, nor overwritten by, the AWS secret.
      expect(await options.authMechanismProperties?.AWS_CREDENTIAL_PROVIDER?.()).toEqual({
        accessKeyId: KEY_ID,
        secretAccessKey: AWS_SECRET,
        sessionToken: AWS_TOKEN,
      });
      const client = new MongoClient(uri, options);
      expect(client.options).toMatchObject({ proxyHost: '127.0.0.1', proxyPort: 40555 });
      expect(client.options.credentials).toMatchObject({
        mechanism: 'MONGODB-AWS',
        source: '$external',
      });
    });

    it('default chain through a tunnel: proxy options only, no credential provider', () => {
      const { options } = clientConfig(
        draft({ auth: { mechanism: 'MONGODB-AWS', secretMode: 'none' }, ssh }),
        {},
        tunnel,
      );
      expect(options).toMatchObject({ ...tunnel, authMechanism: 'MONGODB-AWS' });
      expect(options.authMechanismProperties).toBeUndefined();
    });

    it('needs the open tunnel before any AWS check', () => {
      const error = errorOf(() =>
        clientConfig(
          draft({ auth: { mechanism: 'MONGODB-AWS', username: KEY_ID, secretMode: 'saved' }, ssh }),
          {},
        ),
      );
      expect(error?.code).toBe('INTERNAL');
    });

    it('a missing AWS secret is still AUTH_FAILED with a tunnel', () => {
      const error = errorOf(() =>
        clientConfig(
          draft({ auth: { mechanism: 'MONGODB-AWS', username: KEY_ID, secretMode: 'saved' }, ssh }),
          {},
          tunnel,
        ),
      );
      expect(error?.code).toBe('AUTH_FAILED');
    });
  });
});
