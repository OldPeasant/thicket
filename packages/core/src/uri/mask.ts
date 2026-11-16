import ConnectionString from 'mongodb-connection-string-url';

/** What `mask()` shows instead of a secret. */
export const MASK = '****';

/** Query options whose whole value is a secret (compared case-insensitively). */
const SECRET_OPTIONS = new Set(['proxypassword', 'tlscertificatekeyfilepassword']);
/** `authMechanismProperties` entries whose value is a secret. */
const SECRET_MECHANISM_PROPERTIES = new Set(['aws_session_token']);

const SCHEME = /^mongodb(?:\+srv)?:\/\//i;
/**
 * A connection string inside free text: up to the next whitespace or the next connection string.
 * Quotes, `<`, `>` and backticks may appear unencoded in a password, so they don't end the match;
 * a quote after the hosts just stays in the token and `mask()` keeps it as it is.
 */
const URI_IN_TEXT = /mongodb(?:\+srv)?:\/\/(?:(?!mongodb(?:\+srv)?:\/\/)\S)+/gi;

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
  if (at < 0 && authorityEnd >= 0 && !isValid(uri)) {
    const later = rest.lastIndexOf('@');
    const colon = rest.indexOf(':');
    // Only when a ':' (user:password) comes before that '@'.
    if (later > 0 && colon >= 0 && colon < later) at = later;
  }
  let userinfo = '';
  if (at >= 0) {
    const credentials = rest.slice(0, at);
    const colon = credentials.indexOf(':');
    userinfo = colon < 0 ? `${credentials}@` : `${credentials.slice(0, colon)}:${MASK}@`;
    rest = rest.slice(at + 1);
  }

  const q = rest.indexOf('?');
  if (q >= 0) rest = rest.slice(0, q + 1) + maskQuery(rest.slice(q + 1));
  return prefix + userinfo + rest;
}

/** Masks every MongoDB connection string inside free text (log lines, error messages). */
export function maskText(text: string): string {
  return text.replace(URI_IN_TEXT, (uri) => mask(uri));
}
