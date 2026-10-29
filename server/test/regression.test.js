import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, setupThreeSleeves } from './helpers.js';

test('目标接口拒绝重复分类 id，不破坏合计', async () => {
  const ctx = await startServer();
  try {
    const { state } = await setupThreeSleeves(ctx);
    const [a, b, c] = state.sleeves;
    const res = await ctx.request('/api/targets', { method: 'PUT', body: { sleeves: [
      { id: a.id, targetBp: 6000, bandBp: 500 },
      { id: a.id, targetBp: 2000, bandBp: 500 },
      { id: c.id, targetBp: 2000, bandBp: 200 },
    ] } });
    assert.equal(res.status, 400);
    const after = (await ctx.request('/api/state')).json;
    assert.equal(after.sleeves.reduce((n, s) => n + s.targetBp, 0), 10000);
    assert.equal(after.sleeves.find((s) => s.id === b.id).targetBp, 3000);
  } finally { await ctx.close(); }
});

test('示例数据在计划执行后仍可重载', async () => {
  const ctx = await startServer({ demo: true });
  try {
    const state = (await ctx.request('/api/state')).json;
    const plan = await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 1000000000 } });
    assert.equal(plan.status, 201, plan.text);
    const exec = await ctx.request(`/api/plans/${plan.json.id}/execute`, { method: 'POST', body: { accountId: state.accounts[0].id, tradedAt: '2026-10-29' } });
    assert.equal(exec.status, 200, exec.text);
    const reload = await ctx.request('/api/demo/reload', { method: 'POST', body: { confirm: 'RELOAD' } });
    assert.equal(reload.status, 200, reload.text);
    assert.equal(reload.json.plans?.length ?? 0, 0);
  } finally { await ctx.close(); }
});

test('缺少必填 id 返回 400 而不是 500', async () => {
  const ctx = await startServer();
  try {
    await setupThreeSleeves(ctx);
    for (const [path, body] of [
      ['/api/transactions', { side: 'buy', quantityMicros: 1, priceMicros: 1, tradedAt: '2026-10-28' }],
      ['/api/symbols', { ticker: 'ABC', name: 'n' }],
      ['/api/prices', { prices: [{ priceMicros: 1, priceAsOf: '2026-10-28' }] }],
      ['/api/plans/x/execute', {}],
    ]) {
      const res = await ctx.request(path, { method: path.includes('execute') ? 'POST' : (path === '/api/prices' ? 'PUT' : 'POST'), body });
      assert.ok([400, 404].includes(res.status), `${path} 返回 ${res.status} ${res.text}`);
      assert.notEqual(res.status, 500);
    }
  } finally { await ctx.close(); }
});

test('执行备注用 · 拼接且超 200 字返回 400', async () => {
  const ctx = await startServer();
  try {
    const { account } = await setupThreeSleeves(ctx);
    const plan = await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 100000000, note: '计划备注' } });
    const exec = await ctx.request(`/api/plans/${plan.json.id}/execute`, { method: 'POST', body: { accountId: account.id, tradedAt: '2026-10-29', note: '执行备注' } });
    assert.equal(exec.status, 200, exec.text);
    assert.equal(exec.json.transactions[0].note, '计划备注 · 执行备注');
    const plan2 = await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 100000000, note: 'P'.repeat(200) } });
    const tooLong = await ctx.request(`/api/plans/${plan2.json.id}/execute`, { method: 'POST', body: { accountId: account.id, tradedAt: '2026-10-29', note: 'N'.repeat(200) } });
    assert.equal(tooLong.status, 400);
  } finally { await ctx.close(); }
});

test('低价代码不会生成超过成交数量上限的计划', async () => {
  const ctx = await startServer();
  try {
    const state = (await ctx.request('/api/setup', { method: 'POST', body: { portfolioName: '单一', template: 'blank' } })).json;
    const symbol = await ctx.request('/api/symbols', { method: 'POST', body: { ticker: 'PENNY', name: '低价', sleeveId: state.sleeves[0].id, lotSizeMicros: 1000000, priceMicros: 500, priceAsOf: '2026-10-28' } });
    assert.equal(symbol.status, 201);
    const plan = await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 1000000000000 } });
    assert.equal(plan.status, 422);
    assert.equal(plan.json.code, 'value_overflow');
  } finally { await ctx.close(); }
});

test('成交不会让组合市值越过 1e15', async () => {
  const ctx = await startServer();
  try {
    const state = (await ctx.request('/api/setup', { method: 'POST', body: { portfolioName: '上限', template: 'blank' } })).json;
    const symbol = await ctx.request('/api/symbols', { method: 'POST', body: { ticker: 'BIG', name: '大额', sleeveId: state.sleeves[0].id, lotSizeMicros: 1000000, priceMicros: 1000000, priceAsOf: '2026-10-28' } });
    const account = state.accounts[0];
    const res = await ctx.request('/api/transactions', { method: 'POST', body: { accountId: account.id, symbolId: symbol.json.id, side: 'buy', quantityMicros: 1000000000000000, priceMicros: 1000000, tradedAt: '2026-10-28' } });
    assert.equal(res.status, 201, res.text);
    const second = await ctx.request('/api/transactions', { method: 'POST', body: { accountId: account.id, symbolId: symbol.json.id, side: 'buy', quantityMicros: 1000000000, priceMicros: 1000000, tradedAt: '2026-10-28' } });
    assert.equal(second.status, 400);
    assert.equal((await ctx.request('/api/state')).status, 200);
  } finally { await ctx.close(); }
});
