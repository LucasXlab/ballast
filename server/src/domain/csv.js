import crypto from 'node:crypto';

export class CsvError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'CsvError';
    this.details = details;
  }
}

export function parseCsvLine(line, lineNo) {
  const fields = [];
  let i = 0;
  while (true) {
    if (line[i] === '"') {
      i += 1;
      let value = '';
      let closed = false;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          closed = true;
          i += 1;
          break;
        }
        value += line[i];
        i += 1;
      }
      if (!closed) throw new CsvError(`第 ${lineNo} 行引号没有闭合`, [{ line: lineNo, message: '引号没有闭合' }]);
      while (i < line.length && (line[i] === ' ' || line[i] === '\t')) i += 1;
      if (i < line.length && line[i] !== ',') throw new CsvError(`第 ${lineNo} 行引号结束后还有内容`, [{ line: lineNo, message: '引号结束后还有内容' }]);
      fields.push(value);
    } else {
      let value = '';
      while (i < line.length && line[i] !== ',') {
        value += line[i];
        i += 1;
      }
      fields.push(value.trim());
    }
    if (i < line.length && line[i] === ',') {
      i += 1;
      continue;
    }
    break;
  }
  return fields;
}

export function parseCsv(text) {
  const raw = String(text ?? '');
  const withoutBom = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = withoutBom.split('\n');
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].endsWith('\r') ? lines[index].slice(0, -1) : lines[index];
    if (line.trim() === '') continue;
    entries.push({ lineNo: index + 1, fields: parseCsvLine(line, index + 1) });
  }
  if (entries.length === 0) throw new CsvError('CSV 是空的', [{ line: 1, message: '没有表头' }]);
  const header = entries[0].fields.map((v) => v.trim().toLowerCase());
  const rows = entries.slice(1).map((entry) => ({ line: entry.lineNo, fields: entry.fields }));
  return { header, rows, raw };
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function escapeCell(value, { protectFormula = false } = {}) {
  let text = String(value ?? '');
  if (protectFormula && /^[\s\u0000-\u001f=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function toCsv(header, rows, { protectFormula = false } = {}) {
  const lines = [header.map((h) => escapeCell(h, { protectFormula })).join(',')];
  for (const row of rows) lines.push(row.map((v) => escapeCell(v, { protectFormula })).join(','));
  return `\ufeff${lines.join('\r\n')}\r\n`;
}

export function csvFormulaProtect(value) {
  const text = String(value ?? '');
  return /^[\s\u0000-\u001f=+\-@]/.test(text) ? `'${text}` : text;
}
