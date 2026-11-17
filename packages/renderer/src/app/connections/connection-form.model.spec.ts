import { profileDraft as profileDraftSchema, type Profile } from '@thicket/contract';
import { MASK, emptyConnectionModel } from '@thicket/core/uri';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OIDC_FLOW,
  DEFAULT_PASSWORD_MECHANISM,
  FORM_MECHANISMS,
  applyConnectionString,
  awsKeys,
  connectionStringText,
  editorProblems,
  editorStateFromProfile,
  folderNames,
  formatTagSet,
  hostSummary,
  newEditorState,
  parseTagSet,
  parseW,
  passwordInUse,
  profileDraftFromState,
  stripUriSecrets,
  usedSecretKinds,
  usesExternalSource,
  usesPassword,
  type EditorState,
} from './connection-form.model';

/** Fictitious password used throughout; it must never end up in a draft. */
const PW = 'fictitious-Pa55';

const profile = (extra: Partial<Profile> = {}): Profile => ({
  id: 'p1',
  name: 'Orders',
  connectionString: 'mongodb://alice@db1.example.test:27017/?authMechanism=SCRAM-SHA-256',
  auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'saved' },
  readOnly: false,
  production: false,
  ...extra,
});

/** A profile using every field the editor maps, plus ones the form does not edit. */
const rich = (): Profile => ({
  id: 'rich-1',
  name: 'Reporting',
  color: '#3b7dd8',
  folder: 'Customers/EU',
  connectionString:
    'mongodb://report@db1.example.test:27017,db2.example.test:27018/sales?replicaSet=rs0',
  auth: {
    mechanism: 'SCRAM-SHA-1',
    username: 'report',
    authSource: 'admin',
    secretMode: 'ask',
  },
  tls: {
    enabled: true,
    caFile: '/fictitious/ca.pem',
    certificateKeyFile: '/fictitious/client.crt',
    keyFile: '/fictitious/client.key',
    allowInvalidHostnames: true,
    allowInvalidCertificates: false,
  },
  ssh: {
    host: 'bastion.example.test',
    port: 22,
    username: 'jumper',
    method: 'privateKey',
    privateKeyFile: '/fictitious/id_ed25519',
  },
  proxy: { host: 'socks.example.test', port: 1081, username: 'pat' },
  readPreference: 'secondaryPreferred',
  readPreferenceTags: [[{ name: 'dc', value: 'east' }], []],
  writeConcern: { w: 'majority', journal: true, wtimeoutMS: 5000 },
  appName: 'Thicket report',
  connectTimeoutMS: 7000,
  serverSelectionTimeoutMS: 9000,
  readOnly: true,
  production: true,
});

const withState = (patch: Partial<EditorState> = {}): EditorState => ({
  ...newEditorState('saved'),
  name: 'Local',
  ...patch,
});

function uriOf(state: EditorState): string {
  const shown = connectionStringText(state);
  if (shown.text === undefined) throw new Error(`no connection string: ${shown.error}`);
  return shown.text;
}

function applied(state: EditorState, text: string): EditorState {
  const result = applyConnectionString(state, text);
  if (result.state === undefined) throw new Error(`not applied: ${result.error}`);
  return result.state;
}

