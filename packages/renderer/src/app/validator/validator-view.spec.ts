import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import type { ResultOf } from '@thicket/contract';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import type { WorkspaceTab } from '../layout/workspace.service';
import { ConfirmService } from '../safety/confirm.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { ValidatorChanges } from './validator-marks.service';
import { SCHEMA_TEMPLATE } from './validator.model';
import { ValidatorView, validatorTabId } from './validator-view';

const TAB: WorkspaceTab = {
  id: 'validator:p1:shop.orders',
  kind: 'validator',
  title: 'orders validator',
  data: { profileId: 'p1', db: 'shop', coll: 'orders', type: 'collection' },
} as WorkspaceTab;

const T = { profileId: 'p1', db: 'shop', coll: 'orders' };
const SCHEMA = '{"$jsonSchema":{"bsonType":"object","required":["sku"]}}';

type GetResult = ResultOf<'coll.validator.get'>;

/** A promise with its resolve function, to answer requests in a chosen order. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('validatorTabId', () => {
  it('is stable per profile and namespace', () => {
    expect(validatorTabId('p1', 'shop', 'orders')).toBe('validator:p1:shop.orders');
    expect(validatorTabId('p1', 'shop', 'orders')).not.toBe(validatorTabId('p2', 'shop', 'orders'));
  });
});

describe('ValidatorView', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<ValidatorView>;
  let view: ValidatorView;
  let stored: GetResult;

  const el = () => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(id: string) =>
    el().querySelector<T>(`[data-testid="${id}"]`);
  const get = <T extends HTMLElement = HTMLElement>(id: string): T => {
    const found = q<T>(id);
    if (found === null) throw new Error(`no element ${id}`);
    return found;
  };
  const text = (e: Element | null) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const click = async (id: string) => {
    get(id).click();
    await settle();
  };
  const typeText = async (value: string) => {
    const area = get<HTMLTextAreaElement>('val-text');
    area.value = value;
    area.dispatchEvent(new Event('input'));
    await settle();
  };
  const choose = async (id: string, value: string) => {
    const select = get<HTMLSelectElement>(id);
    select.value = value;
    select.dispatchEvent(new Event('change'));
    await settle();
  };
  const sets = () =>
    fake.requestsFor('coll.validator.set').map((r) => r.params as Record<string, unknown>);
  const gets = () => fake.requestsFor('coll.validator.get');
  const saveButton = () => get<HTMLButtonElement>('val-save');

  const setProfile = (readOnly: boolean, production = false) =>
    TestBed.inject(ProfileSafetyService).set({ id: 'p1', name: 'Local', readOnly, production });

  const create = async () => {
    fixture = TestBed.createComponent(ValidatorView);
    view = fixture.componentInstance;
    fixture.componentRef.setInput('tab', TAB);
    await settle();
  };

  beforeEach(() => {
    fake = new FakeThicketBridge();
    stored = { validator: SCHEMA, validationLevel: 'moderate', validationAction: 'warn' };
    fake.handle('coll.validator.get', () => stored);
    fake.handle('coll.validator.set', (p) => {
      stored = {
        validator: p.validator,
        validationLevel: p.validationLevel,
        validationAction: p.validationAction,
      };
      return {};
    });
    TestBed.configureTestingModule({
      imports: [ValidatorView],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    setProfile(false);
  });

  describe('load', () => {
    it('reads the validator of the tab collection and shows it as shell syntax', async () => {
      await create();
      expect(gets().map((r) => r.params)).toEqual([T]);
      expect(get<HTMLTextAreaElement>('val-text').value).toBe(
        '{\n  $jsonSchema: {\n    bsonType: "object",\n    required: [\n      "sku"\n    ]\n  }\n}',
      );
      expect(get<HTMLSelectElement>('val-level').value).toBe('moderate');
      expect(get<HTMLSelectElement>('val-action').value).toBe('warn');
      expect(text(get('val-state'))).toBe('Validator set');
      expect(view.dirty()).toBe(false);
      expect(saveButton().disabled).toBe(true);
      expect(get<HTMLButtonElement>('val-revert').disabled).toBe(true);
      expect(q('val-template')).toBeNull();
    });

    it('shows a loading message until the first answer', async () => {
      const answer = deferred<GetResult>();
      fake.handle('coll.validator.get', () => answer.promise);
      await create();
      expect(q('val-loading')).not.toBeNull();
      expect(q('val-text')).toBeNull();
      answer.resolve(stored);
      await settle();
      expect(q('val-loading')).toBeNull();
      expect(q('val-text')).not.toBeNull();
    });

    it('offers the $jsonSchema template for a collection without a validator', async () => {
      stored = { validator: null, validationLevel: 'strict', validationAction: 'error' };
      await create();
      expect(text(get('val-state'))).toBe('No validator');
      expect(get<HTMLTextAreaElement>('val-text').value).toBe('');
      await click('val-template');
      expect(get<HTMLTextAreaElement>('val-text').value).toBe(SCHEMA_TEMPLATE);
      expect(view.dirty()).toBe(true);
      expect(q('val-template')).toBeNull();
    });

    it('shows a failed read and loads after Refresh', async () => {
      fake.fail('coll.validator.get', {
        code: 'NOT_FOUND',
        message: 'Collection shop.orders does not exist',
      });
      await create();
      expect(text(get('val-load-error'))).toContain('Collection shop.orders does not exist');
      expect(q('val-text')).toBeNull();
      expect(view.loading()).toBe(false);

      fake.handle('coll.validator.get', () => stored);
      await click('val-refresh');
      expect(q('val-load-error')).toBeNull();
      expect(q('val-text')).not.toBeNull();
    });

    it('Refresh takes the server version and drops the unsaved edit', async () => {
      await create();
      await typeText('{ a: 1 }');
      expect(view.dirty()).toBe(true);
      stored = {
        validator: '{"b":{"$exists":true}}',
        validationLevel: 'off',
        validationAction: 'error',
      };
      await click('val-refresh');
      expect(get<HTMLTextAreaElement>('val-text').value).toBe(
        '{\n  b: {\n    $exists: true\n  }\n}',
      );
      expect(get<HTMLSelectElement>('val-level').value).toBe('off');
      expect(view.dirty()).toBe(false);
    });

    it('keeps the newer read when an older one answers last', async () => {
      const older = deferred<GetResult>();
      const newer = deferred<GetResult>();
      let n = 0;
      fake.handle('coll.validator.get', () => (n++ === 0 ? older.promise : newer.promise));
      await create();
      const second = view.reload();
      newer.resolve({ validator: null, validationLevel: 'off', validationAction: 'warn' });
      await second;
      older.resolve(stored);
      await settle();
      expect(view.saved()).toEqual({ text: '', level: 'off', action: 'warn' });
      expect(view.loading()).toBe(false);
    });

    it('ignores an older read that fails after a newer one answered', async () => {
      const older = deferred<GetResult | { error: { code: 'NETWORK_ERROR'; message: string } }>();
      let n = 0;
      fake.handle('coll.validator.get', () => (n++ === 0 ? older.promise : stored));
      await create();
      await view.reload();
      older.resolve({ error: { code: 'NETWORK_ERROR', message: 'connection reset (fictitious)' } });
      await settle();
      expect(q('val-load-error')).toBeNull();
      expect(view.saved()?.level).toBe('moderate');
      expect(view.loading()).toBe(false);
    });

    it('reads again for another collection', async () => {
      await create();
      fixture.componentRef.setInput('tab', {
        ...TAB,
        data: { profileId: 'p1', db: 'shop', coll: 'items', type: 'collection' },
      });
      await settle();
      expect(gets().map((r) => r.params)).toEqual([T, { ...T, coll: 'items' }]);
    });
  });

  describe('editing', () => {
    beforeEach(create);

    it('is dirty after a change of the text, the level or the action, and Revert undoes it', async () => {
      await typeText('{ qty: { $gt: 0 } }');
      expect(view.dirty()).toBe(true);
      expect(saveButton().disabled).toBe(false);
      await click('val-revert');
      expect(view.dirty()).toBe(false);
      expect(get<HTMLTextAreaElement>('val-text').value).toContain('$jsonSchema');

      await choose('val-level', 'strict');
      expect(view.dirty()).toBe(true);
      await choose('val-level', 'moderate');
      expect(view.dirty()).toBe(false);

      await choose('val-action', 'error');
      expect(view.dirty()).toBe(true);
      expect(text(el().querySelectorAll('.hint')[1] ?? null)).toBe('Refuse invalid writes');
      await click('val-revert');
      expect(get<HTMLSelectElement>('val-action').value).toBe('warn');
      expect(view.dirty()).toBe(false);
    });

    it('shows the parse error on Save, sends nothing, and clears it once the text parses', async () => {
      await typeText('{ $jsonSchema: { bsonType: "object" }');
      expect(q('val-error')).toBeNull(); // not while typing before a Save
      await click('val-save');
      expect(sets()).toEqual([]);
      const error = get('val-error');
      expect(text(error)).toMatch(/line 1, column \d+/);
      expect(get('val-text').getAttribute('aria-invalid')).toBe('true');
      expect(get('val-text').getAttribute('aria-describedby')).toBe(error.id);

      await typeText('{ $jsonSchema: { bsonType: "object" } ');
      expect(q('val-error')).not.toBeNull(); // still wrong: the error follows the text
      await typeText('{ $jsonSchema: { bsonType: "object" } }');
      expect(q('val-error')).toBeNull();
      expect(get('val-text').getAttribute('aria-invalid')).toBeNull();
    });

    it('refuses code in the editor (never evaluated)', async () => {
      await typeText('{ $where: process.exit() }');
      await click('val-save');
      expect(sets()).toEqual([]);
      expect(q('val-error')).not.toBeNull();
    });

    it('Revert also clears a parse error and the last message', async () => {
      await typeText('{ a: ');
      await click('val-save');
      expect(q('val-error')).not.toBeNull();
      await click('val-revert');
      expect(q('val-error')).toBeNull();
      expect(view.dirty()).toBe(false);
    });
  });

  describe('save', () => {
    beforeEach(create);

    it('sends coll.validator.set with canonical EJSON, level and action, then reads it back', async () => {
      const changes = TestBed.inject(ValidatorChanges);
      await typeText('{ qty: { $gte: 1 } }');
      await choose('val-level', 'strict');
      await choose('val-action', 'error');
      await click('val-save');
      expect(sets()).toEqual([
        {
          ...T,
          validator: '{"qty":{"$gte":{"$numberInt":"1"}}}',
          validationLevel: 'strict',
          validationAction: 'error',
        },
      ]);
      expect(changes.version(T)).toBe(1);
      expect(changes.version({ ...T, coll: 'items' })).toBe(0);
      expect(text(get('val-message'))).toBe('Saved the validator.');
      expect(get('val-message').getAttribute('role')).toBe('status');
      expect(gets()).toHaveLength(2);
      expect(view.dirty()).toBe(false);
      expect(get<HTMLTextAreaElement>('val-text').value).toBe('{\n  qty: {\n    $gte: 1\n  }\n}');
      expect(view.saving()).toBe(false);
    });

    it('removes the validator for empty text', async () => {
      await typeText('   ');
      await click('val-save');
      expect(sets()).toEqual([
        { ...T, validator: null, validationLevel: 'moderate', validationAction: 'warn' },
      ]);
      expect(text(get('val-message'))).toBe('Removed the validator.');
      expect(text(get('val-state'))).toBe('No validator');
    });

    it('removes the validator for {}', async () => {
      await typeText('{}');
      await click('val-save');
      expect(sets()[0]?.['validator']).toBeNull();
    });

    it('shows a refused save as an error, keeps the edit and does not tell the collection tabs', async () => {
      const changes = TestBed.inject(ValidatorChanges);
      fake.fail('coll.validator.set', {
        code: 'SERVER_ERROR',
        message: 'The server refused the command: Unknown $jsonSchema keyword: bsonTyp',
      });
      await typeText('{ $jsonSchema: { bsonTyp: "object" } }');
      await click('val-save');
      expect(text(get('val-message'))).toContain('Unknown $jsonSchema keyword: bsonTyp');
      expect(get('val-message').getAttribute('role')).toBe('alert');
      expect(changes.version(T)).toBe(0);
      expect(view.dirty()).toBe(true);
      expect(get<HTMLTextAreaElement>('val-text').value).toContain('bsonTyp');
      expect(gets()).toHaveLength(1);
      expect(view.saving()).toBe(false);
      expect(saveButton().disabled).toBe(false);
    });

    it('a second Save while one is running sends nothing', async () => {
      const answer = deferred<Record<string, never>>();
      fake.handle('coll.validator.set', () => answer.promise);
      await typeText('{ a: 1 }');
      const first = view.save();
      await settle();
      expect(view.saving()).toBe(true);
      expect(text(saveButton())).toBe('Saving…');
      expect(saveButton().disabled).toBe(true);
      await view.save();
      expect(sets()).toHaveLength(1);
      answer.resolve({});
      await first;
      await settle();
      expect(view.saving()).toBe(false);
    });

    it('Ctrl+Enter in the editor saves', async () => {
      await typeText('{ a: 1 }');
      get('val-text').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
      await settle();
      expect(sets()).toHaveLength(1);
    });
  });

  describe('on a production profile', () => {
    beforeEach(async () => {
      setProfile(false, true);
      await create();
    });

    it('asks first and sends coll.validator.set with confirmed after Confirm', async () => {
      const confirm = TestBed.inject(ConfirmService);
      await typeText('{ a: 1 }');
      await click('val-save');
      expect(confirm.current()?.title).toBe('Change validation');
      expect(sets()).toEqual([]);
      confirm.answer(true);
      await settle();
      expect(sets()).toEqual([
        expect.objectContaining({ ...T, validator: '{"a":{"$numberInt":"1"}}', confirmed: true }),
      ]);
      expect(text(get('val-message'))).toBe('Saved the validator.');
    });

    it('sends nothing, shows no error and keeps the edit when the user cancels', async () => {
      const confirm = TestBed.inject(ConfirmService);
      const changes = TestBed.inject(ValidatorChanges);
      await typeText('{ a: 1 }');
      await click('val-save');
      confirm.answer(false);
      await settle();
      expect(sets()).toEqual([]);
      expect(q('val-message')).toBeNull();
      expect(changes.version(T)).toBe(0);
      expect(view.dirty()).toBe(true);
      expect(view.saving()).toBe(false);
    });
  });

  describe('on a read-only profile', () => {
    beforeEach(async () => {
      setProfile(true);
      await create();
    });

    it('shows the validator but disables Save', async () => {
      await typeText('{ a: 1 }');
      expect(get<HTMLTextAreaElement>('val-text').value).toBe('{ a: 1 }');
      expect(saveButton().disabled).toBe(true);
    });

    it('refuses a save called directly before anything is sent', async () => {
      await typeText('{ a: 1 }');
      await view.save();
      await settle();
      expect(sets()).toEqual([]);
      expect(text(get('val-message'))).toContain('read-only');
    });
  });
});
