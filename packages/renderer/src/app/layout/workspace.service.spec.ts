import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { WorkspaceService, type WorkspaceTab } from './workspace.service';

const tab = (id: string): WorkspaceTab => ({ id, kind: 'collection', title: id });

describe('WorkspaceService', () => {
  let ws: WorkspaceService;
  const ids = () => ws.tabs().map((t) => t.id);

  beforeEach(() => {
    ws = TestBed.inject(WorkspaceService);
  });

  it('starts on the start page with no tabs', () => {
    expect(ws.tabs()).toEqual([]);
    expect(ws.activeId()).toBeNull();
    expect(ws.active()).toBeNull();
  });

  it('opens tabs after the active one and shows them', () => {
    ws.open(tab('a'));
    ws.open(tab('b'));
    ws.activate('a');
    ws.open(tab('c'));
    expect(ids()).toEqual(['a', 'c', 'b']);
    expect(ws.activeId()).toBe('c');
  });

  it('appends when the start page is shown', () => {
    ws.open(tab('a'));
    ws.open(tab('b'));
    ws.showHome();
    ws.open(tab('c'));
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('selects and updates an already open tab instead of opening a second one', () => {
    ws.open(tab('a'));
    ws.open(tab('b'));
    ws.open({ ...tab('a'), title: 'renamed' });
    expect(ids()).toEqual(['a', 'b']);
    expect(ws.active()?.title).toBe('renamed');
  });

  it('closing the active tab shows the right neighbour, else the left one, else home', () => {
    ['a', 'b', 'c'].forEach((id) => ws.open(tab(id)));
    ws.activate('b');
    expect(ws.close()).toBe(true);
    expect(ws.activeId()).toBe('c');
    ws.close();
    expect(ws.activeId()).toBe('a');
    ws.close();
    expect(ws.activeId()).toBeNull();
    expect(ws.close()).toBe(false);
  });

  it('closing an inactive tab keeps the active one', () => {
    ['a', 'b'].forEach((id) => ws.open(tab(id)));
    ws.close('a');
    expect(ids()).toEqual(['b']);
    expect(ws.activeId()).toBe('b');
    expect(ws.close('nope')).toBe(false);
  });

  it('cycles forward and backward with wrap-around, from home to the ends', () => {
    expect(ws.cycle(1)).toBe(false);
    ['a', 'b', 'c'].forEach((id) => ws.open(tab(id)));
    ws.cycle(1);
    expect(ws.activeId()).toBe('a');
    ws.cycle(-1);
    expect(ws.activeId()).toBe('c');
    ws.showHome();
    ws.cycle(1);
    expect(ws.activeId()).toBe('a');
    ws.showHome();
    ws.cycle(-1);
    expect(ws.activeId()).toBe('c');
  });

  it('moves tabs, clamped to the list', () => {
    ['a', 'b', 'c'].forEach((id) => ws.open(tab(id)));
    ws.move('a', 2);
    expect(ids()).toEqual(['b', 'c', 'a']);
    ws.move('a', -5);
    expect(ids()).toEqual(['a', 'b', 'c']);
    ws.move('c', 99);
    ws.move('zz', 0);
    expect(ids()).toEqual(['a', 'b', 'c']);
  });

  it('ignores unknown ids on activate', () => {
    ws.open(tab('a'));
    ws.activate('zz');
    expect(ws.activeId()).toBe('a');
    ws.activate(null);
    expect(ws.activeId()).toBeNull();
  });
});
