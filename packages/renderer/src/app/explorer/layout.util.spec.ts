import { describe, expect, it } from 'vitest';
import { defaultLayout } from './layout.util';

// JSON Canopy read these from its samples/ folder, which was not copied; these are small stand-ins
// of the same shape (a configuration file, a list of records).
const config = {
  name: 'billing-api',
  server: { port: 8080, tls: { certFile: 'a.pem', keyFile: 'a.key' } },
  logging: { level: 'info', loggers: { 'http.client': 'warn' } },
  features: { darkMode: true },
};
const team = {
  project: 'Nightwatch',
  members: [
    { id: 1, name: 'Ada', role: 'engineer' },
    { id: 2, name: 'Grace', role: 'engineer' },
  ],
};

describe('defaultLayout', () => {
  it('stays with tables when there is no schema', () => {
    expect(defaultLayout(config, false)).toBe('tables');
  });

  it('picks tables for documents that are lists of records', () => {
    expect(defaultLayout(team, true)).toBe('tables');
    expect(defaultLayout([{ a: 1 }], true)).toBe('tables');
  });

  it('picks the form for configuration', () => {
    expect(defaultLayout(config, true)).toBe('form');
  });

  it('needs at least two records to call something a list', () => {
    expect(defaultLayout({ items: [{ a: 1 }] }, true)).toBe('form');
    expect(defaultLayout({ items: [{ a: 1 }, { a: 2 }] }, true)).toBe('tables');
    expect(defaultLayout({ items: ['a', 'b', 'c'] }, true)).toBe('form');
  });

  it('keeps tables for documents that are not objects', () => {
    expect(defaultLayout(3, true)).toBe('tables');
    expect(defaultLayout(null, true)).toBe('tables');
    expect(defaultLayout(['a'], true)).toBe('tables');
  });
});
