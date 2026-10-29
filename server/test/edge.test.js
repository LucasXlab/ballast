import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer, setupThreeSleeves } from './helpers.js';

test('金额与数量边界、溢出、分页、404', async () => {
  const ctx = await startServer();
  try {
    const { account, symbols } = await setupThreeSleeves(ctx);
    const huge = await ctx.request('/api/transactions', { method: 'POST', body: {
      accountId: account.id, symbolId: symbols['510300'].id, side: 'buy', quantityMicros: 1_000_000_000_000_000, priceMicros: 1_000_000_000_000, tradedAt: '2026-10-28',
    } });
    assert.equal(huge.status, 400);
    assert.equal((await ctx.request('/api/transactions?limit=0')).status, 400);
    assert.equal((await ctx.request('/api/transactions?offset=-1')).status, 400);
    assert.equal((await ctx.request('/api/plan/nope')).status, 404);
    assert.equal((await ctx.request('/api/plans/nope')).status, 404);
    assert.equal((await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 0 } })).status, 400);
    assert.equal((await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 1_000_000_000_001 } })).status, 400);
    assert.equal((await ctx.request('/api/transactions', { method: 'POST', body: { accountId: account.id, symbolId: symbols['510300'].id, side: 'buy', quantityMicros: 1, priceMicros: 1, tradedAt: '2026-10-30' } })).status, 201);
    assert.equal((await ctx.request('/api/transactions', { method: 'POST', body: { accountId: account.id, symbolId: symbols['510300'].id, side: 'buy', quantityMicros: 1, priceMicros: 1, tradedAt: '2026-10-31' } })).status, 400);
  } finally { await ctx.close(); }
});

test('SQL 注入样本只作为文本保存', async () => {
  const ctx = await startServer();
  try {
    const state = (await ctx.request('/api/setup', { method: 'POST', body: { portfolioName: "x' OR 1=1 --", template: 'blank' } })).json;
    const sleeve = state.sleeves[0];
    const symbol = await ctx.request('/api/symbols', { method: 'POST', body: { ticker: 'X1', name: "n' OR 1=1 --", sleeveId: sleeve.id } });
    assert.equal(symbol.status, 201);
    const plan = await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 1000000 } });
    assert.equal(plan.status, 422);
    assert.equal((await ctx.request('/api/state')).json.portfolio.name, "x' OR 1=1 --");
  } finally { await ctx.close(); }
});

test('归档代码不参与买入但仍计入市值', async () => {
  const ctx = await startServer();
  try {
    const { symbols, state } = await setupThreeSleeves(ctx);
    const bond = state.sleeves.find((s) => s.name === '债券');
    const extra = await ctx.request('/api/symbols', { method: 'POST', body: { ticker: '511020', name: '另一只国债ETF', sleeveId: bond.id, lotSizeMicros: 1000000, priceMicros: 100000000, priceAsOf: '2026-10-28' } });
    assert.equal(extra.status, 201);
    await ctx.request(`/api/symbols/${symbols['511010'].id}`, { method: 'PATCH', body: { archived: true } });
    const plan = await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 1000000000 } });
    assert.equal(plan.status, 201, plan.text);
    assert.equal(plan.json.items.some((i) => i.ticker === '511010'), false);
    assert.equal((await ctx.request('/api/state')).json.totals.marketValueMicros, 6000000000);
  } finally { await ctx.close(); }
});
