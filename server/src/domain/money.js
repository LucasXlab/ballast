export const MICROS = 1_000_000;

export class MoneyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * 十进制字符串转微单位整数。只接受非负、最多 6 位小数、无指数。
 * @param {string|number} input
 * @param {{max?: number, field?: string}} [options]
 */
export function parseDecimalToMicros(input, { max = 1_000_000_000_000_000, field = '数值' } = {}) {
  const raw = typeof input === 'number' ? String(input) : String(input ?? '').trim();
  if (raw === '') throw new MoneyError(`${field}不能为空`);
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) throw new MoneyError(`${field}必须是最多 6 位小数的非负数字，当前是 "${raw}"`);
  const [whole, frac = ''] = raw.split('.');
  const scaled = BigInt(whole) * BigInt(MICROS) + BigInt(frac.padEnd(6, '0'));
  if (scaled > BigInt(max)) throw new MoneyError(`${field}超过上限`);
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) throw new MoneyError(`${field}过大`);
  return Number(scaled);
}

export function microsToDecimal(value, { decimals = 6, trim = true } = {}) {
  const n = BigInt(value);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / BigInt(MICROS);
  const frac = (abs % BigInt(MICROS)).toString().padStart(6, '0').slice(0, decimals);
  let out = `${whole}`;
  if (decimals > 0) {
    const trimmed = trim ? frac.replace(/0+$/, '') : frac;
    if (trimmed.length > 0) out += `.${trimmed}`;
  }
  return negative ? `-${out}` : out;
}

export function formatMoney(value, currency = 'CNY') {
  const decimals = currency === 'JPY' ? 0 : 2;
  const n = BigInt(value);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const factor = 10n ** BigInt(6 - decimals);
  const rounded = (abs + factor / 2n) / factor;
  const whole = rounded / 10n ** BigInt(decimals);
  const frac = decimals > 0 ? (rounded % 10n ** BigInt(decimals)).toString().padStart(decimals, '0') : '';
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const symbol = { CNY: '¥', USD: '$', EUR: '€', HKD: 'HK$', JPY: '¥', GBP: '£' }[currency] ?? '';
  return `${negative ? '−' : ''}${symbol}${grouped}${decimals > 0 ? `.${frac}` : ''}`;
}

export function roundDiv(numerator, denominator) {
  if (denominator === 0n) return 0n;
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  if (n >= 0n) return (n + d / 2n) / d;
  return -((-n + d / 2n) / d);
}

export function mulDivFloor(a, b, c) {
  return Number((BigInt(a) * BigInt(b)) / BigInt(c));
}

export function mulDivRound(a, b, c) {
  return Number(roundDiv(BigInt(a) * BigInt(b), BigInt(c)));
}

export function safeNumber(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new MoneyError('计算结果超出安全整数范围');
  return n;
}
