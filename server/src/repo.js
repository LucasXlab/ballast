import { roundDiv, safeNumber, microsToDecimal } from './domain/money.js';
import { accountDto, portfolioDto, sleeveDto, symbolDto, toBool, utcDate } from './domain/dto.js';

export function getPortfolio(db) {
  return db.prepare('SELECT * FROM portfolio WHERE id = ?').get('portfolio') ?? null;
}

export function getAccounts(db) {
  return db.prepare('SELECT * FROM account ORDER BY sort_order, created_at, id').all();
}

export function getSleeves(db) {
  return db.prepare('SELECT * FROM sleeve ORDER BY sort_order, created_at, id').all();
}

export function getSymbols(db) {
  return db
    .prepare('SELECT s.*, sl.name AS sleeve_name FROM symbol s JOIN sleeve sl ON sl.id = s.sleeve_id ORDER BY sl.sort_order, s.ticker, s.id')
    .all();
}

export function getTransactions(db, { accountId = null, symbolId = null } = {}) {
  const where = [];
  const params = [];
  if (accountId) {
    where.push('t.account_id = ?');
    params.push(accountId);
  }
  if (symbolId) {
    where.push('t.symbol_id = ?');
    params.push(symbolId);
  }
  const sql = `SELECT t.*, a.name AS account_name, s.ticker, s.name AS symbol_name
    FROM "transaction" t JOIN account a ON a.id = t.account_id JOIN symbol s ON s.id = t.symbol_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.traded_at DESC, t.created_at DESC, t.id DESC`;
  return db.prepare(sql).all(...params);
}

export function transactionDto(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    symbolId: row.symbol_id,
    ticker: row.ticker,
    symbolName: row.symbol_name,
    side: row.side,
    quantityMicros: row.quantity_micros,
    priceMicros: row.price_micros,
    feeMicros: row.fee_micros,
    tradedAt: row.traded_at,
    note: row.note,
    source: row.source,
    planId: row.plan_id,
    createdAt: row.created_at,
  };
}

export function positionRows(db) {
  const rows = db
    .prepare(`SELECT t.account_id, t.symbol_id, t.side, t.quantity_micros, t.price_micros, t.fee_micros,
      a.name AS account_name, a.sort_order AS account_sort, s.ticker, s.name AS symbol_name, s.sleeve_id,
      sl.name AS sleeve_name, s.price_micros AS current_price, s.price_as_of, s.lot_size_micros, s.archived,
      sl.target_bp, sl.band_bp, sl.sort_order AS sleeve_sort
      FROM "transaction" t
      JOIN account a ON a.id = t.account_id
      JOIN symbol s ON s.id = t.symbol_id
      JOIN sleeve sl ON sl.id = s.sleeve_id`)
    .all();
  const map = new Map();
  for (const row of rows) {
    const key = `${row.account_id}\u0000${row.symbol_id}`;
    if (!map.has(key)) {
      map.set(key, {
        accountId: row.account_id,
        accountName: row.account_name,
        accountSort: row.account_sort,
        symbolId: row.symbol_id,
        ticker: row.ticker,
        name: row.symbol_name,
        sleeveId: row.sleeve_id,
        sleeveName: row.sleeve_name,
        sleeveSort: row.sleeve_sort,
        targetBp: row.target_bp,
        bandBp: row.band_bp,
        priceMicros: row.current_price,
        priceAsOf: row.price_as_of,
        lotSizeMicros: row.lot_size_micros,
        archived: toBool(row.archived),
        qty: 0n,
        buyQty: 0n,
        buyCost: 0n,
      });
    }
    const item = map.get(key);
    const qty = BigInt(row.quantity_micros);
    if (row.side === 'buy') {
      item.qty += qty;
      item.buyQty += qty;
      item.buyCost += (qty * BigInt(row.price_micros)) / 1_000_000n + BigInt(row.fee_micros);
    } else {
      item.qty -= qty;
    }
  }
  return [...map.values()]
    .filter((item) => item.qty > 0n)
    .map((item) => {
      const avgCost = item.buyQty > 0n ? Number(roundDiv(item.buyCost * 1_000_000n, item.buyQty)) : 0;
      const costBasis = (BigInt(avgCost) * item.qty) / 1_000_000n;
      const marketValue = (item.qty * BigInt(item.priceMicros)) / 1_000_000n;
      return {
        accountId: item.accountId,
        accountName: item.accountName,
        accountSort: item.accountSort,
        symbolId: item.symbolId,
        ticker: item.ticker,
        name: item.name,
        sleeveId: item.sleeveId,
        sleeveName: item.sleeveName,
        sleeveSort: item.sleeveSort,
        quantityMicros: safeNumber(item.qty),
        avgCostMicros: avgCost,
        priceMicros: item.priceMicros,
        priceAsOf: item.priceAsOf,
        marketValueMicros: safeNumber(marketValue),
        costBasisMicros: safeNumber(costBasis),
        unrealizedMicros: safeNumber(marketValue - costBasis),
        lotSizeMicros: item.lotSizeMicros,
        archived: item.archived,
      };
    })
    .sort((a, b) => b.marketValueMicros - a.marketValueMicros || a.accountName.localeCompare(b.accountName, 'zh-CN') || a.ticker.localeCompare(b.ticker, 'zh-CN') || a.symbolId.localeCompare(b.symbolId));
}

