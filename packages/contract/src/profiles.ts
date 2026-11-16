import { z } from 'zod';

import { emptyParams, emptyResult, profileId } from './common';
import { defineMethods } from './define';

/**
 * Connection profiles (served by `main`, stored in `connections.json` without secrets).
 * Secrets go in only through `profiles.setSecret` and never come back out.
 */

export const AUTH_MECHANISMS = [
  'NONE',
  'SCRAM-SHA-1',
  'SCRAM-SHA-256',
  'MONGODB-X509',
  'PLAIN',
  'MONGODB-OIDC',
  'MONGODB-AWS',
  'GSSAPI',
] as const;

export const SECRET_KINDS = [
  'password',
  'sshPassword',
  'sshKeyPassphrase',
  'tlsKeyPassphrase',
  'awsSecretAccessKey',
  'awsSessionToken',
  'oidcTokens',
] as const;

export type SecretKind = (typeof SECRET_KINDS)[number];

export const READ_PREFERENCES = [
  'primary',
  'primaryPreferred',
  'secondary',
  'secondaryPreferred',
  'nearest',
] as const;

const optionalString = z.string().min(1).optional();

export const profileAuth = z.strictObject({
  mechanism: z.enum(AUTH_MECHANISMS),
  username: optionalString,
  authSource: optionalString,
  /** How the password (or other primary secret) is obtained. */
  secretMode: z.enum(['saved', 'ask', 'none']),
});

export const profileTls = z.strictObject({
  enabled: z.boolean(),
  caFile: optionalString,
  certificateKeyFile: optionalString,
  allowInvalidHostnames: z.boolean().optional(),
  allowInvalidCertificates: z.boolean().optional(),
});

export const profileSsh = z.strictObject({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  method: z.enum(['password', 'privateKey', 'agent']),
  privateKeyFile: optionalString,
});

/** A profile without secrets. Fields are added by the connection tasks; unknown keys are rejected. */
export const profile = z.strictObject({
  id: profileId,
  name: z.string().min(1, { message: 'name must not be empty' }),
  /** Accent color (CSS color). */
  color: optionalString,
  /** Folder/group path, `/`-separated. */
  folder: optionalString,
  /** Connection string without password (`mongodb://` or `mongodb+srv://`). */
  connectionString: z.string().regex(/^mongodb(\+srv)?:\/\//, {
    message: 'connectionString must start with mongodb:// or mongodb+srv://',
  }),
  auth: profileAuth.optional(),
  tls: profileTls.optional(),
  ssh: profileSsh.optional(),
  readPreference: z.enum(READ_PREFERENCES).optional(),
  appName: optionalString,
  connectTimeoutMS: z.number().int().positive().optional(),
  serverSelectionTimeoutMS: z.number().int().positive().optional(),
  /** All write UI disabled; the backend refuses writes too. */
  readOnly: z.boolean(),
  /** Red accent; every write needs `confirmed: true`. */
  production: z.boolean(),
});

export type Profile = z.infer<typeof profile>;

/** A profile being created or edited: `id` is assigned by `main` when missing. */
export const profileDraft = profile.extend({ id: profileId.optional() });

export type ProfileDraft = z.infer<typeof profileDraft>;

/** Result of the import methods. */
export const importResult = z.object({
  imported: z.array(profile),
  skipped: z.array(z.object({ source: z.string(), reason: z.string() })),
});

export const profilesMethods = defineMethods({
  'profiles.list': {
    summary: 'List all profiles',
    route: 'main',
    params: emptyParams,
    result: z.object({ profiles: z.array(profile) }),
  },
  'profiles.get': {
    summary: 'Get one profile',
    route: 'main',
    params: z.strictObject({ profileId }),
    result: z.object({
      profile,
      /** Which secrets are stored (never their values). */
      storedSecrets: z.array(z.enum(SECRET_KINDS)),
    }),
  },
  'profiles.save': {
    summary: 'Create or update a profile',
    route: 'main',
    params: z.strictObject({ profile: profileDraft }),
    result: z.object({ profile }),
  },
  'profiles.delete': {
    summary: 'Delete a profile and its secrets',
    route: 'main',
    params: z.strictObject({ profileId }),
    result: emptyResult,
  },
  'profiles.duplicate': {
    summary: 'Copy a profile (without secrets) under a new id',
    route: 'main',
    params: z.strictObject({ profileId }),
    result: z.object({ profile }),
  },
  'profiles.importCompass': {
    summary: 'Import a Compass connections export (file chosen with a native dialog)',
    route: 'main',
    params: emptyParams,
    /** `null` when the dialog was cancelled. */
    result: importResult.nullable(),
  },
  'profiles.importUris': {
    summary: 'Create profiles from connection strings',
    route: 'main',
    params: z.strictObject({
      uris: z.array(z.string().min(1)).min(1, { message: 'uris must contain at least one entry' }),
    }),
    result: importResult,
  },
  'profiles.export': {
    summary: 'Export profiles as JSON without secrets (file chosen with a native dialog)',
    route: 'main',
    params: z.strictObject({ profileIds: z.array(profileId).optional() }),
    /** `path` is `null` when the dialog was cancelled. */
    result: z.object({ path: z.string().nullable(), exported: z.number().int().nonnegative() }),
  },
  'profiles.setSecret': {
    summary: 'Store a secret in the OS keychain',
    route: 'main',
    params: z.strictObject({
      profileId,
      kind: z.enum(SECRET_KINDS),
      value: z.string(),
    }),
    result: z.object({
      /** False when only `basic_text` encryption is available (Linux without keyring). */
      secureStorage: z.boolean(),
    }),
  },
  'profiles.clearSecret': {
    summary: 'Remove one (or, without `kind`, all) secrets of a profile',
    route: 'main',
    params: z.strictObject({ profileId, kind: z.enum(SECRET_KINDS).optional() }),
    result: emptyResult,
  },
});
