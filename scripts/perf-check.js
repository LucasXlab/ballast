#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ballast-perf-'));
const port = 8813;
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'server/src/index.js'), '--port', String(port), '--data-dir', dir], { cwd: root, env: { ...process.env, BALLAST_DEMO: '1' }, stdio: 'ignore' });
for (let i = 0; i < 100; i += 1) {
  try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 50));
}
function pct(values, p) { return values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)]; }
async function measure(name, run, times = 30) {
  await run();
  const list = [];
  for (let i = 0; i < times; i += 1) {
    const start = performance.now();
    await run();
    list.push(performance.now() - start);
  }
  list.sort((a, b) => a - b);
  console.log(`${name}  p50 ${list[Math.floor(list.length / 2)].toFixed(1)}ms  p95 ${pct(list, 0.95).toFixed(1)}ms`);
}
try {
  await measure('GET /api/state', () => fetch(`http://127.0.0.1:${port}/api/state`).then((r) => r.arrayBuffer()));
  await measure('POST /api/plans', () => fetch(`http://127.0.0.1:${port}/api/plans`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountMicros: 1000000000 }) }).then((r) => r.arrayBuffer()), 20);
} finally {
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 200));
  fs.rmSync(dir, { recursive: true, force: true });
}