export function aggregatePositions(positions) {
  const map = new Map();
  for (const p of positions) {
    map.set(p.symbolId, (map.get(p.symbolId) ?? 0) + p.quantityMicros);
  }
  return [...map.entries()].map(([symbolId, quantityMicros]) => ({ symbolId, quantityMicros }));
}

export function computePosition(db, accountId, symbolId) {
  const row = db
    .prepare(`SELECT COALESCE(SUM(CASE WHEN side='buy' THEN quantity_micros ELSE -quantity_micros END), 0) AS qty,
      COALESCE(SUM(CASE WHEN side='buy' THEN quantity_micros * price_micros / 1000000 + fee_micros ELSE 0 END), 0) AS cost,
      COALESCE(SUM(CASE WHEN side='buy' THEN quantity_micros ELSE 0 END), 0) AS buy_qty
      FROM "transaction" WHERE account_id = ? AND symbol_id = ?`)
    .get(accountId, symbolId);
  const qty = Number(row.qty);
  const avgCost = row.buy_qty > 0 ? Number(roundDiv(BigInt(Math.round(row.cost)) * 1_000_000n, BigInt(row.buy_qty))) : 0;
  return { accountId, symbolId, quantityMicros: qty, avgCostMicros: avgCost };
}

export function computeSymbolQty(db, symbolId) {
  const row = db
    .prepare(`SELECT COALESCE(SUM(CASE WHEN side='buy' THEN quantity_micros ELSE -quantity_micros END), 0) AS qty FROM "transaction" WHERE symbol_id = ?`)
    .get(symbolId);
  return Number(row.qty);
}

export function buildState(db, nowMs) {
  const portfolio = getPortfolio(db);
  const today = utcDate(nowMs);
  if (!portfolio) {
    return {
      setupComplete: false,
      demo: false,
      today,
      portfolio: null,
      accounts: [],
      sleeves: [],
      symbols: [],
      positions: [],
      totals: { marketValueMicros: 0, costBasisMicros: 0, unrealizedMicros: 0, positionCount: 0 },
      targets: [],
      lastPlan: null,
    };
  }
  const accounts = getAccounts(db).map(accountDto);
  const sleeves = getSleeves(db).map(sleeveDto);
  const symbols = getSymbols(db).map(symbolDto);
  const positions = positionRows(db).map((p) => ({
    accountId: p.accountId,
    accountName: p.accountName,
    symbolId: p.symbolId,
    ticker: p.ticker,
    name: p.name,
    sleeveId: p.sleeveId,
    sleeveName: p.sleeveName,
    quantityMicros: p.quantityMicros,
    avgCostMicros: p.avgCostMicros,
    priceMicros: p.priceMicros,
    priceAsOf: p.priceAsOf,
    marketValueMicros: p.marketValueMicros,
    costBasisMicros: p.costBasisMicros,
    unrealizedMicros: p.unrealizedMicros,
  }));
  const total = positions.reduce((sum, p) => sum + BigInt(p.marketValueMicros), 0n);
  const totalCost = positions.reduce((sum, p) => sum + BigInt(p.costBasisMicros), 0n);
  const valueBySleeve = new Map(sleeves.map((s) => [s.id, 0n]));
  for (const p of positions) valueBySleeve.set(p.sleeveId, (valueBySleeve.get(p.sleeveId) ?? 0n) + BigInt(p.marketValueMicros));
  const targets = sleeves.map((s) => {
    const value = valueBySleeve.get(s.id) ?? 0n;
    const actualBp = total === 0n ? 0 : Number(roundDiv(value * 10000n, total));
    const driftBp = total === 0n ? -s.targetBp : actualBp - s.targetBp;
    return {
      sleeveId: s.id,
      name: s.name,
      targetBp: s.targetBp,
      bandBp: s.bandBp,
      valueMicros: Number(value),
      actualBp,
      driftBp,
      status: Math.abs(driftBp) <= s.bandBp ? 'within' : 'outside',
    };
  });
  const last = db.prepare('SELECT * FROM plan ORDER BY created_at DESC, id ASC LIMIT 1').get();
  const lastPlan = last
    ? {
        id: last.id,
        status: last.status,
        amountMicros: last.amount_micros,
        plannedMicros: last.planned_micros,
        cashLeftMicros: last.cash_left_micros,
        maxDriftBeforeBp: last.max_drift_before_bp,
        maxDriftAfterBp: last.max_drift_after_bp,
        createdAt: last.created_at,
        executedAt: last.executed_at,
        abandonedAt: last.abandoned_at,
        accountId: last.account_id ?? null,
      }
    : null;
  return {
    setupComplete: true,
    demo: db.prepare("SELECT value FROM meta WHERE key='demo_seeded'").get()?.value === '1',
    today,
    portfolio: portfolioDto(portfolio),
    accounts,
    sleeves,
    symbols,
    positions,
    totals: {
      marketValueMicros: safeNumber(total),
      costBasisMicros: safeNumber(totalCost),
      unrealizedMicros: safeNumber(total - totalCost),
      positionCount: positions.length,
    },
    targets,
    lastPlan,
  };
}

