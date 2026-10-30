import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { openDatabase, backupDatabase, newId } from './db/database.js';
import { buildPlan, hashPlanInputs, normalizeTicker, validTicker, PlanError } from './domain/plan.js';
import { MoneyError, parseDecimalToMicros, microsToDecimal, formatMoney } from './domain/money.js';
import { CsvError, parseCsv, sha256Text, toCsv } from './domain/csv.js';
import { seedDemo } from './domain/seed.js';
import { buildState, getAccounts, getPortfolio, getSleeves, getSymbols, getTransactions, positionRows, aggregatePositions, computePosition, computeSymbolQty, planDto, planFull, planItems, planSleeves, transactionDto, importDto, csvMoney, csvFixed6 } from './repo.js';
import { accountDto, sleeveDto, symbolDto, portfolioDto, iso, utcDate, utcStamp } from './domain/dto.js';
import { ApiError, bad, requireObject, textField, intField, boolField, dateField, asyncRoute } from './http.js';

const ALLOWED_CURRENCIES = ['CNY', 'USD', 'EUR', 'HKD', 'JPY', 'GBP'];
const ACCOUNT_KINDS = ['taxable', 'tax_advantaged', 'cash', 'other'];
const MAX_AMOUNT = 1_000_000_000_000;
const MAX_VALUE = 1_000_000_000_000_000;

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* */ }
    throw err;
  }
}

function ensureSetup(db) {
  if (!getPortfolio(db)) throw new ApiError(409, 'setup_incomplete', '尚未完成首次设置');
}

function pagination(query, defLimit = 50, maxLimit = 200) {
  const parse = (raw, fallback) => {
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(String(raw))) throw bad(raw === undefined ? null : 'limit', '分页参数必须是整数');
    return Number(String(raw));
  };
  const limit = parse(query.limit, defLimit);
  const offset = parse(query.offset, 0);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxLimit) throw bad('limit', `limit 必须是 1–${maxLimit}`);
  if (!Number.isSafeInteger(offset) || offset < 0) throw bad('offset', 'offset 必须 ≥0');
  return { limit, offset };
}

function positionForAccount(db, accountId, symbolId) {
  return computePosition(db, accountId, symbolId);
}

function planInputs(db) {
  const symbols = getSymbols(db).map((s) => ({
    id: s.id,
    ticker: s.ticker,
    name: s.name,
    sleeveId: s.sleeve_id,
    priceMicros: s.price_micros,
    priceAsOf: s.price_as_of,
    lotSizeMicros: s.lot_size_micros,
    archived: s.archived === 1,
  }));
  const sleeves = getSleeves(db).map((s) => ({ ...s, targetBp: s.target_bp, bandBp: s.band_bp, sortOrder: s.sort_order }));
  const positions = aggregatePositions(positionRows(db));
  return { symbols, sleeves, positions };
}

function currentHash(db, plan) {
  const inputs = planInputs(db);
  return hashPlanInputs({
    amountMicros: plan.amount_micros,
    minTradeMicros: plan.min_trade_micros,
    positions: new Map(inputs.positions.map((p) => [p.symbolId, p.quantityMicros])),
    symbols: inputs.symbols,
    sleeves: inputs.sleeves,
  });
}

