/** What the GridFS tab of a database needs (the tab's `data`). */
export interface GridfsTabData {
  readonly profileId: string;
  readonly db: string;
}

/** Stable id of the GridFS tab of a database. */
export function gridfsTabId(profileId: string, db: string): string {
  return `gridfs:${profileId}:${db}`;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** A byte count for people: `0 B`, `512 B`, `1.5 KB`, `20 MB` (powers of 1024). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${String(Math.max(0, bytes))} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value < 10 ? 1 : 0;
  return `${value.toFixed(digits).replace(/\.0$/, '')} ${UNITS[unit] ?? 'B'}`;
}

/** Share of `bytes` in `total`, 0…1 (an empty file counts as complete once started). */
export function fraction(bytes: number, total: number): number {
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, bytes / total));
}

/** The mongosh call that lists a bucket, shown in the tab's head. */
export function bucketCall(bucket: string): string {
  return `db.getGridFSBucket({ bucketName: ${JSON.stringify(bucket)} }).find()`;
}

/** An ISO date as local date and time (`2026-11-17 07:31`); the text itself when invalid. */
export function formatDate(iso: string): string {
  if (iso === '') return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
