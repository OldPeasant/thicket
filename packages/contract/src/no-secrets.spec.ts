import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  BROADCAST_STREAMS,
  SECRET_KINDS,
  backendRestarted,
  connStatus,
  methods,
  privilegedMethods,
  route,
  settingsChanged,
  themeInfo,
  type MethodDef,
} from './index';

/*
 * Contract test for "the renderer cannot request a secret" (schemas): no result, stream payload
 * or broadcast reachable from the renderer has a field that could carry a secret value; the only
 * method that returns secrets is privileged and unroutable. The behavioural half (main's
 * renderer port refuses `secrets.get` and never answers with a stored value) is
 * `apps/desktop/src/secrets/no-secrets-to-renderer.spec.ts`.
 */

/** Field names that would carry a secret value. */
const SECRET_FIELD = /password|passphrase|secret|token|credential|private.?key(?!file)/i;

/**
 * Fields matching `SECRET_FIELD` that are free strings but carry no secret. Every entry needs a
 * reason; adding one is a security decision.
 */
const ALLOWED_TEXT_FIELDS: Record<string, string> = {
  /** `io.previewImport`: opaque token for a file the user chose in a native dialog. */
  fileToken: 'a handle main created for a dialog-chosen file, not a credential',
};

/** Value types that cannot hold a secret: flags, numbers and fixed vocabularies. */
const NON_TEXT = new Set(['boolean', 'number', 'int', 'bigint', 'enum', 'literal', 'null', 'date']);

/** Whether a field's schema can hold arbitrary text (and so a secret). */
function canHoldText(schema: z.ZodType): boolean {
  const def = defOf(schema);
  if (NON_TEXT.has(def.type)) return false;
  switch (def.type) {
    case 'array':
    case 'set':
      return canHoldText((def['element'] ?? def['valueType']) as z.ZodType);
    case 'union':
      return (def['options'] as z.ZodType[]).some(canHoldText);
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly':
      return canHoldText(def['innerType'] as z.ZodType);
    default:
      return true;
  }
}

interface Def {
  type: string;
  [key: string]: unknown;
}

function defOf(schema: z.ZodType): Def {
  return (schema as unknown as { _zod: { def: Def } })._zod.def;
}

/** Every `(path, schema)` of an object field below `schema`. */
function* fields(
  schema: z.ZodType,
  at: string,
  seen = new Set<z.ZodType>(),
): Generator<[string, z.ZodType]> {
  if (seen.has(schema)) return;
  seen.add(schema);
  const def = defOf(schema);
  const child = (key: string) => def[key] as z.ZodType | undefined;
  switch (def.type) {
    case 'object': {
      for (const [key, value] of Object.entries(def['shape'] as Record<string, z.ZodType>)) {
        yield [`${at}.${key}`, value];
        yield* fields(value, `${at}.${key}`, seen);
      }
      const catchall = child('catchall');
      if (catchall && defOf(catchall).type !== 'never') {
        yield [`${at}.*`, catchall];
        yield* fields(catchall, `${at}.*`, seen);
      }
      return;
    }
    case 'array':
      yield* fields(def['element'] as z.ZodType, `${at}[]`, seen);
      return;
    case 'tuple':
      for (const item of def['items'] as z.ZodType[]) yield* fields(item, `${at}[]`, seen);
      if (child('rest')) yield* fields(child('rest') as z.ZodType, `${at}[]`, seen);
      return;
    case 'union':
      for (const option of def['options'] as z.ZodType[]) yield* fields(option, at, seen);
      return;
    case 'intersection':
      yield* fields(def['left'] as z.ZodType, at, seen);
      yield* fields(def['right'] as z.ZodType, at, seen);
      return;
    case 'record':
    case 'map':
      yield [`${at}{}`, def['valueType'] as z.ZodType];
      yield* fields(def['valueType'] as z.ZodType, `${at}{}`, seen);
      return;
    case 'set':
      yield* fields(def['valueType'] as z.ZodType, `${at}[]`, seen);
      return;
    case 'pipe':
      yield* fields(def['in'] as z.ZodType, at, seen);
      yield* fields(def['out'] as z.ZodType, at, seen);
      return;
    case 'lazy':
      yield* fields((def['getter'] as () => z.ZodType)(), at, seen);
      return;
    default: {
      const inner = child('innerType');
      if (inner) yield* fields(inner, at, seen);
    }
  }
}

