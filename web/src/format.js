const SYMBOLS = { CNY: '¥', USD: '$', EUR: '€', HKD: 'HK$', JPY: '¥', GBP: '£' };

export function formatMoney(value, currency = 'CNY') {
  const n = Number(value) || 0;
  const decimals = currency === 'JPY' ? 0 : 2;
  return `${n < 0 ? '−' : ''}${SYMBOLS[currency] ?? ''}${Math.abs(n / 1e6).toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export function formatPrice(value) {
  const n = Number(value) || 0;
  return (n / 1e6).toFixed(6).replace(/\.?0+$/, '');
}

export function formatPercent(bp, { signed = false } = {}) {
  const value = (Number(bp) || 0) / 100;
  const text = `${Math.abs(value).toFixed(2)}%`;
  if (!signed) return text;
  return `${value < 0 ? '−' : '+'}${text}`;
}

export function parseMicros(input, field = '数值') {
  const raw = String(input ?? '').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) throw new Error(`${field}必须是最多 6 位小数的非负数字`);
  const [whole, frac = ''] = raw.split('.');
  const value = Number(whole) * 1e6 + Number(frac.padEnd(6, '0'));
  if (!Number.isSafeInteger(value)) throw new Error(`${field}过大`);
  return value;
}

export function microsInput(value) {
  const n = Number(value) || 0;
  const whole = Math.floor(n / 1e6);
  const frac = String(n % 1e6).padStart(6, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

export function todayFrom(state) {
  return state?.today ?? new Date().toISOString().slice(0, 10);
}

export function cls(...values) {
  return values.filter(Boolean).join(' ');
}
