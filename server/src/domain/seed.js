import { newId } from '../db/database.js';
import { iso, utcDate } from './dto.js';

function monthDate(nowMs, offset, day = 5) {
  const d = new Date(nowMs);
  return utcDate(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, day, 12));
}

export const DEMO_TRANSACTIONS = [
  { ticker: '510300', account: '工资卡定投', offset: -11, day: 5, qty: 1000000000, price: 3900000 },
  { ticker: '513100', account: '工资卡定投', offset: -10, day: 5, qty: 3000000000, price: 1700000 },
  { ticker: '510300', account: '工资卡定投', offset: -9, day: 5, qty: 1000000000, price: 4000000 },
  { ticker: '511010', account: '养老金账户', offset: -8, day: 5, qty: 100000000, price: 118000000 },
  { ticker: '510300', account: '工资卡定投', offset: -7, day: 5, qty: 500000000, price: 3800000 },
  { ticker: '513100', account: '养老金账户', offset: -6, day: 5, qty: 2000000000, price: 1800000 },
  { ticker: '511880', account: '养老金账户', offset: -6, day: 20, qty: 200000000, price: 100000000 },
  { ticker: '510300', account: '工资卡定投', offset: -5, day: 5, qty: 1000000000, price: 4100000 },
  { ticker: '513100', account: '工资卡定投', offset: -4, day: 5, qty: 2000000000, price: 1900000 },
  { ticker: '510300', account: '工资卡定投', offset: -3, day: 5, qty: 500000000, price: 4200000 },
  { ticker: '511010', account: '养老金账户', offset: -2, day: 5, qty: 100000000, price: 119000000 },
  { ticker: '511880', account: '养老金账户', offset: -1, day: 5, qty: 200000000, price: 100000000 },
];

export function seedDemo(db, nowMs = Date.now()) {
  const now = iso(nowMs);
  const today = utcDate(nowMs);
  const yesterday = utcDate(nowMs - 86_400_000);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of ['"transaction"', 'plan_item', 'plan_sleeve', 'plan', 'import', 'symbol', 'sleeve', 'account', 'portfolio']) {
      db.exec(`DELETE FROM ${table}`);
    }
    db.exec('DELETE FROM meta');
    db.prepare('INSERT INTO portfolio(id,name,base_currency,created_at,updated_at) VALUES (?,?,?,?,?)').run('portfolio', '示例组合', 'CNY', now, now);
    const accounts = {};
    for (const [name, kind, sort] of [['工资卡定投', 'taxable', 0], ['养老金账户', 'tax_advantaged', 1]]) {
      const id = newId();
      accounts[name] = id;
      db.prepare('INSERT INTO account(id,name,kind,archived,sort_order,created_at,updated_at) VALUES (?,?,?,0,?,?,?)').run(id, name, kind, sort, now, now);
    }
    const sleeves = {};
    for (const [name, target, band, sort] of [['股票', 6000, 500, 0], ['债券', 3000, 300, 1], ['现金', 1000, 200, 2]]) {
      const id = newId();
      sleeves[name] = id;
      db.prepare('INSERT INTO sleeve(id,name,target_bp,band_bp,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, name, target, band, sort, now, now);
    }
    const symbols = {};
    for (const [ticker, name, sleeve, lot, price] of [
      ['510300', '沪深300ETF', '股票', 100000000, 4123000],
      ['513100', '纳指ETF', '股票', 100000000, 1876000],
      ['511010', '国债ETF', '债券', 10000000, 121456000],
      ['511880', '银华日利', '现金', 100000000, 100123000],
    ]) {
      const id = newId();
      symbols[ticker] = id;
      db.prepare('INSERT INTO symbol(id,ticker,name,sleeve_id,currency,lot_size_micros,price_micros,price_as_of,archived,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,0,?,?)').run(id, ticker, name, sleeves[sleeve], 'CNY', lot, price, yesterday, now, now);
    }
    for (const row of DEMO_TRANSACTIONS) {
      db.prepare('INSERT INTO "transaction"(id,account_id,symbol_id,side,quantity_micros,price_micros,fee_micros,traded_at,note,source,plan_id,import_id,created_at) VALUES (?,?,?,?,?,?,0,?,?,?,NULL,NULL,?)').run(
        newId(), accounts[row.account], symbols[row.ticker], 'buy', row.qty, row.price, monthDate(nowMs, row.offset, row.day), '', 'manual', now,
      );
    }
    db.prepare("INSERT INTO meta(key,value) VALUES ('demo_seeded','1')").run();
    db.prepare("INSERT INTO meta(key,value) VALUES ('schema_version','1')").run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function demoExpected() {
  return { totalBeforeMicros: 93_964_000_000, positionCount: 4 };
}
