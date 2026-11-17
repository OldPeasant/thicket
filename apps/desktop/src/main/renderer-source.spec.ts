import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { rendererSource } from './renderer-source';

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
});
