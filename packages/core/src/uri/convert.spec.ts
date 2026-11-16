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

  it('writes a password without a user name', () => {
    const m = { ...emptyConnectionModel(), password: 'onlyPass' };
    expect(toConnectionString(m)).toBe('mongodb://:onlyPass@localhost:27017');
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
});
