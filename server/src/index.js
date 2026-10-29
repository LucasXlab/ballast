#!/usr/bin/env node
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig, parseArgs, helpText, createLogger, ArgsError, ConfigError } from './config.js';
import { createApp } from './app.js';
import { VERSION } from './version.js';

export async function main(argv = process.argv.slice(2), env = process.env) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`参数错误：${err.message}\n`);
    return 2;
  }
  if (args.help) {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  let config;
  try {
    config = loadConfig(env, { port: args.port, dataDir: args.dataDir });
  } catch (err) {
    if (err instanceof ConfigError || err instanceof ArgsError) {
      process.stderr.write(`配置错误：${err.message}\n`);
      return 2;
    }
    process.stderr.write(`启动失败：${err.message}\n`);
    return 1;
  }
  const log = createLogger(config.logLevel);
  let app;
  try {
    app = createApp({ config, staticDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist') });
  } catch (err) {
    process.stderr.write(`启动失败：${err.message}\n`);
    return 1;
  }
  const server = app.listen(config.port, config.host);
  return await new Promise((resolve) => {
    let done = false;
    const finish = (code) => {
      if (done) return;
      done = true;
      try { app.locals.close(); } catch { /* */ }
      resolve(code);
    };
    server.on('listening', () => {
      process.stdout.write(`Ballast ${VERSION}\n`);
      process.stdout.write(`数据目录：${config.dataDir}\n`);
      process.stdout.write(`监听：http://${config.host === '::1' ? '[::1]' : config.host}:${config.port}\n`);
      log.info('Ballast 已启动');
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') process.stderr.write(`启动失败：端口 ${config.port} 已被占用\n`);
      else process.stderr.write(`启动失败：${err.message}\n`);
      finish(1);
    });
    const shutdown = () => {
      server.close(() => finish(0));
      setTimeout(() => finish(0), 3000).unref();
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then((code) => {
    process.exitCode = code;
  });
}
