import path from 'node:path';

export interface RendererSource {
  /** `ng serve` origin to load the renderer from (dev only), else undefined. */
  devServer: string | undefined;
  /** Folder of the built renderer served from `thicket://app`. */
  rendererDir: string;
}

/**
 * Where the renderer comes from. `THICKET_DEV_SERVER` and `THICKET_RENDERER_DIR` are development and
 * test overrides: a packaged app ignores them and always serves `resources/renderer` (the
 * electron-builder extra resource next to app.asar), so an environment variable cannot make an
 * installed Thicket load other code.
 */
export function rendererSource(options: {
  packaged: boolean;
  env: Readonly<Record<string, string | undefined>>;
  resourcesPath: string;
  /** Folder of the bundled main script (`apps/desktop/dist`). */
  distDir: string;
}): RendererSource {
  const { packaged, env, resourcesPath, distDir } = options;
  if (packaged) {
    return { devServer: undefined, rendererDir: path.join(resourcesPath, 'renderer') };
  }
  return {
    devServer: env['THICKET_DEV_SERVER'] || undefined,
    rendererDir:
      env['THICKET_RENDERER_DIR'] ||
      path.resolve(distDir, '..', '..', '..', 'packages', 'renderer', 'dist'),
  };
}
