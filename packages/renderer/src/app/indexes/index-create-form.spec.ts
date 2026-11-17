import { provideZonelessChangeDetection } from '@angular/core';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { FakeThicketBridge, provideFakeThicket } from '../api/testing';
import { ConfirmService } from '../safety/confirm.service';
import { ProfileSafetyService } from '../safety/profile-safety.service';
import { IndexCreateForm } from './index-create-form';

describe('IndexCreateForm', () => {
  let fake: FakeThicketBridge;
  let fixture: ComponentFixture<IndexCreateForm>;
  let created: string[];
  let cancelled: number;

  const el = () => fixture.nativeElement as HTMLElement;
  const all = <T extends HTMLElement = HTMLElement>(id: string) => [
    ...el().querySelectorAll<T>(`[data-testid="${id}"]`),
  ];
  const get = <T extends HTMLElement = HTMLElement>(id: string, i = 0): T => {
    const found = all<T>(id)[i];
    if (!found) throw new Error(`no element ${id}[${i}]`);
    return found;
  };
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();
    }
  };
  const type = async (id: string, text: string, i = 0) => {
    const input = get<HTMLInputElement>(id, i);
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  const select = async (id: string, value: string, i = 0) => {
    const s = get<HTMLSelectElement>(id, i);
    s.value = value;
    s.dispatchEvent(new Event('change'));
    await settle();
  };
  const check = async (id: string, on = true) => {
    const box = get<HTMLInputElement>(id);
    box.checked = on;
    box.dispatchEvent(new Event('change'));
    await settle();
  };
  const click = async (id: string, i = 0) => {
    get(id, i).click();
    await settle();
  };
  const submit = () => click('idx-create-submit');
  const errors = () => all('idx-error').map((e) => e.textContent?.trim() ?? '');
  const sent = () => fake.requestsFor('idx.create').map((r) => r.params as Record<string, unknown>);

  beforeEach(async () => {
    fake = new FakeThicketBridge();
    fake.handle('idx.create', () => ({ name: 'created_1' }));
    TestBed.configureTestingModule({
      imports: [IndexCreateForm],
      providers: [provideZonelessChangeDetection(), provideFakeThicket(fake)],
    });
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Local',
      readOnly: false,
      production: false,
    });
    fixture = TestBed.createComponent(IndexCreateForm);
    fixture.componentRef.setInput('target', { profileId: 'p1', db: 'shop', coll: 'orders' });
    created = [];
    cancelled = 0;
    fixture.componentInstance.created.subscribe((name) => created.push(name));
    fixture.componentInstance.cancelled.subscribe(() => cancelled++);
    await settle();
  });

  it('refuses an empty field name and sends nothing', async () => {
    await submit();
    expect(errors()).toEqual(['Enter a field name.']);
    const field = get('idx-key-field');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe(get('idx-error').id);
    expect(sent()).toEqual([]);
  });

  it('clears a field error when that field is edited', async () => {
    await submit();
    expect(errors()).toHaveLength(1);
    await type('idx-key-field', 'createdAt');
    expect(errors()).toEqual([]);
    expect(get('idx-key-field').getAttribute('aria-invalid')).toBeNull();
  });

  it('creates a TTL index with the seconds as Int32', async () => {
    await type('idx-key-field', 'createdAt');
    await type('idx-ttl', '3600');
    expect(get('idx-preview').textContent).toContain(
      'db.orders.createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 })',
    );
    await submit();
    expect(sent()).toEqual([
      {
        profileId: 'p1',
        db: 'shop',
        coll: 'orders',
        key: '{"createdAt":{"$numberInt":"1"}}',
        options: '{"expireAfterSeconds":{"$numberInt":"3600"}}',
      },
    ]);
    expect(created).toEqual(['created_1']);
    // The form starts over for the next index.
    expect(get<HTMLInputElement>('idx-key-field').value).toBe('');
  });

  it('refuses a TTL that is not whole seconds', async () => {
    await type('idx-key-field', 'createdAt');
    for (const bad of ['-1', '1.5', 'soon', '99999999999']) {
      await type('idx-ttl', bad);
      await submit();
      expect(errors()).toEqual(['Enter whole seconds (0 or more).']);
    }
    expect(sent()).toEqual([]);
  });

  it('refuses a TTL on a compound key', async () => {
    await type('idx-key-field', 'a');
    await click('idx-key-add');
    await type('idx-key-field', 'b', 1);
    await type('idx-ttl', '60');
    await submit();
    expect(errors()).toEqual(['A TTL index has exactly one field.']);
    expect(sent()).toEqual([]);
  });

  it('creates a partial index from a shell-syntax filter', async () => {
    await type('idx-key-field', 'customer');
    await select('idx-key-type', '-1');
    await type('idx-partial', '{ status: "open", total: { $gt: 100 } }');
    await type('idx-name', 'open_customers');
    await check('idx-unique');
    await submit();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      key: '{"customer":{"$numberInt":"-1"}}',
      options:
        '{"name":"open_customers","unique":true,"partialFilterExpression":{"status":"open","total":{"$gt":{"$numberInt":"100"}}}}',
    });
  });

  it('shows the parser error of a partial filter at the field', async () => {
    await type('idx-key-field', 'customer');
    await type('idx-partial', '{ status: ');
    await submit();
    expect(errors()).toHaveLength(1);
    expect(errors()[0]).toMatch(/line 1/);
    expect(get('idx-partial').getAttribute('aria-invalid')).toBe('true');
    expect(sent()).toEqual([]);
  });

  it('refuses sparse together with a partial filter', async () => {
    await type('idx-key-field', 'customer');
    await type('idx-partial', '{ status: "open" }');
    await check('idx-sparse');
    await submit();
    expect(errors()).toEqual(['Use either sparse or a partial filter, not both.']);
    expect(sent()).toEqual([]);
  });

  it('refuses duplicate fields and the reserved name', async () => {
    await type('idx-key-field', 'a');
    await click('idx-key-add');
    await type('idx-key-field', 'a', 1);
    await type('idx-name', '*');
    await submit();
    expect(errors()).toEqual(['a is already in the key.', 'The name * is reserved.']);
  });

  it('opens the advanced options when one of them has an error', async () => {
    await click('idx-more');
    await type('idx-key-field', 'name');
    await type('idx-collation', '{ strength: 2 }');
    await click('idx-more');
    expect(all('idx-collation')).toHaveLength(0);
    await submit();
    expect(all('idx-collation')).toHaveLength(1);
    expect(errors()).toEqual(['A collation needs a locale, e.g. { locale: "en" }.']);
  });

  it('creates a text index with weights and language', async () => {
    await type('idx-key-field', 'title');
    await select('idx-key-type', 'text');
    await click('idx-more');
    await type('idx-weights', '{ title: 10 }');
    await type('idx-language', 'german');
    await submit();
    expect(sent()[0]).toMatchObject({
      key: '{"title":"text"}',
      options: '{"weights":{"title":{"$numberInt":"10"}},"default_language":"german"}',
    });
  });

  it('refuses unique on a wildcard index', async () => {
    await type('idx-key-field', '$**');
    await check('idx-unique');
    await submit();
    expect(errors()).toEqual(['A wildcard index cannot be unique.']);
  });

  it('shows a server error and keeps the form', async () => {
    fake.fail('idx.create', { code: 'SERVER_ERROR', message: 'Index already exists' });
    await type('idx-key-field', 'a');
    await submit();
    expect(get('idx-create-error').textContent).toContain('Index already exists');
    expect(get<HTMLInputElement>('idx-key-field').value).toBe('a');
    expect(created).toEqual([]);
  });

  it('is disabled on a read-only profile', async () => {
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Local',
      readOnly: true,
      production: false,
    });
    await settle();
    expect(get<HTMLButtonElement>('idx-create-submit').disabled).toBe(true);
  });

  it('removing a field drops the positional and TTL errors and the last field cannot be removed', async () => {
    expect(get<HTMLButtonElement>('idx-key-remove').disabled).toBe(true);
    await type('idx-key-field', 'createdAt');
    await click('idx-key-add');
    await type('idx-key-field', '$bad', 1);
    await type('idx-ttl', '60');
    await submit();
    expect(errors()).toEqual([
      'Field names do not start with $.',
      'A TTL index has exactly one field.',
    ]);
    await click('idx-key-remove', 1);
    expect(all('idx-key-row')).toHaveLength(1);
    expect(errors()).toEqual([]);
    expect(get<HTMLButtonElement>('idx-key-remove').disabled).toBe(true);
    await submit();
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toMatchObject({
      key: '{"createdAt":{"$numberInt":"1"}}',
      options: '{"expireAfterSeconds":{"$numberInt":"60"}}',
    });
  });

  it('shows a whole-key error and clears it when a field changes', async () => {
    await type('idx-key-field', 'a');
    await select('idx-key-type', 'hashed');
    await click('idx-key-add');
    await type('idx-key-field', 'b', 1);
    await select('idx-key-type', 'hashed', 1);
    await submit();
    expect(get('idx-error-fields').textContent).toContain('at most one hashed field');
    await select('idx-key-type', '1', 1);
    expect(all('idx-error-fields')).toHaveLength(0);
    expect(sent()).toEqual([]);
  });

  it('on a production profile asks first and a cancel sends nothing and shows no error', async () => {
    TestBed.inject(ProfileSafetyService).set({
      id: 'p1',
      name: 'Live',
      readOnly: false,
      production: true,
    });
    const confirm = TestBed.inject(ConfirmService);
    await type('idx-key-field', 'a');
    await submit();
    expect(confirm.current()?.title).toBe('Create index');
    confirm.answer(false);
    await settle();
    expect(sent()).toEqual([]);
    expect(all('idx-create-error')).toHaveLength(0);
    expect(created).toEqual([]);
    expect(get<HTMLButtonElement>('idx-create-submit').disabled).toBe(false);
  });

  it('sends one create while the first is still running', async () => {
    let finish!: () => void;
    fake.handle(
      'idx.create',
      () => new Promise((resolve) => (finish = () => resolve({ name: 'a_1' }))),
    );
    await type('idx-key-field', 'a');
    await submit();
    expect(get('idx-create-submit').textContent).toContain('Creating…');
    await fixture.componentInstance.create();
    expect(sent()).toHaveLength(1);
    finish();
    await settle();
    expect(created).toEqual(['a_1']);
    // The form starts over after a create.
    expect(get<HTMLInputElement>('idx-key-field').value).toBe('');
  });

  it('emits cancelled', async () => {
    await click('idx-create-cancel');
    expect(cancelled).toBe(1);
  });

  it('disables Cancel while a create is running and enables it again afterwards', async () => {
    let finish!: () => void;
    fake.handle(
      'idx.create',
      () => new Promise((resolve) => (finish = () => resolve({ name: 'a_1' }))),
    );
    expect(get<HTMLButtonElement>('idx-create-cancel').disabled).toBe(false);
    await type('idx-key-field', 'a');
    await submit();
    expect(get<HTMLButtonElement>('idx-create-cancel').disabled).toBe(true);
    await click('idx-create-cancel');
    expect(cancelled).toBe(0);
    finish();
    await settle();
    expect(created).toEqual(['a_1']);
    expect(get<HTMLButtonElement>('idx-create-cancel').disabled).toBe(false);
  });

  it('enables Cancel again after a failed create', async () => {
    let fail!: () => void;
    fake.handle(
      'idx.create',
      () =>
        new Promise((_, reject) => {
          fail = () => reject({ code: 'SERVER_ERROR', message: 'Index already exists' });
        }),
    );
    await type('idx-key-field', 'a');
    await submit();
    expect(get<HTMLButtonElement>('idx-create-cancel').disabled).toBe(true);
    fail();
    await settle();
    expect(get('idx-create-error').textContent).toContain('Index already exists');
    expect(get<HTMLButtonElement>('idx-create-cancel').disabled).toBe(false);
    await click('idx-create-cancel');
    expect(cancelled).toBe(1);
  });

  it('greys out the wildcard projection only while $** is not a text field', async () => {
    await click('idx-more');
    const label = () =>
      el().querySelector(`label[for="${get('idx-wildcard-projection').id}"]`)?.classList;
    expect(label()?.contains('off')).toBe(true);
    await type('idx-key-field', '$**');
    expect(label()?.contains('off')).toBe(false);
    await select('idx-key-type', 'text');
    expect(label()?.contains('off')).toBe(true);
    await select('idx-key-type', '-1');
    expect(label()?.contains('off')).toBe(false);
  });

  it('shows the 2d position error as a whole-key error', async () => {
    await type('idx-key-field', 'cat');
    await click('idx-key-add');
    await type('idx-key-field', 'pos', 1);
    await select('idx-key-type', '2d', 1);
    await submit();
    expect(get('idx-error-fields').textContent).toContain(
      'A 2d field must be the first field of the key.',
    );
    expect(sent()).toEqual([]);
  });

  it('creates a wildcard text index with weights and language, without a wildcard projection', async () => {
    await type('idx-key-field', '$**');
    await select('idx-key-type', 'text');
    await click('idx-more');
    const projection = get('idx-wildcard-projection');
    const label = el().querySelector(`label[for="${projection.id}"]`);
    expect(label?.classList.contains('off')).toBe(true);
    await type('idx-weights', '{ title: 10 }');
    await type('idx-language', 'spanish');
    await submit();
    expect(sent()[0]).toMatchObject({
      key: '{"$**":"text"}',
      options: '{"weights":{"title":{"$numberInt":"10"}},"default_language":"spanish"}',
    });
  });

  it('refuses a wildcard projection and a collation on a wildcard text index', async () => {
    await type('idx-key-field', '$**');
    await select('idx-key-type', 'text');
    await click('idx-more');
    await type('idx-wildcard-projection', '{ secret: 0 }');
    await type('idx-collation', '{ locale: "en" }');
    await submit();
    expect(errors()).toEqual([
      'A text index does not support a collation.',
      'A wildcard text index has no wildcard projection.',
    ]);
    expect(sent()).toEqual([]);
  });
});
