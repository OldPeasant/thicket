/**
 * One row of a side-by-side diff: the left and right line shown next to each other.
 * - `same`: both sides have the line.
 * - `changed`: the line differs (left replaced by right).
 * - `left` / `right`: only that side has the line (the other side shows a gap).
 */
export interface DiffRow {
  readonly kind: 'same' | 'changed' | 'left' | 'right';
  readonly left: string | null;
  readonly right: string | null;
}

/**
 * Above this many cells (lines × lines of the part that differs) the longest common subsequence
 * is not computed: the differing middle is shown as changed rows (big documents stay responsive).
 */
export const LCS_CELL_LIMIT = 4_000_000;

/**
 * Aligns `left` and `right` line by line (longest common subsequence after trimming the common
 * start and end), pairing removed and added lines between two common lines as changed rows.
 */
export function diffLines(left: readonly string[], right: readonly string[]): DiffRow[] {
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  let endL = left.length;
  let endR = right.length;
  while (endL > start && endR > start && left[endL - 1] === right[endR - 1]) {
    endL--;
    endR--;
  }
  const rows: DiffRow[] = [];
  for (let i = 0; i < start; i++) rows.push(same(left[i] as string));
  const midL = left.slice(start, endL);
  const midR = right.slice(start, endR);
  if (midL.length * midR.length > LCS_CELL_LIMIT) pairRuns(rows, midL, midR);
  else alignMiddle(rows, midL, midR);
  for (let i = endL; i < left.length; i++) rows.push(same(left[i] as string));
  return rows;
}

function same(line: string): DiffRow {
  return { kind: 'same', left: line, right: line };
}

function alignMiddle(rows: DiffRow[], a: readonly string[], b: readonly string[]): void {
  const n = a.length;
  const m = b.length;
  // lcs[i * (m + 1) + j]: length of the LCS of a[i..] and b[j..].
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? (lcs[(i + 1) * width + j + 1] as number) + 1
          : Math.max(lcs[(i + 1) * width + j] as number, lcs[i * width + j + 1] as number);
    }
  }
  let i = 0;
  let j = 0;
  let runL: string[] = [];
  let runR: string[] = [];
  const flush = () => {
    pairRuns(rows, runL, runR);
    runL = [];
    runR = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      rows.push(same(a[i] as string));
      i++;
      j++;
    } else if (
      j >= m ||
      (i < n && (lcs[(i + 1) * width + j] as number) >= (lcs[i * width + j + 1] as number))
    ) {
      runL.push(a[i] as string);
      i++;
    } else {
      runR.push(b[j] as string);
      j++;
    }
  }
  flush();
}

/** Lines only on the left and only on the right between two common lines: paired as changed. */
function pairRuns(rows: DiffRow[], left: readonly string[], right: readonly string[]): void {
  const n = Math.max(left.length, right.length);
  for (let k = 0; k < n; k++) {
    const l = left[k];
    const r = right[k];
    if (l !== undefined && r !== undefined) rows.push({ kind: 'changed', left: l, right: r });
    else if (l !== undefined) rows.push({ kind: 'left', left: l, right: null });
    else rows.push({ kind: 'right', left: null, right: r as string });
  }
}