function insertPlan(db, result, note, nowMs) {
  const existing = db.prepare('SELECT COUNT(*) AS n FROM plan').get().n;
  const id = newId();
  const createdAt = iso(nowMs);
  db.prepare(`INSERT INTO plan(id,amount_micros,min_trade_micros,status,algorithm_version,inputs_hash,total_before_micros,total_after_micros,planned_micros,cash_left_micros,max_drift_before_bp,max_drift_after_bp,warnings_json,note,created_at,executed_at,abandoned_at)
    VALUES (?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,NULL,NULL)`).run(
    id, result.amountMicros, result.minTradeMicros, result.algorithmVersion, result.inputsHash, result.totalBeforeMicros,
    result.totalAfterMicros, result.plannedMicros, result.cashLeftMicros, result.maxDriftBeforeBp, result.maxDriftAfterBp,
    JSON.stringify(result.warnings), note, createdAt,
  );
  const sleeveOrders = new Map();
  result.sleeves.forEach((sleeve, index) => {
    sleeveOrders.set(sleeve.sleeveId, index);
    db.prepare(`INSERT INTO plan_sleeve(id,plan_id,sleeve_id,name,target_bp,value_before_micros,value_after_micros,drift_before_bp,drift_after_bp,sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(newId(), id, sleeve.sleeveId, sleeve.name, sleeve.targetBp, sleeve.valueBeforeMicros, sleeve.valueAfterMicros, sleeve.driftBeforeBp, sleeve.driftAfterBp, index);
  });
  result.items.forEach((item, index) => {
    db.prepare(`INSERT INTO plan_item(id,plan_id,symbol_id,ticker,symbol_name,sleeve_id,sleeve_name,quantity_micros,price_micros,amount_micros,sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(newId(), id, item.symbolId, item.ticker, item.symbolName, item.sleeveId, item.sleeveName, item.quantityMicros, item.priceMicros, item.amountMicros, index);
  });
  return id;
}

function portfolioValueBigInt(db) {
  const rows = db.prepare(`SELECT account_id, symbol_id, SUM(CASE WHEN side = 'buy' THEN quantity_micros ELSE -quantity_micros END) AS qty FROM "transaction" GROUP BY account_id, symbol_id`).all();
  const prices = new Map(db.prepare('SELECT id, price_micros FROM symbol').all().map((s) => [s.id, s.price_micros]));
  let total = 0n;
  for (const row of rows) {
    const qty = BigInt(row.qty ?? 0);
    if (qty <= 0n) continue;
    total += (qty * BigInt(prices.get(row.symbol_id) ?? 0)) / 1_000_000n;
  }
  return total;
}

function assertPortfolioValue(db) {
  if (portfolioValueBigInt(db) > 1_000_000_000_000_000n) {
    throw bad('quantityMicros', '组合总市值超过 1e15 微单位上限');
  }
}

export function createApp({ config, now = Date.now, staticDir = null, dbHandle = null }) {
  const handle = dbHandle ?? openDatabase({ dataDir: config.dataDir, backupKeep: config.backupKeep, now, log: console });
  const db = handle.db;
  if (config.demo && !getPortfolio(db)) seedDemo(db, now());
  const app = express();
  app.disable('x-powered-by');
  app.locals.db = db;
  app.locals.handle = handle;
  app.locals.config = config;
  app.locals.now = now;
  app.locals.close = () => handle.close();

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use((req, res, next) => {
    const host = String(req.get('host') ?? '').toLowerCase();
    if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/.test(host)) return next(new ApiError(403, 'bad_host', '只接受本机地址访问'));
    next();
  });

  app.use((req, res, next) => {
    const write = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (!write) return next();
    const origin = req.get('origin');
    if (origin) {
      if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/.test(origin)) return next(new ApiError(403, 'bad_origin', '来源不被允许'));
    }
    const hasBody = Number(req.get('content-length') ?? 0) > 0 || Boolean(req.get('transfer-encoding'));
    if (hasBody && !(req.is('application/json') || req.is('application/*+json'))) {
      return next(new ApiError(415, 'unsupported_media_type', '写请求必须使用 application/json'));
    }
    return next();
  });

  app.use(express.json({ limit: '4mb', type: ['application/json', 'application/*+json'] }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, version: config.version, setupComplete: Boolean(getPortfolio(db)), demo: Boolean(config.demo), today: utcDate(now()) });
  });

  app.get('/api/state', (req, res) => res.json(buildState(db, now())));

  app.post('/api/setup', asyncRoute((req, res) => {
    ensureNotSetup(db);
    const body = requireObject(req.body);
    const portfolioName = textField(body.portfolioName, 'portfolioName', { min: 1, max: 60 });
    const baseCurrency = body.baseCurrency === undefined ? 'CNY' : String(body.baseCurrency);
    if (!ALLOWED_CURRENCIES.includes(baseCurrency)) throw new ApiError(400, 'invalid_currency', '币种不在允许范围', [{ field: 'baseCurrency', line: null, message: '币种非法', context: { value: baseCurrency } }]);
    const template = body.template;
    if (template !== 'three_sleeve' && template !== 'blank') throw bad('template', 'template 只能是 three_sleeve 或 blank');
    const at = iso(now());
    tx(db, () => {
      db.prepare('INSERT INTO portfolio(id,name,base_currency,created_at,updated_at) VALUES (?,?,?,?,?)').run('portfolio', portfolioName, baseCurrency, at, at);
      db.prepare('INSERT INTO account(id,name,kind,archived,sort_order,created_at,updated_at) VALUES (?,?,?,0,0,?,?)').run(newId(), '主账户', 'taxable', at, at);
      const sleeves = template === 'three_sleeve'
        ? [['股票', 6000, 500], ['债券', 3000, 300], ['现金', 1000, 200]]
        : [['默认', 10000, 500]];
      sleeves.forEach(([name, target, band], i) => {
        db.prepare('INSERT INTO sleeve(id,name,target_bp,band_bp,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(newId(), name, target, band, i, at, at);
      });
    });
    res.status(201).json(buildState(db, now()));
  }));

  app.put('/api/portfolio', asyncRoute((req, res) => {
    ensureSetup(db);
    const body = requireObject(req.body);
    if ('baseCurrency' in body) throw bad('baseCurrency', '基础币种不可修改');
    const name = textField(body.name, 'name', { min: 1, max: 60 });
    db.prepare('UPDATE portfolio SET name = ?, updated_at = ? WHERE id = ?').run(name, iso(now()), 'portfolio');
    res.json(portfolioDto(getPortfolio(db)));
  }));

  app.get('/api/accounts', asyncRoute((req, res) => {
    ensureSetup(db);
    res.json(getAccounts(db).map(accountDto));
  }));

  app.post('/api/accounts', asyncRoute((req, res) => {
    ensureSetup(db);
    const body = requireObject(req.body);
    const name = textField(body.name, 'name', { min: 1, max: 40 });
    const kind = body.kind ?? 'taxable';
    if (!ACCOUNT_KINDS.includes(kind)) throw bad('kind', '账户类型非法');
    const id = newId();
    const at = iso(now());
    try {
      tx(db, () => {
        const max = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS n FROM account').get().n;
        db.prepare('INSERT INTO account(id,name,kind,archived,sort_order,created_at,updated_at) VALUES (?,?,?,0,?,?,?)').run(id, name, kind, max + 1, at, at);
      });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw new ApiError(409, 'duplicate_account', '账户名称已存在');
      throw err;
    }
    res.status(201).json(accountDto(db.prepare('SELECT * FROM account WHERE id = ?').get(id)));
  }));

  app.patch('/api/accounts/:id', asyncRoute((req, res) => {
    ensureSetup(db);
    const row = db.prepare('SELECT * FROM account WHERE id = ?').get(req.params.id);
    if (!row) throw new ApiError(404, 'not_found', '账户不存在');
    const body = requireObject(req.body);
    const name = body.name === undefined ? row.name : textField(body.name, 'name', { min: 1, max: 40 });
    const kind = body.kind === undefined ? row.kind : String(body.kind);
    if (!ACCOUNT_KINDS.includes(kind)) throw bad('kind', '账户类型非法');
    const archived = body.archived === undefined ? row.archived : (boolField(body.archived, 'archived') ? 1 : 0);
    if (archived === 1 && row.archived === 0) {
      const active = db.prepare('SELECT COUNT(*) AS n FROM account WHERE archived = 0').get().n;
      if (active <= 1) throw new ApiError(409, 'last_account', '不能归档最后一个未归档账户');
    }
    try {
      tx(db, () => db.prepare('UPDATE account SET name = ?, kind = ?, archived = ?, updated_at = ? WHERE id = ?').run(name, kind, archived, iso(now()), row.id));
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw new ApiError(409, 'duplicate_account', '账户名称已存在');
      throw err;
    }
    res.json(accountDto(db.prepare('SELECT * FROM account WHERE id = ?').get(row.id)));
  }));

  app.delete('/api/accounts/:id', asyncRoute((req, res) => {
    ensureSetup(db);
    const row = db.prepare('SELECT * FROM account WHERE id = ?').get(req.params.id);
    if (!row) throw new ApiError(404, 'not_found', '账户不存在');
    const active = db.prepare('SELECT COUNT(*) AS n FROM account WHERE archived = 0').get().n;
    if (row.archived === 0 && active <= 1) throw new ApiError(409, 'last_account', '不能删除最后一个未归档账户');
    const used = db.prepare('SELECT COUNT(*) AS n FROM "transaction" WHERE account_id = ?').get(row.id).n;
    if (used > 0) throw new ApiError(409, 'account_has_transactions', '账户有交易记录，不能删除');
    db.prepare('DELETE FROM account WHERE id = ?').run(row.id);
    res.status(204).end();
  }));

  app.post('/api/sleeves', asyncRoute((req, res) => {
    ensureSetup(db);
    const body = requireObject(req.body);
    const name = textField(body.name, 'name', { min: 1, max: 30 });
    const targetBp = intField(body.targetBp, 'targetBp', 0, 10000);
    const bandBp = intField(body.bandBp ?? 500, 'bandBp', 0, 2000);
    const count = db.prepare('SELECT COUNT(*) AS n FROM sleeve').get().n;
    if (count >= 12) throw new ApiError(400, 'invalid_input', '分类最多 12 个', [{ field: 'name', line: null, message: '分类最多 12 个', context: {} }]);
    const sum = db.prepare('SELECT COALESCE(SUM(target_bp),0) AS n FROM sleeve').get().n;
    if (sum + targetBp > 10000) throw new ApiError(400, 'target_sum_exceeded', '目标比例合计超过 100%', [{ field: 'targetBp', line: null, message: '合计超过 100%', context: { currentSumBp: sum, maxBp: 10000 } }]);
    const id = newId();
    const at = iso(now());
    try {
      tx(db, () => {
        const order = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS n FROM sleeve').get().n;
        db.prepare('INSERT INTO sleeve(id,name,target_bp,band_bp,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, name, targetBp, bandBp, order + 1, at, at);
      });
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw new ApiError(409, 'duplicate_sleeve', '分类名称已存在');
      throw err;
    }
    res.status(201).json(sleeveDto(db.prepare('SELECT * FROM sleeve WHERE id = ?').get(id)));
  }));

  app.patch('/api/sleeves/:id', asyncRoute((req, res) => {
    ensureSetup(db);
    const row = db.prepare('SELECT * FROM sleeve WHERE id = ?').get(req.params.id);
    if (!row) throw new ApiError(404, 'not_found', '分类不存在');
    const body = requireObject(req.body);
    const name = body.name === undefined ? row.name : textField(body.name, 'name', { min: 1, max: 30 });
    const targetBp = body.targetBp === undefined ? row.target_bp : intField(body.targetBp, 'targetBp', 0, 10000);
    const bandBp = body.bandBp === undefined ? row.band_bp : intField(body.bandBp, 'bandBp', 0, 2000);
    const sum = db.prepare('SELECT COALESCE(SUM(target_bp),0) AS n FROM sleeve WHERE id <> ?').get(row.id).n;
    if (sum + targetBp > 10000) throw new ApiError(400, 'target_sum_exceeded', '目标比例合计超过 100%', [{ field: 'targetBp', line: null, message: '合计超过 100%', context: { currentSumBp: sum + targetBp, maxBp: 10000 } }]);
    try {
      tx(db, () => db.prepare('UPDATE sleeve SET name = ?, target_bp = ?, band_bp = ?, updated_at = ? WHERE id = ?').run(name, targetBp, bandBp, iso(now()), row.id));
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw new ApiError(409, 'duplicate_sleeve', '分类名称已存在');
      throw err;
    }
    res.json(sleeveDto(db.prepare('SELECT * FROM sleeve WHERE id = ?').get(row.id)));
  }));

  app.put('/api/targets', asyncRoute((req, res) => {
    ensureSetup(db);
    const body = requireObject(req.body);
    if (!Array.isArray(body.sleeves)) throw bad('sleeves', 'sleeves 必须是数组');
    const all = getSleeves(db);
    if (body.sleeves.length !== all.length) throw new ApiError(400, 'target_sum_mismatch', '必须包含全部分类');
    const ids = new Set(all.map((s) => s.id));
    const supplied = new Set();
    let sum = 0;
    const updates = body.sleeves.map((item) => {
      if (!item || typeof item !== 'object' || !ids.has(item.id) || supplied.has(item.id)) throw bad('sleeves', '分类 id 不匹配或重复');
      supplied.add(item.id);
      const targetBp = intField(item.targetBp, 'targetBp', 0, 10000);
      const bandBp = intField(item.bandBp, 'bandBp', 0, 2000);
      sum += targetBp;
      return { id: item.id, targetBp, bandBp };
    });
    if (sum !== 10000) throw new ApiError(400, 'target_sum_mismatch', '目标比例合计必须是 100%', [{ field: 'sleeves', line: null, message: '合计不是 100%', context: { sumBp: sum } }]);
    tx(db, () => {
      const at = iso(now());
      for (const item of updates) db.prepare('UPDATE sleeve SET target_bp = ?, band_bp = ?, updated_at = ? WHERE id = ?').run(item.targetBp, item.bandBp, at, item.id);
    });
    const state = buildState(db, now());
    res.json({ sleeves: state.sleeves, targets: state.targets });
  }));

  app.delete('/api/sleeves/:id', asyncRoute((req, res) => {
    ensureSetup(db);
    const row = db.prepare('SELECT * FROM sleeve WHERE id = ?').get(req.params.id);
    if (!row) throw new ApiError(404, 'not_found', '分类不存在');
    const count = db.prepare('SELECT COUNT(*) AS n FROM sleeve').get().n;
    if (count <= 1) throw new ApiError(409, 'last_sleeve', '不能删除最后一个分类');
    const used = db.prepare('SELECT COUNT(*) AS n FROM symbol WHERE sleeve_id = ?').get(row.id).n;
    if (used > 0) throw new ApiError(409, 'sleeve_has_symbols', '分类下还有代码，不能删除');
    db.prepare('DELETE FROM sleeve WHERE id = ?').run(row.id);
    res.status(204).end();
  }));

  app.post('/api/symbols', asyncRoute((req, res) => {
    ensureSetup(db);
    const body = requireObject(req.body);
    const ticker = normalizeTicker(body.ticker);
    if (!validTicker(ticker)) throw bad('ticker', 'ticker 必须是 1–20 位大写字母、数字、点或短横线');
    const name = textField(body.name, 'name', { min: 1, max: 60 });
    const sleeveId = textField(body.sleeveId, 'sleeveId', { min: 1, max: 64 });
    const sleeve = db.prepare('SELECT * FROM sleeve WHERE id = ?').get(sleeveId);
    if (!sleeve) throw new ApiError(404, 'not_found', '分类不存在');
    const lotSize = body.lotSizeMicros === undefined ? 1_000_000 : intField(body.lotSizeMicros, 'lotSizeMicros', 1_000_000, 1_000_000_000_000);
    if (lotSize % 1_000_000 !== 0) throw bad('lotSizeMicros', '每手份数必须是 1 份的整数倍');
    const price = body.priceMicros === undefined ? 0 : intField(body.priceMicros, 'priceMicros', 0, 1_000_000_000_000);
    let priceAsOf = null;
    if (price > 0) {
      priceAsOf = dateField(body.priceAsOf, 'priceAsOf', { code: 'invalid_price_date', max: tomorrow(now()) });
    } else if (body.priceAsOf !== undefined && body.priceAsOf !== null) {
      throw bad('priceAsOf', '没有价格时不能填写价格日期');
    }
    const id = newId();
    const at = iso(now());
    try {
      tx(db, () => db.prepare('INSERT INTO symbol(id,ticker,name,sleeve_id,currency,lot_size_micros,price_micros,price_as_of,archived,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?)').run(
        id, ticker, name, sleeve.id, getPortfolio(db).base_currency, lotSize, price, priceAsOf, at, at,
      ));
    } catch (err) {
      if (String(err.message).includes('UNIQUE')) throw new ApiError(409, 'duplicate_ticker', 'ticker 已存在');
      throw err;
    }
    res.status(201).json(symbolDto({ ...db.prepare('SELECT s.*, sl.name AS sleeve_name FROM symbol s JOIN sleeve sl ON sl.id = s.sleeve_id WHERE s.id = ?').get(id) }));
  }));

  app.patch('/api/symbols/:id', asyncRoute((req, res) => {
    ensureSetup(db);
    const row = db.prepare('SELECT * FROM symbol WHERE id = ?').get(req.params.id);
    if (!row) throw new ApiError(404, 'not_found', '代码不存在');
    const body = requireObject(req.body);
    const name = body.name === undefined ? row.name : textField(body.name, 'name', { min: 1, max: 60 });
    let sleeveId = row.sleeve_id;
    if (body.sleeveId !== undefined) {
      const nextSleeveId = textField(body.sleeveId, 'sleeveId', { min: 1, max: 64 });
      if (!db.prepare('SELECT id FROM sleeve WHERE id = ?').get(nextSleeveId)) throw new ApiError(404, 'not_found', '分类不存在');
      sleeveId = nextSleeveId;
    }
    const lotSize = body.lotSizeMicros === undefined ? row.lot_size_micros : intField(body.lotSizeMicros, 'lotSizeMicros', 1_000_000, 1_000_000_000_000);
    if (lotSize % 1_000_000 !== 0) throw bad('lotSizeMicros', '每手份数必须是 1 份的整数倍');
    const hasPrice = body.priceMicros !== undefined;
    const hasDate = body.priceAsOf !== undefined;
    let price = row.price_micros;
    let priceAsOf = row.price_as_of;
    if (hasPrice) {
      price = intField(body.priceMicros, 'priceMicros', 0, 1_000_000_000_000);
      if (price > 0 && !hasDate) throw bad('priceAsOf', '修改价格时必须同时给价格日期');
    }
    if (hasDate) {
      if (!hasPrice && price > 0) throw bad('priceAsOf', '只给日期不给价格');
      priceAsOf = body.priceAsOf === null ? null : dateField(body.priceAsOf, 'priceAsOf', { code: 'invalid_price_date', max: tomorrow(now()) });
    }
    if (price === 0) priceAsOf = null;
    const archived = body.archived === undefined ? row.archived : (boolField(body.archived, 'archived') ? 1 : 0);
    db.prepare('UPDATE symbol SET name = ?, sleeve_id = ?, lot_size_micros = ?, price_micros = ?, price_as_of = ?, archived = ?, updated_at = ? WHERE id = ?').run(name, sleeveId, lotSize, price, priceAsOf, archived, iso(now()), row.id);
    res.json(symbolDto(db.prepare('SELECT s.*, sl.name AS sleeve_name FROM symbol s JOIN sleeve sl ON sl.id = s.sleeve_id WHERE s.id = ?').get(row.id)));
  }));

  app.put('/api/prices', asyncRoute((req, res) => {
    ensureSetup(db);
    const body = requireObject(req.body);
    if (!Array.isArray(body.prices) || body.prices.length === 0 || body.prices.length > 200) throw bad('prices', 'prices 必须是 1–200 项的数组');
    const updates = body.prices.map((item, index) => {
      if (!item || typeof item !== 'object') throw bad('prices', '价格项必须是对象');
      const symbolId = textField(item.symbolId, 'symbolId', { min: 1, max: 64 });
      const symbol = db.prepare('SELECT * FROM symbol WHERE id = ?').get(symbolId);
      if (!symbol) throw new ApiError(404, 'not_found', '代码不存在', [{ field: 'prices', line: null, message: '代码不存在', context: { index } }]);
      const price = intField(item.priceMicros, 'priceMicros', 1, 1_000_000_000_000);
      const priceAsOf = dateField(item.priceAsOf, 'priceAsOf', { code: 'invalid_price_date', max: tomorrow(now()) });
      return { id: symbol.id, price, priceAsOf };
    });
    tx(db, () => {
      const at = iso(now());
      for (const item of updates) db.prepare('UPDATE symbol SET price_micros = ?, price_as_of = ?, updated_at = ? WHERE id = ?').run(item.price, item.priceAsOf, at, item.id);
      assertPortfolioValue(db);
    });
    res.json(updates.map((u) => symbolDto(db.prepare('SELECT s.*, sl.name AS sleeve_name FROM symbol s JOIN sleeve sl ON sl.id = s.sleeve_id WHERE s.id = ?').get(u.id))));
  }));

  app.delete('/api/symbols/:id', asyncRoute((req, res) => {
    ensureSetup(db);
    const row = db.prepare('SELECT * FROM symbol WHERE id = ?').get(req.params.id);
    if (!row) throw new ApiError(404, 'not_found', '代码不存在');
    const used = db.prepare('SELECT COUNT(*) AS n FROM "transaction" WHERE symbol_id = ?').get(row.id).n;
    if (used > 0) throw new ApiError(409, 'symbol_has_transactions', '代码有交易记录，不能删除；可以归档');
    db.prepare('DELETE FROM symbol WHERE id = ?').run(row.id);
    res.status(204).end();
  }));

  app.get('/api/transactions', asyncRoute((req, res) => {
    ensureSetup(db);
    const { limit, offset } = pagination(req.query, 50, 200);
    const all = getTransactions(db, { accountId: req.query.accountId || null, symbolId: req.query.symbolId || null, planId: req.query.planId || null });
    res.json({ total: all.length, items: all.slice(offset, offset + limit).map(transactionDto) });
  }));

  app.post('/api/transactions', asyncRoute((req, res) => {
    ensureSetup(db);
    const body = requireObject(req.body);
    const accountId = textField(body.accountId, 'accountId', { min: 1, max: 64 });
    const account = db.prepare('SELECT * FROM account WHERE id = ?').get(accountId);
    if (!account) throw new ApiError(404, 'not_found', '账户不存在');
    if (account.archived) throw new ApiError(409, 'account_archived', '账户已归档');
    const symbolId = textField(body.symbolId, 'symbolId', { min: 1, max: 64 });
    const symbol = db.prepare('SELECT * FROM symbol WHERE id = ?').get(symbolId);
    if (!symbol) throw new ApiError(404, 'not_found', '代码不存在');
    if (symbol.archived) throw new ApiError(409, 'symbol_archived', '代码已归档');
    const side = body.side;
    if (side !== 'buy' && side !== 'sell') throw bad('side', 'side 只能是 buy 或 sell');
    const quantity = intField(body.quantityMicros, 'quantityMicros', 1, 1_000_000_000_000_000);
    const price = intField(body.priceMicros, 'priceMicros', 1, 1_000_000_000_000);
    const fee = body.feeMicros === undefined ? 0 : intField(body.feeMicros, 'feeMicros', 0, 1_000_000_000_000);
    const tradedAt = dateField(body.tradedAt, 'tradedAt', { max: tomorrow(now()) });
    const note = body.note === undefined ? '' : textField(body.note, 'note', { min: 0, max: 200, trim: false });
    if ((BigInt(quantity) * BigInt(price)) / 1_000_000n > BigInt(MAX_VALUE)) throw bad('quantityMicros', '数量 × 价格超过金额上限');
    const id = newId();
    const at = iso(now());
    tx(db, () => {
      if (side === 'sell') {
        const current = computePosition(db, account.id, symbol.id).quantityMicros;
        if (quantity > current) throw new ApiError(409, 'insufficient_position', '卖出数量超过当前持仓', [{ field: 'quantityMicros', line: null, message: '持仓不足', context: { availableQuantityMicros: current } }]);
      }
      db.prepare('INSERT INTO "transaction"(id,account_id,symbol_id,side,quantity_micros,price_micros,fee_micros,traded_at,note,source,plan_id,import_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,\'manual\',NULL,NULL,?)').run(
        id, account.id, symbol.id, side, quantity, price, fee, tradedAt, note, at,
      );
      assertPortfolioValue(db);
    });
    res.status(201).json({ transaction: transactionDto(db.prepare('SELECT t.*, a.name AS account_name, s.ticker, s.name AS symbol_name FROM "transaction" t JOIN account a ON a.id=t.account_id JOIN symbol s ON s.id=t.symbol_id WHERE t.id=?').get(id)), position: positionForAccount(db, account.id, symbol.id) });
  }));

  app.delete('/api/transactions/:id', asyncRoute((req, res) => {
    ensureSetup(db);
    const row = db.prepare('SELECT * FROM "transaction" WHERE id = ?').get(req.params.id);
    if (!row) throw new ApiError(404, 'not_found', '交易不存在');
    if (row.source !== 'manual') throw new ApiError(409, 'system_transaction', '系统生成的交易不能删除');
    tx(db, () => {
      const current = computePosition(db, row.account_id, row.symbol_id).quantityMicros;
      const after = current - (row.side === 'buy' ? row.quantity_micros : -row.quantity_micros);
      if (after < 0) throw new ApiError(409, 'would_make_position_negative', '删除后持仓会变成负数');
      db.prepare('DELETE FROM "transaction" WHERE id = ?').run(row.id);
    });
    res.status(204).end();
  }));

  app.get('/api/imports/template', asyncRoute((req, res) => {
    ensureSetup(db);
    const csv = toCsv(['date', 'account', 'symbol', 'side', 'quantity', 'price', 'fee', 'note'], [['2026-01-05', '主账户', '510300', 'buy', '1000', '4.000000', '0', '首次定投']]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ballast-transactions-template.csv"');
    res.send(csv);
  }));

  app.post('/api/imports', asyncRoute((req, res) => {
    ensureSetup(db);
    const body = requireObject(req.body);
    const filename = textField(String(body.filename ?? '').split(/[\\/]/).pop(), 'filename', { min: 1, max: 200 });
    if (typeof body.csv !== 'string') throw bad('csv', 'csv 必须是字符串');
    const bytes = Buffer.byteLength(body.csv, 'utf8');
    if (bytes > 1_000_000) throw new ApiError(400, 'file_too_large', 'CSV 超过 1,000,000 字节', [{ field: 'csv', line: null, message: '文件过大', context: { bytes, maxBytes: 1_000_000 } }]);
    let parsed;
    try {
      parsed = parseCsv(body.csv);
    } catch (err) {
      if (err instanceof CsvError) throw new ApiError(400, 'invalid_csv', 'CSV 格式错误', err.details.map((d) => ({ field: null, line: d.line ?? null, message: d.message, context: {} })));
      throw err;
    }
    const expected = ['date', 'account', 'symbol', 'side', 'quantity', 'price', 'fee', 'note'];
    if (parsed.header.length !== 8 || parsed.header.some((h, i) => h !== expected[i])) {
      throw new ApiError(400, 'invalid_csv', 'CSV 表头不正确', [{ field: null, line: 1, message: '表头必须是 date,account,symbol,side,quantity,price,fee,note', context: {} }]);
    }
    if (parsed.rows.length === 0) throw new ApiError(400, 'invalid_csv', 'CSV 没有数据行', [{ field: null, line: 1, message: '没有数据行', context: {} }]);
    if (parsed.rows.length > 5000) throw new ApiError(400, 'too_many_rows', 'CSV 数据行超过 5000', [{ field: null, line: null, message: '行数过多', context: { rows: parsed.rows.length, maxRows: 5000 } }]);
    const sha = sha256Text(body.csv);
    const dup = db.prepare('SELECT * FROM import WHERE sha256 = ?').get(sha);
    if (dup) throw new ApiError(409, 'duplicate_import', '这个 CSV 已经导入过', [{ field: null, line: null, message: '重复导入', context: { importId: dup.id, createdAt: dup.created_at } }]);
    const accounts = new Map(getAccounts(db).map((a) => [a.name.toLowerCase(), a]));
    const symbols = new Map(getSymbols(db).map((s) => [s.ticker.toLowerCase(), s]));
    const existing = new Map();
    for (const t of getTransactions(db)) {
      const key = `${t.account_id}\u0000${t.symbol_id}`;
      existing.set(key, (existing.get(key) ?? 0) + (t.side === 'buy' ? t.quantity_micros : -t.quantity_micros));
    }
    const errors = [];
    const entries = [];
    const seen = new Set();
    for (const row of parsed.rows) {
      if (errors.length >= 20) break;
      const [date, accountName, tickerRaw, side, qtyRaw, priceRaw, feeRaw, note] = row.fields;
      const rowErrors = [];
      const add = (message) => rowErrors.push({ field: null, line: row.line, message, context: {} });
      if (row.fields.length !== 8) add(`需要 8 列，实际 ${row.fields.length} 列`);
      const account = accounts.get(String(accountName).toLowerCase());
      if (!account) add('账户不存在');
      else if (account.archived) add('账户已归档');
      const symbol = symbols.get(String(tickerRaw).toLowerCase());
      if (!symbol) add('代码不存在');
      else if (symbol.archived) add('代码已归档');
      if (side !== 'buy' && side !== 'sell') add('side 必须是 buy 或 sell');
      let qty = 0; let price = 0; let fee = 0;
      const parseNum = (raw, field, { allowZero = false } = {}) => {
        if (!/^\d+(\.\d{1,6})?$/.test(String(raw))) { add(`${field} 必须是最多 6 位小数的非负数字`); return 0; }
        try {
          const value = parseDecimalToMicros(String(raw), { max: MAX_VALUE, field });
          if (!allowZero && value <= 0) add(`${field} 必须大于 0`);
          return value;
        } catch { add(`${field} 超出范围`); return 0; }
      };
      qty = parseNum(qtyRaw, 'quantity');
      price = parseNum(priceRaw, 'price');
      fee = parseNum(feeRaw, 'fee', { allowZero: true });
      let tradedAt = date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) add('date 格式错误');
      else {
        try { dateField(date, 'date', { max: tomorrow(now()) }); } catch (err) { add(err.message); }
      }
      const checkKey = row.fields.map((f) => String(f).trim()).join('\u0000');
      if (seen.has(checkKey)) add('重复行');
      seen.add(checkKey);
      if (account && symbol && side && qty > 0 && price > 0 && rowErrors.length === 0) {
        const key = `${account.id}\u0000${symbol.id}`;
        const next = (existing.get(key) ?? 0) + (side === 'buy' ? qty : -qty);
        if (next < 0) add('卖出超过当前持仓');
        existing.set(key, next);
        if ((BigInt(qty) * BigInt(price)) / 1_000_000n > BigInt(MAX_VALUE)) add('数量 × 价格超过金额上限');
        entries.push({ accountId: account.id, symbolId: symbol.id, side, quantity: qty, price, fee, tradedAt, note: String(note).slice(0, 200) });
      }
      if (rowErrors.length > 0) errors.push(...rowErrors);
    }
    if (errors.length > 0) throw new ApiError(400, 'invalid_csv', 'CSV 有错误，整个文件未导入', errors.slice(0, 20));
    const importId = newId();
    const at = iso(now());
    tx(db, () => {
      db.prepare('INSERT INTO import(id,kind,filename,sha256,row_count,created_at) VALUES (?,\'transactions\',?,?,?,?)').run(importId, filename, sha, entries.length, at);
      for (const e of entries) {
        db.prepare('INSERT INTO "transaction"(id,account_id,symbol_id,side,quantity_micros,price_micros,fee_micros,traded_at,note,source,plan_id,import_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,\'import\',NULL,?,?)').run(newId(), e.accountId, e.symbolId, e.side, e.quantity, e.price, e.fee, e.tradedAt, e.note, importId, at);
      }
      assertPortfolioValue(db);
    });
    res.status(201).json({ import: importDto(db.prepare('SELECT * FROM import WHERE id = ?').get(importId)), importedRows: entries.length });
  }));

  app.get('/api/imports', asyncRoute((req, res) => {
    ensureSetup(db);
    const { limit, offset } = pagination(req.query, 20, 100);
    const all = db.prepare('SELECT * FROM import ORDER BY created_at DESC, id ASC').all();
    res.json({ total: all.length, items: all.slice(offset, offset + limit).map(importDto) });
  }));

  app.get('/api/export/transactions.csv', asyncRoute((req, res) => {
    ensureSetup(db);
    const rows = getTransactions(db).map((t) => [t.traded_at, t.account_name, t.ticker, t.side, csvFixed6(t.quantity_micros), csvFixed6(t.price_micros), csvFixed6(t.fee_micros), t.note]);
    const csv = toCsv(['date', 'account', 'symbol', 'side', 'quantity', 'price', 'fee', 'note'], rows, { protectFormula: true });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ballast-transactions-${utcStamp(now()).slice(0, 8)}.csv"`);
    res.send(csv);
  }));

  app.get('/api/export/positions.csv', asyncRoute((req, res) => {
    ensureSetup(db);
    const currency = getPortfolio(db).base_currency;
    const rows = positionRows(db).slice().sort((a, b) => a.accountName.localeCompare(b.accountName, 'zh-CN') || a.ticker.localeCompare(b.ticker, 'zh-CN') || a.symbolId.localeCompare(b.symbolId)).map((p) => [p.accountName, p.ticker, p.name, p.sleeveName, csvFixed6(p.quantityMicros), csvFixed6(p.avgCostMicros), csvFixed6(p.priceMicros), p.priceAsOf ?? '', csvMoney(p.marketValueMicros, currency), csvMoney(p.unrealizedMicros, currency)]);
    const csv = toCsv(['account', 'symbol', 'name', 'sleeve', 'quantity', 'avg_cost', 'price', 'price_as_of', 'market_value', 'unrealized'], rows, { protectFormula: true });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ballast-positions-${utcStamp(now()).slice(0, 8)}.csv"`);
    res.send(csv);
  }));

  app.post('/api/plans', asyncRoute((req, res) => {
    ensureSetup(db);
    const body = requireObject(req.body);
    const amountMicros = intField(body.amountMicros, 'amountMicros', 1, MAX_AMOUNT);
    const minTradeMicros = body.minTradeMicros === undefined ? 0 : intField(body.minTradeMicros, 'minTradeMicros', 0, 10_000_000_000);
    const note = body.note === undefined ? '' : textField(body.note, 'note', { min: 0, max: 200, trim: false });
    const inputs = planInputs(db);
    const result = buildPlan({ positions: inputs.positions, symbols: inputs.symbols, sleeves: inputs.sleeves, amountMicros, minTradeMicros, nowMs: now() });
    const id = tx(db, () => insertPlan(db, result, note, now()));
    res.status(201).json(planFull(db, id));
  }));

  app.get('/api/plans', asyncRoute((req, res) => {
    ensureSetup(db);
    const { limit, offset } = pagination(req.query, 20, 100);
    const all = db.prepare('SELECT * FROM plan ORDER BY created_at DESC, id ASC').all();
    res.json({
      total: all.length,
      items: all.slice(offset, offset + limit).map((row) => ({
        id: row.id, status: row.status, amountMicros: row.amount_micros, plannedMicros: row.planned_micros,
        cashLeftMicros: row.cash_left_micros, maxDriftBeforeBp: row.max_drift_before_bp, maxDriftAfterBp: row.max_drift_after_bp,
        createdAt: row.created_at, executedAt: row.executed_at,
      })),
    });
  }));

  app.get('/api/plans/:id', asyncRoute((req, res) => {
    ensureSetup(db);
    const plan = planFull(db, req.params.id);
    if (!plan) throw new ApiError(404, 'not_found', '计划不存在');
    if (plan.status === 'draft') {
      const row = db.prepare('SELECT * FROM plan WHERE id = ?').get(plan.id);
      plan.stale = currentHash(db, row) !== row.inputs_hash;
    }
    res.json(plan);
  }));

  app.post('/api/plans/:id/execute', asyncRoute((req, res) => {
    ensureSetup(db);
    const body = requireObject(req.body);
    const accountId = textField(body.accountId, 'accountId', { min: 1, max: 64 });
    const account = db.prepare('SELECT * FROM account WHERE id = ?').get(accountId);
    if (!account) throw new ApiError(404, 'not_found', '账户不存在');
    if (account.archived) throw new ApiError(409, 'account_archived', '账户已归档');
    const tradedAt = dateField(body.tradedAt, 'tradedAt', { max: tomorrow(now()) });
    const extraNote = body.note === undefined ? '' : textField(body.note, 'note', { min: 0, max: 200, trim: false });
    let planRow;
    const created = tx(db, () => {
      planRow = db.prepare('SELECT * FROM plan WHERE id = ?').get(req.params.id);
      if (!planRow) throw new ApiError(404, 'not_found', '计划不存在');
      if (planRow.status !== 'draft') throw new ApiError(409, 'plan_not_draft', '计划不是草稿，不能执行');
      if (currentHash(db, planRow) !== planRow.inputs_hash) throw new ApiError(409, 'plan_stale', '计划生成后数据变了，请重新生成');
      const items = db.prepare('SELECT * FROM plan_item WHERE plan_id = ? ORDER BY sort_order').all(planRow.id);
      if (items.length === 0) throw new ApiError(422, 'amount_too_small', '计划没有买入项');
      const at = iso(now());
      const note = [planRow.note, extraNote].filter(Boolean).join(' · ');
      if ([...note].length > 200) throw bad('note', '计划备注和执行备注合计不能超过 200 字');
      const ids = [];
      for (const item of items) {
        const id = newId();
        ids.push(id);
        db.prepare('INSERT INTO "transaction"(id,account_id,symbol_id,side,quantity_micros,price_micros,fee_micros,traded_at,note,source,plan_id,import_id,created_at) VALUES (?,?,?,?,?,?,0,?,?,\'plan\',?,NULL,?)').run(id, account.id, item.symbol_id, 'buy', item.quantity_micros, item.price_micros, tradedAt, note, planRow.id, at);
      }
      db.prepare('UPDATE plan SET status = \'executed\', executed_at = ?, account_id = ? WHERE id = ?').run(at, account.id, planRow.id);
      return ids;
    });
    const transactions = created.map((id) => transactionDto(db.prepare('SELECT t.*, a.name AS account_name, s.ticker, s.name AS symbol_name FROM "transaction" t JOIN account a ON a.id=t.account_id JOIN symbol s ON s.id=t.symbol_id WHERE t.id=?').get(id)));
    res.json({ plan: planFull(db, planRow.id), transactions });
  }));

  app.post('/api/plans/:id/abandon', asyncRoute((req, res) => {
    ensureSetup(db);
    const row = db.prepare('SELECT * FROM plan WHERE id = ?').get(req.params.id);
    if (!row) throw new ApiError(404, 'not_found', '计划不存在');
    if (row.status !== 'draft') throw new ApiError(409, 'plan_not_draft', '计划不是草稿，不能放弃');
    db.prepare('UPDATE plan SET status = \'abandoned\', abandoned_at = ? WHERE id = ?').run(iso(now()), row.id);
    res.json(planFull(db, row.id));
  }));

  app.delete('/api/plans/:id', asyncRoute((req, res) => {
    ensureSetup(db);
    const row = db.prepare('SELECT * FROM plan WHERE id = ?').get(req.params.id);
    if (!row) throw new ApiError(404, 'not_found', '计划不存在');
    if (row.status !== 'draft') throw new ApiError(409, 'plan_not_draft', '只有草稿计划可以删除');
    db.prepare('DELETE FROM plan WHERE id = ?').run(row.id);
    res.status(204).end();
  }));

  app.post('/api/backup', asyncRoute((req, res, next) => {
    ensureSetup(db);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ballast-backup-'));
    const stamp = utcStamp(now()).replace(/[-:]/g, '').replace('T', '-').replace('Z', '').slice(0, 15);
    const file = path.join(dir, 'backup.sqlite');
    try {
      backupDatabase(db, file);
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new ApiError(500, 'backup_failed', '备份失败，请查看服务日志');
    }
    res.setHeader('Content-Type', 'application/vnd.sqlite3');
    res.download(file, `ballast-backup-${stamp}.sqlite`, (err) => {
      fs.rmSync(dir, { recursive: true, force: true });
      if (err && !res.headersSent) next(err);
    });
  }));

  app.post('/api/demo/reload', asyncRoute((req, res) => {
    if (!config.demo) throw new ApiError(403, 'demo_disabled', '示例模式未开启');
    const body = requireObject(req.body);
    if (body.confirm !== 'RELOAD') throw new ApiError(400, 'bad_confirm', '确认文字必须是 RELOAD');
    seedDemo(db, now());
    res.json(buildState(db, now()));
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在', code: 'not_found' }));

  const dist = path.resolve(staticDir ?? path.resolve(process.cwd(), 'web/dist'));
  const dataReal = path.resolve(config.dataDir);
  if (dataReal === dist || dataReal.startsWith(dist + path.sep)) {
    throw new Error('数据目录不能位于前端静态目录内');
  }
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist, { index: false }));
    app.get(/.*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    app.get('/', (req, res) => res.status(503).json({ error: '前端尚未构建，运行 npm run build', code: 'web_not_built' }));
  }

  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message, code: err.code, details: err.details ?? [] });
    if (err instanceof PlanError) {
      return res.status(err.status).json({
        error: err.message, code: err.code,
        details: (err.details ?? []).map((d) => ({ field: null, line: null, message: err.message, context: d })),
      });
    }
    if (err instanceof MoneyError) return res.status(400).json({ error: err.message, code: 'invalid_input', details: [] });
    if (err instanceof CsvError) return res.status(400).json({ error: err.message, code: 'invalid_csv', details: err.details ?? [] });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON 解析失败', code: 'invalid_json', details: [] });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: '请求体超过 4MB', code: 'payload_too_large', details: [] });
    if (String(err?.message ?? '').includes('UNIQUE constraint')) return res.status(409).json({ error: '记录已存在', code: 'duplicate', details: [] });
    console.error(err);
    return res.status(500).json({ error: '服务内部错误', code: 'internal_error', details: [] });
  });

  return app;
}

function ensureNotSetup(db) {
  if (getPortfolio(db)) throw new ApiError(409, 'already_setup', '已经完成首次设置');
}

function tomorrow(nowMs) {
  const d = new Date(nowMs + 86_400_000);
  return d.toISOString().slice(0, 10);
}
