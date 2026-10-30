import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, setupThreeSleeves } from './helpers.js';

test('设置、状态与首次使用保护', async () => {
  const ctx = await startServer();
  try {
    const before = await ctx.request('/api/state');
    assert.equal(before.json.setupComplete, false);
    assert.equal(before.json.portfolio, null);
    assert.equal((await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 1 } })).status, 409);
    const setup = await ctx.request('/api/setup', { method: 'POST', body: { portfolioName: '长期组合', baseCurrency: 'CNY', template: 'three_sleeve' } });
    assert.equal(setup.status, 201);
    assert.equal(setup.json.setupComplete, true);
    assert.deepEqual(setup.json.sleeves.map((s) => s.targetBp), [6000, 3000, 1000]);
    assert.equal(setup.json.today, '2026-10-29');
    assert.equal((await ctx.request('/api/setup', { method: 'POST', body: { portfolioName: 'x', template: 'blank' } })).status, 409);
    assert.equal((await ctx.request('/api/portfolio', { method: 'PUT', body: { name: '新名字' } })).json.name, '新名字');
  } finally { await ctx.close(); }
});

test('代码、交易、持仓与卖出保护', async () => {
  const ctx = await startServer();
  try {
    const { account, symbols } = await setupThreeSleeves(ctx);
    let state = (await ctx.request('/api/state')).json;
    assert.equal(state.positions.length, 3);
    assert.equal(state.positions[0].avgCostMicros, state.positions[0].priceMicros);
    assert.equal(state.totals.positionCount, 3);
    const sell = await ctx.request('/api/transactions', { method: 'POST', body: {
      accountId: account.id, symbolId: symbols['510300'].id, side: 'sell', quantityMicros: 1000000001, priceMicros: 4000000, tradedAt: '2026-10-28',
    } });
    assert.equal(sell.status, 409);
    assert.equal(sell.json.code, 'insufficient_position');
    state = (await ctx.request('/api/state')).json;
    assert.equal(state.totals.marketValueMicros, 6000000000);
  } finally { await ctx.close(); }
});

test('计划生成、执行、幂等与过期', async () => {
  const ctx = await startServer();
  try {
    const { account, symbols } = await setupThreeSleeves(ctx);
    const plan = await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 1000000000 } });
    assert.equal(plan.status, 201, plan.text);
    assert.equal(plan.json.items.length, 2);
    assert.equal(plan.json.plannedMicros, 1000000000);
    assert.equal(plan.json.cashLeftMicros, 0);
    assert.equal(plan.json.maxDriftBeforeBp, 1333);
    assert.equal(plan.json.maxDriftAfterBp, 429);
    const exec = await ctx.request(`/api/plans/${plan.json.id}/execute`, { method: 'POST', body: { accountId: account.id, tradedAt: '2026-10-29' } });
    assert.equal(exec.status, 200, exec.text);
    assert.equal(exec.json.plan.status, 'executed');
    assert.equal(exec.json.transactions.length, 2);
    const again = await ctx.request(`/api/plans/${plan.json.id}/execute`, { method: 'POST', body: { accountId: account.id, tradedAt: '2026-10-29' } });
    assert.equal(again.status, 409);
    assert.equal(again.json.code, 'plan_not_draft');
    const plan2 = await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 1000000000 } });
    const before = await ctx.request(`/api/plans/${plan2.json.id}`);
    assert.equal(before.json.stale, false);
    await ctx.request('/api/prices', { method: 'PUT', body: { prices: [{ symbolId: symbols['510300'].id, priceMicros: 4100000, priceAsOf: '2026-10-29' }] } });
    const stale = await ctx.request(`/api/plans/${plan2.json.id}/execute`, { method: 'POST', body: { accountId: account.id, tradedAt: '2026-10-29' } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, 'plan_stale');
    const detail = await ctx.request(`/api/plans/${plan2.json.id}`);
    assert.equal(detail.json.stale, true);
  } finally { await ctx.close(); }
});
