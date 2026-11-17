/**
 * Static checks of the electron-builder packaging (apps/desktop/electron-builder.yml, build/,
 * package.json). The config is read and schema-validated with electron-builder's own loader, so
 * these tests see what `npm run dist` sees. Building installers is not part of `npm run check`
 * (see docs/ARCHITECTURE.md "Packaging").
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, inflateSync } from 'node:zlib';

import { getConfig, validateConfiguration } from 'app-builder-lib/out/util/config/config.js';
import { DebugLogger } from 'builder-util';
import type { Configuration, FileSet, TargetConfiguration } from 'electron-builder';
import { beforeAll, describe, expect, it } from 'vitest';

import { rendererSource } from './main/renderer-source';

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(desktopDir, '..', '..');

interface PackageJson {
  name: string;
  productName?: string;
  desktopName?: string;
  main?: string;
  homepage?: string;
  author?: { name?: string; email?: string };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as PackageJson;
const desktopPackage = readJson(resolve(desktopDir, 'package.json'));
const rootPackage = readJson(resolve(repoDir, 'package.json'));

/** Target names of a platform's `target` option (string, list of strings or objects). */
function targetNames(target: unknown): string[] {
  const list = Array.isArray(target) ? (target as unknown[]) : target == null ? [] : [target];
  return list.map((entry) =>
    typeof entry === 'string' ? entry : (entry as TargetConfiguration).target,
  );
}

function targetArchs(target: unknown, name: string): string[] {
  const list = Array.isArray(target) ? (target as unknown[]) : [];
  const entry = list.find(
    (item): item is TargetConfiguration =>
      typeof item === 'object' && item !== null && (item as TargetConfiguration).target === name,
  );
  const arch = entry?.arch;
  return arch == null ? [] : Array.isArray(arch) ? arch : [arch];
}

