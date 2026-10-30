import crypto from 'node:crypto';
import { MoneyError, roundDiv, safeNumber } from './money.js';

export class PlanError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.name = 'PlanError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function normalizeTicker(raw) {
  return String(raw ?? '').trim().toUpperCase();
}

export function validTicker(raw) {
  return /^[A-Z0-9.-]{1,20}$/.test(normalizeTicker(raw));
}

function localDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  const [y, m, d] = dateText.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * 按权重分配整数，使用最大余数法；可给每项一个上限。
 * @param {number} total
 * @param {number[]} weights
 * @param {number[]|null} caps
 */
export function splitBudget(total, weights, caps = null) {
  const totalBig = BigInt(total);
  const weightSum = weights.reduce((a, b) => a + BigInt(b), 0n);
  if (weightSum === 0n) return weights.map(() => 0);
  const floors = weights.map((w) => (totalBig * BigInt(w)) / weightSum);
  const fractions = weights.map((w, i) => ({ i, rem: (totalBig * BigInt(w)) % weightSum }));
  fractions.sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  let remaining = totalBig - floors.reduce((a, b) => a + b, 0n);
  let progress = true;
  while (remaining > 0n && progress) {
    progress = false;
    for (const slot of fractions) {
      if (remaining === 0n) break;
      const cap = caps ? BigInt(caps[slot.i]) : null;
      if (cap !== null && floors[slot.i] >= cap) continue;
      floors[slot.i] += 1n;
      remaining -= 1n;
      progress = true;
    }
  }
  return floors.map(safeNumber);
}

function allocateGoal(totalAfter, sleeves) {
  return splitBudget(totalAfter, sleeves.map((s) => s.targetBp));
}

function symbolKey(s) {
  return `${s.ticker}\u0000${s.id}`;
}

function splitByValueExact(budget, eligible, valueById, sleeveValue) {
  const n = BigInt(eligible.length);
  if (sleeveValue <= 0n) {
    const base = budget / n;
    const remainder = budget - base * n;
    return eligible.map((symbol, index) => base + (BigInt(index) < remainder ? 1n : 0n));
  }
  const raw = eligible.map((symbol) => (budget * (valueById.get(symbol.id) ?? 0n)) / sleeveValue);
  let assigned = raw.reduce((a, b) => a + b, 0n);
  let remainder = budget - assigned;
  const out = [...raw];
  for (let i = 0; i < out.length && remainder > 0n; i += 1) {
    out[i] += 1n;
    remainder -= 1n;
  }
  return out;
}

