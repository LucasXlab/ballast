#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname, '../web/dist');
if (!fs.existsSync(dist)) {
  console.error('web/dist 不存在，先运行 npm run build');
  process.exit(1);
}
const files = [];
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full);
    else files.push(full);
  }
}
walk(dist);
const bad = [];
for (const file of files) {
  if (!/\.(html|js|css)$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>)]+/g)) {
    const url = match[0];
    if (url.startsWith('http://www.w3.org/')) continue;
    if (url.startsWith('https://react.dev/errors/')) continue;
    bad.push(`${path.relative(dist, file)}: ${url}`);
  }
}
if (bad.length) {
  console.error(`发现外部资源：\n${bad.join('\n')}`);
  process.exit(1);
}
console.log(`离线检查通过：${files.length} 个构建文件，0 个外部 http(s) 资源`);
