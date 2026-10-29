#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

let failed = false;
for (let i = 1; i <= 3; i += 1) {
  process.stdout.write(`\n===== 第 ${i}/3 轮 npm test =====\n`);
  const result = spawnSync('npm', ['test'], { stdio: 'inherit', shell: false });
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
