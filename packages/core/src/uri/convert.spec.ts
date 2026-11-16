import { describe, expect, it } from 'vitest';

import {
  ConnectionStringError,
  emptyConnectionModel,
  parseConnectionString,
  toConnectionString,
  type ConnectionUriModel,
} from './index';
import { URI_CASES } from './fixtures';

describe('connection string round trip', () => {
  it('covers at least 20 URIs', () => {
    expect(URI_CASES.length).toBeGreaterThanOrEqual(20);
  });

  it.each(URI_CASES)('$name', ({ uri, canonical }) => {
    const model = parseConnectionString(uri);
    const written = toConnectionString(model);
    expect(written).toBe(canonical ?? uri);
    expect(parseConnectionString(written)).toEqual(model);
    expect(toConnectionString(parseConnectionString(written))).toBe(written);
  });
});

describe('parseConnectionString', () => {
  it('reads SRV host, credentials, database and options', () => {
    const m = parseConnectionString(
      'mongodb+srv://alice:s3cret@cluster0.example.net/test?authSource=admin&tls=true&w=majority&appName=Cluster0',
    );
    expect(m).toEqual<ConnectionUriModel>({
      ...emptyConnectionModel(),
      scheme: 'mongodb+srv',
      hosts: [{ host: 'cluster0.example.net' }],
      username: 'alice',
      password: 's3cret',
      database: 'test',
      auth: { source: 'admin' },
      tls: { enabled: true },
      writeConcern: { w: 'majority' },
      appName: 'Cluster0',
    });
  });

  it('reads IPv6 hosts without brackets, with and without port', () => {
    const m = parseConnectionString('mongodb://[2001:db8::1]:27017,[::1],host.example.com:27019');
    expect(m.hosts).toEqual([
      { host: '2001:db8::1', port: 27017 },
      { host: '::1' },
      { host: 'host.example.com', port: 27019 },
    ]);
  });

  it('decodes percent-encoded credentials and socket paths', () => {
    const m = parseConnectionString(
      'mongodb://user%40example.com:p%40ss%3Aw%2Frd@%2Ftmp%2Fmongodb-27017.sock/my%20db',
    );
    expect(m.username).toBe('user@example.com');
    expect(m.password).toBe('p@ss:w/rd');
    expect(m.hosts).toEqual([{ host: '/tmp/mongodb-27017.sock' }]);
    expect(m.database).toBe('my db');
  });

  it('reads authMechanismProperties into a map, values may contain colons', () => {
    const m = parseConnectionString(
      'mongodb://h/?authMechanism=MONGODB-OIDC&authMechanismProperties=ENVIRONMENT:azure,TOKEN_RESOURCE:api://app',
    );
    expect(m.auth).toEqual({
      mechanism: 'MONGODB-OIDC',
      mechanismProperties: { ENVIRONMENT: 'azure', TOKEN_RESOURCE: 'api://app' },
    });
  });

  it('reads typed values: booleans, numbers, read preference tags, w as number', () => {
    const m = parseConnectionString(
      'mongodb://h/?directConnection=true&readPreference=nearest&readPreferenceTags=dc:ny,rack:1&readPreferenceTags=&maxStalenessSeconds=-1&w=3&journal=false&connectTimeoutMS=2000&proxyHost=p&proxyPort=1080',
    );
    expect(m.directConnection).toBe(true);
    expect(m.readPreference).toEqual({
      mode: 'nearest',
      tags: [{ dc: 'ny', rack: '1' }, {}],
      maxStalenessSeconds: -1,
    });
    expect(m.writeConcern).toEqual({ w: 3, journal: false });
    expect(m.timeouts).toEqual({ connectTimeoutMS: 2000 });
    expect(m.proxy).toEqual({ host: 'p', port: 1080 });
  });

  it('rejects invalid strings with a message that never contains the password', () => {
    const bad = [
      'http://user:topSecret1@host',
      'mongodb+srv://user:topSecret1@host:27017',
      'mongodb://user:topSecret1@host:99999',
      'mongodb://user:topSecret1@',
      'mongodb://user:top%ZZSecret1@host',
    ];
    for (const uri of bad) {
      let error: unknown;
      try {
        parseConnectionString(uri);
      } catch (e) {
        error = e;
      }
      expect(error, uri).toBeInstanceOf(ConnectionStringError);
      expect((error as Error).message).not.toContain('topSecret1');
      expect((error as Error).message).not.toContain('Secret1');
    }
  });
});

