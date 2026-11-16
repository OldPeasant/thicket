import ConnectionString from 'mongodb-connection-string-url';

/** What `mask()` shows instead of a secret. */
export const MASK = '****';

/** Query options whose whole value is a secret (compared case-insensitively). */
const SECRET_OPTIONS = new Set(['proxypassword', 'tlscertificatekeyfilepassword']);
/** `authMechanismProperties` entries whose value is a secret. */
const SECRET_MECHANISM_PROPERTIES = new Set(['aws_session_token']);

const SCHEME = /^mongodb(?:\+srv)?:\/\//i;
const SCHEME_SOURCE = 'mongodb(?:\\+srv)?:\\/\\/';

function tryDecode(s: string): string | undefined {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return undefined;
  }
}

function isValid(uri: string): boolean {
  try {
    new ConnectionString(uri.trim());
    return true;
  } catch {
    return false;
  }
}

function maskMechanismProperties(value: string): string {
  return value
    .split(',')
    .map((entry) => {
      const colon = entry.indexOf(':');
      if (colon < 0) return entry;
      const key = entry.slice(0, colon).toLowerCase();
      return SECRET_MECHANISM_PROPERTIES.has(key) ? `${entry.slice(0, colon)}:${MASK}` : entry;
    })
    .join(',');
}

function maskQuery(query: string): string {
  return query
    .split('&')
    .map((part) => {
      const eq = part.indexOf('=');
      if (eq < 0) return part;
      const rawKey = part.slice(0, eq);
      const key = tryDecode(rawKey)?.toLowerCase();
      // A key we can't decode can't be checked: hide its value to be safe.
      if (key === undefined || SECRET_OPTIONS.has(key)) return `${rawKey}=${MASK}`;
      if (key === 'authmechanismproperties') {
        const value = tryDecode(part.slice(eq + 1));
        if (value === undefined) return `${rawKey}=${MASK}`;
        const masked = maskMechanismProperties(value);
        return masked === value ? part : `${rawKey}=${encodeURIComponent(masked)}`;
      }
      return part;
    })
    .join('&');
}

/**
 * Masks the secrets of one connection string for display and logs: the password (the user name
 * stays visible), `proxyPassword`, `tlsCertificateKeyFilePassword` and the `AWS_SESSION_TOKEN`
 * auth mechanism property. Works on invalid strings too, masking more rather than less there.
 * A string that isn't a MongoDB connection string is returned unchanged.
 */
export function mask(uri: string): string {
  const schemeMatch = SCHEME.exec(uri.trimStart());
  if (schemeMatch === null) return uri;
  const lead = uri.length - uri.trimStart().length;
  const start = lead + schemeMatch[0].length;
  const prefix = uri.slice(0, start);
  let rest = uri.slice(start);

  // Valid URIs encode '/', '?' and '#' in credentials, so the authority ends at the first of
  // them and the credentials at its last '@'. In anything else, an '@' further on may still end
  // the credentials (an unencoded '/' in the password): mask up to the last '@' to be safe.
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd < 0 ? rest : rest.slice(0, authorityEnd);
  let at = authority.lastIndexOf('@');
  // Where the visible user name ends at the latest; the rest of the credentials is masked.
  let userEnd = Infinity;
  if (at < 0 && authorityEnd >= 0 && !isValid(uri)) {
    const later = rest.lastIndexOf('@');
    const colon = rest.indexOf(':');
    // Only when a ':' (user:password) comes before that '@'. Nothing after the authority end
    // stays visible then: it may be a secret option value (e.g. "?proxyPassword=pp",...).
    if (later > 0 && colon >= 0 && colon < later) {
      at = later;
      userEnd = authorityEnd;
    }
  }
  let userinfo = '';
  if (at >= 0) {
    const credentials = rest.slice(0, at);
    const colon = Math.min(credentials.indexOf(':'), userEnd);
    userinfo = colon < 0 ? `${credentials}@` : `${credentials.slice(0, colon)}:${MASK}@`;
    rest = rest.slice(at + 1);
  }

  const q = rest.indexOf('?');
  if (q >= 0) rest = rest.slice(0, q + 1) + maskQuery(rest.slice(q + 1));
  return prefix + userinfo + rest;
}

/**
 * True when `prefix` (a connection string cut just before an embedded scheme) ends inside a
 * secret, so the scheme belongs to that secret and must not start a new connection string:
 * - still in the authority, no `@` yet, and a `:` that isn't a port (`u:pw-mongodb://...`);
 * - in a secret option value (see `endsInSecretOption`).
 * Thicket writes `:` and `/` unencoded in option values, so such values can contain a scheme.
 */
