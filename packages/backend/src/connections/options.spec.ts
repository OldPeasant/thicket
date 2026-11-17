import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ProfileDraft } from '@thicket/contract';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RpcError } from '../server/rpc';
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

  it.each(['PLAIN', 'GSSAPI', 'MONGODB-OIDC'] as const)(
    'answers UNSUPPORTED for mechanism %s',
    (mechanism) => {
      const error = errorOf(() =>
        clientConfig(draft({ auth: { mechanism, username: 'alice', secretMode: 'saved' } }), {
          password: PASSWORD,
        }),
      );
      expect(error?.code).toBe('UNSUPPORTED');
      expect(error?.message).toContain(mechanism);
    },
  );

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

  it('answers UNSUPPORTED for SSH tunnels, before looking at auth', () => {
    const error = errorOf(() =>
      clientConfig(
        draft({
          ssh: { host: 'bastion.example.test', port: 22, username: 'ops', method: 'agent' },
          auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'saved' },
        }),
        {},
      ),
    );
    expect(error?.code).toBe('UNSUPPORTED');
    expect(error?.message).toMatch(/SSH/);
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
