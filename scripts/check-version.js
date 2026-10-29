#!/usr/bin/env node
import fs from 'node:fs';
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const tag = process.env.GITHUB_REF_NAME ?? process.argv[2];
if (!tag) {
  console.error('需要 GITHUB_REF_NAME 或参数，例如 v0.1.0');
  process.exit(1);
}
if (tag !== `v${pkg.version}`) {
  console.error(`标签 ${tag} 与 package.json 版本 ${pkg.version} 不一致`);
  process.exit(1);
}
console.log(`版本一致：${tag}`);
