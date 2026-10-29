export function iso(nowMs) {
  return new Date(nowMs).toISOString();
}
export function utcDate(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}
export function utcStamp(nowMs) {
  return new Date(nowMs).toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
}
export function toBool(value) {
  return value === 1 || value === true;
}
export function accountDto(row) {
  return { id: row.id, name: row.name, kind: row.kind, archived: toBool(row.archived), sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at };
}
export function sleeveDto(row) {
  return { id: row.id, name: row.name, targetBp: row.target_bp, bandBp: row.band_bp, sortOrder: row.sort_order, createdAt: row.created_at, updatedAt: row.updated_at };
}
export function symbolDto(row) {
  return { id: row.id, ticker: row.ticker, name: row.name, sleeveId: row.sleeve_id, sleeveName: row.sleeve_name ?? undefined, currency: row.currency, lotSizeMicros: row.lot_size_micros, priceMicros: row.price_micros, priceAsOf: row.price_as_of, archived: toBool(row.archived), createdAt: row.created_at, updatedAt: row.updated_at };
}
export function portfolioDto(row) {
  return { id: row.id, name: row.name, baseCurrency: row.base_currency, createdAt: row.created_at, updatedAt: row.updated_at };
}