describe('unknown options', () => {
  it('are preserved in extra with their original key and decoded value', () => {
    const m = parseConnectionString(
      'mongodb://h/?retryWrites=false&compressors=zstd,snappy&zlibCompressionLevel=6&myOpt=a%26b',
    );
    expect(m.extra).toEqual({
      retryWrites: 'false',
      compressors: 'zstd,snappy',
      zlibCompressionLevel: '6',
      myOpt: 'a&b',
    });
    expect(toConnectionString(m)).toBe(
      'mongodb://h/?retryWrites=false&compressors=zstd,snappy&zlibCompressionLevel=6&myOpt=a%26b',
    );
  });

  it('keep every value of a repeated key', () => {
    const m = parseConnectionString('mongodb://h/?foo=1&foo=2&foo=3');
    expect(m.extra).toEqual({ foo: ['1', '2', '3'] });
    expect(toConnectionString(m)).toBe('mongodb://h/?foo=1&foo=2&foo=3');
  });

  it('include known options with values Thicket cannot represent, unchanged', () => {
    const uri =
      'mongodb://h/?tls=yes&connectTimeoutMS=-5&readPreference=fastest&authMechanism=MAGIC&proxyPort=0&appName=&authMechanismProperties=nocolon&readPreferenceTags=bad';
    const m = parseConnectionString(uri);
    expect(m.tls).toEqual({});
    expect(m.timeouts).toEqual({});
    expect(m.readPreference).toEqual({});
    expect(m.extra).toEqual({
      tls: 'yes',
      connectTimeoutMS: '-5',
      readPreference: 'fastest',
      authMechanism: 'MAGIC',
      proxyPort: '0',
      appName: '',
      authMechanismProperties: 'nocolon',
      readPreferenceTags: 'bad',
    });
    expect(toConnectionString(m)).toBe(uri);
  });

  it('include a repeated or conflicting alias of a known option', () => {
    const m = parseConnectionString('mongodb://h/?tls=true&ssl=false&appName=a&appname=b');
    expect(m.tls).toEqual({ enabled: true });
    expect(m.appName).toBe('a');
    expect(m.extra).toEqual({ ssl: 'false', appname: 'b' });
    expect(toConnectionString(m)).toBe('mongodb://h/?tls=true&appName=a&ssl=false&appname=b');
  });
});

