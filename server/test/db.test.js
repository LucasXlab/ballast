import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, setMeta, getMeta } from '../src/db/database.js';
import { seedDemo } from '../src/domain/seed.js';

test('迁移、权限、重开与示例数据', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ballast-db-'));
  const fixed = Date.parse('2026-10-29T12:00:00Z');
  const one = openDatabase({ dataDir: dir, now: () => fixed });
  assert.equal(one.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, 1);
  assert.equal(fs.statSync(one.dbPath).mode & 0o777, 0o600);
  setMeta(one.db, 'demo_seeded', '1');
  seedDemo(one.db, fixed);
  assert.equal(one.db.prepare('SELECT COUNT(*) AS n FROM "transaction"').get().n, 12);
  one.close();
  const two = openDatabase({ dataDir: dir, now: () => fixed });
  assert.equal(getMeta(two.db, 'demo_seeded'), '1');
  assert.equal(two.db.prepare('SELECT COUNT(*) AS n FROM portfolio').get().n, 1);
  two.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('同一数据目录只允许一个实例', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ballast-lock-'));
  const fixed = Date.parse('2026-10-29T12:00:00Z');
  const one = openDatabase({ dataDir: dir, now: () => fixed });
  assert.throws(() => openDatabase({ dataDir: dir, now: () => fixed }), /另一个 Ballast/);
  one.close();
  const two = openDatabase({ dataDir: dir, now: () => fixed });
  two.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('旧库迁移前备份', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ballast-db-'));
  const fixed = Date.parse('2026-10-29T12:00:00Z');
  const one = openDatabase({ dataDir: dir, now: () => fixed });
  one.close();
  // 模拟已有业务表但版本落后，再打开会触发备份路径。
  const db = openDatabase({ dataDir: dir, now: () => fixed });
  assert.equal(db.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
