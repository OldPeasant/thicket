import { TestBed } from '@angular/core/testing';
import { RouterTestingHarness } from '@angular/router/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { appConfig } from '../app.config';
import { ExplorerDemo } from './explorer-demo';

// The dev route end to end inside the renderer: router -> lazy demo page -> copied explorer.
describe('dev route #/dev/explorer', () => {
  let harness: RouterTestingHarness;
  let page: HTMLElement;

  const stable = () => harness.fixture.whenStable();
  const all = (selector: string) => [...page.querySelectorAll<HTMLElement>(selector)];
  const one = (selector: string) => {
    const el = page.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no ${selector}`);
    return el;
  };
  const button = (text: string) => {
    const el = all('button').find((b) => b.textContent?.trim() === text);
    if (!el) throw new Error(`no button "${text}"`);
    return el;
  };
  const text = () => one('app-json-explorer').textContent ?? '';
  const search = async (value: string) => {
    const input = one('.filter-box input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await stable();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/dev/explorer', ExplorerDemo);
    await stable();
    page = harness.routeNativeElement as HTMLElement;
  });

  it('renders the demo document in tables', () => {
    expect(one('h1').textContent).toBe('Explorer demo');
    expect(page.querySelector('app-json-table')).not.toBeNull();
    expect(text()).toContain('Nightwatch');
    for (const name of ['Ada Lovelace', 'Grace Hopper', 'Alan Turing'])
      expect(text()).toContain(name);
    // The members array of records is a table with a column per key.
    const headers = all('th').map((th) => th.textContent?.trim());
    expect(headers).toEqual(expect.arrayContaining(['id', 'name', 'role', 'skills', 'contact']));
  });

  it('switches between the tables and the form layout', async () => {
    button('Form').click();
    await stable();
    // The document root is a form now (its list of records may still show as a table inside).
    expect(page.querySelector('.json-output > app-json-form')).not.toBeNull();
    expect(page.querySelector('.json-output > app-json-table')).toBeNull();
    expect(text()).toContain('Ada Lovelace');

    button('Tables').click();
    await stable();
    expect(page.querySelector('.json-output > app-json-table')).not.toBeNull();
    expect(page.querySelector('app-json-form')).toBeNull();
  });

  it('searches in strict and context mode', async () => {
    await search('Grace');
    expect(one('.filter-hint').textContent).toContain('strict');
    expect(text()).toContain('Grace Hopper');
    // Strict shows only what matched (under its parents): the other members are gone.
    expect(text()).not.toContain('Ada Lovelace');
    expect(text()).not.toContain('Nightwatch');

    button('Context').click();
    await stable();
    expect(one('.filter-hint').textContent).toContain('context');
    expect(text()).toContain('Grace Hopper');
    // Context also keeps the siblings of the match's parents, such as the project name.
    expect(text()).toContain('Nightwatch');

    button('×').click();
    await stable();
    expect(text()).toContain('Ada Lovelace');
    expect(page.querySelector('.filter-hint')).toBeNull();
  });

  it('collapses and expands a node', async () => {
    const membersToggle = all('.node-toggle').find((b) => b.closest('td, th') !== null);
    if (!membersToggle) throw new Error('no nested node toggle');
    membersToggle.click();
    await stable();
    const chip = one('.collapsed-chip');
    expect(text()).not.toContain('Ada Lovelace');

    chip.click();
    await stable();
    expect(text()).toContain('Ada Lovelace');
    expect(page.querySelector('.collapsed-chip')).toBeNull();
  });

  it('hides a column', async () => {
    // Open each table's column menu until one offers the members' "skills" column.
    let checkbox: HTMLInputElement | null | undefined;
    for (const menu of all('.col-menu-btn')) {
      menu.click();
      await stable();
      const skills = all('.col-menu label').find((l) => l.textContent?.trim() === 'skills');
      checkbox = skills?.querySelector('input');
      if (checkbox) break;
      menu.click();
      await stable();
    }
    if (!checkbox) throw new Error('no column menu offers "skills"');
    expect(all('th').map((th) => th.textContent?.trim())).toContain('skills');
    checkbox.click();
    await stable();
    expect(all('th').map((th) => th.textContent?.trim())).not.toContain('skills');
    expect(text()).not.toContain('algorithms');
  });

  it('edits a value and hands the new document to the page', async () => {
    button('Go to edit mode').click();
    await stable();
    const input = all('input.val-input.str').find(
      (i) => (i as HTMLInputElement).value === 'Nightwatch',
    ) as HTMLInputElement | undefined;
    if (!input) throw new Error('no editor for "Nightwatch"');
    input.value = 'Daywatch';
    input.dispatchEvent(new Event('blur'));
    await stable();

    expect(one('.raw-json').textContent).toContain('"project": "Daywatch"');
    expect(one('.raw-json').textContent).not.toContain('Nightwatch');
    button('Go to view mode').click();
    await stable();
    expect(text()).toContain('Daywatch');
  });
});
