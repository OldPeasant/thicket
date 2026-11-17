import { createRequire } from 'node:module';

import type { ProfileDraft } from '@thicket/contract';
import type { MongoClientOptions } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { RpcError } from '../../server/rpc';
import { awsAuthOptions } from './aws';

/** Fictitious values; nothing here is a real AWS credential. */
const KEY_ID = 'AKIAFICTITIOUSKEYID0';
const SECRET_KEY = 'fictitious/secret+access+key';
const SESSION_TOKEN = 'fictitious-session-token';

type Auth = NonNullable<ProfileDraft['auth']>;

function auth(extra: Partial<Auth> = {}): Auth {
  return { mechanism: 'MONGODB-AWS', secretMode: 'saved', ...extra };
}

async function credentialsOf(options: MongoClientOptions): Promise<unknown> {
  const provider = options.authMechanismProperties?.AWS_CREDENTIAL_PROVIDER;
  expect(provider).toBeTypeOf('function');
  return provider?.();
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

describe('awsAuthOptions', () => {
  describe('explicit keys', () => {
    it('passes the access key ID and the saved secret access key to a credential provider', async () => {
      const options = awsAuthOptions(
        auth({ username: KEY_ID }),
        { awsSecretAccessKey: SECRET_KEY },
        undefined,
      );
      expect(options).toMatchObject({ authMechanism: 'MONGODB-AWS', authSource: '$external' });
      expect(options.auth).toBeUndefined();
      expect(await credentialsOf(options)).toEqual({
        accessKeyId: KEY_ID,
        secretAccessKey: SECRET_KEY,
      });
    });

    it('adds a saved session token for temporary credentials', async () => {
      const options = awsAuthOptions(
        auth({ username: KEY_ID }),
        { awsSecretAccessKey: SECRET_KEY, awsSessionToken: SESSION_TOKEN },
        undefined,
      );
      expect(await credentialsOf(options)).toEqual({
        accessKeyId: KEY_ID,
        secretAccessKey: SECRET_KEY,
        sessionToken: SESSION_TOKEN,
      });
      // Driver 7 refuses AWS_SESSION_TOKEN as a mechanism property.
      expect(options.authMechanismProperties).not.toHaveProperty('AWS_SESSION_TOKEN');
    });

    it('uses the secret typed at connect, over a saved one', async () => {
      const options = awsAuthOptions(
        auth({ username: KEY_ID }),
        { password: 'typed-secret', awsSecretAccessKey: SECRET_KEY },
        undefined,
      );
      expect(await credentialsOf(options)).toMatchObject({ secretAccessKey: 'typed-secret' });
    });

    it("ignores a saved secret access key with secretMode 'ask'", async () => {
      const error = errorOf(() =>
        awsAuthOptions(
          auth({ username: KEY_ID, secretMode: 'ask' }),
          { awsSecretAccessKey: SECRET_KEY },
          undefined,
        ),
      );
      expect(error?.code).toBe('AUTH_FAILED');
      const asked = awsAuthOptions(
        auth({ username: KEY_ID, secretMode: 'ask' }),
        { password: 'typed-secret', awsSecretAccessKey: SECRET_KEY },
        undefined,
      );
      expect(await credentialsOf(asked)).toMatchObject({ secretAccessKey: 'typed-secret' });
    });

    it('answers AUTH_FAILED without a secret access key, naming the key ID but no secret', () => {
      const error = errorOf(() =>
        awsAuthOptions(auth({ username: KEY_ID }), { awsSessionToken: SESSION_TOKEN }, undefined),
      );
      expect(error?.code).toBe('AUTH_FAILED');
      expect(error?.message).toContain(KEY_ID);
      expect(error?.message).not.toContain(SESSION_TOKEN);
    });

    it("answers AUTH_FAILED for an access key ID with secretMode 'none'", () => {
      const error = errorOf(() =>
        awsAuthOptions(
          auth({ username: KEY_ID, secretMode: 'none' }),
          { password: 'typed', awsSecretAccessKey: SECRET_KEY },
          undefined,
        ),
      );
      expect(error?.code).toBe('AUTH_FAILED');
    });

    it('always authenticates against $external, whatever authSource the profile has', () => {
      const options = awsAuthOptions(
        auth({ username: KEY_ID, authSource: 'admin' }),
        { awsSecretAccessKey: SECRET_KEY },
        undefined,
      );
      expect(options.authSource).toBe('$external');
    });
  });

  describe('default credential chain', () => {
    it('sets only the mechanism: the driver builds the chain from @aws-sdk/credential-providers', () => {
      const options = awsAuthOptions(
        auth({ secretMode: 'none' }),
        { password: 'ignored', awsSecretAccessKey: SECRET_KEY },
        undefined,
      );
      expect(options).toEqual({ authMechanism: 'MONGODB-AWS', authSource: '$external' });
    });

    it('the driver can load @aws-sdk/credential-providers (it refuses MONGODB-AWS without it)', () => {
      const requireFromDriver = createRequire(createRequire(import.meta.url).resolve('mongodb'));
      const sdk = requireFromDriver('@aws-sdk/credential-providers') as Record<string, unknown>;
      expect(sdk['fromNodeProviderChain']).toBeTypeOf('function');
    });
  });

  it('answers AUTH_FAILED for a user name in the connection string', () => {
    const error = errorOf(() => awsAuthOptions(auth(), {}, 'alice'));
    expect(error?.code).toBe('AUTH_FAILED');
    expect(error?.message).toContain('connection string');
  });
});