describe('connection-form.model', () => {
  describe('newEditorState', () => {
    it('starts on localhost:27017 without authentication and with the given secret mode', () => {
      const state = newEditorState('ask');
      expect(state.model).toEqual(emptyConnectionModel());
      expect(state.mechanism).toBe('NONE');
      expect(state.password).toBe('');
      expect(state.secretMode).toBe('ask');
      expect(state.readOnly).toBe(false);
      expect(state.production).toBe(false);
      expect(state.id).toBeUndefined();
      expect(uriOf(withState())).toBe('mongodb://localhost:27017');
    });
  });

  describe('usesPassword', () => {
    it('is true only for the password mechanisms', () => {
      expect(usesPassword('SCRAM-SHA-256')).toBe(true);
      expect(usesPassword('SCRAM-SHA-1')).toBe(true);
      expect(usesPassword('PLAIN')).toBe(true);
      expect(usesPassword('NONE')).toBe(false);
      expect(usesPassword('MONGODB-X509')).toBe(false);
    });
  });

  describe('profile → state → draft round trip', () => {
    it('keeps every profile field, including SSH, tls.keyFile, tags, write concern and proxy', () => {
      const original = rich();
      const draft = profileDraftFromState(editorStateFromProfile(original, 'saved'));
      // Every field but the connection string (checked in the next test) comes back unchanged.
      expect({ ...draft, connectionString: '' }).toEqual({ ...original, connectionString: '' });
      expect(profileDraftSchema.safeParse(draft).success).toBe(true);
    });

    it('writes the form fields into the saved connection string (without password)', () => {
      const draft = profileDraftFromState(editorStateFromProfile(rich(), 'saved'));
      const uri = draft.connectionString;
      expect(
        uri.startsWith('mongodb://report@db1.example.test:27017,db2.example.test:27018/sales?'),
      ).toBe(true);
      for (const part of [
        'replicaSet=rs0',
        'authMechanism=SCRAM-SHA-1',
        'authSource=admin',
        'readPreference=secondaryPreferred',
        'w=majority',
        'proxyHost=socks.example.test',
      ]) {
        expect(uri).toContain(part);
      }
    });

    it('is stable: a draft loaded again gives the same draft', () => {
      const first = profileDraftFromState(editorStateFromProfile(rich(), 'saved'));
      const again = profileDraftFromState(
        editorStateFromProfile({ ...first, id: 'rich-1' } as Profile, 'saved'),
      );
      expect(again).toEqual(first);
    });

    it('keeps tls.keyFile only together with a client certificate', () => {
      const state = editorStateFromProfile(rich(), 'saved');
      state.model.tls.certificateKeyFile = '';
      const draft = profileDraftFromState(state);
      expect(draft.tls?.certificateKeyFile).toBeUndefined();
      expect(draft.tls?.keyFile).toBeUndefined();
      expect(draft.tls?.caFile).toBe('/fictitious/ca.pem');
    });
  });

  describe('editorStateFromProfile', () => {
    it('lets the profile fields win over the same options in the connection string', () => {
      const state = editorStateFromProfile(
        profile({
          connectionString:
            'mongodb://bob@db1.example.test/?authMechanism=SCRAM-SHA-1&appName=old&readPreference=nearest',
          auth: { mechanism: 'SCRAM-SHA-256', username: 'alice', secretMode: 'saved' },
          appName: 'new',
          readPreference: 'secondary',
        }),
        'saved',
      );
      expect(state.mechanism).toBe('SCRAM-SHA-256');
      expect(state.model.username).toBe('alice');
      expect(state.model.appName).toBe('new');
      expect(state.model.readPreference.mode).toBe('secondary');
    });

    it('never keeps a password from the connection string and knows no typed password', () => {
      const state = editorStateFromProfile(profile(), 'saved');
      expect(state.model.password).toBeUndefined();
      expect(state.password).toBe('');
      expect(state.base).toEqual(profile());
    });

    it('drops the user name of a NONE profile', () => {
      const state = editorStateFromProfile(
        profile({
          connectionString: 'mongodb://ghost@db1.example.test/?authMechanism=SCRAM-SHA-256',
          auth: { mechanism: 'NONE', secretMode: 'none' },
        }),
        'saved',
      );
      expect(state.mechanism).toBe('NONE');
      expect(state.model.username).toBeUndefined();
      expect(state.model.auth.mechanism).toBeUndefined();
      expect(uriOf(state)).toBe('mongodb://db1.example.test');
    });

    it('without profile.auth derives the mechanism and secret mode from the URI', () => {
      const user = editorStateFromProfile(
        profile({ connectionString: 'mongodb://carol@db1.example.test', auth: undefined }),
        'ask',
      );
      expect(user.mechanism).toBe(DEFAULT_PASSWORD_MECHANISM);
      expect(user.secretMode).toBe('ask');

      const anonymous = editorStateFromProfile(
        profile({ connectionString: 'mongodb://db1.example.test', auth: undefined }),
        'saved',
      );
      expect(anonymous.mechanism).toBe('NONE');
      expect(anonymous.secretMode).toBe('none');
    });

    it('falls back to localhost for an invalid saved connection string but keeps the profile fields', () => {
      const state = editorStateFromProfile(
        profile({ connectionString: 'mongodb://', appName: 'kept', folder: 'Lab' }),
        'saved',
      );
      expect(state.model.hosts).toEqual([{ host: 'localhost', port: 27017 }]);
      expect(state.model.username).toBe('alice');
      expect(state.model.appName).toBe('kept');
      expect(state.folder).toBe('Lab');
      expect(state.name).toBe('Orders');
      expect(editorProblems(state)).toEqual([]);
    });
  });

  describe('connectionStringText', () => {
    it('shows a typed password as MASK, never in clear', () => {
      const state = withState({
        mechanism: 'SCRAM-SHA-256',
        password: PW,
        model: { ...emptyConnectionModel(), username: 'alice' },
      });
      const uri = uriOf(state);
      expect(uri).toBe(`mongodb://alice:${MASK}@localhost:27017/?authMechanism=SCRAM-SHA-256`);
      expect(uri).not.toContain(PW);
    });

    it('shows no password when none is typed', () => {
      const state = withState({
        mechanism: 'SCRAM-SHA-256',
        model: { ...emptyConnectionModel(), username: 'alice' },
      });
      expect(uriOf(state)).toBe('mongodb://alice@localhost:27017/?authMechanism=SCRAM-SHA-256');
    });

    it('NONE shows neither the user nor the typed password nor the auth source', () => {
      const model = emptyConnectionModel();
      model.username = 'alice';
      model.auth.source = 'admin';
      const uri = uriOf(withState({ mechanism: 'NONE', password: PW, model }));
      expect(uri).toBe('mongodb://localhost:27017');
    });

    it('reports a model that cannot be written as a connection string', () => {
      const model = emptyConnectionModel();
      model.hosts = [];
      const shown = connectionStringText(withState({ model }));
      expect(shown.text).toBeUndefined();
      expect(shown.error).toEqual(expect.any(String));
    });
  });

  describe('applyConnectionString', () => {
    const base = () =>
      withState({ name: 'Keep me', color: '#1f9d8b', folder: 'Lab', readOnly: true });

    it('moves a password from the URI into the password field and out of the model', () => {
      const state = applied(base(), `mongodb://alice:${PW}@db1.example.test:27017`);
      expect(state.password).toBe(PW);
      expect(state.model.password).toBeUndefined();
      expect(state.model.username).toBe('alice');
      expect(state.mechanism).toBe('SCRAM-SHA-256');
      expect(state.model.auth.mechanism).toBe('SCRAM-SHA-256');
      expect(uriOf(state)).not.toContain(PW);
    });

    it('MASK keeps the password already typed', () => {
      const typed = { ...base(), password: PW };
      const state = applied(typed, `mongodb://alice:${MASK}@db1.example.test`);
      expect(state.password).toBe(PW);
    });

    it('a URI without password clears the typed one', () => {
      const typed = { ...base(), password: PW };
      expect(applied(typed, 'mongodb://alice@db1.example.test').password).toBe('');
    });

    it('keeps name, color, folder and flags', () => {
      const state = applied(base(), 'mongodb://db9.example.test:27020');
      expect(state).toMatchObject({
        name: 'Keep me',
        color: '#1f9d8b',
        folder: 'Lab',
        readOnly: true,
      });
      expect(state.model.hosts).toEqual([{ host: 'db9.example.test', port: 27020 }]);
    });

    it('takes an explicit authMechanism', () => {
      const state = applied(base(), 'mongodb://alice@db1.example.test/?authMechanism=SCRAM-SHA-1');
      expect(state.mechanism).toBe('SCRAM-SHA-1');
    });

    it('switches the secret mode with the authentication', () => {
      const anonymous = applied(base(), 'mongodb://db1.example.test');
      expect(anonymous.mechanism).toBe('NONE');
      expect(anonymous.secretMode).toBe('none');
      // Coming from 'none', a user name makes the profile ask for its password.
      const user = applied(anonymous, 'mongodb://alice@db1.example.test');
      expect(user.secretMode).toBe('ask');
      // An explicit choice ('saved') survives further edits.
      const saved = applied({ ...user, secretMode: 'saved' }, 'mongodb://bob@db1.example.test');
      expect(saved.secretMode).toBe('saved');
    });

    it('returns an error and no state for an invalid connection string', () => {
      for (const text of ['', 'http://db1.example.test', 'mongodb://', 'not a uri']) {
        const result = applyConnectionString(base(), text);
        expect(result.state, text).toBeUndefined();
        expect(result.error, text).toEqual(expect.any(String));
      }
    });
  });

  describe('profileDraftFromState', () => {
    const passwordState = (): EditorState =>
      withState({
        name: '  Orders  ',
        mechanism: 'SCRAM-SHA-256',
        password: PW,
        model: { ...emptyConnectionModel(), username: 'alice' },
      });

    it('never contains the typed password', () => {
      const draft = profileDraftFromState(passwordState());
      expect(draft.connectionString).toBe(
        'mongodb://alice@localhost:27017/?authMechanism=SCRAM-SHA-256',
      );
      expect(JSON.stringify(draft)).not.toContain(PW);
      expect(profileDraftSchema.safeParse(draft).success).toBe(true);
    });

    it('never contains a password pasted into the connection-string tab', () => {
      const state = applied(passwordState(), `mongodb://alice:${PW}@db1.example.test`);
      const draft = profileDraftFromState(state);
      expect(JSON.stringify(draft)).not.toContain(PW);
      expect(profileDraftSchema.safeParse(draft).success).toBe(true);
    });

    it('never contains secret URI options (proxyPassword, tlsCertificateKeyFilePassword)', () => {
      const state = applied(
        passwordState(),
        `mongodb://alice@db1.example.test/?proxyHost=socks.example.test&proxyUsername=pat` +
          `&proxyPassword=${PW}&tls=true&tlsCertificateKeyFile=%2Ffictitious%2Fc.pem` +
          `&tlsCertificateKeyFilePassword=${PW}`,
      );
      const draft = profileDraftFromState(state);
      expect(JSON.stringify(draft)).not.toContain(PW);
    });

    it('trims the name and leaves out an empty color', () => {
      const draft = profileDraftFromState({ ...passwordState(), color: ' ' });
      expect(draft.name).toBe('Orders');
      expect(draft).not.toHaveProperty('color');
      expect(draft).not.toHaveProperty('id');
    });

    it('keeps the id of an edited profile', () => {
      expect(profileDraftFromState({ ...passwordState(), id: 'p7' }).id).toBe('p7');
    });

    it('normalizes the folder path', () => {
      const folder = (value: string | undefined) =>
        profileDraftFromState(withState({ folder: value })).folder;
      expect(folder(' Customers / / EU / ')).toBe('Customers/EU');
      expect(folder('/Lab/')).toBe('Lab');
      expect(folder('Lab')).toBe('Lab');
      expect(folder('/')).toBeUndefined();
      expect(folder(' / ')).toBeUndefined();
      expect(folder('   ')).toBeUndefined();
      expect(folder(undefined)).toBeUndefined();
    });

    it('NONE clears user, auth source and the secret mode', () => {
      const model = emptyConnectionModel();
      model.username = 'alice';
      model.auth.source = 'admin';
      const draft = profileDraftFromState(
        withState({ mechanism: 'NONE', password: PW, secretMode: 'saved', model }),
      );
      expect(draft.auth).toEqual({ mechanism: 'NONE', secretMode: 'none' });
      expect(draft.connectionString).toBe('mongodb://localhost:27017');
      expect(JSON.stringify(draft)).not.toContain('alice');
    });

    it('keeps the secret mode of a password mechanism and the auth source', () => {
      const state = passwordState();
      state.secretMode = 'ask';
      state.model.auth.source = 'admin';
      expect(profileDraftFromState(state).auth).toEqual({
        mechanism: 'SCRAM-SHA-256',
        username: 'alice',
        authSource: 'admin',
        secretMode: 'ask',
      });
    });

    it('a mechanism without password (X.509) saves no secret mode', () => {
      const original = profile({
        connectionString: 'mongodb://db1.example.test/?authMechanism=MONGODB-X509&tls=true',
        auth: { mechanism: 'MONGODB-X509', secretMode: 'none' },
        tls: { enabled: true, certificateKeyFile: '/fictitious/x509.pem' },
      });
      const state = editorStateFromProfile(original, 'saved');
      state.secretMode = 'saved';
      const draft = profileDraftFromState(state);
      expect(draft.auth).toEqual({ mechanism: 'MONGODB-X509', secretMode: 'none' });
      expect(draft.tls).toEqual({ enabled: true, certificateKeyFile: '/fictitious/x509.pem' });
    });

    it('TLS options without tls=… use the driver default (on for SRV)', () => {
      const srv = withState({
        model: {
          ...emptyConnectionModel(),
          scheme: 'mongodb+srv',
          hosts: [{ host: 'cluster0.example.test' }],
          tls: { caFile: '/fictitious/ca.pem' },
        },
      });
      expect(profileDraftFromState(srv).tls).toEqual({
        enabled: true,
        caFile: '/fictitious/ca.pem',
      });
      const plain = withState({
        model: { ...emptyConnectionModel(), tls: { allowInvalidHostnames: true } },
      });
      expect(profileDraftFromState(plain).tls).toEqual({
        enabled: false,
        allowInvalidHostnames: true,
      });
      expect(profileDraftFromState(withState())).not.toHaveProperty('tls');
    });

    it('leaves out read preference tags with primary or with an empty tag name', () => {
      const model = emptyConnectionModel();
      model.readPreference = { mode: 'primary', tags: [{ dc: 'east' }] };
      const primary = profileDraftFromState(withState({ model }));
      expect(primary.readPreference).toBe('primary');
      expect(primary).not.toHaveProperty('readPreferenceTags');

      const unnamed = emptyConnectionModel();
      unnamed.readPreference = { mode: 'nearest', tags: [{ '': 'east' }] };
      const draft = profileDraftFromState(withState({ model: unnamed }));
      expect(draft).not.toHaveProperty('readPreferenceTags');
      expect(profileDraftSchema.safeParse(draft).success).toBe(true);
    });

    it('leaves out an empty w, zero timeouts and an empty app name', () => {
      const model = emptyConnectionModel();
      model.writeConcern = { w: '', journal: false };
      model.timeouts = { connectTimeoutMS: 0, serverSelectionTimeoutMS: 0 };
      model.appName = '  ';
      const draft = profileDraftFromState(withState({ model }));
      expect(draft.writeConcern).toEqual({ journal: false });
      expect(draft).not.toHaveProperty('connectTimeoutMS');
      expect(draft).not.toHaveProperty('serverSelectionTimeoutMS');
      expect(draft).not.toHaveProperty('appName');
    });

    it('gives a proxy without port the SOCKS5 default 1080 and drops an empty proxy user', () => {
      const model = emptyConnectionModel();
      model.proxy = { host: 'socks.example.test', username: ' ' };
      expect(profileDraftFromState(withState({ model })).proxy).toEqual({
        host: 'socks.example.test',
        port: 1080,
      });
      const none = emptyConnectionModel();
      none.proxy = { host: '  ', port: 1081 };
      expect(profileDraftFromState(withState({ model: none }))).not.toHaveProperty('proxy');
    });
  });

  describe('editorProblems', () => {
    const valid = () => withState();

    it('is empty for a valid state', () => {
      expect(editorProblems(valid())).toEqual([]);
    });

    it('asks for a name (whitespace is no name)', () => {
      expect(editorProblems({ ...valid(), name: '' })).toEqual([
        'Enter a name for the connection.',
      ]);
      expect(editorProblems({ ...valid(), name: '   ' })).toEqual([
        'Enter a name for the connection.',
      ]);
    });

    it('asks for a host name for every host', () => {
      const empty = valid();
      empty.model.hosts = [];
      expect(editorProblems(empty)).toContain('Enter a host name for every host.');
      const blank = valid();
      blank.model.hosts = [{ host: 'db1.example.test' }, { host: ' ', port: 27017 }];
      expect(editorProblems(blank)).toContain('Enter a host name for every host.');
    });

    it('accepts ports 1 and 65535 and refuses 0, 65536 and fractions', () => {
      const withPort = (port: number) => {
        const state = valid();
        state.model.hosts = [{ host: 'db1.example.test', port }];
        return editorProblems(state);
      };
      expect(withPort(1)).toEqual([]);
      expect(withPort(65535)).toEqual([]);
      for (const port of [0, 65536, 27017.5, -1]) {
        expect(withPort(port), String(port)).toEqual(['Ports are whole numbers from 1 to 65535.']);
      }
    });

    it('refuses an SRV connection with a port or with several hosts', () => {
      const srv = (hosts: EditorState['model']['hosts']) => {
        const state = valid();
        state.model.scheme = 'mongodb+srv';
        state.model.hosts = hosts;
        return editorProblems(state);
      };
      const problem = 'An SRV connection has exactly one host name and no port.';
      expect(srv([{ host: 'cluster0.example.test' }])).toEqual([]);
      expect(srv([{ host: 'cluster0.example.test', port: 27017 }])).toEqual([problem]);
      expect(srv([{ host: 'a.example.test' }, { host: 'b.example.test' }])).toEqual([problem]);
    });

    it('asks for the user name of a password mechanism', () => {
      const state = valid();
      state.mechanism = 'SCRAM-SHA-1';
      state.model.username = '  ';
      expect(editorProblems(state)).toEqual([
        'Enter the user name, or choose "No authentication".',
      ]);
    });

    it('lists several problems at once', () => {
      const state = valid();
      state.name = '';
      state.mechanism = 'SCRAM-SHA-256';
      state.model.hosts = [{ host: '', port: 0 }];
      expect(editorProblems(state)).toEqual([
        'Enter a name for the connection.',
        'Enter a host name for every host.',
        'Ports are whole numbers from 1 to 65535.',
        'Enter the user name, or choose "No authentication".',
      ]);
    });
  });

  describe('M2 options: validation', () => {
    const ssh = (patch: Partial<EditorState['ssh']> = {}): EditorState =>
      withState({
        ssh: {
          enabled: true,
          host: 'bastion.example.test',
          port: 22,
          username: 'jumper',
          method: 'password',
          ...patch,
        },
      });

    it('accepts a complete SSH tunnel', () => {
      expect(editorProblems(ssh())).toEqual([]);
      expect(editorProblems(ssh({ method: 'agent' }))).toEqual([]);
      expect(
        editorProblems(ssh({ method: 'privateKey', privateKeyFile: '/fictitious/id_ed25519' })),
      ).toEqual([]);
    });

    it('asks for the SSH server, port, user and the key file of the key method', () => {
      expect(editorProblems(ssh({ host: ' ' }))).toEqual(['Enter the SSH server.']);
      expect(editorProblems(ssh({ username: '' }))).toEqual(['Enter the SSH user name.']);
      for (const port of [0, 65536, 22.5]) {
        expect(editorProblems(ssh({ port })), String(port)).toEqual([
          'The SSH port is a whole number from 1 to 65535.',
        ]);
      }
      // An empty SSH port means the default 22, like the proxy port's 1080 (review CR-1).
      expect(editorProblems(ssh({ port: undefined }))).toEqual([]);
      expect(profileDraftFromState(ssh({ port: undefined })).ssh?.port).toBe(22);
      expect(editorProblems(ssh({ method: 'privateKey' }))).toEqual([
        'Choose the SSH private key file.',
      ]);
    });

    it('ignores the SSH fields while the tunnel is off', () => {
      const state = ssh({ host: '', username: '' });
      state.ssh.enabled = false;
      expect(editorProblems(state)).toEqual([]);
      expect(profileDraftFromState(state).ssh).toBeUndefined();
    });

    it('refuses an SSH tunnel together with a proxy', () => {
      const state = ssh();
      state.model.proxy.host = 'socks.example.test';
      expect(editorProblems(state)).toEqual([
        'Use either an SSH tunnel or a SOCKS5 proxy, not both.',
      ]);
    });

    it('needs a proxy host for a proxy user and a valid proxy port', () => {
      const user = withState();
      user.model.proxy.username = 'pat';
      expect(editorProblems(user)).toEqual([
        'Enter the proxy host, or remove the proxy user name.',
      ]);
      const port = withState();
      port.model.proxy.host = 'socks.example.test';
      port.model.proxy.port = 70000;
      expect(editorProblems(port)).toEqual(['The proxy port is a whole number from 1 to 65535.']);
    });

    it('refuses a private key file without a client certificate (CR-2)', () => {
      const state = withState({ tlsKeyFile: '/fictitious/client.key' });
      state.model.tls.enabled = true;
      expect(editorProblems(state)).toEqual([
        'A private key file needs the client certificate file it belongs to.',
      ]);
      state.model.tls.certificateKeyFile = '/fictitious/client.crt';
      expect(editorProblems(state)).toEqual([]);
    });

    it('refuses read preference tags with primary or no read preference (CR-3)', () => {
      const problem = 'Read preference tags need a read preference other than Primary.';
      const state = withState();
      state.model.readPreference.tags = [{ dc: 'east' }];
      expect(editorProblems(state)).toEqual([problem]);
      state.model.readPreference.mode = 'primary';
      expect(editorProblems(state)).toEqual([problem]);
      state.model.readPreference.mode = 'nearest';
      expect(editorProblems(state)).toEqual([]);
    });

    it('asks for a name for every tag', () => {
      const state = withState();
      state.model.readPreference.mode = 'secondary';
      state.model.readPreference.tags = [{ '': 'east' }];
      expect(editorProblems(state)).toEqual([
        'Every read preference tag needs a name (name:value).',
      ]);
    });

    it('X.509 needs TLS and a client certificate', () => {
      const problem = 'X.509 authentication needs TLS and a client certificate file.';
      const state = withState({ mechanism: 'MONGODB-X509', secretMode: 'none' });
      expect(editorProblems(state)).toEqual([problem]);
      state.model.tls.certificateKeyFile = '/fictitious/client.pem';
      expect(editorProblems(state)).toEqual([problem]);
      state.model.tls.enabled = true;
      expect(editorProblems(state)).toEqual([]);
    });
  });

  describe('M2 options: URI sync and draft', () => {
    it('writes proxy, tags, write concern and the client certificate into the URI', () => {
      const state = withState();
      state.model.proxy = { host: 'socks.example.test', port: 1081, username: 'pat' };
      state.model.readPreference = { mode: 'secondary', tags: [{ dc: 'east', rack: '1' }, {}] };
      state.model.writeConcern = { w: 'majority', journal: true, wtimeoutMS: 5000 };
      state.model.tls = { enabled: true, certificateKeyFile: '/fictitious/client.pem' };
      const uri = uriOf(state);
      expect(uri).toContain('proxyHost=socks.example.test');
      expect(uri).toContain('proxyPort=1081');
      expect(uri).toContain('proxyUsername=pat');
      expect(uri).toContain('readPreference=secondary');
      expect(uri).toMatch(/readPreferenceTags=dc(:|%3A)east(,|%2C)rack(:|%3A)1/);
      expect(uri).toContain('w=majority');
      expect(uri).toContain('journal=true');
      expect(uri).toContain('wtimeoutMS=5000');
      expect(uri).toContain('tlsCertificateKeyFile=');
    });

    it('a pasted URI fills the proxy, tag, write concern and X.509 fields', () => {
      const state = applied(
        withState(),
        'mongodb://db1.example.test/?tls=true&tlsCertificateKeyFile=%2Ffictitious%2Fc.pem' +
          '&authMechanism=MONGODB-X509&proxyHost=socks.example.test&proxyPort=1081' +
          '&readPreference=nearest&readPreferenceTags=dc:east&readPreferenceTags=' +
          '&w=2&journal=false&wtimeoutMS=100',
      );
      expect(state.mechanism).toBe('MONGODB-X509');
      expect(state.secretMode).toBe('none');
      expect(state.model.tls.certificateKeyFile).toBe('/fictitious/c.pem');
      expect(state.model.proxy).toMatchObject({ host: 'socks.example.test', port: 1081 });
      expect(state.model.readPreference.tags).toEqual([{ dc: 'east' }, {}]);
      expect(state.model.writeConcern).toEqual({ w: 2, journal: false, wtimeoutMS: 100 });
      const draft = profileDraftFromState(state);
      expect(draft.auth).toEqual({ mechanism: 'MONGODB-X509', secretMode: 'none' });
      expect(draft.readPreferenceTags).toEqual([[{ name: 'dc', value: 'east' }], []]);
      expect(draft.proxy).toEqual({ host: 'socks.example.test', port: 1081 });
      expect(draft.writeConcern).toEqual({ w: 2, journal: false, wtimeoutMS: 100 });
    });

    it('X.509 never writes an authSource, also when a pasted URI has one (review CR-2)', () => {
      const state = applied(
        withState(),
        'mongodb://db1.example.test/?tls=true&tlsCertificateKeyFile=%2Ffictitious%2Fc.pem' +
          '&authMechanism=MONGODB-X509&authSource=admin',
      );
      expect(state.mechanism).toBe('MONGODB-X509');
      const uri = connectionStringText(state).text ?? '';
      expect(uri).toContain('authMechanism=MONGODB-X509');
      expect(uri).not.toContain('authSource');
      expect(profileDraftFromState(state).connectionString).not.toContain('authSource');
      expect(profileDraftFromState(state).auth).toEqual({
        mechanism: 'MONGODB-X509',
        secretMode: 'none',
      });
    });

    it('keeps SSH out of the URI and puts it in the draft (default port 22, key file only for keys)', () => {
      const state = withState({
        ssh: {
          enabled: true,
          host: 'bastion.example.test',
          username: 'jumper',
          method: 'password',
          privateKeyFile: '/fictitious/id_ed25519',
        },
      });
      expect(uriOf(state)).not.toMatch(/bastion|jumper/);
      expect(profileDraftFromState(state).ssh).toEqual({
        host: 'bastion.example.test',
        port: 22,
        username: 'jumper',
        method: 'password',
      });
      state.ssh.method = 'privateKey';
      expect(profileDraftFromState(state).ssh?.privateKeyFile).toBe('/fictitious/id_ed25519');
      expect(profileDraftSchema.safeParse(profileDraftFromState(state)).success).toBe(true);
    });

    it('never puts typed SSH, proxy or key secrets into the URI or the draft', () => {
      const state = withState({
        ssh: { enabled: true, host: 'b.example.test', port: 22, username: 'u', method: 'password' },
        secrets: { sshPassword: PW, proxyPassword: PW, tlsKeyPassphrase: PW, sshKeyPassphrase: PW },
      });
      expect(uriOf(state)).not.toContain(PW);
      expect(JSON.stringify(profileDraftFromState(state))).not.toContain(PW);
    });

    it('usedSecretKinds lists only the secrets the settings use', () => {
      const state = withState();
      expect(usedSecretKinds(state)).toEqual([]);
      state.ssh = { enabled: true, host: 'b', port: 22, username: 'u', method: 'password' };
      expect(usedSecretKinds(state)).toEqual(['sshPassword']);
      state.ssh.method = 'privateKey';
      expect(usedSecretKinds(state)).toEqual(['sshKeyPassphrase']);
      state.ssh.method = 'agent';
      expect(usedSecretKinds(state)).toEqual([]);
      state.ssh.enabled = false;
      state.model.tls = { enabled: true, certificateKeyFile: '/fictitious/c.pem' };
      expect(usedSecretKinds(state)).toEqual(['tlsKeyPassphrase']);
      state.model.tls.enabled = false;
      expect(usedSecretKinds(state)).toEqual([]);
      state.model.proxy = { host: 'socks.example.test' };
      expect(usedSecretKinds(state)).toEqual([]);
      state.model.proxy.username = 'pat';
      expect(usedSecretKinds(state)).toEqual(['proxyPassword']);
    });

    it('tag set text round trip', () => {
      expect(parseTagSet(' dc : east , rack:1,')).toEqual({ dc: 'east', rack: '1' });
      expect(parseTagSet('')).toEqual({});
      expect(parseTagSet('ssd')).toEqual({ ssd: '' });
      expect(formatTagSet({ dc: 'east', rack: '1' })).toBe('dc:east, rack:1');
      expect(parseTagSet(formatTagSet({ dc: 'east', rack: '1' }))).toEqual({
        dc: 'east',
        rack: '1',
      });
    });

    it('parseW takes numbers and names', () => {
      expect(parseW(' 2 ')).toBe(2);
      expect(parseW('majority')).toBe('majority');
      expect(parseW('  ')).toBeUndefined();
    });

    it('loads SSH and the separate key file of a saved profile', () => {
      const state = editorStateFromProfile(rich(), 'saved');
      expect(state.ssh).toEqual({ enabled: true, ...rich().ssh });
      expect(state.tlsKeyFile).toBe('/fictitious/client.key');
      expect(state.secrets).toEqual({});
      expect(editorStateFromProfile(profile(), 'saved').ssh.enabled).toBe(false);
    });
  });

  describe('hostSummary', () => {
    it('lists hosts with ports, brackets IPv6 and marks SRV', () => {
      expect(hostSummary('mongodb://alice@db1.example.test:27017,db2.example.test')).toBe(
        'db1.example.test:27017, db2.example.test',
      );
      expect(hostSummary('mongodb://[::1]:27017')).toBe('[::1]:27017');
      expect(hostSummary('mongodb+srv://cluster0.example.test')).toBe(
        'cluster0.example.test (SRV)',
      );
    });

    it('never shows credentials', () => {
      expect(hostSummary(`mongodb://alice:${PW}@db1.example.test`)).toBe('db1.example.test');
    });

    it('is empty for an invalid connection string', () => {
      expect(hostSummary('mongodb://')).toBe('');
      expect(hostSummary('garbage')).toBe('');
    });
  });

  describe('folderNames', () => {
    it('lists each folder once, sorted, without empty ones', () => {
      const profiles = [
        profile({ id: 'a', folder: 'Zeta' }),
        profile({ id: 'b', folder: 'Alpha/One' }),
        profile({ id: 'c' }),
        profile({ id: 'd', folder: 'Zeta' }),
        profile({ id: 'e', folder: '' }),
      ];
      expect(folderNames(profiles)).toEqual(['Alpha/One', 'Zeta']);
      expect(folderNames([])).toEqual([]);
    });
  });

  describe('secret URI options (review fix CR-1)', () => {
    const base = 'mongodb://alice@db1.example.test/?authMechanism=SCRAM-SHA-256';
    const cases: { option: string; query: string; dropped: string }[] = [
      {
        option: 'proxyPassword',
        query: `proxyHost=p.test&proxyPassword=${PW}`,
        dropped: 'proxyPassword',
      },
      {
        option: 'tlsCertificateKeyFilePassword',
        query: `tlsCertificateKeyFile=%2Fc.pem&tlsCertificateKeyFilePassword=${PW}`,
        dropped: 'tlsCertificateKeyFilePassword',
      },
      {
        option: 'AWS_SESSION_TOKEN',
        query: `authMechanismProperties=AWS_SESSION_TOKEN:${PW},SERVICE_NAME:mongodb`,
        dropped: 'authMechanismProperties AWS_SESSION_TOKEN',
      },
      {
        option: 'proxyPassword in other case',
        query: `PROXYPASSWORD=${PW}`,
        dropped: 'proxyPassword',
      },
      {
        option: 'a repeated proxyPassword (kept in extra)',
        query: `proxyPassword=${PW}&proxyPassword=${PW}2`,
        dropped: 'proxyPassword',
      },
      {
        option: 'an invalid authMechanismProperties (kept in extra)',
        query: `authMechanismProperties=AWS_SESSION_TOKEN:${PW},broken`,
        dropped: 'authMechanismProperties',
      },
    ];

    for (const { option, query, dropped } of cases) {
      it(`${option}: not in the draft, not shown, reported as not stored`, () => {
        const state = applied(withState({ name: 'S' }), `${base}&${query}`);
        expect(state.droppedSecrets).toContain(dropped);
        expect(JSON.stringify(profileDraftFromState(state))).not.toContain(PW);
        expect(uriOf(state)).not.toContain(PW);
      });

      it(`${option}: a saved profile holding it loads without it`, () => {
        const state = editorStateFromProfile(
          profile({ connectionString: `${base}&${query}` }),
          'saved',
        );
        expect(state.droppedSecrets).toContain(dropped);
        expect(JSON.stringify(profileDraftFromState(state))).not.toContain(PW);
      });

      it(`${option}: a model holding it is cleaned when the draft is built`, () => {
        const state = withState({ name: 'S' });
        // Bypass applyConnectionString: put the secret straight into the model.
        const raw = applied(state, `${base}&${query}`);
        const model = structuredClone(raw.model);
        if (option === 'proxyPassword') model.proxy.password = PW;
        if (option === 'tlsCertificateKeyFilePassword') model.tls.certificateKeyFilePassword = PW;
        if (option === 'AWS_SESSION_TOKEN') {
          model.auth.mechanismProperties = { AWS_SESSION_TOKEN: PW };
        }
        const dirty = { ...raw, model };
        expect(JSON.stringify(profileDraftFromState(dirty))).not.toContain(PW);
        expect(uriOf(dirty)).not.toContain(PW);
      });
    }

    it('keeps the non-secret parts of the options', () => {
      const state = applied(
        withState({ name: 'S' }),
        `${base}&proxyHost=p.test&proxyUsername=pat&proxyPassword=${PW}` +
          `&authMechanismProperties=AWS_SESSION_TOKEN:${PW},SERVICE_NAME:mongodb`,
      );
      const uri = profileDraftFromState(state).connectionString;
      expect(uri).toContain('proxyHost=p.test');
      expect(uri).toContain('proxyUsername=pat');
      expect(uri).toContain('authMechanismProperties=SERVICE_NAME:mongodb');
    });

    it('a connection string without secrets reports none', () => {
      expect(applied(withState({ name: 'S' }), base).droppedSecrets).toBeUndefined();
      const state = applied(withState({ name: 'S' }), `${base}&proxyPassword=${PW}`);
      expect(applied(state, base).droppedSecrets).toBeUndefined();
    });

    it('stripUriSecrets reports nothing for a clean model', () => {
      expect(stripUriSecrets(emptyConnectionModel())).toEqual([]);
    });

    it('stripUriSecrets removes a lower-case AWS_SESSION_TOKEN and an emptied property map', () => {
      const model = emptyConnectionModel();
      model.auth.mechanismProperties = { aws_session_token: PW };
      expect(stripUriSecrets(model)).toEqual(['authMechanismProperties aws_session_token']);
      expect(model.auth.mechanismProperties).toBeUndefined();
      expect(JSON.stringify(model)).not.toContain(PW);
    });

    it('stripUriSecrets keeps the other mechanism properties', () => {
      const model = emptyConnectionModel();
      model.auth.mechanismProperties = { AWS_SESSION_TOKEN: PW, SERVICE_NAME: 'mongodb' };
      stripUriSecrets(model);
      expect(model.auth.mechanismProperties).toEqual({ SERVICE_NAME: 'mongodb' });
    });

    it('stripUriSecrets cleans unparsed options in extra, keeping what is not secret', () => {
      const model = emptyConnectionModel();
      model.extra = {
        AuthMechanismProperties: [
          `AWS_SESSION_TOKEN:${PW}`,
          `SERVICE_NAME:a,aws_session_token:${PW}`,
        ],
        tlsCertificateKeyFilePassword: [PW, `${PW}2`],
        ProxyPassword: PW,
        unrelatedOption: 'kept',
      };
      expect(stripUriSecrets(model).sort()).toEqual([
        'authMechanismProperties',
        'proxyPassword',
        'tlsCertificateKeyFilePassword',
      ]);
      expect(model.extra).toEqual({
        AuthMechanismProperties: 'SERVICE_NAME:a',
        unrelatedOption: 'kept',
      });
    });

    it('stripUriSecrets removes an unparsed authMechanismProperties that holds only the token', () => {
      const model = emptyConnectionModel();
      model.extra = { authMechanismProperties: `AWS_SESSION_TOKEN:${PW}` };
      expect(stripUriSecrets(model)).toEqual(['authMechanismProperties']);
      expect(model.extra).toEqual({});
    });

    it('stripUriSecrets leaves an unparsed authMechanismProperties without secrets alone', () => {
      const model = emptyConnectionModel();
      model.extra = { authMechanismProperties: ['SERVICE_NAME:a', 'CANONICALIZE_HOST_NAME:true'] };
      expect(stripUriSecrets(model)).toEqual([]);
      expect(model.extra).toEqual({
        authMechanismProperties: ['SERVICE_NAME:a', 'CANONICALIZE_HOST_NAME:true'],
      });
    });

    it('the connection-string tab never shows a secret option a model still holds in extra', () => {
      const state = withState({ name: 'S' });
      state.model.extra = { proxyPassword: PW };
      expect(uriOf(state)).not.toContain(PW);
    });
  });
});

