import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs, loadConfig, ConfigError, ArgsError } from '../src/config.js';

test('命令行解析与错误', () => {
  assert.deepEqual(parseArgs(['--port', '9000', '--data-dir', '/tmp/x']), { help: false, version: false, port: '9000', dataDir: '/tmp/x' });
  assert.throws(() => parseArgs(['--nope']), ArgsError);
  assert.throws(() => parseArgs(['--port']), ArgsError);
});

test('配置默认值与校验', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ballast-config-'));
  const config = loadConfig({ BALLAST_DATA_DIR: dir });
  assert.equal(config.port, 8787);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.logLevel, 'info');
  assert.equal(config.demo, false);
  assert.equal(config.backupKeep, 7);
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  assert.throws(() => loadConfig({ BALLAST_DATA_DIR: dir, BALLAST_PORT: '0' }), ConfigError);
  assert.throws(() => loadConfig({ BALLAST_DATA_DIR: dir, BALLAST_HOST: '0.0.0.0' }), ConfigError);
  assert.throws(() => loadConfig({ BALLAST_DATA_DIR: dir, BALLAST_LOG_LEVEL: 'debug' }), ConfigError);
  assert.throws(() => loadConfig({ BALLAST_DATA_DIR: dir, BALLAST_BACKUP_KEEP: '0' }), ConfigError);
  const existing = fs.mkdtempSync(path.join(os.tmpdir(), 'ballast-shared-'));
  fs.chmodSync(existing, 0o755);
  loadConfig({ BALLAST_DATA_DIR: existing });
  assert.equal(fs.statSync(existing).mode & 0o777, 0o755, '已存在目录不应被强制改权限');
  fs.rmSync(existing, { recursive: true, force: true });
  if (!fs.existsSync('/.dockerenv') && !fs.existsSync('/run/.containerenv')) {
    assert.throws(() => loadConfig({ BALLAST_DATA_DIR: dir, BALLAST_DOCKER: '1', BALLAST_HOST: '0.0.0.0' }), ConfigError);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
