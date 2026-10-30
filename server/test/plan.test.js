import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, hashPlanInputs, splitBudget } from '../src/domain/plan.js';

const sleeves = [
  { id: 's', name: '股票', targetBp: 6000, bandBp: 500, sortOrder: 0 },
  { id: 'b', name: '债券', targetBp: 3000, bandBp: 300, sortOrder: 1 },
  { id: 'c', name: '现金', targetBp: 1000, bandBp: 200, sortOrder: 2 },
];
const symbols = [
  { id: 'a', ticker: '510300', name: '沪深300ETF', sleeveId: 's', priceMicros: 4000000, priceAsOf: '2026-10-28', lotSizeMicros: 1000000, archived: false },
  { id: 'b1', ticker: '511010', name: '国债ETF', sleeveId: 'b', priceMicros: 100000000, priceAsOf: '2026-10-28', lotSizeMicros: 1000000, archived: false },
  { id: 'c1', ticker: '511880', name: '银华日利', sleeveId: 'c', priceMicros: 100000000, priceAsOf: '2026-10-28', lotSizeMicros: 1000000, archived: false },
];
const positions = [
  { symbolId: 'a', quantityMicros: 1000000000 },
  { symbolId: 'b1', quantityMicros: 10000000 },
  { symbolId: 'c1', quantityMicros: 10000000 },
];

test('SPEC 5.4 示例逐项断言', () => {
  const plan = buildPlan({ positions, symbols, sleeves, amountMicros: 1000000000, minTradeMicros: 0, nowMs: Date.parse('2026-10-29T12:00:00Z') });
  assert.deepEqual(plan.items.map((i) => [i.ticker, i.quantityMicros, i.amountMicros]), [['510300', 50000000, 200000000], ['511010', 8000000, 800000000]]);
  assert.equal(plan.plannedMicros, 1000000000);
  assert.equal(plan.cashLeftMicros, 0);
  assert.equal(plan.totalBeforeMicros, 6000000000);
  assert.equal(plan.totalAfterMicros, 7000000000);
  assert.deepEqual(plan.sleeves.map((s) => [s.driftBeforeBp, s.driftAfterBp]), [[667, 0], [-1333, -429], [667, 429]]);
  assert.equal(plan.maxDriftBeforeBp, 1333);
  assert.equal(plan.maxDriftAfterBp, 429);
});

test('整手与最小单笔', () => {
  const s = [{ id: 's', name: 'A', targetBp: 10000, bandBp: 500, sortOrder: 0 }];
  const sym = [{ id: 'x', ticker: 'X', name: 'X', sleeveId: 's', priceMicros: 1230000, priceAsOf: '2026-10-28', lotSizeMicros: 100000000, archived: false }];
  const pos = [{ symbolId: 'x', quantityMicros: 0 }];
  const plan = buildPlan({ positions: pos, symbols: sym, sleeves: s, amountMicros: 1000000000, minTradeMicros: 0, nowMs: Date.parse('2026-10-29T12:00:00Z') });
  assert.equal(plan.items[0].quantityMicros % 100000000, 0);
  assert.ok(plan.items[0].amountMicros <= 1000000000);
  assert.throws(() => buildPlan({ positions: pos, symbols: sym, sleeves: s, amountMicros: 100000000, minTradeMicros: 500000000, nowMs: Date.parse('2026-10-29T12:00:00Z') }), (err) => err.code === 'amount_too_small');
});

test('缺价格、无代码与金额过小', () => {
  assert.throws(() => buildPlan({ positions, symbols: symbols.map((s) => s.id === 'a' ? { ...s, priceMicros: 0, priceAsOf: null } : s), sleeves, amountMicros: 1000000 }), (err) => err.code === 'missing_price');
  assert.throws(() => buildPlan({ positions: [], symbols: [symbols[0]], sleeves, amountMicros: 1000000 }), (err) => err.code === 'sleeve_without_symbol');
  assert.throws(() => buildPlan({ positions: [], symbols: [{ ...symbols[0], priceMicros: 1000000000 }], sleeves: [{ id: 's', name: 'A', targetBp: 10000, bandBp: 500, sortOrder: 0 }], amountMicros: 1 }), (err) => err.code === 'amount_too_small');
});

test('目标总和必须 10000，哈希稳定且敏感', () => {
  assert.throws(() => buildPlan({ positions, symbols, sleeves: sleeves.map((s) => s.id === 's' ? { ...s, targetBp: 5000 } : s), amountMicros: 1000000 }), (err) => err.code === 'target_sum_mismatch');
  const a = buildPlan({ positions, symbols, sleeves, amountMicros: 1000000000, nowMs: Date.parse('2026-10-29T12:00:00Z') });
  const b = buildPlan({ positions, symbols, sleeves, amountMicros: 1000000000, nowMs: Date.parse('2026-10-30T12:00:00Z') });
  assert.equal(a.inputsHash, b.inputsHash);
  const c = buildPlan({ positions, symbols: symbols.map((s) => s.id === 'a' ? { ...s, priceMicros: 4100000 } : s), sleeves, amountMicros: 1000000000, nowMs: Date.parse('2026-10-29T12:00:00Z') });
  assert.notEqual(a.inputsHash, c.inputsHash);
  assert.match(a.inputsHash, /^[0-9a-f]{64}$/);
});

test('最大余数分配不丢微单位', () => {
  assert.deepEqual(splitBudget(10, [1, 1, 1]), [4, 3, 3]);
  assert.equal(splitBudget(1000000000, [1, 2, 3]).reduce((a, b) => a + b, 0), 1000000000);
});

test('直接 hash 输入的规范化顺序无关', () => {
  const h1 = hashPlanInputs({ amountMicros: 1, minTradeMicros: 0, positions: new Map([['b', 2], ['a', 1]]), symbols, sleeves });
  const h2 = hashPlanInputs({ amountMicros: 1, minTradeMicros: 0, positions: new Map([['a', 1], ['b', 2]]), symbols: [...symbols].reverse(), sleeves: [...sleeves].reverse() });
  assert.equal(h1, h2);
});

test('分类内按市值比例先取整，余数按 ticker 升序逐微补', () => {
  const sleeves = [{ id: 's', name: '单一', targetBp: 10000, bandBp: 500, sortOrder: 0 }];
  const symbols = [
    { id: 'b', ticker: 'BBB', name: 'B', sleeveId: 's', priceMicros: 1, priceAsOf: '2026-10-28', lotSizeMicros: 1000000, archived: false },
    { id: 'a', ticker: 'AAA', name: 'A', sleeveId: 's', priceMicros: 1, priceAsOf: '2026-10-28', lotSizeMicros: 1000000, archived: false },
  ];
  const positions = [{ symbolId: 'a', quantityMicros: 1000000 }, { symbolId: 'b', quantityMicros: 3000000 }];
  const plan = buildPlan({ positions, symbols, sleeves, amountMicros: 10, minTradeMicros: 0, nowMs: Date.parse('2026-10-29T12:00:00Z') });
  const byTicker = Object.fromEntries(plan.items.map((i) => [i.ticker, i.amountMicros]));
  assert.deepEqual(byTicker, { AAA: 3, BBB: 7 });
});
