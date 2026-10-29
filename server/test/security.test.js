import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from './helpers.js';

test('安全头、Origin、Content-Type 与 404', async () => {
  const ctx = await startServer();
  try {
    const health = await ctx.request('/api/health');
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(health.headers.get('content-security-policy').includes("default-src 'self'"));
    assert.equal(health.json.ok, true);
    const badOrigin = await ctx.request('/api/setup', { method: 'POST', headers: { Origin: 'http://evil.example' }, body: { portfolioName: 'x', template: 'blank' } });
    assert.equal(badOrigin.status, 403);
    assert.equal(badOrigin.json.code, 'bad_origin');
    const form = await fetch(`${ctx.base}/api/setup`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'x=1' });
    assert.equal(form.status, 415);
    const badHost = await new Promise((resolve, reject) => {
      const url = new URL(ctx.base);
      const req = http.request({ hostname: url.hostname, port: url.port, path: '/api/state', headers: { Host: 'evil.example' } }, (res) => {
        let body = '';
        res.on('data', (d) => { body += d; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(badHost.status, 403);
    assert.equal(JSON.parse(badHost.body).code, 'bad_host');
    const jsonPatch = await ctx.request('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json-patch' }, body: { portfolioName: 'x', template: 'blank' } });
    assert.equal(jsonPatch.status, 415);
    const notFound = await ctx.request('/api/nope');
    assert.equal(notFound.status, 404);
    assert.equal(notFound.json.code, 'not_found');
    const big = 'x'.repeat(4 * 1024 * 1024 + 10);
    const tooLarge = await ctx.request('/api/setup', { method: 'POST', body: { portfolioName: big, template: 'blank' } });
    assert.equal(tooLarge.status, 413);
  } finally { await ctx.close(); }
});

test('静态资源未构建时返回 503', async () => {
  const ctx = await startServer();
  try {
    const res = await ctx.request('/');
    assert.equal(res.status, 503);
    assert.equal(res.json.code, 'web_not_built');
  } finally { await ctx.close(); }
});
