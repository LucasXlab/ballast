export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error ?? '请求失败');
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
