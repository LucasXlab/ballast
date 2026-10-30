#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '..');
const chrome = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outDir = path.join(root, 'assets/screenshots');
fs.mkdirSync(outDir, { recursive: true });

function startServer(port, dataDir, demo) {
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'server/src/index.js'), '--port', String(port), '--data-dir', dataDir], {
    cwd: root,
    env: { ...process.env, BALLAST_DEMO: demo ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}
async function waitFor(url) {
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`服务没有启动：${url}`);
}
async function post(base, pathname, body) {
  const res = await fetch(base + pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ballast-shots-'));
const demoDir = path.join(tmp, 'demo');
const emptyDir = path.join(tmp, 'empty');
const demoPort = 8799;
const emptyPort = 8800;
const demoServer = startServer(demoPort, demoDir, true);
const emptyServer = startServer(emptyPort, emptyDir, false);
const demoBase = `http://127.0.0.1:${demoPort}`;
const emptyBase = `http://127.0.0.1:${emptyPort}`;
let browser;
try {
  await waitFor(`${demoBase}/api/health`);
  await waitFor(`${emptyBase}/api/health`);
  const state = await (await fetch(`${demoBase}/api/state`)).json();
  const plan = await post(demoBase, '/api/plans', { amountMicros: 1000000000 });
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const pages = [
    ['overview', '/', demoBase],
    ['plan', `/plans/${plan.id}`, demoBase],
    ['holdings', '/holdings', demoBase],
    ['targets', '/targets', demoBase],
    ['plans', '/plans', demoBase],
    ['settings', '/settings', demoBase],
    ['setup', '/setup', emptyBase],
    ['not-found', '/nope', demoBase],
  ];
  const problems = [];
  for (const [scheme, colors] of [['light', 'light'], ['dark', 'dark']]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: colors, locale: 'zh-CN' });
    const page = await context.newPage();
    for (const [name, pathname, base] of pages) {
      await page.goto(base + pathname, { waitUntil: 'networkidle' });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(outDir, `${name}-${scheme}.png`), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > 1280);
      if (overflow) problems.push(`${name}-${scheme} 桌面横向滚动`);
    }
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, colorScheme: 'light', locale: 'zh-CN' });
  const page = await context.newPage();
  for (const [name, pathname, base] of pages) {
    await page.goto(base + pathname, { waitUntil: 'networkidle' });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(outDir, `${name}-375.png`), fullPage: true });
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    if (width > 375) problems.push(`${name}-375 横向滚动 ${width}px`);
    const wideTables = await page.evaluate(() => [...document.querySelectorAll('table')].filter((table) => table.getBoundingClientRect().right > 376).length);
    if (wideTables > 0) problems.push(`${name}-375 有 ${wideTables} 个表格超出视口`);
  }
  await context.close();
  if (problems.length) throw new Error(problems.join('\n'));
  console.log(`截图完成：${pages.length * 3} 张，位于 assets/screenshots`);
  console.log(`示例总市值：${(state.totals.marketValueMicros / 1e6).toFixed(2)} 元，计划 ${plan.items.length} 项`);
} finally {
  if (browser) await browser.close();
  demoServer.kill('SIGTERM');
  emptyServer.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  fs.rmSync(tmp, { recursive: true, force: true });
}
