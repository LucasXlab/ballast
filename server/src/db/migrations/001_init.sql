CREATE TABLE portfolio (
  id TEXT PRIMARY KEY CHECK (id = 'portfolio'),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  base_currency TEXT NOT NULL CHECK (base_currency IN ('CNY','USD','EUR','HKD','JPY','GBP')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE account (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  kind TEXT NOT NULL CHECK (kind IN ('taxable','tax_advantaged','cash','other')),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX account_name_unique ON account(lower(name));

CREATE TABLE sleeve (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 30),
  target_bp INTEGER NOT NULL CHECK (target_bp BETWEEN 0 AND 10000),
  band_bp INTEGER NOT NULL DEFAULT 500 CHECK (band_bp BETWEEN 0 AND 2000),
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 10000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX sleeve_name_unique ON sleeve(lower(name));

CREATE TABLE symbol (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL CHECK (length(ticker) BETWEEN 1 AND 20),
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
  sleeve_id TEXT NOT NULL REFERENCES sleeve(id) ON DELETE RESTRICT,
  currency TEXT NOT NULL CHECK (currency IN ('CNY','USD','EUR','HKD','JPY','GBP')),
  lot_size_micros INTEGER NOT NULL DEFAULT 1000000 CHECK (lot_size_micros BETWEEN 1000000 AND 1000000000000),
  price_micros INTEGER NOT NULL DEFAULT 0 CHECK (price_micros BETWEEN 0 AND 1000000000000),
  price_as_of TEXT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((price_micros = 0 AND price_as_of IS NULL) OR (price_micros > 0 AND price_as_of IS NOT NULL))
);
CREATE UNIQUE INDEX symbol_ticker_unique ON symbol(lower(ticker));
CREATE INDEX symbol_sleeve_idx ON symbol(sleeve_id);

CREATE TABLE plan (
  id TEXT PRIMARY KEY,
  amount_micros INTEGER NOT NULL CHECK (amount_micros BETWEEN 1 AND 1000000000000),
  min_trade_micros INTEGER NOT NULL DEFAULT 0 CHECK (min_trade_micros BETWEEN 0 AND 10000000000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','executed','abandoned')),
  algorithm_version TEXT NOT NULL DEFAULT 'greedy-v1',
  inputs_hash TEXT NOT NULL,
  total_before_micros INTEGER NOT NULL CHECK (total_before_micros >= 0),
  total_after_micros INTEGER NOT NULL CHECK (total_after_micros >= 0),
  planned_micros INTEGER NOT NULL CHECK (planned_micros >= 0),
  cash_left_micros INTEGER NOT NULL CHECK (cash_left_micros >= 0),
  max_drift_before_bp INTEGER NOT NULL,
  max_drift_after_bp INTEGER NOT NULL,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  created_at TEXT NOT NULL,
  executed_at TEXT,
  abandoned_at TEXT,
  account_id TEXT REFERENCES account(id)
);
CREATE INDEX plan_created_idx ON plan(created_at DESC);

CREATE TABLE plan_item (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  symbol_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  symbol_name TEXT NOT NULL,
  sleeve_id TEXT NOT NULL,
  sleeve_name TEXT NOT NULL,
  quantity_micros INTEGER NOT NULL CHECK (quantity_micros > 0),
  price_micros INTEGER NOT NULL CHECK (price_micros > 0),
  amount_micros INTEGER NOT NULL CHECK (amount_micros > 0),
  sort_order INTEGER NOT NULL
);
CREATE INDEX plan_item_plan_idx ON plan_item(plan_id);

CREATE TABLE plan_sleeve (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  sleeve_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_bp INTEGER NOT NULL,
  value_before_micros INTEGER NOT NULL,
  value_after_micros INTEGER NOT NULL,
  drift_before_bp INTEGER NOT NULL,
  drift_after_bp INTEGER NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE INDEX plan_sleeve_plan_idx ON plan_sleeve(plan_id);

CREATE TABLE import (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind = 'transactions'),
  filename TEXT NOT NULL CHECK (length(filename) BETWEEN 1 AND 200),
  sha256 TEXT NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count BETWEEN 1 AND 5000),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX import_sha_unique ON import(sha256);

CREATE TABLE "transaction" (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account(id) ON DELETE RESTRICT,
  symbol_id TEXT NOT NULL REFERENCES symbol(id) ON DELETE RESTRICT,
  side TEXT NOT NULL CHECK (side IN ('buy','sell')),
  quantity_micros INTEGER NOT NULL CHECK (quantity_micros BETWEEN 1 AND 1000000000000000),
  price_micros INTEGER NOT NULL CHECK (price_micros BETWEEN 1 AND 1000000000000),
  fee_micros INTEGER NOT NULL DEFAULT 0 CHECK (fee_micros BETWEEN 0 AND 1000000000000),
  traded_at TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '' CHECK (length(note) <= 200),
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','plan')),
  plan_id TEXT REFERENCES plan(id) ON DELETE RESTRICT,
  import_id TEXT REFERENCES import(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  CHECK ((source = 'plan' AND plan_id IS NOT NULL) OR (source <> 'plan' AND plan_id IS NULL)),
  CHECK ((source = 'import' AND import_id IS NOT NULL) OR (source <> 'import' AND import_id IS NULL))
);
CREATE INDEX transaction_account_idx ON "transaction"(account_id);
CREATE INDEX transaction_symbol_idx ON "transaction"(symbol_id);
CREATE INDEX transaction_traded_idx ON "transaction"(traded_at DESC, created_at DESC);

CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
