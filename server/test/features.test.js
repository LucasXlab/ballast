import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, setupThreeSleeves } from './helpers.js';
import { openDatabase } from '../src/db/database.js';

test('分类、代码、价格与目标接口', async () => {
  const ctx = await startServer();
  try {
    const { state } = await setupThreeSleeves(ctx);
    const stock = state.sleeves.find((s) => s.name === '股票');
    const golden = await ctx.request('/api/sleeves', { method: 'POST', body: { name: '黄金', targetBp: 0, bandBp: 300 } });
    assert.equal(golden.status, 201);
    const sum = (await ctx.request('/api/state')).json.sleeves.reduce((n, s) => n + s.targetBp, 0);
    assert.equal(sum, 10000);
    const tooMuch = await ctx.request('/api/sleeves', { method: 'POST', body: { name: '超了', targetBp: 1 } });
    assert.equal(tooMuch.status, 400);
    assert.equal(tooMuch.json.code, 'target_sum_exceeded');
    const target = await ctx.request('/api/targets', { method: 'PUT', body: { sleeves: (await ctx.request('/api/state')).json.sleeves.map((s) => ({ id: s.id, targetBp: s.id === stock.id ? 5000 : s.targetBp, bandBp: s.bandBp })) } });
    assert.equal(target.status, 400);
    assert.equal(target.json.code, 'target_sum_mismatch');
    const symbols = (await ctx.request('/api/state')).json.symbols;
    assert.equal((await ctx.request('/api/prices', { method: 'PUT', body: { prices: symbols.map((s, i) => ({ symbolId: s.id, priceMicros: s.priceMicros + i + 1, priceAsOf: '2026-10-29' })) } })).status, 200);
    assert.equal((await ctx.request('/api/prices', { method: 'PUT', body: { prices: Array.from({ length: 201 }, () => ({ symbolId: symbols[0].id, priceMicros: 1, priceAsOf: '2026-10-29' })) } })).status, 400);
    const archived = await ctx.request(`/api/symbols/${symbols[0].id}`, { method: 'PATCH', body: { archived: true } });
    assert.equal(archived.status, 200);
    assert.equal(archived.json.archived, true);
    const del = await ctx.request(`/api/symbols/${symbols[0].id}`, { method: 'DELETE' });
    assert.equal(del.status, 409);
    assert.equal(del.json.code, 'symbol_has_transactions');
  } finally { await ctx.close(); }
});

test('CSV 导出格式与持仓排序', async () => {
  const ctx = await startServer();
  try {
    await setupThreeSleeves(ctx);
    const tx = await fetch(`${ctx.base}/api/export/transactions.csv`);
    assert.equal(tx.status, 200);
    const txBytes = Buffer.from(await tx.arrayBuffer());
    assert.equal(txBytes.subarray(0, 3).toString('hex'), 'efbbbf');
    assert.match(tx.headers.get('content-disposition'), /ballast-transactions-\d{8}\.csv/);
    const pos = await fetch(`${ctx.base}/api/export/positions.csv`);
    assert.equal(pos.status, 200);
    const lines = Buffer.from(await pos.arrayBuffer()).toString('utf8').replace(/^\ufeff/, '').trim().split('\r\n');
    assert.equal(lines.length, 4);
    assert.ok(lines[0].includes('market_value'));
    assert.ok(lines[1].includes(',1000.000000,'));
  } finally { await ctx.close(); }
});

test('备份是可打开的 SQLite 文件', async () => {
  const ctx = await startServer();
  try {
    await setupThreeSleeves(ctx);
    const res = await fetch(`${ctx.base}/api/backup`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/vnd.sqlite3');
    assert.match(res.headers.get('content-disposition'), /ballast-backup-\d{8}-\d{6}\.sqlite/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.equal(bytes.subarray(0, 15).toString(), 'SQLite format 3');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ballast-backup-check-'));
    const file = path.join(dir, 'x.sqlite');
    fs.writeFileSync(file, bytes);
    const db = openDatabase({ dataDir: dir, now: () => Date.now() });
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  } finally { await ctx.close(); }
});
