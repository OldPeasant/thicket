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

/**
 * Whether a `mongodb://` / `mongodb+srv://` URI has a password in its userinfo. The authority
 * (userinfo and the host list, e.g. `u:p@h1:27017,h2:27017`) ends at the first `/`, `?` or `#`;
 * the userinfo is everything before its last `@`, and a `:` in it separates user and password.
 */
export function hasPassword(uri: string): boolean {
  const rest = uri.replace(/^mongodb(\+srv)?:\/\//, '');
  const authority = rest.split(/[/?#]/, 1)[0] ?? '';
  const at = authority.lastIndexOf('@');
  return at >= 0 && authority.slice(0, at).includes(':');
}

export const profileAuth = z.strictObject({
  mechanism: z.enum(AUTH_MECHANISMS),
  username: optionalString,
  authSource: optionalString,
  /** How the password (or other primary secret) is obtained. */
  secretMode: z.enum(['saved', 'ask', 'none']),
});

/**
 * File paths in a profile (`tls.caFile`, `tls.certificateKeyFile`, `ssh.privateKeyFile`) are the
 * deliberate exception to "the renderer never sends file paths": they are part of the stored
 * profile. The renderer gets them from `profiles.chooseFile` (native dialog in `main`).
 */
export const FILE_PURPOSES = ['tlsCaFile', 'tlsCertificateKeyFile', 'sshPrivateKeyFile'] as const;

export type FilePurpose = (typeof FILE_PURPOSES)[number];

export const profileTls = z.strictObject({
  enabled: z.boolean(),
  /** Path from `profiles.chooseFile({ purpose: 'tlsCaFile' })`. */
  caFile: optionalString,
  /** Path from `profiles.chooseFile({ purpose: 'tlsCertificateKeyFile' })`. */
  certificateKeyFile: optionalString,
  allowInvalidHostnames: z.boolean().optional(),
  allowInvalidCertificates: z.boolean().optional(),
});

export const profileSsh = z.strictObject({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  method: z.enum(['password', 'privateKey', 'agent']),
  /** Path from `profiles.chooseFile({ purpose: 'sshPrivateKeyFile' })`. */
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
  /**
   * Connection string without password (`mongodb://` or `mongodb+srv://`, one or more hosts).
   * A username in the userinfo (`user@host`) is allowed; a password (`user:pass@host`) is rejected
   * in params and results, so it can neither be stored in `connections.json` nor reach the renderer.
   */
  connectionString: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, {
      message: 'connectionString must start with mongodb:// or mongodb+srv://',
    })
    .refine((uri) => !hasPassword(uri), {
      message:
        'connectionString must not contain a password (user:password@); store it with profiles.setSecret',
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

/**
 * Protection of `secrets.bin`:
 * - `secure`: encrypted with a key from the OS keychain (macOS Keychain, Windows DPAPI, libsecret
 *   or KWallet on Linux).
 * - `weak`: Linux without a keyring (`basic_text` backend): encrypted with a hard-coded key, so
 *   anyone who can read the file can read the secrets. New profiles default to not saving them.
 * - `unavailable`: no encryption at all; secrets cannot be saved.
 */
export const SECRET_STORAGE_LEVELS = ['secure', 'weak', 'unavailable'] as const;

export type SecretStorageLevel = (typeof SECRET_STORAGE_LEVELS)[number];

export const secretStorageStatus = z.object({
  level: z.enum(SECRET_STORAGE_LEVELS),
  /** Electron's backend name, e.g. `keychain`, `dpapi`, `gnome_libsecret`, `kwallet5`, `basic_text`. */
  backend: z.string(),
  /** `secretMode` for new profiles: `saved` only when the storage is `secure`. */
  defaultSecretMode: z.enum(['saved', 'ask']),
});

export type SecretStorageStatus = z.infer<typeof secretStorageStatus>;

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
  'profiles.chooseFile': {
    summary: 'Choose a TLS CA, client certificate/key or SSH key file with a native open dialog',
    route: 'main',
    params: z.strictObject({ purpose: z.enum(FILE_PURPOSES) }),
    /** `path` is `null` when the dialog was cancelled. */
    result: z.object({ path: z.string().min(1).nullable() }),
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
  'profiles.secretStorage': {
    summary: 'How well the OS keychain protects saved secrets (for the weak-keychain warning)',
    route: 'main',
    params: emptyParams,
    result: secretStorageStatus,
  },
});
