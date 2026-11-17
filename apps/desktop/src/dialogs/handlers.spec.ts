import { serve, type Port } from '@thicket/backend';
import { parseResultIn, privilegedMethods, type Response } from '@thicket/contract';
import { describe, expect, it, vi } from 'vitest';

import { dialogHandlers, type NativeDialogs } from './handlers';

const ctx = { signal: new AbortController().signal, requestId: '1' };

function fakeDialogs(
  save: Awaited<ReturnType<NativeDialogs['showSaveDialog']>> = {
    canceled: false,
    filePath: '/home/alice/export.json',
  },
  open: Awaited<ReturnType<NativeDialogs['showOpenDialog']>> = {
    canceled: false,
    filePaths: ['/home/alice/import.jsonl'],
  },
) {
  return {
    showSaveDialog: vi.fn<NativeDialogs['showSaveDialog']>(() => Promise.resolve(save)),
    showOpenDialog: vi.fn<NativeDialogs['showOpenDialog']>(() => Promise.resolve(open)),
  };
}

const filters = [
  { name: 'JSON', extensions: ['json'] },
  { name: 'All files', extensions: ['*'] },
];

describe('dialogHandlers', () => {
  it('serves exactly dialog.saveFile and dialog.openFile', () => {
    expect(Object.keys(dialogHandlers(fakeDialogs())).sort()).toEqual([
      'dialog.openFile',
      'dialog.saveFile',
    ]);
  });

  it('dialog.saveFile shows a save dialog with the given options and answers the path', async () => {
    const dialogs = fakeDialogs();
    const result: unknown = await dialogHandlers(dialogs)['dialog.saveFile']?.(
      { title: 'Export documents', defaultName: 'orders.json', filters } as never,
      ctx,
    );
    expect(result).toEqual({ path: '/home/alice/export.json' });
    expect(parseResultIn(privilegedMethods, 'dialog.saveFile', result).ok).toBe(true);
    expect(dialogs.showSaveDialog).toHaveBeenCalledWith({
      title: 'Export documents',
      defaultPath: 'orders.json',
      filters,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
  });

  it('dialog.saveFile leaves out options that were not given', async () => {
    const dialogs = fakeDialogs();
    await dialogHandlers(dialogs)['dialog.saveFile']?.({} as never, ctx);
    expect(dialogs.showSaveDialog).toHaveBeenCalledWith({
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
  });

  it.each([
    ['cancelled', { canceled: true, filePath: '/home/alice/ignored.json' }],
    ['without a path', { canceled: false }],
    ['with an empty path', { canceled: false, filePath: '' }],
  ])('dialog.saveFile answers null when %s', async (_what, answer) => {
    const result: unknown = await dialogHandlers(fakeDialogs(answer))['dialog.saveFile']?.(
      {} as never,
      ctx,
    );
    expect(result).toEqual({ path: null });
    expect(parseResultIn(privilegedMethods, 'dialog.saveFile', result).ok).toBe(true);
  });

  it('dialog.openFile shows an open dialog for one file and answers its path', async () => {
    const dialogs = fakeDialogs();
    const result: unknown = await dialogHandlers(dialogs)['dialog.openFile']?.(
      { title: 'Import documents', filters } as never,
      ctx,
    );
    expect(result).toEqual({ path: '/home/alice/import.jsonl' });
    expect(parseResultIn(privilegedMethods, 'dialog.openFile', result).ok).toBe(true);
    expect(dialogs.showOpenDialog).toHaveBeenCalledWith({
      title: 'Import documents',
      filters,
      properties: ['openFile'],
    });
    await dialogHandlers(dialogs)['dialog.openFile']?.({} as never, ctx);
    expect(dialogs.showOpenDialog).toHaveBeenLastCalledWith({ properties: ['openFile'] });
  });

  it.each([
    ['cancelled', { canceled: true, filePaths: ['/home/alice/ignored.json'] }],
    ['without a file', { canceled: false, filePaths: [] }],
    ['with an empty path', { canceled: false, filePaths: [''] }],
  ])('dialog.openFile answers null when %s', async (_what, answer) => {
    const result: unknown = await dialogHandlers(fakeDialogs(undefined, answer))[
      'dialog.openFile'
    ]?.({} as never, ctx);
    expect(result).toEqual({ path: null });
  });

  it('passes a failing dialog on', async () => {
    const dialogs = fakeDialogs();
    dialogs.showOpenDialog.mockRejectedValueOnce(new Error('no display'));
    await expect(dialogHandlers(dialogs)['dialog.openFile']?.({} as never, ctx)).rejects.toThrow(
      'no display',
    );
  });
});

/** A synchronous in-memory port: `push` delivers to the server, `sent` collects its answers. */
function fakePort() {
  const listeners = new Set<(message: unknown) => void>();
  const port = {
    sent: [] as Response[],
    send: (message: unknown) => void port.sent.push(message as Response),
    onMessage(listener: (message: unknown) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    close: () => undefined,
    push: (message: unknown) => {
      for (const listener of [...listeners]) listener(message);
    },
  };
  return port satisfies Port;
}

describe('dialog.* on the privileged port', () => {
  it('validates params against the privileged contract', async () => {
    const dialogs = fakeDialogs();
    const port = fakePort();
    serve(port, { table: privilegedMethods, route: 'main', handlers: dialogHandlers(dialogs) });
    port.push({ id: 'ok', method: 'dialog.saveFile', params: { defaultName: 'a.json' } });
    port.push({ id: 'extra', method: 'dialog.openFile', params: { path: '/etc/passwd' } });
    port.push({ id: 'empty', method: 'dialog.saveFile', params: { defaultName: '' } });
    port.push({
      id: 'filter',
      method: 'dialog.openFile',
      params: { filters: [{ name: 'JSON', extensions: [] }] },
    });
    await vi.waitFor(() => expect(port.sent).toHaveLength(4));
    const byId = new Map(port.sent.map((r) => [r.id, r]));
    expect(byId.get('ok')).toEqual({
      id: 'ok',
      ok: true,
      result: { path: '/home/alice/export.json' },
    });
    for (const id of ['extra', 'empty', 'filter']) {
      expect(byId.get(id)).toMatchObject({ ok: false, error: { code: 'INVALID_PARAMS' } });
    }
    expect(dialogs.showSaveDialog).toHaveBeenCalledTimes(1);
    expect(dialogs.showOpenDialog).not.toHaveBeenCalled();
  });
});
