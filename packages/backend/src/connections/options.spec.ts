import type { ProfileDraft } from '@thicket/contract';
import { describe, expect, it } from 'vitest';

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

  it.each(['MONGODB-X509', 'PLAIN', 'GSSAPI', 'MONGODB-OIDC', 'MONGODB-AWS'] as const)(
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
});
