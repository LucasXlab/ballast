import fs from 'node:fs';
import path from 'node:path';

export const CURRENCIES = ['CNY', 'USD', 'EUR', 'HKD', 'JPY', 'GBP'];
export const LOG_LEVELS = ['info', 'warn', 'error'];

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
    this.exitCode = 2;
  }
}

export class ArgsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ArgsError';
    this.exitCode = 2;
  }
}

function intInRange(raw, name, min, max) {
  if (!/^\d+$/.test(raw)) throw new ConfigError(`${name} 必须是 ${min}–${max} 的整数，当前值 "${raw.slice(0, 40)}"`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new ConfigError(`${name} 必须是 ${min}–${max} 的整数，当前值 "${raw.slice(0, 40)}"`);
  }
  return n;
}

export function parseArgs(argv) {
  const out = { help: false, version: false, port: undefined, dataDir: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }
    if (arg === '--version' || arg === '-v') {
      out.version = true;
      continue;
    }
    if (arg === '--port' || arg === '--data-dir') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new ArgsError(`${arg} 缺少值`);
      i += 1;
      if (arg === '--port') out.port = value;
      else out.dataDir = value;
      continue;
    }
    throw new ArgsError(`未知参数 "${arg.slice(0, 60)}"`);
  }
  return out;
}

export function helpText() {
  return [
    '用法：ballast [--port <1-65535>] [--data-dir <path>] [--help] [--version]',
    '',
    '启动 Ballast 本机服务。默认 http://127.0.0.1:8787。',
    '',
    '选项：',
    '  --port <n>        监听端口，覆盖 BALLAST_PORT',
    '  --data-dir <p>    数据目录，覆盖 BALLAST_DATA_DIR',
    '  --help            显示这段帮助',
    '  --version         显示版本号',
  ].join('\n');
}

/**
 * 读取并校验配置。只读取 BALLAST_ 开头的变量。
 * @param {Record<string, string|undefined>} env
 * @param {{port?: string, dataDir?: string}} overrides
 */
export function loadConfig(env = process.env, overrides = {}) {
  const rawPort = overrides.port ?? env.BALLAST_PORT ?? '8787';
  const port = intInRange(String(rawPort), overrides.port ? '--port' : 'BALLAST_PORT', 1, 65535);

  const dockerRaw = env.BALLAST_DOCKER ?? '0';
  if (dockerRaw !== '0' && dockerRaw !== '1') {
    throw new ConfigError(`BALLAST_DOCKER 只能是 0 或 1，当前值 "${dockerRaw.slice(0, 40)}"`);
  }
  const inContainer = fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
  if (dockerRaw === '1' && !inContainer) {
    throw new ConfigError('BALLAST_DOCKER=1 只能在容器内使用；裸机请保持 0，避免把服务暴露到局域网');
  }
  const host = env.BALLAST_HOST ?? '127.0.0.1';
  const hostAllowed = host === '127.0.0.1' || host === '::1' || (dockerRaw === '1' && inContainer && host === '0.0.0.0');
  if (!hostAllowed) {
    throw new ConfigError('BALLAST_HOST 只允许 127.0.0.1 或 ::1；只有已识别的容器内（BALLAST_DOCKER=1）才允许 0.0.0.0');
  }

  const rawDir = overrides.dataDir ?? env.BALLAST_DATA_DIR ?? './data';
  if (typeof rawDir !== 'string' || rawDir.length === 0 || rawDir.length > 500) {
    throw new ConfigError('BALLAST_DATA_DIR 必须是长度 1–500 的路径');
  }
  const dataDir = path.resolve(rawDir);

  const logLevel = env.BALLAST_LOG_LEVEL ?? 'info';
  if (!LOG_LEVELS.includes(logLevel)) {
    throw new ConfigError(`BALLAST_LOG_LEVEL 只能是 ${LOG_LEVELS.join(' / ')}，当前值 "${logLevel.slice(0, 40)}"`);
  }

  const demoRaw = env.BALLAST_DEMO ?? '0';
  if (demoRaw !== '0' && demoRaw !== '1') {
    throw new ConfigError(`BALLAST_DEMO 只能是 0 或 1，当前值 "${demoRaw.slice(0, 40)}"`);
  }

  const backupKeep = intInRange(String(env.BALLAST_BACKUP_KEEP ?? '7'), 'BALLAST_BACKUP_KEEP', 1, 100);

  let created = false;
  try {
    created = !fs.existsSync(dataDir);
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const st = fs.statSync(dataDir);
    if (!st.isDirectory()) throw new ConfigError(`BALLAST_DATA_DIR 不是目录：${dataDir}`);
    fs.accessSync(dataDir, fs.constants.W_OK);
    if (created) fs.chmodSync(dataDir, 0o700);
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(`BALLAST_DATA_DIR 不可写：${dataDir}（${err.message}）`);
  }

  return {
    port,
    host,
    docker: dockerRaw === '1',
    dataDir,
    logLevel,
    demo: demoRaw === '1',
    backupKeep,
    version: '0.1.0',
  };
}

export function createLogger(level = 'info', sink = console) {
  const order = { info: 0, warn: 1, error: 2 };
  const min = order[level] ?? 0;
  const write = (name) => (...args) => {
    if (order[name] >= min) sink[name === 'info' ? 'log' : name](...args);
  };
  return { info: write('info'), warn: write('warn'), error: write('error') };
}
