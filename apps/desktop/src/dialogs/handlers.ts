import type { Handler } from '@thicket/backend';
import type { PrivilegedParamsOf } from '@thicket/contract';

/** A file type filter as Electron's dialogs take it. */
export interface DialogFilter {
  name: string;
  extensions: string[];
}

/**
 * The part of Electron's `dialog` module the file dialogs use (with the parent window already
 * applied), so the handlers can be tested without Electron.
 */
export interface NativeDialogs {
  showSaveDialog(options: {
    title?: string;
    defaultPath?: string;
    filters?: DialogFilter[];
    properties?: ('createDirectory' | 'showOverwriteConfirmation')[];
  }): Promise<{ canceled: boolean; filePath?: string }>;
  showOpenDialog(options: {
    title?: string;
    filters?: DialogFilter[];
    properties: 'openFile'[];
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

/**
 * Privileged handlers `dialog.saveFile` / `dialog.openFile`: main shows the native dialog for the
 * backend (`io.export`, `io.previewImport`) and answers the chosen path, `null` when cancelled.
 * Only the backend can call them (privileged port); the renderer never gets a way to pass paths.
 */
export function dialogHandlers(dialogs: NativeDialogs): Record<string, Handler> {
  return {
    'dialog.saveFile': async (params: PrivilegedParamsOf<'dialog.saveFile'>) => {
      const answer = await dialogs.showSaveDialog({
        ...(params.title !== undefined ? { title: params.title } : {}),
        ...(params.defaultName !== undefined ? { defaultPath: params.defaultName } : {}),
        ...(params.filters !== undefined ? { filters: params.filters } : {}),
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      return { path: answer.canceled || !answer.filePath ? null : answer.filePath };
    },
    'dialog.openFile': async (params: PrivilegedParamsOf<'dialog.openFile'>) => {
      const answer = await dialogs.showOpenDialog({
        ...(params.title !== undefined ? { title: params.title } : {}),
        ...(params.filters !== undefined ? { filters: params.filters } : {}),
        properties: ['openFile'],
      });
      const [file] = answer.filePaths;
      return { path: answer.canceled || !file ? null : file };
    },
  };
}