describe('electron-builder.yml', () => {
  let config: Configuration;

  beforeAll(async () => {
    config = await getConfig(desktopDir, 'electron-builder.yml', null);
  });

  it("passes electron-builder's own schema validation", async () => {
    await expect(validateConfiguration(config, new DebugLogger(false))).resolves.toBeUndefined();
  });

  it('sets the app id io.github.oldpeasant.thicket and product name Thicket', () => {
    expect(config.appId).toBe('io.github.oldpeasant.thicket');
    expect(config.productName).toBe('Thicket');
  });

  it('uses build/ for resources and writes installers to release/ (git-ignored)', () => {
    expect(config.directories?.buildResources).toBe('build');
    expect(config.directories?.output).toBe('release');
    const gitignore = readFileSync(resolve(repoDir, '.gitignore'), 'utf8').split('\n');
    expect(gitignore).toContain('release/');
  });

  it('builds AppImage, deb and rpm on Linux with a lower-case executable and package name', () => {
    expect(targetNames(config.linux?.target).sort()).toEqual(['AppImage', 'deb', 'rpm']);
    expect(config.linux?.executableName).toBe('thicket');
    expect(config.deb?.packageName).toBe('thicket');
    expect(config.rpm?.packageName).toBe('thicket');
    // deb and rpm refuse to build without a maintainer.
    expect(config.linux?.maintainer).toMatch(/\S+ <[^@\s]+@[^@\s]+>/);
  });

  it('builds an ad-hoc signed (no Developer ID) dmg for arm64 and x64 on macOS', () => {
    expect(targetNames(config.mac?.target)).toEqual(['dmg']);
    expect(targetArchs(config.mac?.target, 'dmg').sort()).toEqual(['arm64', 'x64']);
    // '-' = ad-hoc: Apple Silicon shows the Gatekeeper warning instead of "damaged".
    expect(config.mac?.identity).toBe('-');
    // Ad-hoc signing with hardened runtime would fail library validation of Electron's frameworks.
    expect(config.mac?.hardenedRuntime).toBe(false);
    expect(config.dmg?.sign).toBe(false);
  });

  it('builds NSIS and zip for x64 on Windows', () => {
    expect(targetNames(config.win?.target).sort()).toEqual(['nsis', 'zip']);
    expect(targetArchs(config.win?.target, 'nsis')).toEqual(['x64']);
    expect(targetArchs(config.win?.target, 'zip')).toEqual(['x64']);
  });

  it('points every platform at the placeholder icon in build/', () => {
    expect(config.linux?.icon).toBe('build/icon.png');
    expect(config.mac?.icon).toBe('build/icon.png');
    expect(config.win?.icon).toBe('build/icon.png');
  });

  it('packs the dist bundles (without source maps) and package.json into the app', () => {
    // electron-builder normalises a plain pattern list to [{ filter: [...] }].
    const files = (config.files as (string | FileSet)[]).flatMap((entry) =>
      typeof entry === 'string' ? [entry] : (entry.filter ?? []),
    );
    expect(files).toContain('dist/**/*');
    expect(files).toContain('!dist/**/*.map');
    expect(files).toContain('package.json');
    // The entry point named in package.json must be inside the packed files.
    expect(desktopPackage.main).toMatch(/^dist\//);
  });

  it('copies the built renderer to resources/renderer, where main looks when packaged', () => {
    const extra = config.extraResources as FileSet[];
    expect(extra).toHaveLength(1);
    const [renderer] = extra;
    expect(renderer?.to).toBe('renderer');
    expect(resolve(desktopDir, renderer?.from ?? '')).toBe(
      resolve(repoDir, 'packages', 'renderer', 'dist'),
    );
    const resourcesPath = resolve('/opt/Thicket/resources');
    const packaged = rendererSource({
      packaged: true,
      env: {},
      resourcesPath,
      distDir: desktopDir,
    });
    expect(packaged.rendererDir).toBe(join(resourcesPath, renderer?.to ?? ''));
  });

  it('rebuilds native modules for Electron and unpacks them from the asar', () => {
    expect(config.npmRebuild).toBe(true);
    expect(config.asarUnpack).toEqual(['**/*.node']);
  });

  it('names artifacts thicket-<version>-<os>-<arch>.<ext>', () => {
    expect(config.artifactName).toBe('thicket-${version}-${os}-${arch}.${ext}');
  });

  it('flips the Electron fuses: no Node mode, NODE_OPTIONS or --inspect; asar only, validated', () => {
    expect(config.electronFuses).toEqual({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      onlyLoadAppFromAsar: true,
      enableEmbeddedAsarIntegrityValidation: true,
    });
    // Fuses only apply to an asar app (electron-builder's default, which must not be turned off).
    expect(config.asar).not.toBe(false);
  });
});

describe('apps/desktop/package.json', () => {
  it('has the same product name as the electron-builder config (userData folder Thicket)', async () => {
    const config = await getConfig(desktopDir, 'electron-builder.yml', null);
    expect(desktopPackage.productName).toBe(config.productName);
    expect(desktopPackage.productName).toBe('Thicket');
  });

  it('names the desktop entry thicket.desktop, matching the Linux executable', () => {
    expect(desktopPackage.desktopName).toBe('thicket.desktop');
  });

  it('has the homepage and author e-mail that deb/rpm metadata need', () => {
    expect(desktopPackage.homepage).toMatch(/^https:\/\//);
    expect(desktopPackage.author?.name).toBeTruthy();
    expect(desktopPackage.author?.email).toMatch(/^[^@\s]+@[^@\s]+$/);
  });

  it('pins electron to an exact version (electron-builder rejects a hoisted range)', () => {
    expect(desktopPackage.devDependencies?.['electron']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('keeps bundled workspace packages out of the runtime dependencies (asar holds only dist)', () => {
    const runtime = Object.keys(desktopPackage.dependencies ?? {});
    expect(runtime.filter((name) => name.startsWith('@thicket/'))).toEqual([]);
    expect(desktopPackage.devDependencies).toHaveProperty('electron-builder');
  });

  it('builds with the electron-builder config via dist and dist:dir, never publishing', () => {
    for (const script of ['dist', 'dist:dir']) {
      const command = desktopPackage.scripts?.[script] ?? '';
      // The renderer is built first, so the workspace script never packages a missing or stale
      // packages/renderer/dist (electron-builder only warns about a missing extraResources source).
      expect(command).toMatch(
        /^npm run build -w @thicket\/renderer && node scripts\/build\.mjs && electron-builder /,
      );
      expect(command).toContain('electron-builder --config electron-builder.yml');
      expect(command).toContain('--publish never');
    }
    expect(desktopPackage.scripts?.['dist:dir']).toContain('--dir');
  });

  it('is reachable from the root as npm run dist, delegating to the workspace (renderer built once)', () => {
    expect(rootPackage.scripts?.['dist']).toBe('npm run dist -w apps/desktop');
  });
});

describe('build/icon.png', () => {
  const png = readFileSync(resolve(desktopDir, 'build', 'icon.png'));

  interface Chunk {
    type: string;
    data: Buffer;
    crcOk: boolean;
  }

  function chunks(buffer: Buffer): Chunk[] {
    const result: Chunk[] = [];
    let offset = 8;
    while (offset < buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const body = buffer.subarray(offset + 4, offset + 8 + length);
      const crc = buffer.readUInt32BE(offset + 8 + length);
      result.push({
        type: body.subarray(0, 4).toString('ascii'),
        data: body.subarray(4),
        crcOk: crc32(body) === crc,
      });
      offset += 12 + length;
    }
    return result;
  }

  function ihdr(list: Chunk[]): Buffer {
    const first = list[0];
    if (first?.type !== 'IHDR') throw new Error('icon.png does not start with IHDR');
    return first.data;
  }

  it('is a well-formed PNG (signature, IHDR first, IEND last, valid CRCs)', () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const list = chunks(png);
    expect(list[0]?.type).toBe('IHDR');
    expect(list.at(-1)?.type).toBe('IEND');
    expect(list.every((chunk) => chunk.crcOk)).toBe(true);
  });

  it('is a square RGBA image of at least 512x512 (electron-builder minimum for macOS)', () => {
    const header = ihdr(chunks(png));
    const width = header.readUInt32BE(0);
    const height = header.readUInt32BE(4);
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(512);
    expect(header[8]).toBe(8); // bit depth
    expect(header[9]).toBe(6); // colour type RGBA
  });

  it('has image data that inflates to exactly one filtered row per scanline', () => {
    const list = chunks(png);
    const header = ihdr(list);
    const width = header.readUInt32BE(0);
    const height = header.readUInt32BE(4);
    const idat = Buffer.concat(list.filter((c) => c.type === 'IDAT').map((c) => c.data));
    expect(inflateSync(idat).length).toBe((width * 4 + 1) * height);
  });
});