export function buildPlan({ positions, symbols, sleeves, amountMicros, minTradeMicros = 0, nowMs = Date.now() }) {
  if (!Number.isInteger(amountMicros) || amountMicros < 1 || amountMicros > 1_000_000_000_000) {
    throw new PlanError(400, 'invalid_input', '投入金额必须在 0.000001–1,000,000 之间');
  }
  if (!Number.isInteger(minTradeMicros) || minTradeMicros < 0 || minTradeMicros > 10_000_000_000) {
    throw new PlanError(400, 'invalid_input', '最小单笔金额必须在 0–10,000 之间');
  }
  const targetSum = sleeves.reduce((sum, s) => sum + s.targetBp, 0);
  if (targetSum !== 10000) throw new PlanError(400, 'target_sum_mismatch', '分类目标合计必须是 100.00%');

  const activeSymbols = symbols.filter((s) => !s.archived);
  const byId = new Map(activeSymbols.map((s) => [s.id, s]));
  const activeSleeves = [...sleeves].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh-CN'));

  const qtyBySymbol = new Map(positions.filter((p) => p.quantityMicros > 0).map((p) => [p.symbolId, p.quantityMicros]));
  for (const [symbolId, qty] of qtyBySymbol) {
    const symbol = symbols.find((s) => s.id === symbolId);
    if (!symbol) continue;
    if (qty > 0 && symbol.priceMicros === 0) {
      throw new PlanError(422, 'missing_price', `${symbol.ticker} 没有价格，无法计算计划`, [{ ticker: symbol.ticker }]);
    }
  }

  let total = 0n;
  const valueById = new Map();
  for (const symbol of symbols) {
    const qty = BigInt(qtyBySymbol.get(symbol.id) ?? 0);
    const value = (qty * BigInt(symbol.priceMicros)) / 1_000_000n;
    valueById.set(symbol.id, value);
    total += value;
  }
  if (total + BigInt(amountMicros) > 1_000_000_000_000_000n) {
    throw new PlanError(422, 'value_overflow', '组合市值加投入金额超过 1e15 微单位上限');
  }
  const totalBefore = safeNumber(total);
  const totalAfter = safeNumber(total + BigInt(amountMicros));
  const goals = allocateGoal(totalAfter, activeSleeves).map(BigInt);

  const valueBySleeve = new Map(activeSleeves.map((s) => [s.id, 0n]));
  for (const symbol of symbols) {
    if (!valueBySleeve.has(symbol.sleeveId)) continue;
    valueBySleeve.set(symbol.sleeveId, valueBySleeve.get(symbol.sleeveId) + (valueById.get(symbol.id) ?? 0n));
  }

  for (const sleeve of activeSleeves) {
    if (sleeve.targetBp <= 0) continue;
    const eligible = activeSymbols.filter((s) => s.sleeveId === sleeve.id);
    if (eligible.length === 0) {
      throw new PlanError(422, 'sleeve_without_symbol', `分类「${sleeve.name}」没有可买入的代码`, [{ sleeve: sleeve.name }]);
    }
    if (!eligible.some((s) => s.priceMicros > 0)) {
      throw new PlanError(422, 'sleeve_without_symbol', `分类「${sleeve.name}」的代码都没有价格`, [{ sleeve: sleeve.name }]);
    }
  }

  const deficits = activeSleeves.map((s, i) => {
    const gap = goals[i] - (valueBySleeve.get(s.id) ?? 0n);
    return gap > 0n ? gap : 0n;
  });
  const deficitSum = deficits.reduce((a, b) => a + b, 0n);
  if (deficitSum === 0n) throw new PlanError(422, 'amount_too_small', '没有需要买入的金额');

  const budgets = splitBudget(
    amountMicros,
    deficits.map(safeNumber),
    deficits.map(safeNumber),
  ).map(BigInt);

  const allocatedBySleeve = new Map(activeSleeves.map((s) => [s.id, 0n]));
  const allocations = new Map();
  const warnings = [];
  let droppedByMinTrade = false;

  for (let i = 0; i < activeSleeves.length; i += 1) {
    const sleeve = activeSleeves[i];
    const budget = budgets[i];
    if (budget === 0n) continue;
    const sleeveValue = valueBySleeve.get(sleeve.id) ?? 0n;
    const eligible = activeSymbols
      .filter((s) => s.sleeveId === sleeve.id && s.priceMicros > 0)
      .sort((a, b) => symbolKey(a).localeCompare(symbolKey(b), 'zh-CN'));
    if (eligible.length === 0) continue;
    const symbolBudgets = splitByValueExact(budget, eligible, valueById, sleeveValue);
    for (let j = 0; j < eligible.length; j += 1) {
      const symbol = eligible[j];
      const unit = (BigInt(symbol.lotSizeMicros) * BigInt(symbol.priceMicros)) / 1_000_000n;
      if (unit <= 0n) continue;
      const qty = (symbolBudgets[j] / unit) * BigInt(symbol.lotSizeMicros);
      if (qty <= 0n) continue;
      if (qty > 1_000_000_000_000_000n) throw new PlanError(422, 'value_overflow', '买入数量超过 1e15 微单位上限');
      const amount = (qty * BigInt(symbol.priceMicros)) / 1_000_000n;
      if (amount < BigInt(minTradeMicros)) {
        droppedByMinTrade = true;
        continue;
      }
      allocations.set(symbol.id, (allocations.get(symbol.id) ?? 0n) + qty);
      allocatedBySleeve.set(sleeve.id, (allocatedBySleeve.get(sleeve.id) ?? 0n) + amount);
    }
  }

  let planned = [...allocations.entries()].reduce((sum, [symbolId, qty]) => {
    const symbol = byId.get(symbolId);
    if (!symbol) return sum;
    return sum + (qty * BigInt(symbol.priceMicros)) / 1_000_000n;
  }, 0n);
  let remaining = BigInt(amountMicros) - planned;
  let loopHit = false;
  let iterations = 0;

  while (remaining > 0n && iterations < 10000) {
    iterations += 1;
    const candidates = activeSleeves
      .map((s, i) => {
        const nowValue = (valueBySleeve.get(s.id) ?? 0n) + (allocatedBySleeve.get(s.id) ?? 0n);
        return { sleeve: s, deficit: goals[i] - nowValue };
      })
      .filter((c) => c.deficit > 0n)
      .sort((a, b) => (a.deficit === b.deficit ? a.sleeve.sortOrder - b.sleeve.sortOrder : a.deficit > b.deficit ? -1 : 1));
    let bought = false;
    for (const candidate of candidates) {
  const eligible = activeSymbols
        .filter((s) => s.sleeveId === candidate.sleeve.id && s.priceMicros > 0)
        .sort((a, b) => symbolKey(a).localeCompare(symbolKey(b), 'zh-CN'));
      for (const symbol of eligible) {
        const unit = (BigInt(symbol.lotSizeMicros) * BigInt(symbol.priceMicros)) / 1_000_000n;
        if (unit <= 0n || unit > remaining) continue;
        allocations.set(symbol.id, (allocations.get(symbol.id) ?? 0n) + BigInt(symbol.lotSizeMicros));
        allocatedBySleeve.set(candidate.sleeve.id, (allocatedBySleeve.get(candidate.sleeve.id) ?? 0n) + unit);
        remaining -= unit;
        planned += unit;
        bought = true;
        break;
      }
      if (bought) break;
    }
    if (!bought) break;
  }
  if (remaining > 0n && iterations >= 10000) loopHit = true;

  const items = [...allocations.entries()]
    .map(([symbolId, qty]) => {
      const symbol = byId.get(symbolId);
      const amount = (qty * BigInt(symbol.priceMicros)) / 1_000_000n;
      return { symbol, qty, amount };
    })
    .filter((item) => {
      if (item.amount >= BigInt(minTradeMicros)) return true;
      droppedByMinTrade = true;
      return false;
    })
    .sort((a, b) => {
      const sa = activeSleeves.findIndex((s) => s.id === a.symbol.sleeveId);
      const sb = activeSleeves.findIndex((s) => s.id === b.symbol.sleeveId);
      return sa - sb || symbolKey(a.symbol).localeCompare(symbolKey(b.symbol), 'zh-CN');
    });

  planned = items.reduce((sum, item) => sum + item.amount, 0n);
  remaining = BigInt(amountMicros) - planned;

  if (items.length === 0) {
    let minUnit = null;
    for (const symbol of activeSymbols) {
      if (symbol.priceMicros <= 0) continue;
      const unit = (BigInt(symbol.lotSizeMicros) * BigInt(symbol.priceMicros)) / 1_000_000n;
      if (minUnit === null || unit < minUnit) minUnit = unit;
    }
    const minimum = minUnit === null ? 0 : Math.max(Number(minUnit), minTradeMicros);
    throw new PlanError(422, 'amount_too_small', '投入金额不够买入一手', [{ minimumAmountMicros: minimum }]);
  }

  const finalAllocated = new Map(activeSleeves.map((s) => [s.id, 0n]));
  for (const item of items) {
    finalAllocated.set(item.symbol.sleeveId, (finalAllocated.get(item.symbol.sleeveId) ?? 0n) + item.amount);
  }

  const plannedTotal = total + planned;
  const sleeveRows = activeSleeves.map((s, i) => {
    const before = valueBySleeve.get(s.id) ?? 0n;
    const after = before + (finalAllocated.get(s.id) ?? 0n);
    const actualBefore = totalBefore === 0 ? 0 : safeNumber(roundDiv(before * 10000n, total));
    const actualAfter = plannedTotal === 0n ? 0 : safeNumber(roundDiv(after * 10000n, plannedTotal));
    const driftBefore = totalBefore === 0 ? -s.targetBp : actualBefore - s.targetBp;
    const driftAfter = plannedTotal === 0n ? -s.targetBp : actualAfter - s.targetBp;
    return {
      sleeveId: s.id,
      name: s.name,
      targetBp: s.targetBp,
      valueBeforeMicros: safeNumber(before),
      valueAfterMicros: safeNumber(after),
      driftBeforeBp: driftBefore,
      driftAfterBp: driftAfter,
      sortOrder: s.sortOrder,
    };
  });

  const stale = symbols
    .filter((s) => s.priceMicros > 0 && s.priceAsOf && s.priceAsOf < addDays(localDate(nowMs), -30))
    .map((s) => s.priceAsOf)
    .sort();
  if (stale.length > 0) {
    warnings.push({ code: 'stale_price', message: `有价格早于 30 天前，最早是 ${stale[0]}。更新价格后再生成计划更可靠` });
  }
  const outside = sleeveRows.filter((row) => Math.abs(row.driftBeforeBp) > activeSleeves.find((s) => s.id === row.sleeveId).bandBp);
  if (outside.length > 0) {
    warnings.push({
      code: 'outside_band',
      message: outside.map((row) => `${row.name}偏离 ${row.driftBeforeBp > 0 ? '+' : ''}${(row.driftBeforeBp / 100).toFixed(2)}%`).join('；') + '，超出偏离带',
    });
  }
  if (remaining > 0n) {
    warnings.push({ code: 'residual_cash', message: `有 ${(Number(remaining) / 1_000_000).toFixed(2)} 单位不足一手，留在现金` });
  }
  const unpriced = activeSymbols.filter((s) => s.priceMicros === 0 && (qtyBySymbol.get(s.id) ?? 0) === 0);
  if (unpriced.length > 0) {
    warnings.push({ code: 'symbol_without_price', message: `这些代码没有价格，未参与计划：${unpriced.map((s) => s.ticker).join('、')}` });
  }
  if (droppedByMinTrade) warnings.push({ code: 'amount_below_min_trade', message: '有买入项小于最小单笔金额，已从计划中删除' });
  if (loopHit) warnings.push({ code: 'residual_loop_limit', message: '剩余金额分配达到 10,000 次上限，计划可能留有现金' });

  const maxDriftBefore = sleeveRows.reduce((m, row) => Math.max(m, Math.abs(row.driftBeforeBp)), 0);
  const maxDriftAfter = sleeveRows.reduce((m, row) => Math.max(m, Math.abs(row.driftAfterBp)), 0);
  if (maxDriftAfter > maxDriftBefore) {
    warnings.push({ code: 'drift_worsened', message: '整手限制让部分分类买不进，买入后最大偏离反而变大；可以减少投入或调整最小单笔金额' });
  }
  warnings.sort((a, b) => a.code.localeCompare(b.code));
  const inputsHash = hashPlanInputs({ amountMicros, minTradeMicros, positions: qtyBySymbol, symbols, sleeves: activeSleeves });
  const itemRows = items.map((item) => ({
    symbolId: item.symbol.id,
    ticker: item.symbol.ticker,
    symbolName: item.symbol.name,
    sleeveId: item.symbol.sleeveId,
    sleeveName: activeSleeves.find((s) => s.id === item.symbol.sleeveId)?.name ?? '',
    quantityMicros: safeNumber(item.qty),
    priceMicros: item.symbol.priceMicros,
    amountMicros: safeNumber(item.amount),
  }));

  return {
    amountMicros,
    minTradeMicros,
    plannedMicros: safeNumber(planned),
    cashLeftMicros: safeNumber(remaining),
    totalBeforeMicros: totalBefore,
    totalAfterMicros: totalAfter,
    maxDriftBeforeBp: maxDriftBefore,
    maxDriftAfterBp: maxDriftAfter,
    algorithmVersion: 'greedy-v1',
    inputsHash,
    warnings,
    items: itemRows,
    sleeves: sleeveRows,
  };
}

export function hashPlanInputs({ amountMicros, minTradeMicros, positions, symbols, sleeves }) {
  const pos = [...positions.entries()]
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => [id, Number(qty)])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const active = symbols.filter((s) => !s.archived);
  const prices = active
    .map((s) => [s.id, s.priceMicros, s.priceAsOf])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const symbolRows = active
    .map((s) => [s.id, s.sleeveId, s.ticker, s.lotSizeMicros])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const sleeveRows = sleeves
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((s) => [s.id, s.targetBp, s.bandBp, s.sortOrder]);
  const canonical = JSON.stringify({ amountMicros, minTradeMicros, positions: pos, prices, sleeves: sleeveRows, symbols: symbolRows });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}
