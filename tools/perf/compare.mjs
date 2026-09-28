/**
 * Prints a before/after table from two benchmark runs.
 *   node tools/perf/compare.mjs tests/perf/out/baseline.json tests/perf/out/after.json
 */
import fs from 'node:fs';

const [a, b] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, 'utf8')));
if (!a || !b) {
  console.error('usage: node tools/perf/compare.mjs before.json after.json');
  process.exit(1);
}
const byName = (run) => new Map(run.results.map((r) => [r.name, r]));
const before = byName(a);
const after = byName(b);
const cols = [
  ['avg FPS', 'avgFps', 1],
  ['min FPS', 'minFps', 1],
  ['frame ms', 'avgFrameMs', 1],
  ['p95 ms', 'p95FrameMs', 1],
  ['draws', 'avgDrawCalls', 0],
  ['triangles', 'avgTriangles', 0],
  ['mesh ms', 'avgMeshMs', 2],
  ['heap MB', 'heapMB', 1],
  ['peak RSS MB', 'rssPeakMB', 0],
];
const fmt = (v, d) => (typeof v === 'number' ? v.toFixed(d) : '-');
console.log(`| scenario | ${cols.map((c) => `${c[0]} before → after`).join(' | ')} |`);
console.log(`|---|${cols.map(() => '---').join('|')}|`);
for (const [name, x] of before) {
  const y = after.get(name);
  if (!y) continue;
  const cells = cols.map(([, k, d]) => `${fmt(x[k], d)} → ${fmt(y[k], d)}`);
  console.log(`| ${name} | ${cells.join(' | ')} |`);
}
console.log(`\nserver: ${a.server || '-'}  →  ${b.server || '-'}`);
console.log(`join: ${a.joinMs ?? '-'} ms  →  ${b.joinMs ?? '-'} ms`);
