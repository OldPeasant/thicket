import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { rendererSource } from './renderer-source';
import { contentSecurityPolicy } from './security';

const distDir = path.resolve('/repo/apps/desktop/dist');
const resourcesPath = path.resolve('/opt/Thicket/resources');
const overrides = { THICKET_DEV_SERVER: 'http://evil.example', THICKET_RENDERER_DIR: '/tmp/evil' };

describe('rendererSource', () => {
  it('packaged: ignores THICKET_DEV_SERVER and THICKET_RENDERER_DIR', () => {
    expect(rendererSource({ packaged: true, env: overrides, resourcesPath, distDir })).toEqual({
      devServer: undefined,
      rendererDir: path.join(resourcesPath, 'renderer'),
    });
  });

  it('dev: honours both overrides', () => {
    expect(rendererSource({ packaged: false, env: overrides, resourcesPath, distDir })).toEqual({
      devServer: 'http://evil.example',
      rendererDir: '/tmp/evil',
    });
  });

  it('dev without overrides (or empty ones): no dev server, packages/renderer/dist', () => {
    const expected = {
      devServer: undefined,
      rendererDir: path.resolve('/repo/packages/renderer/dist'),
    };
    expect(rendererSource({ packaged: false, env: {}, resourcesPath, distDir })).toEqual(expected);
    expect(
      rendererSource({
        packaged: false,
        env: { THICKET_DEV_SERVER: '', THICKET_RENDERER_DIR: '' },
        resourcesPath,
        distDir,
      }),
    ).toEqual(expected);
  });

  it('packaged: ignores each override on its own too', () => {
    const packagedDir = path.join(resourcesPath, 'renderer');
    for (const env of [
      { THICKET_DEV_SERVER: 'http://evil.example' },
      { THICKET_RENDERER_DIR: '/tmp/evil' },
    ]) {
      expect(rendererSource({ packaged: true, env, resourcesPath, distDir })).toEqual({
        devServer: undefined,
        rendererDir: packagedDir,
      });
    }
  });

  it('packaged: the renderer folder does not depend on distDir', () => {
    const other = path.resolve('/elsewhere/dist');
    expect(rendererSource({ packaged: true, env: {}, resourcesPath, distDir: other })).toEqual(
      rendererSource({ packaged: true, env: {}, resourcesPath, distDir }),
    );
  });

  it('dev: each override applies independently of the other', () => {
    expect(
      rendererSource({
        packaged: false,
        env: { THICKET_DEV_SERVER: 'http://localhost:4200' },
        resourcesPath,
        distDir,
      }),
    ).toEqual({
      devServer: 'http://localhost:4200',
      rendererDir: path.resolve('/repo/packages/renderer/dist'),
    });
    expect(
      rendererSource({
        packaged: false,
        env: { THICKET_RENDERER_DIR: '/tmp/renderer-build' },
        resourcesPath,
        distDir,
      }),
    ).toEqual({ devServer: undefined, rendererDir: '/tmp/renderer-build' });
  });

  it('packaged: THICKET_DEV_SERVER cannot widen the CSP connect-src', () => {
    const { devServer } = rendererSource({
      packaged: true,
      env: { THICKET_DEV_SERVER: 'http://evil.example:9999' },
      resourcesPath,
      distDir,
    });
    const csp = contentSecurityPolicy(devServer);
    expect(csp).toContain("connect-src 'self';");
    expect(csp).not.toContain('evil.example');
  });

  it('main reads the renderer overrides only through rendererSource', () => {
    // Regression guard: a direct process.env read in main would bypass the packaged check.
    const main = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.ts'),
      'utf8',
    );
    const code = main.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/THICKET_DEV_SERVER|THICKET_RENDERER_DIR/);
    expect(code).toMatch(/rendererSource\(\{\s*packaged: app\.isPackaged,/);
  });
});