export function planDto(row) {
  return {
    id: row.id,
    status: row.status,
    amountMicros: row.amount_micros,
    minTradeMicros: row.min_trade_micros,
    plannedMicros: row.planned_micros,
    cashLeftMicros: row.cash_left_micros,
    totalBeforeMicros: row.total_before_micros,
    totalAfterMicros: row.total_after_micros,
    maxDriftBeforeBp: row.max_drift_before_bp,
    maxDriftAfterBp: row.max_drift_after_bp,
    algorithmVersion: row.algorithm_version,
    inputsHash: row.inputs_hash,
    warnings: JSON.parse(row.warnings_json),
    note: row.note,
    createdAt: row.created_at,
    executedAt: row.executed_at,
    abandonedAt: row.abandoned_at,
    accountId: row.account_id ?? null,
  };
}

export function planItems(db, planId) {
  return db
    .prepare('SELECT * FROM plan_item WHERE plan_id = ? ORDER BY sort_order, id')
    .all(planId)
    .map((row) => ({
      symbolId: row.symbol_id,
      ticker: row.ticker,
      symbolName: row.symbol_name,
      sleeveId: row.sleeve_id,
      sleeveName: row.sleeve_name,
      quantityMicros: row.quantity_micros,
      priceMicros: row.price_micros,
      amountMicros: row.amount_micros,
    }));
}

export function planSleeves(db, planId) {
  return db
    .prepare('SELECT * FROM plan_sleeve WHERE plan_id = ? ORDER BY sort_order, id')
    .all(planId)
    .map((row) => ({
      sleeveId: row.sleeve_id,
      name: row.name,
      targetBp: row.target_bp,
      valueBeforeMicros: row.value_before_micros,
      valueAfterMicros: row.value_after_micros,
      driftBeforeBp: row.drift_before_bp,
      driftAfterBp: row.drift_after_bp,
    }));
}

export function planFull(db, id) {
  const row = db.prepare('SELECT * FROM plan WHERE id = ?').get(id);
  if (!row) return null;
  return { ...planDto(row), items: planItems(db, id), sleeves: planSleeves(db, id) };
}

export function importDto(row) {
  return { id: row.id, filename: row.filename, rowCount: row.row_count, createdAt: row.created_at };
}

export function csvMoney(value, currency) {
  const decimals = currency === 'JPY' ? 0 : 2;
  const n = BigInt(value);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const factor = 10n ** BigInt(6 - decimals);
  const rounded = (abs + factor / 2n) / factor;
  const whole = rounded / 10n ** BigInt(decimals);
  const frac = decimals > 0 ? (rounded % 10n ** BigInt(decimals)).toString().padStart(decimals, '0') : '';
  return `${negative ? '-' : ''}${whole}${decimals > 0 ? `.${frac}` : ''}`;
}

export function csvFixed6(value) {
  return microsToDecimal(value, { decimals: 6, trim: false });
}
