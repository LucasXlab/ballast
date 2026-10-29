#!/usr/bin/env node
import { startServer, setupThreeSleeves } from '../server/test/helpers.js';

const failures = [
  ['价格缺失', async (ctx, { symbols }) => {
    await ctx.request(`/api/symbols/${symbols['510300'].id}`, { method: 'PATCH', body: { priceMicros: 0 } });
    const res = await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 100000000 } });
    if (res.status !== 422 || res.json.code !== 'missing_price') throw new Error(`期望 missing_price，得到 ${res.status} ${res.text}`);
  }],
  ['金额过小', async (ctx) => {
    const res = await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 1 } });
    if (res.status !== 422 || res.json.code !== 'amount_too_small') throw new Error(`期望 amount_too_small，得到 ${res.status} ${res.text}`);
  }],
  ['过期计划', async (ctx, { account, symbols }) => {
    const plan = await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 100000000 } });
    await ctx.request('/api/prices', { method: 'PUT', body: { prices: [{ symbolId: symbols['510300'].id, priceMicros: 4100000, priceAsOf: '2026-10-29' }] } });
    const res = await ctx.request(`/api/plans/${plan.json.id}/execute`, { method: 'POST', body: { accountId: account.id, tradedAt: '2026-10-29' } });
    if (res.status !== 409 || res.json.code !== 'plan_stale') throw new Error(`期望 plan_stale，得到 ${res.status} ${res.text}`);
  }],
  ['重复导入', async (ctx, { account }) => {
    const csv = `date,account,symbol,side,quantity,price,fee,note\n2026-10-28,${account.name},510300,buy,1,4.1,0,ok`;
    const first = await ctx.request('/api/imports', { method: 'POST', body: { filename: 'x.csv', csv } });
    const second = await ctx.request('/api/imports', { method: 'POST', body: { filename: 'x.csv', csv } });
    if (first.status !== 201 || second.status !== 409 || second.json.code !== 'duplicate_import') throw new Error(`导入结果 ${first.status}/${second.status}`);
  }],
  ['CSV 行错误', async (ctx, { account }) => {
    const csv = `date,account,symbol,side,quantity,price,fee,note\n2026-10-28,${account.name},NOPE,buy,1,1,0,bad`;
    const res = await ctx.request('/api/imports', { method: 'POST', body: { filename: 'bad.csv', csv } });
    if (res.status !== 400 || res.json.code !== 'invalid_csv' || res.json.details[0].line !== 2) throw new Error(`CSV 结果 ${res.status} ${res.text}`);
  }],
  ['错误 Origin', async (ctx) => {
    const res = await ctx.request('/api/plans', { method: 'POST', headers: { Origin: 'http://evil.example' }, body: { amountMicros: 100000000 } });
    if (res.status !== 403 || res.json.code !== 'bad_origin') throw new Error(`Origin 结果 ${res.status} ${res.text}`);
  }],
  ['卖出超持仓', async (ctx, { account, symbols }) => {
    const res = await ctx.request('/api/transactions', { method: 'POST', body: { accountId: account.id, symbolId: symbols['510300'].id, side: 'sell', quantityMicros: 999999999999, priceMicros: 4000000, tradedAt: '2026-10-28' } });
    if (res.status !== 409 || res.json.code !== 'insufficient_position') throw new Error(`卖出结果 ${res.status} ${res.text}`);
  }],
  ['目标总和不等于 100%', async (ctx) => {
    const state = (await ctx.request('/api/state')).json;
    const res = await ctx.request('/api/targets', { method: 'PUT', body: { sleeves: state.sleeves.map((s, i) => ({ id: s.id, targetBp: i === 0 ? 5000 : s.targetBp, bandBp: s.bandBp })) } });
    if (res.status !== 400 || res.json.code !== 'target_sum_mismatch') throw new Error(`目标结果 ${res.status} ${res.text}`);
  }],
  ['重复执行', async (ctx, { account }) => {
    const plan = await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 100000000 } });
    await ctx.request(`/api/plans/${plan.json.id}/execute`, { method: 'POST', body: { accountId: account.id, tradedAt: '2026-10-29' } });
    const again = await ctx.request(`/api/plans/${plan.json.id}/execute`, { method: 'POST', body: { accountId: account.id, tradedAt: '2026-10-29' } });
    if (again.status !== 409 || again.json.code !== 'plan_not_draft') throw new Error(`重复执行结果 ${again.status} ${again.text}`);
  }],
  ['错误 Content-Type', async (ctx) => {
    const res = await fetch(`${ctx.base}/api/plans`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"amountMicros":1}' });
    if (res.status !== 415) throw new Error(`Content-Type 结果 ${res.status}`);
  }],
];

let passed = 0;
for (let round = 1; round <= 10; round += 1) {
  const ctx = await startServer();
  const started = Date.now();
  try {
    const { account, symbols } = await setupThreeSleeves(ctx);
    const before = (await ctx.request('/api/state')).json.totals.marketValueMicros;
    const plan = await ctx.request('/api/plans', { method: 'POST', body: { amountMicros: 100000000 } });
    if (plan.status !== 201) throw new Error(`计划失败 ${plan.status} ${plan.text}`);
    const exec = await ctx.request(`/api/plans/${plan.json.id}/execute`, { method: 'POST', body: { accountId: account.id, tradedAt: '2026-10-29' } });
    if (exec.status !== 200) throw new Error(`执行失败 ${exec.status} ${exec.text}`);
    const after = (await ctx.request('/api/state')).json.totals.marketValueMicros;
    if (after <= before) throw new Error('执行后市值未增加');
    const history = await ctx.request('/api/plans');
    if (history.json.items[0].status !== 'executed') throw new Error('计划历史状态不对');
    const failure = failures[(round - 1) % failures.length];
    await failure[1](ctx, { account, symbols });
    console.log(`第 ${String(round).padStart(2)} 轮 通过  计划 ${plan.json.items.length} 项  市值 ${(before / 1e6).toFixed(2)} → ${(after / 1e6).toFixed(2)}  失败用例「${failure[0]}」 ${Date.now() - started}ms`);
    passed += 1;
  } catch (error) {
    console.log(`第 ${String(round).padStart(2)} 轮 失败  ${error.message}`);
  } finally {
    await ctx.close();
  }
}
console.log(`\n真实使用：${passed}/10 轮通过；覆盖 ${failures.length} 类失败场景`);
process.exit(passed === 10 ? 0 : 1);
