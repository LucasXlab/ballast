import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, setupThreeSleeves } from './helpers.js';

test('示例数据固定、重载与非 demo 保护', async () => {
  const ctx = await startServer({ demo: true });
  try {
    const state = (await ctx.request('/api/state')).json;
    assert.equal(state.demo, true);
    assert.equal(state.totals.marketValueMicros, 93964400000);
    assert.equal(state.totals.positionCount, 5);
    assert.equal(state.accounts.length, 2);
    assert.equal(state.sleeves.map((s) => s.targetBp).join(','), '6000,3000,1000');
    assert.equal((await ctx.request('/api/transactions?limit=20')).json.total, 12);
    assert.equal((await ctx.request('/api/demo/reload', { method: 'POST', body: { confirm: 'NO' } })).status, 400);
    const reload = await ctx.request('/api/demo/reload', { method: 'POST', body: { confirm: 'RELOAD' } });
    assert.equal(reload.status, 200);
    assert.equal(reload.json.totals.marketValueMicros, 93964400000);
  } finally { await ctx.close(); }
});

test('非 demo 模式禁止重载', async () => {
  const ctx = await startServer();
  try {
    const res = await ctx.request('/api/demo/reload', { method: 'POST', body: { confirm: 'RELOAD' } });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, 'demo_disabled');
  } finally { await ctx.close(); }
});

test('同一数据目录重启后设置、交易、计划和导入记录保留', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ballast-restart-'));
  let ctx = await startServer({ dataDir: dir });
  try {
    const { account } = await setupThreeSleeves(ctx);
    const plan = await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 1000000000 } });
    await ctx.request(`/api/plans/${plan.json.id}/execute`, { method: 'POST', body: { accountId: account.id, tradedAt: '2026-10-29' } });
    const csv = 'date,account,symbol,side,quantity,price,fee,note\n2026-10-28,主账户,510300,buy,1,4.1,0,ok';
    assert.equal((await ctx.request('/api/imports', { method: 'POST', body: { filename: 'a.csv', csv } })).status, 201);
    await ctx.close();
    ctx = await startServer({ dataDir: dir });
    const state = (await ctx.request('/api/state')).json;
    assert.equal(state.setupComplete, true);
    assert.equal(state.portfolio.name, '长期组合');
    assert.equal(state.lastPlan.status, 'executed');
    assert.equal((await ctx.request('/api/plans')).json.items.length, 1);
    assert.equal((await ctx.request('/api/imports')).json.total, 1);
    assert.equal((await ctx.request('/api/imports', { method: 'POST', body: { filename: 'a.csv', csv } })).status, 409);
  } finally {
    await ctx.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