function endsInSecret(prefix: string): boolean {
  const body = prefix.replace(SCHEME, '');
  if (body.search(/[/?#]/) < 0) {
    if (body.includes('@')) return false;
    // IPv6 literals in brackets contain ':'. A port is ':' + digits followed by a host delimiter
    // (or the end); anything else after the digits (TW-5: "u:123-mongodb://...") is a password.
    return /:(?!\d+(?:[,/?#\s"'`()[\]{}<>]|$))/.test(body.replace(/\[[^\]]*\]/g, ''));
  }
  return endsInSecretOption(prefix);
}

/**
 * True when `prefix` (a connection string cut anywhere) ends in the value of `proxyPassword` /
 * `tlsCertificateKeyFilePassword` or of an `authMechanismProperties` entry whose key is secret.
 * An option key or `authMechanismProperties` value that can't be decoded can't be checked:
 * `undecodable` is returned for it.
 */
function endsInSecretOption(prefix: string, undecodable = true): boolean {
  const body = prefix.replace(SCHEME, '');
  const q = body.indexOf('?');
  if (q < 0 || body.lastIndexOf('#') > q) return false;
  const last =
    body
      .slice(q + 1)
      .split('&')
      .pop() ?? '';
  const eq = last.indexOf('=');
  if (eq < 0) return false;
  const key = tryDecode(last.slice(0, eq))?.toLowerCase();
  if (key === undefined) return undecodable;
  if (SECRET_OPTIONS.has(key)) return true;
  if (key !== 'authmechanismproperties') return false;
  const value = tryDecode(last.slice(eq + 1));
  if (value === undefined) return undecodable;
  const entry = value.split(',').pop() ?? '';
  const colon = entry.indexOf(':');
  return colon >= 0 && SECRET_MECHANISM_PROPERTIES.has(entry.slice(0, colon).toLowerCase());
}

/** Where the connection string that starts at `start` (its scheme ends at `bodyStart`) ends. */
function uriEnd(text: string, start: number, bodyStart: number): number {
  let end = bodyStart;
  // CR-5: the driver accepts a raw space or tab in the password (`mongodb://u:my secret@h`), so
  // when an '@' comes before any '/', '?', '#' or scheme on the same line, the credentials run up
  // to that '@' even across spaces. Prose can be swallowed too ("mongodb://host:27017 failed for
  // user@x" becomes "mongodb://host:****@x"): masking more is acceptable, leaking is not.
  const cred = new RegExp(`[/?#@\\r\\n]|${SCHEME_SOURCE}`, 'gi');
  cred.lastIndex = bodyStart;
  const stop = cred.exec(text);
  if (stop?.[0] === '@') end = stop.index + 1;

  // Then up to the next whitespace, or up to an embedded scheme that starts a new connection
  // string. Quotes, '<', '>' and backticks may appear unencoded in a password, so they don't end
  // it; a quote after the hosts just stays in the token and `mask()` keeps it as it is.
  const ws = /\s/g;
  const inner = new RegExp(SCHEME_SOURCE, 'gi');
  inner.lastIndex = end;
  // CR-9: the next embedded scheme at or after `end`, searched once and kept across runs, and
  // whether the token so far is in its query part, updated only from newly scanned text. Both
  // keep the loop linear in the length of the line.
  let next = inner.exec(text);
  let inQuery = false;
  let scanned = bodyStart;
  for (;;) {
    ws.lastIndex = end;
    const runEnd = ws.exec(text)?.index ?? text.length;
    for (; next !== null && next.index < runEnd; next = inner.exec(text)) {
      // TW-4: a scheme inside a secret value is part of it, not a new connection string.
      if (!endsInSecret(text.slice(start, next.index))) return next.index;
    }
    // TW-6 / TW-7: the driver also keeps a raw space or tab in any option value (`appName=my app`),
    // and a secret option may follow it. So inside the query part (after '?', before '#'),
    // whitespace doesn't end the connection string: it runs on word by word to the end of the
    // line (never across lines), or to the first whitespace after a '#'. Each further word is
    // still scanned for an embedded scheme above, which starts a new connection string unless it
    // lies in a secret value. Prose after a query is swallowed too, and `mask()` keeps non-secret
    // text as it is: masking more is acceptable, leaking is not.
    if (runEnd >= text.length || /[\r\n]/.test(text.charAt(runEnd))) return runEnd;
    // In the query part: after the first '?' of the body, before any '#' after it.
    const run = text.slice(scanned, runEnd);
    if (!inQuery) {
      const q = run.indexOf('?');
      if (q < 0) return runEnd;
      inQuery = true;
      if (run.indexOf('#', q) >= 0) return runEnd;
    } else if (run.includes('#')) {
      return runEnd;
    }
    scanned = runEnd;
    end = runEnd + 1;
  }
}

/** Masks every MongoDB connection string inside free text (log lines, error messages). */
export function maskText(text: string): string {
  const scheme = new RegExp(SCHEME_SOURCE, 'gi');
  let out = '';
  let copied = 0;
  for (let m = scheme.exec(text); m !== null; m = scheme.exec(text)) {
    const end = uriEnd(text, m.index, m.index + m[0].length);
    out += text.slice(copied, m.index) + mask(text.slice(m.index, end));
    copied = end;
    scheme.lastIndex = end;
  }
  return out + text.slice(copied);
}
