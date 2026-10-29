import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

export const FIXED_NOW = Date.parse('2026-10-29T12:00:00.000Z');

export async function startServer({ demo = false, now = FIXED_NOW, dataDir = null } = {}) {
  const dir = dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'ballast-test-'));
  const cleanup = dataDir === null;
  const app = createApp({
    config: { dataDir: dir, backupKeep: 7, port: 8787, demo, version: '0.1.0' },
    now: () => now,
    staticDir: path.join(dir, 'no-web'),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(pathname, { method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(base + pathname, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not json */ }
    return { status: response.status, headers: response.headers, text, json };
  }
  async function close() {
    await new Promise((resolve) => server.close(resolve));
    app.locals.close();
    if (cleanup) fs.rmSync(dir, { recursive: true, force: true });
  }
  return { app, server, base, dir, request, close, now };
}

export async function setupThreeSleeves(ctx) {
  const setup = await ctx.request('/api/setup', { method: 'POST', body: { portfolioName: '长期组合', baseCurrency: 'CNY', template: 'three_sleeve' } });
  if (setup.status !== 201) throw new Error(`setup failed: ${setup.text}`);
  const state = setup.json;
  const stock = state.sleeves.find((s) => s.name === '股票');
  const bond = state.sleeves.find((s) => s.name === '债券');
  const cash = state.sleeves.find((s) => s.name === '现金');
  const symbols = {};
  for (const [ticker, name, sleeveId, lotSizeMicros, priceMicros] of [
    ['510300', '沪深300ETF', stock.id, 1000000, 4000000],
    ['511010', '国债ETF', bond.id, 1000000, 100000000],
    ['511880', '银华日利', cash.id, 1000000, 100000000],
  ]) {
    const res = await ctx.request('/api/symbols', { method: 'POST', body: { ticker, name, sleeveId, lotSizeMicros, priceMicros, priceAsOf: '2026-10-28' } });
    if (res.status !== 201) throw new Error(`symbol failed: ${res.text}`);
    symbols[ticker] = res.json;
  }
  const account = state.accounts[0];
  for (const [ticker, quantityMicros] of [['510300', 1000000000], ['511010', 10000000], ['511880', 10000000]]) {
    const res = await ctx.request('/api/transactions', { method: 'POST', body: {
      accountId: account.id, symbolId: symbols[ticker].id, side: 'buy', quantityMicros, priceMicros: symbols[ticker].priceMicros, feeMicros: 0, tradedAt: '2026-10-28',
    } });
    if (res.status !== 201) throw new Error(`transaction failed: ${res.text}`);
  }
  return { account, symbols, state };
}
