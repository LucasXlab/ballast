const FIELD_LABELS = {
  amountMicros: '投入金额',
  minTradeMicros: '最小单笔金额',
  quantityMicros: '份额',
  priceMicros: '价格',
  feeMicros: '费用',
  lotSizeMicros: '每手份数',
  targetBp: '目标比例',
  bandBp: '偏离带',
  tradedAt: '成交日期',
  priceAsOf: '价格日期',
  accountId: '账户',
  symbolId: '代码',
  sleeveId: '分类',
  portfolioName: '组合名称',
  baseCurrency: '基础币种',
  ticker: '代码',
  name: '名称',
  note: '备注',
  csv: 'CSV',
  filename: '文件名',
  side: '方向',
};

export function friendlyMessage(message) {
  let text = String(message ?? '');
  for (const [field, label] of Object.entries(FIELD_LABELS)) {
    text = text.replace(new RegExp(`\\b${field}\\b`, 'g'), label);
  }
  return text;
}

export class ApiError extends Error {
  constructor(status, payload) {
    super(friendlyMessage(payload?.error ?? '请求失败'));
    this.status = status;
    this.code = payload?.code ?? 'unknown';
    this.details = payload?.details ?? [];
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload;
}

export async function download(path, { method = 'GET' } = {}) {
  if (method !== 'GET') {
    const res = await fetch(path, { method });
    if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => null));
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const name = res.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/)?.[1] ?? 'ballast-download';
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    return;
  }
  const a = document.createElement('a');
  a.href = path;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
