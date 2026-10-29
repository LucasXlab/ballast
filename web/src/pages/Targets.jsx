import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Alert, Button, Empty, Field, Input, useToast } from '../components.jsx';
import { formatPercent } from '../format.js';

function toRow(s) {
  return { id: s.id, name: s.name, target: (s.targetBp / 100).toFixed(2), band: (s.bandBp / 100).toFixed(2) };
}

export default function Targets({ state, refresh }) {
  const [rows, setRows] = useState(state.sleeves.map(toRow));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => { setRows(state.sleeves.map(toRow)); }, [state.sleeves]);
  const values = rows.map((r) => Number(r.target));
  const sum = values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const valid = Math.abs(sum - 100) < 1e-9 && values.every((v) => Number.isFinite(v) && v >= 0 && v <= 100);
  const current = new Map(state.targets.map((t) => [t.sleeveId, t]));

  async function save() {
    setBusy(true); setError('');
    try {
      for (const row of rows) {
        const old = state.sleeves.find((s) => s.id === row.id);
        if (old && old.name !== row.name.trim()) {
          await api(`/api/sleeves/${row.id}`, { method: 'PATCH', body: { name: row.name.trim() } });
        }
      }
      await api('/api/targets', { method: 'PUT', body: { sleeves: rows.map((r, i) => ({
        id: r.id,
        targetBp: Math.round(values[i] * 100),
        bandBp: Math.round(Number(r.band) * 100),
      })) } });
      await refresh(); toast('目标已保存');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  async function add() {
    setError('');
    try { await api('/api/sleeves', { method: 'POST', body: { name: '新分类', targetBp: 0, bandBp: 500 } }); await refresh(); }
    catch (err) { setError(err.message); }
  }
  async function remove(id) {
    setError('');
    try { await api(`/api/sleeves/${id}`, { method: 'DELETE' }); await refresh(); }
    catch (err) { setError(err.message); }
  }

  return (
    <>
      <header className="page-head">
        <div><p className="eyebrow">目标</p><h1 className="page-title">目标比例</h1></div>
        <Button variant="primary" onClick={save} disabled={!valid || busy}>{busy ? '保存中…' : '保存目标'}</Button>
      </header>
      <p className={valid ? 'sum' : 'sum is-invalid'}>合计 {sum.toFixed(2)}%</p>
      {!valid && <Alert>目标合计必须正好 100.00%，当前是 {sum.toFixed(2)}%。改到 100% 才能保存。</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      {state.sleeves.length === 0 ? <Empty title="还没有分类。" action={<Button onClick={add}>新增分类</Button>} /> : (
        <table className="table">
          <caption className="sr-only">分类目标</caption>
          <thead><tr><th>分类名</th><th className="num">目标 %</th><th className="num">偏离带 %</th><th className="num is-secondary">当前市值</th><th className="num is-secondary">当前比例</th><th /></tr></thead>
          <tbody>
            {state.sleeves.map((s, i) => {
              const row = rows[i] ?? toRow(s);
              const t = current.get(s.id);
              return (
                <tr key={s.id}>
                  <td><Input aria-label={`${s.name}分类名`} className="input--compact" value={row.name} onChange={(e) => setRows(rows.map((r, j) => j === i ? { ...r, name: e.target.value } : r))} /></td>
                  <td className="num"><Input aria-label={`${s.name}目标`} className="input--compact" inputMode="decimal" aria-invalid={!Number.isFinite(values[i]) || values[i] < 0 || values[i] > 100} value={row.target} onChange={(e) => setRows(rows.map((r, j) => j === i ? { ...r, target: e.target.value } : r))} /></td>
                  <td className="num"><Input aria-label={`${s.name}偏离带`} className="input--compact" inputMode="decimal" value={row.band} onChange={(e) => setRows(rows.map((r, j) => j === i ? { ...r, band: e.target.value } : r))} /></td>
                  <td className="num is-secondary">{t ? (t.valueMicros / 1e6).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—'}</td>
                  <td className="num is-secondary">{t ? formatPercent(t.actualBp) : '—'}</td>
                  <td><Button size="small" variant="ghost" onClick={() => remove(row.id)} disabled={state.sleeves.length <= 1}>删除</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <div className="actions"><Button onClick={add} disabled={state.sleeves.length >= 12}>新增分类</Button></div>
      <p className="caption">输入 60 表示 60.00%。偏离带用于提示，不阻止生成计划。保存时会整体替换所有目标。</p>
    </>
  );
}
