// Line-based LCS diff for import triage — dependency-free.
// Common prefix/suffix trimmed first (typical case → near-zero DP), with a
// degraded whole-middle replace above 4M cells so huge files can't stall.

export type DiffLineType = 'same' | 'add' | 'del';
export interface DiffLine {
  type: DiffLineType;
  text: string;
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  // Empty-input short-circuits: `''.split('\n')` is `['']`, which would fake a
  // removed "empty line" against real content — triage wants whole-add/del.
  if (!oldText && !newText) return [{ type: 'same', text: '' }];
  if (!oldText) return (newText || '').split('\n').map((t) => ({ type: 'add', text: t }));
  if (!newText) return (oldText || '').split('\n').map((t) => ({ type: 'del', text: t }));

  const a = (oldText || '').split('\n');
  const b = (newText || '').split('\n');

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffLine[] = a.slice(0, start).map((t) => ({ type: 'same', text: t }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;

  if (n * m > 4_000_000) {
    // Degraded mode: whole-middle replace (colors stay honest, granularity loses).
    for (const t of midA) out.push({ type: 'del', text: t });
    for (const t of midB) out.push({ type: 'add', text: t });
  } else if (n === 0) {
    for (const t of midB) out.push({ type: 'add', text: t });
  } else if (m === 0) {
    for (const t of midA) out.push({ type: 'del', text: t });
  } else {
    // LCS length table, filled from the bottom-right so backtracking is forward.
    const W = m + 1;
    const dp = new Int32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * W + j] =
          midA[i] === midB[j]
            ? dp[(i + 1) * W + (j + 1)] + 1
            : Math.max(dp[(i + 1) * W + j], dp[i * W + (j + 1)]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        out.push({ type: 'same', text: midA[i] });
        i++;
        j++;
      } else if (dp[(i + 1) * W + j] >= dp[i * W + (j + 1)]) {
        out.push({ type: 'del', text: midA[i] });
        i++;
      } else {
        out.push({ type: 'add', text: midB[j] });
        j++;
      }
    }
    while (i < n) out.push({ type: 'del', text: midA[i++] });
    while (j < m) out.push({ type: 'add', text: midB[j++] });
  }

  for (const t of a.slice(endA)) out.push({ type: 'same', text: t });
  return out;
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === 'add') added++;
    else if (l.type === 'del') removed++;
  }
  return { added, removed };
}