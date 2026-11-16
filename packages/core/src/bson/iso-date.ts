import { BsonModelError } from './model';

const ISO =
  /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|([+-])(\d{2}):?(\d{2})))?$/;

/** Largest |ms| a JS `Date` can hold. */
const DATE_LIMIT_MS = 8_640_000_000_000_000n;

/**
 * Parses an ISO-8601 date (`2024-05-01`, UTC midnight; extended years such as `+010000-01-01`
 * or `-000001-01-01` as `formatIsoDate` writes them) or date-time with `Z` or an offset
 * (`2024-05-01T12:30:00.123+02:00`) into epoch milliseconds. Rejects impossible calendar dates.
 */
export function parseIsoDate(text: string): bigint {
  const m = ISO.exec(text);
  // ISO 8601 has no negative zero year ("-000000"), as in JS `Date.parse`.
  if (!m || m[1] === '-000000') throw new BsonModelError(`"${text}" is not an ISO-8601 date`);
  const [, y, mo, d, h = '0', mi = '0', s = '0', frac = '', , sign, oh = '0', om = '0'] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s);
  const millis = Number(frac.slice(0, 3).padEnd(3, '0'));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millis);
  const valid =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    hour < 24 &&
    minute < 60 &&
    second < 60 &&
    Number(oh) < 24 &&
    Number(om) < 60;
  if (!valid) throw new BsonModelError(`"${text}" is not a valid date`);
  const offsetMin = (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om));
  return BigInt(date.getTime() - offsetMin * 60_000);
}

/** Formats epoch milliseconds as `YYYY-MM-DDTHH:mm:ss.sssZ` (UTC); errors outside JS dates. */
export function formatIsoDate(ms: bigint): string {
  if (ms > DATE_LIMIT_MS || ms < -DATE_LIMIT_MS) {
    throw new BsonModelError(`${ms} ms is outside the representable date range`);
  }
  return new Date(Number(ms)).toISOString();
}
