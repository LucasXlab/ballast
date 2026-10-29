export class ApiError extends Error {
  constructor(status, code, message, details = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function bad(field, message, context = {}) {
  return new ApiError(400, 'invalid_input', message, [{ field, line: null, message, context }]);
}

export function requireObject(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad(null, '请求体必须是 JSON 对象');
  return body;
}

export function textField(value, field, { min = 1, max = 100, trim = true } = {}) {
  if (typeof value !== 'string') throw bad(field, `${field} 必须是字符串`);
  const text = trim ? value.trim() : value;
  const len = [...text].length;
  if (len < min || len > max) throw bad(field, `${field} 长度必须是 ${min}–${max} 个字符`, { length: len });
  return text;
}

export function intField(value, field, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw bad(field, `${field} 必须是 ${min}–${max} 的整数`, { value });
  return value;
}

export function boolField(value, field) {
  if (typeof value !== 'boolean') throw bad(field, `${field} 必须是 true 或 false`);
  return value;
}

export function dateField(value, field, { code = 'invalid_date', min = '2000-01-01', max } = {}) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, code, `${field} 必须是 YYYY-MM-DD`, [{ field, line: null, message: `${field} 格式错误`, context: { value } }]);
  }
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new ApiError(400, code, `${field} 不是有效日期`, [{ field, line: null, message: `${field} 不是有效日期`, context: { value } }]);
  }
  if (value < min) throw new ApiError(400, code, `${field} 不能早于 ${min}`, [{ field, line: null, message: `${field} 太早`, context: { value } }]);
  if (max && value > max) throw new ApiError(400, code, `${field} 不能晚于 ${max}`, [{ field, line: null, message: `${field} 太晚`, context: { value } }]);
  return value;
}

export function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
