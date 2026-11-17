import { profileDraft as profileDraftSchema, type Profile } from '@thicket/contract';
import { MASK, emptyConnectionModel } from '@thicket/core/uri';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PASSWORD_MECHANISM,
  applyConnectionString,
  connectionStringText,
  editorProblems,
  editorStateFromProfile,
  folderNames,
  hostSummary,
  newEditorState,
  profileDraftFromState,
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
});
