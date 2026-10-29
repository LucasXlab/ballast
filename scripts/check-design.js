#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const styles = path.join(root, 'web/src/styles');
const files = fs.readdirSync(styles).filter((name) => name.endsWith('.css'));
const errors = [];
for (const name of files) {
  if (name === 'tokens.css') continue;
  const text = fs.readFileSync(path.join(styles, name), 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const where = `${name}:${index + 1}`;
    if (/#[0-9a-fA-F]{3,8}\b/.test(line)) errors.push(`${where} 十六进制颜色`);
    if (/\brgba?\(/.test(line)) errors.push(`${where} rgb/rgba`);
    if (/\bhsla?\(/.test(line)) errors.push(`${where} hsl/hsla`);
    if (/font-size:\s*\d+(\.\d+)?px/.test(line)) errors.push(`${where} 硬编码 font-size`);
    if (/border-radius:\s*\d+(\.\d+)?px/.test(line)) errors.push(`${where} 硬编码 border-radius`);
    if (/box-shadow:/.test(line) && !/box-shadow:\s*var\(/.test(line)) errors.push(`${where} 硬编码 box-shadow`);
    if (/(linear|radial)-gradient/.test(line)) errors.push(`${where} 渐变`);
  });
}
const tokens = fs.readFileSync(path.join(styles, 'tokens.css'), 'utf8');
if (!tokens.includes('--fs-32')) errors.push('tokens.css 缺少 --fs-32');
if (!tokens.includes('--focus-ring')) errors.push('tokens.css 缺少 --focus-ring');
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`设计检查通过：${files.length} 个 CSS 文件，token 与字面量规则正常`);