/** Field paths below `schema` that could carry a secret. */
function secretFields(schema: z.ZodType, at: string): string[] {
  const found: string[] = [];
  for (const [field, value] of fields(schema, at)) {
    const name = field.slice(field.lastIndexOf('.') + 1).replace(/[[\]{}*]+$/, '');
    if (!SECRET_FIELD.test(name) || !canHoldText(value)) continue;
    if (!Object.hasOwn(ALLOWED_TEXT_FIELDS, name)) found.push(field);
  }
  return found;
}

/** Everything the renderer can receive from a method: its result and its stream payloads. */
function rendererVisible(name: string, def: MethodDef): [string, z.ZodType][] {
  const out: [string, z.ZodType][] = [[`${name} result`, def.result]];
  if (def.stream) out.push([`${name} stream`, def.stream]);
  return out;
}

describe('no renderer-routable method can return a secret (schemas)', () => {
  it('the field walker finds the secrets in the privileged secrets.get (self-test)', () => {
    expect(secretFields(privilegedMethods['secrets.get'].result, 'secrets.get')).toEqual([
      'secrets.get.secrets',
      'secrets.get.secrets{}',
    ]);
  });

  it('the field walker sees through optional, nullable, arrays, unions and records', () => {
    const schema = z.object({
      a: z.array(z.object({ password: z.string() }).nullable()).optional(),
      b: z.union([z.object({ sshKeyPassphrase: z.string() }), z.null()]),
      c: z.record(z.string(), z.object({ awsSessionToken: z.string() })),
      d: z.object({ privateKeyFile: z.string() }),
    });
    expect(secretFields(schema, 'x')).toEqual([
      'x.a[].password',
      'x.b.sshKeyPassphrase',
      'x.c{}.awsSessionToken',
    ]);
  });

  it('secret-named fields that cannot hold text pass (flags, enums, kinds)', () => {
    const schema = z.object({
      secretMode: z.enum(['saved', 'ask']).optional(),
      storedSecrets: z.array(z.enum(SECRET_KINDS)),
      secureStorage: z.boolean(),
      tokenCount: z.number(),
      passwordSet: z.literal(true).nullable(),
      secretOrText: z.union([z.boolean(), z.string()]),
    });
    expect(secretFields(schema, 'x')).toEqual(['x.secretOrText']);
  });

  it.each(Object.entries(methods))('%s returns no secret field', (name, def) => {
    for (const [label, schema] of rendererVisible(name, def as MethodDef))
      expect(secretFields(schema, label)).toEqual([]);
  });

  it('every method with a secret in its result is privileged and unroutable', () => {
    const withSecrets = Object.entries(privilegedMethods)
      .filter(([name, def]) => secretFields(def.result, name).length > 0)
      .map(([name]) => name);
    expect(withSecrets).toEqual(['secrets.get']);
    for (const name of withSecrets) {
      expect(Object.hasOwn(methods, name)).toBe(false);
      expect(route(name)).toBeUndefined();
    }
  });

  it('broadcast payloads carry no secret field', () => {
    const payloads: Record<string, z.ZodType> = {
      [BROADCAST_STREAMS.connStatus]: connStatus,
      [BROADCAST_STREAMS.theme]: themeInfo,
      [BROADCAST_STREAMS.settingsChanged]: settingsChanged,
      [BROADCAST_STREAMS.backendRestarted]: backendRestarted,
    };
    expect(Object.keys(payloads).sort()).toEqual(Object.values(BROADCAST_STREAMS).sort());
    for (const [stream, schema] of Object.entries(payloads))
      expect(secretFields(schema, stream)).toEqual([]);
  });
});