describe('toConnectionString', () => {
  it('writes an empty model as localhost', () => {
    expect(toConnectionString(emptyConnectionModel())).toBe('mongodb://localhost:27017');
  });

  it('writes a model built by the form', () => {
    const m: ConnectionUriModel = {
      ...emptyConnectionModel(),
      hosts: [
        { host: 'a.example.com', port: 27017 },
        { host: 'fe80::1', port: 27018 },
      ],
      username: 'app user',
      password: 'p@ss word',
      database: 'shop',
      replicaSet: 'rs0',
      auth: { mechanism: 'SCRAM-SHA-256', source: 'admin' },
      tls: { enabled: true, caFile: 'C:\\certs\\ca.pem' },
      readPreference: { mode: 'secondary', tags: [{ dc: 'east' }] },
      timeouts: { serverSelectionTimeoutMS: 3000 },
      extra: { retryWrites: 'true' },
    };
    const uri = toConnectionString(m);
    expect(uri).toBe(
      'mongodb://app%20user:p%40ss%20word@a.example.com:27017,[fe80::1]:27018/shop?replicaSet=rs0&authSource=admin&authMechanism=SCRAM-SHA-256&tls=true&tlsCAFile=C:%5Ccerts%5Cca.pem&readPreference=secondary&readPreferenceTags=dc:east&serverSelectionTimeoutMS=3000&retryWrites=true',
    );
    expect(parseConnectionString(uri)).toEqual(m);
  });

  it('omits empty authMechanismProperties and empty database', () => {
    const m = {
      ...emptyConnectionModel(),
      database: '',
      auth: { mechanismProperties: {} },
    };
    expect(toConnectionString(m)).toBe('mongodb://localhost:27017');
  });

  it('rejects a password without a user name (the driver rejects empty user info)', () => {
    const base = emptyConnectionModel();
    expect(() => toConnectionString({ ...base, password: 'onlyPass' })).toThrow(
      ConnectionStringError,
    );
    expect(() => toConnectionString({ ...base, username: '', password: 'onlyPass' })).toThrow(
      ConnectionStringError,
    );
  });

  it('treats an empty user name as none', () => {
    const uri = toConnectionString({ ...emptyConnectionModel(), username: '' });
    expect(uri).toBe('mongodb://localhost:27017');
    expect(parseConnectionString(uri).username).toBeUndefined();
  });

  it('encodes an apostrophe in the user info', () => {
    const m = { ...emptyConnectionModel(), username: "o'neil", password: "it's" };
    const uri = toConnectionString(m);
    expect(uri).toBe('mongodb://o%27neil:it%27s@localhost:27017');
    expect(parseConnectionString(uri)).toEqual(m);
  });

  it('writes a Unix socket path containing ":" percent-encoded, not in brackets', () => {
    const uri = 'mongodb://%2Ftmp%2Fa%3Ab.sock';
    const m = parseConnectionString(uri);
    expect(m.hosts).toEqual([{ host: '/tmp/a:b.sock' }]);
    expect(toConnectionString(m)).toBe(uri);
    expect(parseConnectionString(toConnectionString(m))).toEqual(m);
  });

  it('rejects models the driver would reject', () => {
    const base = emptyConnectionModel();
    const bad: ConnectionUriModel[] = [
      { ...base, hosts: [] },
      { ...base, scheme: 'mongodb+srv', hosts: [{ host: 'a.example.net' }, { host: 'b' }] },
      { ...base, scheme: 'mongodb+srv', hosts: [{ host: 'a.example.net', port: 27017 }] },
      { ...base, hosts: [{ host: 'h', port: 0 }] },
      { ...base, hosts: [{ host: 'h', port: 1.5 }] },
      { ...base, hosts: [{ host: '' }] },
    ];
    for (const m of bad) {
      expect(() => toConnectionString(m), JSON.stringify(m.hosts)).toThrow(ConnectionStringError);
    }
  });

  it('accepts the port boundaries 1 and 65535 and rejects 65536', () => {
    const base = emptyConnectionModel();
    expect(toConnectionString({ ...base, hosts: [{ host: 'h', port: 1 }] })).toBe('mongodb://h:1');
    expect(toConnectionString({ ...base, hosts: [{ host: 'h', port: 65535 }] })).toBe(
      'mongodb://h:65535',
    );
    expect(() => toConnectionString({ ...base, hosts: [{ host: 'h', port: 65536 }] })).toThrow(
      ConnectionStringError,
    );
  });

  it('writes a user name without a password and no ":"', () => {
    const m = { ...emptyConnectionModel(), username: 'reader' };
    expect(toConnectionString(m)).toBe('mongodb://reader@localhost:27017');
    expect(parseConnectionString(toConnectionString(m))).toEqual(m);
  });

  it('encodes a "/" in the database name so it stays one path segment', () => {
    const m = { ...emptyConnectionModel(), database: 'a/b?c' };
    const uri = toConnectionString(m);
    expect(uri).toBe('mongodb://localhost:27017/a%2Fb%3Fc');
    expect(parseConnectionString(uri).database).toBe('a/b?c');
  });

  it('encodes "&", "=" and "#" in option values and extra keys', () => {
    const m: ConnectionUriModel = {
      ...emptyConnectionModel(),
      appName: 'a&b=c#d',
      extra: { 'my opt': 'x=y&z' },
    };
    const uri = toConnectionString(m);
    expect(uri).toBe('mongodb://localhost:27017/?appName=a%26b%3Dc%23d&my%20opt=x%3Dy%26z');
    expect(parseConnectionString(uri)).toEqual(m);
  });

  it('writes w=0 as a number', () => {
    const m = parseConnectionString('mongodb://h/?w=0');
    expect(m.writeConcern).toEqual({ w: 0 });
    expect(toConnectionString(m)).toBe('mongodb://h/?w=0');
  });

  it('writes an extra array value as a repeated key, after the known options', () => {
    const m: ConnectionUriModel = {
      ...emptyConnectionModel(),
      appName: 'x',
      extra: { foo: ['1', '2'], bar: 'b' },
    };
    expect(toConnectionString(m)).toBe('mongodb://localhost:27017/?appName=x&foo=1&foo=2&bar=b');
  });
});

