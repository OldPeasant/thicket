import { computed } from '@angular/core';
import { type BsonDocument, parseEJsonDocument } from '@thicket/core/bson';
import { describe, expect, it } from 'vitest';

import { SaveHistory, type SavedVersion } from './save-history';

const doc = (text: string): BsonDocument => parseEJsonDocument(text);
const version = (key: string, before: string, after: string): SavedVersion => ({
  key,
  before: doc(before),
  after: doc(after),
  partial: false,
  hidesSubFields: false,
});

// SaveHistory: the pre-save version of each document's last save, per collection tab.
describe('SaveHistory', () => {
  it('is empty at first', () => {
    const history = new SaveHistory();
    expect(history.has('"a"')).toBe(false);
    expect(history.get('"a"')).toBeUndefined();
  });

  it('keeps one entry per document; a newer save replaces it', () => {
    const history = new SaveHistory();
    history.record(version('"a"', '{"_id":"a","n":"1"}', '{"_id":"a","n":"2"}'));
    history.record(version('"b"', '{"_id":"b","n":"1"}', '{"_id":"b","n":"9"}'));
    history.record(version('"a"', '{"_id":"a","n":"2"}', '{"_id":"a","n":"3"}'));

    expect(history.get('"a"')?.before).toEqual(doc('{"_id":"a","n":"2"}'));
    expect(history.get('"a"')?.after).toEqual(doc('{"_id":"a","n":"3"}'));
    expect(history.get('"b"')?.after).toEqual(doc('{"_id":"b","n":"9"}'));
  });

  it('drops only the given document; dropping an unknown one is harmless', () => {
    const history = new SaveHistory();
    history.record(version('"a"', '{"_id":"a"}', '{"_id":"a","n":"1"}'));
    history.record(version('"b"', '{"_id":"b"}', '{"_id":"b","n":"1"}'));
    history.drop('"a"');
    history.drop('"zzz"');
    expect(history.has('"a"')).toBe(false);
    expect(history.has('"b"')).toBe(true);
  });

  it('is reactive: a computed reading it follows record and drop', () => {
    const history = new SaveHistory();
    const offered = computed(() => history.has('"a"'));
    expect(offered()).toBe(false);
    history.record(version('"a"', '{"_id":"a"}', '{"_id":"a","n":"1"}'));
    expect(offered()).toBe(true);
    history.drop('"a"');
    expect(offered()).toBe(false);
  });
});
