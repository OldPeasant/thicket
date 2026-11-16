import { formatCount } from '../safety/write-guard.service';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** 1536 → "1.5 KB" (binary steps, one decimal below 10). */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const text = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1);
  return `${text} ${UNITS[unit]}`;
}

/** "1 204 docs, 3.2 MB" */
export function formatDocs(count: number, size: number): string {
  return `${formatCount(count)} ${count === 1 ? 'doc' : 'docs'}, ${formatBytes(size)}`;
}
