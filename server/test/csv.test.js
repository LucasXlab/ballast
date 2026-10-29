import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, toCsv } from '../src/domain/csv.js';
import { startServer, setupThreeSleeves } from './helpers.js';

test('CSV 解析：BOM、CRLF、引号、空行', () => {
  const parsed = parseCsv('\ufeffa,b,c\r\n1,"x,y","q""z"\r\n\r\n2,3,4\r\n');
  assert.deepEqual(parsed.header, ['a', 'b', 'c']);
  assert.deepEqual(parsed.rows.map((r) => r.fields), [['1', 'x,y', 'q"z'], ['2', '3', '4']]);
  assert.deepEqual(parsed.rows.map((r) => r.line), [2, 4]);
});

test('CSV 导出：BOM、引号和公式前缀', () => {
  const csv = toCsv(['a', 'b'], [['=1+1', 'x,y']], { protectFormula: true });
  assert.ok(csv.startsWith('\ufeff'));
  assert.ok(csv.includes("'=1+1,\"x,y\""));
});

test('导入：成功、重复内容、行错误与原子性', async () => {
  const ctx = await startServer();
  try {
    const { account } = await setupThreeSleeves(ctx);
    const header = 'date,account,symbol,side,quantity,price,fee,note';
    const good = `${header}\n2026-10-28,${account.name},510300,buy,10,4.100000,0,"备注,带逗号"`;
    const res = await ctx.request('/api/imports', { method: 'POST', body: { filename: 'a.csv', csv: good } });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json.importedRows, 1);
    const dup = await ctx.request('/api/imports', { method: 'POST', body: { filename: 'a.csv', csv: good } });
    assert.equal(dup.status, 409);
    assert.equal(dup.json.code, 'duplicate_import');
    const bad = `${header}\n2026-10-28,${account.name},510300,buy,10,4.1,0,ok\n2026-10-28,${account.name},NOPE,buy,1,1,0,bad`;
    const before = (await ctx.request('/api/state')).json.totals.marketValueMicros;
    const badRes = await ctx.request('/api/imports', { method: 'POST', body: { filename: 'b.csv', csv: bad } });
    assert.equal(badRes.status, 400);
    assert.equal(badRes.json.code, 'invalid_csv');
    assert.equal(badRes.json.details[0].line, 3);
    assert.equal((await ctx.request('/api/state')).json.totals.marketValueMicros, before);
  } finally { await ctx.close(); }
});
