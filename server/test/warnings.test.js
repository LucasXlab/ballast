import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../src/domain/plan.js';

test('过期价格与偏离带警告，rollup 按 code 排序', () => {
  const sleeves = [
    { id: 'a', name: 'A', targetBp: 5000, bandBp: 100, sortOrder: 0 },
    { id: 'b', name: 'B', targetBp: 5000, bandBp: 100, sortOrder: 1 },
  ];
  const symbols = [
    { id: 'a1', ticker: 'AAA', name: 'A', sleeveId: 'a', priceMicros: 1000000, priceAsOf: '2026-08-01', lotSizeMicros: 1000000, archived: false },
    { id: 'b1', ticker: 'BBB', name: 'B', sleeveId: 'b', priceMicros: 1000000, priceAsOf: '2026-10-28', lotSizeMicros: 1000000, archived: false },
  ];
  const plan = buildPlan({ positions: [], symbols, sleeves, amountMicros: 100000000, minTradeMicros: 0, nowMs: Date.parse('2026-10-29T12:00:00Z') });
  const codes = plan.warnings.map((w) => w.code);
  assert.ok(codes.includes('stale_price'));
  assert.ok(codes.includes('outside_band'));
  assert.deepEqual([...codes].sort(), codes);
});
