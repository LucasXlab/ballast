import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = [{ version: 1, file: 'migrations/001_init.sql' }];

function iso(now) {
  return new Date(now()).toISOString();
}

function quoteSqlPath(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function backupDatabase(db, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  if (fs.existsSync(destination)) fs.rmSync(destination);
  db.exec(`VACUUM INTO ${quoteSqlPath(destination)}`);
  fs.chmodSync(destination, 0o600);
  return destination;
}

export function pruneBackups(dir, keep, prefix = 'backup-before-') {
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.sqlite'))
    .map((name) => {
      const full = path.join(dir, name);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => a.mtime - b.mtime);
  const remove = files.slice(0, Math.max(0, files.length - keep));
  for (const item of remove) fs.rmSync(item.full, { force: true });
  return files.slice(-keep).map((item) => item.full);
}

function listMigrations() {
  return MIGRATIONS.map((m) => ({
    version: m.version,
    sql: fs.readFileSync(path.join(HERE, m.file), 'utf8'),
  }));
}

function tableNames(db) {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
}

function acquireLock(dataDir) {
  const lockPath = path.join(dataDir, '.ballast.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeSync(fd, String(process.pid));
      return {
        release() {
          try { fs.closeSync(fd); } catch { /* 已关闭 */ }
          try { fs.unlinkSync(lockPath); } catch { /* 已删除 */ }
        },
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw new Error(`无法创建数据目录锁：${err.message}`);
      let pid = 0;
      try { pid = Number(fs.readFileSync(lockPath, 'utf8')); } catch { /* 读取失败按过期处理 */ }
      let alive = false;
      if (Number.isInteger(pid) && pid > 0) {
        if (pid === process.pid) alive = true;
        else {
          try { process.kill(pid, 0); alive = true; } catch { alive = false; }
        }
      }
      if (alive) throw new Error(`另一个 Ballast 进程（pid ${pid}）正在使用这个数据目录`);
      try { fs.unlinkSync(lockPath); } catch { /* 竞争中被删除 */ }
    }
  }
  throw new Error('无法获取数据目录锁');
}

export function openDatabase({ dataDir, backupKeep = 7, now = Date.now, log = console }) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const lock = acquireLock(dataDir);
  const dbPath = path.join(dataDir, 'ballast.sqlite');
  let db;
  try {
    db = new DatabaseSync(dbPath);
  } catch (err) {
    lock.release();
    throw err;
  }
  try {
    fs.chmodSync(dbPath, 0o600);
  } catch {
    // 非 POSIX 文件系统忽略。
  }
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');

  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const current = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get().v;
  const migrations = listMigrations();
  const pending = migrations.filter((m) => m.version > current);
  const existingTables = tableNames(db).filter((name) => name !== 'schema_migrations');
  const backupsDir = path.join(dataDir, 'backups');
  if (pending.length > 0 && existingTables.length > 0) {
    const stamp = iso(now).replaceAll(':', '').replaceAll('-', '').replace('.000Z', 'Z');
    const target = path.join(backupsDir, `backup-before-v${current}-${stamp}.sqlite`);
    try {
      fs.mkdirSync(backupsDir, { recursive: true, mode: 0o700 });
      fs.chmodSync(backupsDir, 0o700);
      backupDatabase(db, target);
      pruneBackups(backupsDir, backupKeep);
      log.info(`迁移前备份：${path.basename(target)}`);
    } catch (err) {
      db.close();
      lock.release();
      throw new Error(`迁移前备份失败，未迁移：${err.message}`);
    }
  }

  if (pending.length > 0) {
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const migration of pending) {
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, iso(now));
      }
      db.prepare("INSERT INTO meta(key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(
        String(migrations.at(-1)?.version ?? current),
      );
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // 已回滚。
      }
      db.close();
      lock.release();
      throw new Error(`数据库迁移失败：${err.message}`);
    }
  }

  return {
    db,
    dbPath,
    dataDir,
    close() {
      try {
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch {
        // 只读或已关闭时忽略。
      }
      db.close();
      lock.release();
    },
  };
}

export function getMeta(db, key) {
  return db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}

export function setMeta(db, key, value) {
  db.prepare('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

export function newId() {
  return crypto.randomUUID();
}

export { iso };