describe('connection-form.model M5: LDAP (PLAIN), OIDC and AWS IAM (test-writer)', () => {
  /** Fictitious AWS credentials (not real keys). */
  const KEY_ID = 'AKIAFICTITIOUS00001';
  const AWS_SECRET = 'fictitiousAwsSecret1';
  const NEW_KEY_ID = 'AKIAFICTITIOUS00002';
  const NEW_SECRET = 'fictitiousAwsSecret2';
  type Draft = ReturnType<typeof profileDraftFromState>;
  type Auth = NonNullable<Profile['auth']>;

  const roundTrip = (p: Profile, fallback: 'saved' | 'ask' = 'saved'): Draft =>
    profileDraftFromState(editorStateFromProfile(p, fallback));
  /** A draft loaded again as a saved profile, and saved once more. */
  const again = (draft: Draft): Draft => roundTrip({ ...draft, id: 'p1' } as Profile);
  const withoutId = (draft: Draft): Omit<Draft, 'id'> => {
    const rest = { ...draft };
    delete rest.id;
    return rest;
  };

  const ldapProfile = (extra: Partial<Profile> = {}): Profile =>
    profile({
      connectionString:
        'mongodb://ldapuser@ldap.example.test:27017/?authSource=%24external&authMechanism=PLAIN',
      auth: {
        mechanism: 'PLAIN',
        username: 'ldapuser',
        authSource: '$external',
        secretMode: 'ask',
      },
      ...extra,
    });

  const oidcProfile = (auth: Partial<Auth> = {}): Profile =>
    profile({
      connectionString: 'mongodb://oidc.example.test:27017/?authMechanism=MONGODB-OIDC',
      auth: { mechanism: 'MONGODB-OIDC', secretMode: 'none', ...auth },
    });

  const awsProfile = (auth: Partial<Auth> = {}, query = ''): Profile =>
    profile({
      connectionString: `mongodb://db1.example.test:27017/?authMechanism=MONGODB-AWS${query}`,
      auth: { mechanism: 'MONGODB-AWS', secretMode: 'saved', username: KEY_ID, ...auth },
    });

  /** An AWS IAM state with an access key ID and a typed secret access key. */
  const awsState = (): EditorState => ({
    ...editorStateFromProfile(awsProfile(), 'saved'),
    password: AWS_SECRET,
  });

  describe('mechanism helpers', () => {
    it('the form offers LDAP (PLAIN), OIDC and AWS IAM', () => {
      expect(FORM_MECHANISMS).toEqual(
        expect.arrayContaining(['PLAIN', 'MONGODB-OIDC', 'MONGODB-AWS']),
      );
    });

    it('usesExternalSource is true for the $external mechanisms only', () => {
      for (const m of ['MONGODB-X509', 'PLAIN', 'MONGODB-OIDC', 'MONGODB-AWS', 'GSSAPI'] as const) {
        expect(usesExternalSource(m), m).toBe(true);
      }
      for (const m of ['NONE', 'SCRAM-SHA-256', 'SCRAM-SHA-1'] as const) {
        expect(usesExternalSource(m), m).toBe(false);
      }
    });

    it('usesPassword includes AWS IAM but not OIDC or GSSAPI', () => {
      expect(usesPassword('MONGODB-AWS')).toBe(true);
      expect(usesPassword('PLAIN')).toBe(true);
      expect(usesPassword('MONGODB-OIDC')).toBe(false);
      expect(usesPassword('GSSAPI')).toBe(false);
    });

    it('awsKeys / passwordInUse: AWS uses the password only with an access key ID', () => {
      const state = (mechanism: EditorState['mechanism'], username?: string) =>
        withState({ mechanism, model: { ...emptyConnectionModel(), username } });
      expect(awsKeys(state('MONGODB-AWS'))).toBe(false);
      expect(awsKeys(state('MONGODB-AWS', '   '))).toBe(false);
      expect(awsKeys(state('MONGODB-AWS', KEY_ID))).toBe(true);
      expect(awsKeys(state('SCRAM-SHA-256', 'alice'))).toBe(false);

      expect(passwordInUse(state('MONGODB-AWS'))).toBe(false);
      expect(passwordInUse(state('MONGODB-AWS', '  '))).toBe(false);
      expect(passwordInUse(state('MONGODB-AWS', KEY_ID))).toBe(true);
      expect(passwordInUse(state('PLAIN', 'ldapuser'))).toBe(true);
      expect(passwordInUse(state('SCRAM-SHA-256'))).toBe(true);
      expect(passwordInUse(state('MONGODB-OIDC', 'pat'))).toBe(false);
      expect(passwordInUse(state('MONGODB-X509'))).toBe(false);
      expect(passwordInUse(state('NONE'))).toBe(false);
    });

    it('usedSecretKinds lists the AWS session token only for AWS with an access key ID', () => {
      expect(usedSecretKinds(awsState())).toEqual(['awsSessionToken']);
      expect(usedSecretKinds(withState({ mechanism: 'MONGODB-AWS' }))).toEqual([]);
      const scram = withState({
        mechanism: 'SCRAM-SHA-256',
        model: { ...emptyConnectionModel(), username: KEY_ID },
      });
      expect(usedSecretKinds(scram)).toEqual([]);
    });
  });

  describe('LDAP (PLAIN) round trip', () => {
    it('keeps user and secret mode, drops $external from the form, the string and the draft', () => {
      const state = editorStateFromProfile(ldapProfile(), 'saved');
      expect(state.mechanism).toBe('PLAIN');
      expect(state.model.username).toBe('ldapuser');
      expect(state.model.auth.source).toBeUndefined();
      expect(state.secretMode).toBe('ask');
      expect(uriOf(state)).not.toContain('authSource');

      const draft = profileDraftFromState(state);
      expect(draft.auth).toEqual({ mechanism: 'PLAIN', username: 'ldapuser', secretMode: 'ask' });
      expect(draft.connectionString).toContain('ldapuser@ldap.example.test:27017');
      expect(draft.connectionString).toContain('authMechanism=PLAIN');
      expect(draft.connectionString).not.toContain('authSource');
      expect(profileDraftSchema.safeParse(draft).success).toBe(true);
      expect(withoutId(again(draft))).toEqual(withoutId(draft));
    });

    it('drops another authentication database of a saved LDAP profile', () => {
      const draft = roundTrip(
        ldapProfile({
          connectionString:
            'mongodb://ldapuser@ldap.example.test/?authSource=admin&authMechanism=PLAIN',
          auth: {
            mechanism: 'PLAIN',
            username: 'ldapuser',
            authSource: 'admin',
            secretMode: 'saved',
          },
        }),
      );
      expect(draft.auth).toEqual({
        mechanism: 'PLAIN',
        username: 'ldapuser',
        secretMode: 'saved',
      });
      expect(draft.connectionString).not.toContain('authSource');
    });

    it('an LDAP profile without auth takes the mechanism from the string and the fallback mode', () => {
      const state = editorStateFromProfile(ldapProfile({ auth: undefined }), 'ask');
      expect(state.mechanism).toBe('PLAIN');
      expect(state.secretMode).toBe('ask');
      expect(state.model.auth.source).toBeUndefined();
    });

    it('a typed LDAP password is masked in the string and never in the draft', () => {
      const state = { ...editorStateFromProfile(ldapProfile(), 'saved'), password: PW };
      expect(uriOf(state)).toContain(`ldapuser:${MASK}@`);
      expect(uriOf(state)).not.toContain(PW);
      expect(JSON.stringify(profileDraftFromState(state))).not.toContain(PW);
    });
  });

  describe('OIDC round trip', () => {
    it('keeps user name, flow and trusted endpoint; saves no secret mode and no authSource', () => {
      const original = oidcProfile({
        username: 'pat@example.test',
        oidcFlow: 'deviceCode',
        oidcTrustedEndpoint: true,
      });
      const state = editorStateFromProfile(original, 'saved');
      expect(state.mechanism).toBe('MONGODB-OIDC');
      expect(state.oidc).toEqual({ flow: 'deviceCode', trustedEndpoint: true });
      expect(state.secretMode).toBe('none');

      const draft = profileDraftFromState(state);
      expect(draft.auth).toEqual({
        mechanism: 'MONGODB-OIDC',
        username: 'pat@example.test',
        secretMode: 'none',
        oidcFlow: 'deviceCode',
        oidcTrustedEndpoint: true,
      });
      expect(draft.connectionString).toContain('authMechanism=MONGODB-OIDC');
      expect(draft.connectionString).not.toContain('authSource');
      expect(profileDraftSchema.safeParse(draft).success).toBe(true);
      expect(withoutId(again(draft))).toEqual(withoutId(draft));
    });

    it('the authCode flow is saved', () => {
      expect(roundTrip(oidcProfile({ oidcFlow: 'authCode' })).auth).toEqual({
        mechanism: 'MONGODB-OIDC',
        secretMode: 'none',
        oidcFlow: 'authCode',
      });
    });

    it('defaults: auto flow and no trusted endpoint, both left out of the draft', () => {
      const state = editorStateFromProfile(oidcProfile(), 'saved');
      expect(DEFAULT_OIDC_FLOW).toBe('auto');
      expect(state.oidc).toEqual({ flow: 'auto', trustedEndpoint: false });
      expect(newEditorState('ask').oidc).toEqual({ flow: 'auto', trustedEndpoint: false });
      const explicit = roundTrip(oidcProfile({ oidcFlow: 'auto', oidcTrustedEndpoint: false }));
      expect(explicit.auth).toEqual({ mechanism: 'MONGODB-OIDC', secretMode: 'none' });
    });

    it('without a user name, the string names no user', () => {
      const draft = roundTrip(oidcProfile());
      expect(draft.auth).not.toHaveProperty('username');
      expect(draft.connectionString).not.toContain('@');
    });

    it('a secret mode left in the state is not saved for OIDC', () => {
      const state: EditorState = {
        ...editorStateFromProfile(oidcProfile(), 'saved'),
        secretMode: 'saved',
      };
      expect(profileDraftFromState(state).auth?.secretMode).toBe('none');
    });

    it('OIDC settings are saved only while OIDC is the mechanism', () => {
      const state = editorStateFromProfile(
        oidcProfile({ oidcFlow: 'deviceCode', oidcTrustedEndpoint: true }),
        'saved',
      );
      const scram: EditorState = {
        ...state,
        mechanism: 'SCRAM-SHA-256',
        model: { ...state.model, username: 'alice' },
        secretMode: 'ask',
      };
      expect(profileDraftFromState(scram).auth).toEqual({
        mechanism: 'SCRAM-SHA-256',
        username: 'alice',
        secretMode: 'ask',
      });
    });
  });

  describe('AWS IAM round trip', () => {
    it('access key ID: in the draft auth, never in the connection string', () => {
      const state = editorStateFromProfile(awsProfile(), 'ask');
      expect(state.mechanism).toBe('MONGODB-AWS');
      expect(state.model.username).toBe(KEY_ID);
      expect(state.secretMode).toBe('saved');
      expect(awsKeys(state)).toBe(true);
      expect(uriOf(state)).not.toContain(KEY_ID);

      const draft = profileDraftFromState(state);
      expect(draft.auth).toEqual({
        mechanism: 'MONGODB-AWS',
        username: KEY_ID,
        secretMode: 'saved',
      });
      expect(draft.connectionString).toBe(
        'mongodb://db1.example.test:27017/?authMechanism=MONGODB-AWS',
      );
      expect(profileDraftSchema.safeParse(draft).success).toBe(true);
      expect(withoutId(again(draft))).toEqual(withoutId(draft));
    });

    it('a typed secret access key appears nowhere: not masked in the string, not in the draft', () => {
      const state = awsState();
      const uri = uriOf(state);
      expect(uri).not.toContain(AWS_SECRET);
      expect(uri).not.toContain(MASK);
      expect(uri).not.toContain(KEY_ID);
      expect(JSON.stringify(profileDraftFromState(state))).not.toContain(AWS_SECRET);
    });

    it('default credential chain: saved with secret mode none; the editor keeps the fallback', () => {
      const state = editorStateFromProfile(
        awsProfile({ username: undefined, secretMode: 'none' }),
        'ask',
      );
      expect(state.model.username).toBeUndefined();
      expect(awsKeys(state)).toBe(false);
      expect(state.secretMode).toBe('ask');
      expect(profileDraftFromState(state).auth).toEqual({
        mechanism: 'MONGODB-AWS',
        secretMode: 'none',
      });
      // Once a key ID is entered, the kept mode is saved.
      const keyed: EditorState = { ...state, model: { ...state.model, username: KEY_ID } };
      expect(profileDraftFromState(keyed).auth).toEqual({
        mechanism: 'MONGODB-AWS',
        username: KEY_ID,
        secretMode: 'ask',
      });
    });

    it('keeps a saved "ask" mode of an AWS profile with keys', () => {
      const state = editorStateFromProfile(awsProfile({ secretMode: 'ask' }), 'saved');
      expect(state.secretMode).toBe('ask');
    });

    it('trims the access key ID; a blank one means the default chain', () => {
      const padded = withState({
        mechanism: 'MONGODB-AWS',
        secretMode: 'saved',
        model: { ...emptyConnectionModel(), username: `  ${KEY_ID} ` },
      });
      expect(profileDraftFromState(padded).auth).toEqual({
        mechanism: 'MONGODB-AWS',
        username: KEY_ID,
        secretMode: 'saved',
      });
      const blank: EditorState = { ...padded, model: { ...padded.model, username: '   ' } };
      expect(profileDraftFromState(blank).auth).toEqual({
        mechanism: 'MONGODB-AWS',
        secretMode: 'none',
      });
    });

    it('drops an authSource of a saved AWS profile', () => {
      const draft = roundTrip(awsProfile({ authSource: '$external' }, '&authSource=%24external'));
      expect(draft.auth).not.toHaveProperty('authSource');
      expect(draft.connectionString).not.toContain('authSource');
    });

    it('a saved AWS profile with a session token in its string loads without it, keeping the key', () => {
      const state = editorStateFromProfile(
        awsProfile({}, `&authMechanismProperties=AWS_SESSION_TOKEN:${PW}`),
        'saved',
      );
      expect(state.droppedSecrets).toEqual(['authMechanismProperties AWS_SESSION_TOKEN']);
      expect(state.model.username).toBe(KEY_ID);
      expect(JSON.stringify(profileDraftFromState(state))).not.toContain(PW);
      expect(uriOf(state)).not.toContain(PW);
    });
  });

  describe('applyConnectionString', () => {
    it('AWS: editing the string keeps the access key ID, secret and secret mode', () => {
      const state = applied(
        awsState(),
        'mongodb://db2.example.test:27018/?authMechanism=MONGODB-AWS&appName=Reports',
      );
      expect(state.mechanism).toBe('MONGODB-AWS');
      expect(state.model.username).toBe(KEY_ID);
      expect(state.password).toBe(AWS_SECRET);
      expect(state.secretMode).toBe('saved');
      expect(state.model.hosts).toEqual([{ host: 'db2.example.test', port: 27018 }]);
      expect(profileDraftFromState(state).auth?.username).toBe(KEY_ID);
    });

    it('AWS on the default credential chain: editing the string adds no key and no secret', () => {
      const chain = withState({ mechanism: 'MONGODB-AWS', secretMode: 'ask' });
      const state = applied(
        chain,
        'mongodb://db2.example.test/?authMechanism=MONGODB-AWS&appName=Reports',
      );
      expect(state.model.username).toBeUndefined();
      expect(state.password).toBe('');
      expect(profileDraftFromState(state).auth).toEqual({
        mechanism: 'MONGODB-AWS',
        secretMode: 'none',
      });
    });

    it('AWS: the tab text applied unchanged keeps the keys (sync loop)', () => {
      const state = awsState();
      const next = applied(state, uriOf(state));
      expect(next.model.username).toBe(KEY_ID);
      expect(next.password).toBe(AWS_SECRET);
      expect(profileDraftFromState(next)).toEqual(profileDraftFromState(state));
    });

    it('AWS: a pasted string with key ID and secret replaces them, and they leave the string', () => {
      const state = applied(
        awsState(),
        `mongodb://${NEW_KEY_ID}:${NEW_SECRET}@db1.example.test/?authMechanism=MONGODB-AWS`,
      );
      expect(state.model.username).toBe(NEW_KEY_ID);
      expect(state.model.password).toBeUndefined();
      expect(state.password).toBe(NEW_SECRET);
      const uri = uriOf(state);
      expect(uri).not.toContain(NEW_KEY_ID);
      expect(uri).not.toContain(NEW_SECRET);
      const draft = profileDraftFromState(state);
      expect(draft.auth?.username).toBe(NEW_KEY_ID);
      expect(JSON.stringify(draft)).not.toContain(NEW_SECRET);
    });

    it('AWS: a pasted key ID without secret replaces the key and clears the old secret', () => {
      const state = applied(
        awsState(),
        `mongodb://${NEW_KEY_ID}@db1.example.test/?authMechanism=MONGODB-AWS`,
      );
      expect(state.model.username).toBe(NEW_KEY_ID);
      expect(state.password).toBe('');
    });

    it('AWS: a session token in a pasted string is dropped, the keys stay', () => {
      const state = applied(
        awsState(),
        `mongodb://db1.example.test/?authMechanism=MONGODB-AWS` +
          `&authMechanismProperties=AWS_SESSION_TOKEN:${PW}`,
      );
      expect(state.droppedSecrets).toEqual(['authMechanismProperties AWS_SESSION_TOKEN']);
      expect(state.model.username).toBe(KEY_ID);
      expect(state.password).toBe(AWS_SECRET);
      expect(JSON.stringify(profileDraftFromState(state))).not.toContain(PW);
      expect(uriOf(state)).not.toContain(PW);
    });

    it('AWS: an authSource in a pasted string is dropped', () => {
      const state = applied(
        awsState(),
        'mongodb://db1.example.test/?authMechanism=MONGODB-AWS&authSource=admin',
      );
      expect(state.model.auth.source).toBeUndefined();
      expect(uriOf(state)).not.toContain('authSource');
    });

    it('SCRAM → AWS string: the database user and password do not become AWS keys', () => {
      const scram = withState({
        mechanism: 'SCRAM-SHA-256',
        password: PW,
        secretMode: 'saved',
        model: { ...emptyConnectionModel(), username: 'alice' },
      });
      const state = applied(scram, 'mongodb://db1.example.test/?authMechanism=MONGODB-AWS');
      expect(state.mechanism).toBe('MONGODB-AWS');
      expect(state.model.username).toBeUndefined();
      expect(state.password).toBe('');
      expect(state.secretMode).toBe('saved');
      expect(profileDraftFromState(state).auth).toEqual({
        mechanism: 'MONGODB-AWS',
        secretMode: 'none',
      });
    });

    it('AWS → SCRAM string: the AWS secret is not kept as a database password', () => {
      const state = applied(awsState(), 'mongodb://alice@db1.example.test');
      expect(state.mechanism).toBe('SCRAM-SHA-256');
      expect(state.model.username).toBe('alice');
      expect(state.password).toBe('');
    });

    it('PLAIN: user and password from the string, $external dropped, "none" becomes "ask"', () => {
      const state = applied(
        withState({ secretMode: 'none' }),
        `mongodb://ldapuser:${PW}@ldap.example.test/?authSource=%24external&authMechanism=PLAIN`,
      );
      expect(state.mechanism).toBe('PLAIN');
      expect(state.model.username).toBe('ldapuser');
      expect(state.password).toBe(PW);
      expect(state.model.auth.source).toBeUndefined();
      expect(state.secretMode).toBe('ask');
      expect(uriOf(state)).toContain(`ldapuser:${MASK}@`);
      expect(uriOf(state)).not.toContain('authSource');
    });

    it('OIDC: no secret mode, no authSource, other properties and the OIDC settings kept', () => {
      const before: EditorState = {
        ...withState({ secretMode: 'saved' }),
        oidc: { flow: 'deviceCode', trustedEndpoint: true },
      };
      const state = applied(
        before,
        'mongodb://oidc.example.test/?authMechanism=MONGODB-OIDC&authSource=%24external' +
          '&authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:api://thicket-app',
      );
      expect(state.mechanism).toBe('MONGODB-OIDC');
      expect(state.secretMode).toBe('none');
      expect(state.model.auth.source).toBeUndefined();
      expect(state.oidc).toEqual({ flow: 'deviceCode', trustedEndpoint: true });
      const draft = profileDraftFromState(state);
      expect(draft.auth).toEqual({
        mechanism: 'MONGODB-OIDC',
        secretMode: 'none',
        oidcFlow: 'deviceCode',
        oidcTrustedEndpoint: true,
      });
      expect(draft.connectionString).toContain('ENVIRONMENT:azure');
    });

    it('OIDC: a password in a pasted string is never shown nor saved', () => {
      const state = applied(
        withState(),
        `mongodb://pat:${PW}@oidc.example.test/?authMechanism=MONGODB-OIDC`,
      );
      expect(uriOf(state)).not.toContain(PW);
      expect(uriOf(state)).not.toContain(MASK);
      expect(JSON.stringify(profileDraftFromState(state))).not.toContain(PW);
    });
  });

  describe('GSSAPI (not offered by the form, kept for loaded profiles)', () => {
    it('is not in the form list, but a loaded profile keeps it and saves no authSource', () => {
      expect(FORM_MECHANISMS).not.toContain('GSSAPI');
      const draft = roundTrip(
        profile({
          connectionString:
            'mongodb://svc%40EXAMPLE.TEST@db1.example.test/?authMechanism=GSSAPI&authSource=%24external',
          auth: {
            mechanism: 'GSSAPI',
            username: 'svc@EXAMPLE.TEST',
            authSource: '$external',
            secretMode: 'none',
          },
        }),
      );
      expect(draft.auth).toEqual({
        mechanism: 'GSSAPI',
        username: 'svc@EXAMPLE.TEST',
        secretMode: 'none',
      });
      expect(draft.connectionString).toContain('authMechanism=GSSAPI');
      expect(draft.connectionString).not.toContain('authSource');
    });
  });

  describe('editorProblems', () => {
    const named = (patch: Partial<EditorState>) => withState({ name: 'M5', ...patch });

    it('AWS without an access key ID (default credential chain) is valid', () => {
      expect(editorProblems(named({ mechanism: 'MONGODB-AWS' }))).toEqual([]);
      const blank = named({
        mechanism: 'MONGODB-AWS',
        model: { ...emptyConnectionModel(), username: ' ' },
      });
      expect(editorProblems(blank)).toEqual([]);
      expect(editorProblems(awsState())).toEqual([]);
    });

    it('LDAP needs a user name, OIDC does not', () => {
      expect(editorProblems(named({ mechanism: 'PLAIN' }))).toEqual([
        'Enter the user name, or choose "No authentication".',
      ]);
      expect(editorProblems(named({ mechanism: 'MONGODB-OIDC' }))).toEqual([]);
    });
  });
});