describe('parseConnectionString edge cases', () => {
  it('reads port boundaries and drops leading zeros', () => {
    expect(parseConnectionString('mongodb://h:1,g:65535,k:027017').hosts).toEqual([
      { host: 'h', port: 1 },
      { host: 'g', port: 65535 },
      { host: 'k', port: 27017 },
    ]);
  });

  it('rejects port 0, 65536 and malformed IPv6 hosts with ConnectionStringError', () => {
    for (const uri of [
      'mongodb://h:0',
      'mongodb://h:65536',
      'mongodb://[::1',
      'mongodb://[::1]x',
      'mongodb://[]:27017',
    ]) {
      expect(() => parseConnectionString(uri), uri).toThrow(ConnectionStringError);
    }
  });

  it('rejects invalid percent-encoding in the host or database name', () => {
    expect(() => parseConnectionString('mongodb://h%ZZ')).toThrow(
      new ConnectionStringError('Invalid percent-encoding in the host'),
    );
    expect(() => parseConnectionString('mongodb://h/db%ZZ')).toThrow(
      new ConnectionStringError('Invalid percent-encoding in the database name'),
    );
  });

  it('rejects a password with an unescaped ":" without echoing it', () => {
    let error: unknown;
    try {
      parseConnectionString('mongodb://user:pa:ssColonSecret@host');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConnectionStringError);
    expect((error as Error).name).toBe('ConnectionStringError');
    expect((error as Error).message).not.toContain('ssColonSecret');
  });

  it('reads a user name without a password', () => {
    const m = parseConnectionString('mongodb://reader@h');
    expect(m.username).toBe('reader');
    expect(m.password).toBeUndefined();
    expect(toConnectionString(m)).toBe('mongodb://reader@h');
  });

  it('treats an empty query as no options', () => {
    const m = parseConnectionString('mongodb://h/?');
    expect(m.extra).toEqual({});
    expect(toConnectionString(m)).toBe('mongodb://h');
  });

  it('keeps numbers beyond the safe integer range verbatim in extra', () => {
    const uri = 'mongodb://h/?connectTimeoutMS=99999999999999999999&wtimeoutMS=1.5';
    const m = parseConnectionString(uri);
    expect(m.timeouts).toEqual({});
    expect(m.writeConcern).toEqual({});
    expect(m.extra).toEqual({ connectTimeoutMS: '99999999999999999999', wtimeoutMS: '1.5' });
    expect(toConnectionString(m)).toBe(uri);
  });

  it('keeps empty w and authMechanismProperties values verbatim in extra', () => {
    const uri = 'mongodb://h/?authMechanismProperties=&w=';
    const m = parseConnectionString(uri);
    expect(m.auth).toEqual({});
    expect(m.writeConcern).toEqual({});
    expect(m.extra).toEqual({ authMechanismProperties: '', w: '' });
    expect(toConnectionString(m)).toBe(uri);
  });

  it('keeps a repeated authMechanismProperties key verbatim in extra', () => {
    const uri = 'mongodb://h/?authMechanismProperties=SERVICE_NAME:a,SERVICE_NAME:b';
    const m = parseConnectionString(uri);
    expect(m.auth).toEqual({});
    expect(m.extra).toEqual({ authMechanismProperties: 'SERVICE_NAME:a,SERVICE_NAME:b' });
    expect(toConnectionString(m)).toBe(uri);
  });

  it('returns a fresh model each time (no state shared between parses)', () => {
    const a = parseConnectionString('mongodb://h/?foo=1');
    a.extra['foo'] = 'changed';
    a.hosts.push({ host: 'other' });
    const b = parseConnectionString('mongodb://h/?foo=1');
    expect(b.extra).toEqual({ foo: '1' });
    expect(b.hosts).toEqual([{ host: 'h' }]);
    expect(emptyConnectionModel().extra).toEqual({});
  });
});

describe('unknown options named like Object.prototype members', () => {
  // Option keys come from user input; a key that matches a built-in property of a plain object
  // must still be preserved verbatim (TW-1, TW-2 in reviews/uri-model/tests.md).
  it.each(['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__proto__'])(
    'preserves ?%s=x in extra and on the round trip',
    (key) => {
      const uri = `mongodb://h/?${key}=x`;
      const m = parseConnectionString(uri);
      expect(Object.entries(m.extra)).toEqual([[key, 'x']]);
      expect(toConnectionString(m)).toBe(uri);
    },
  );

  it('preserves an authMechanismProperties entry named __proto__', () => {
    const uri = 'mongodb://h/?authMechanismProperties=__proto__:x';
    expect(toConnectionString(parseConnectionString(uri))).toBe(uri);
  });

  it('preserves a readPreferenceTags entry named __proto__', () => {
    const uri = 'mongodb://h/?readPreferenceTags=__proto__:x';
    expect(toConnectionString(parseConnectionString(uri))).toBe(uri);
  });
});
