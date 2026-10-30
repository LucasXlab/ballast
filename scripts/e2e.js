#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ballast-e2e-'));
const port = 8816;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'server/src/index.js'), '--port', String(port), '--data-dir', dir], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 100; i += 1) {
  try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 50));
}
const request = async (pathname, options = {}) => {
  const response = await fetch(base + pathname, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
};

let browser;
let failed = false;
const check = (condition, message) => {
  if (condition) console.log(`✔ ${message}`);
  else { failed = true; console.error(`✖ ${message}`); }
};
try {
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(`${base}/setup`, { waitUntil: 'networkidle' });
  await page.locator('#setup-name').fill('E2E 组合');
  await page.getByRole('button', { name: '开始使用' }).click();
  await page.waitForURL(`${base}/`, { timeout: 5000 });
  const state = (await request('/api/state')).json;
  check(state.setupComplete === true, '首次设置从界面完成');
  const account = state.accounts[0];
  const stock = state.sleeves.find((s) => s.name === '股票');
  const bond = state.sleeves.find((s) => s.name === '债券');
  const cash = state.sleeves.find((s) => s.name === '现金');
  const codes = [['510300', '沪深300ETF', stock.id, 4000000], ['511010', '国债ETF', bond.id, 100000000], ['511880', '银华日利', cash.id, 100000000]];
  const symbols = [];
  for (const [ticker, name, sleeveId, priceMicros] of codes) {
    const res = await request('/api/symbols', { method: 'POST', body: { ticker, name, sleeveId, lotSizeMicros: 1000000, priceMicros, priceAsOf: state.today } });
    if (res.status === 201) symbols.push(res.json);
  }
  check(symbols.length === 3, '三个目标分类都有代码');
  const buy = await request('/api/transactions', { method: 'POST', body: { accountId: account.id, symbolId: symbols[0].id, side: 'buy', quantityMicros: 1000000000, priceMicros: 4000000, tradedAt: state.today } });
  check(buy.status === 201, '录入第一笔买入');

  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.locator('#amount').fill('1000');
  await page.getByRole('button', { name: '生成计划' }).last().click();
  await page.waitForURL(/\/plans\/[0-9a-f-]+$/, { timeout: 5000 });
  await page.getByRole('heading', { name: '买入计划' }).waitFor({ timeout: 5000 });
  check(true, '从总览生成计划并进入详情');
  await page.getByRole('button', { name: '标记为已执行' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '执行' }).click();
  await page.waitForTimeout(400);
  check(await page.getByText('生成的交易').count() >= 1, '执行后显示生成的交易');
  const history = (await request('/api/plans')).json.items;
  check(history[0]?.status === 'executed', '计划历史状态为已执行');
  const after = (await request('/api/state')).json;
  check(after.totals.marketValueMicros > state.totals.marketValueMicros, '执行后总市值增加');

  await page.goto(`${base}/targets`, { waitUntil: 'networkidle' });
  const targets = page.locator('input[aria-label$="目标"]');
  for (const [index, value] of ['60', '30', '10'].entries()) await targets.nth(index).fill(value);
  check((await page.locator('.sum').innerText()).includes('100.00%'), '目标页百分比换算正确');
  await page.getByRole('button', { name: '保存目标' }).click();
  await page.waitForTimeout(300);
  check(await page.locator('.alert--danger').count() === 0, '目标页保存无错误');

  await page.goto(`${base}/holdings`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '导入 CSV' }).click();
  await page.locator('#csv-text').fill(`date,account,symbol,side,quantity,price,fee,note\n${state.today},${account.name},510300,buy,1,4.1,0,ok\n${state.today},${account.name},511010,buy,1,100,0,ok`);
  check(await page.locator('.table--preview tbody tr').count() === 3, 'CSV 导入显示预览行');
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${base}/holdings`, { waitUntil: 'networkidle' });
  const mobile = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    wideTables: [...document.querySelectorAll('table')].filter((table) => table.getBoundingClientRect().right > 376).length,
  }));
  check(mobile.pageWidth <= 375 && mobile.wideTables === 0, '375px 页面与表格不横向溢出');
  check(pageErrors.length === 0, `无页面运行时错误${pageErrors.length ? `：${pageErrors[0]}` : ''}`);
} catch (error) {
  failed = true;
  console.error(`✖ E2E 失败：${error.message}`);
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 200));
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
