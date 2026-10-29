import { useState } from 'react';
import { api, download } from '../api.js';
import { Alert, Button, Dialog, Empty, Field, Input, Tag, useToast } from '../components.jsx';

export default function Settings({ state, refresh }) {
  const [name, setName] = useState(state.portfolio.name);
  const [accountName, setAccountName] = useState('');
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function run(action) {
    setBusy(true); setError('');
    try { await action(); await refresh(); setDialog(null); toast('已保存'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return (
    <>
      <header className="page-head"><div><p className="eyebrow">设置</p><h1 className="page-title">设置</h1></div></header>
      {error && !dialog && <Alert tone="danger">{error}</Alert>}
      <section className="section">
        <h2 className="section__title">组合</h2>
        <div className="form-row">
          <Field label="名称" id="portfolio-name"><Input id="portfolio-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
          <Field label="基础币种" id="portfolio-currency" hint="首次设置后不可改"><Input id="portfolio-currency" value={state.portfolio.baseCurrency} disabled /></Field>
          <div className="field"><span className="field__label">&nbsp;</span><Button variant="primary" onClick={() => run(async () => api('/api/portfolio', { method: 'PUT', body: { name } }))} disabled={busy || !name.trim()}>保存名称</Button></div>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">账户</h2>
        {state.accounts.length === 0 ? <Empty title="还没有账户。" /> : (
          <table className="table">
            <caption className="sr-only">账户</caption>
            <thead><tr><th>名称</th><th>类型</th><th>状态</th><th /></tr></thead>
            <tbody>
              {state.accounts.map((a) => (
                <tr key={a.id}>
                  <td>{a.name}</td><td>{a.kind === 'taxable' ? '普通' : a.kind === 'tax_advantaged' ? '养老/税优' : a.kind === 'cash' ? '现金' : '其他'}</td>
                  <td><Tag tone={a.archived ? 'danger' : 'default'}>{a.archived ? '已归档' : '在用'}</Tag></td>
                  <td><Button size="small" variant="ghost" onClick={() => run(async () => api(`/api/accounts/${a.id}`, { method: 'PATCH', body: { archived: !a.archived } }))}>{a.archived ? '恢复' : '归档'}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="actions">
          <Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder="新账户名称" aria-label="新账户名称" />
          <Button onClick={() => run(async () => { await api('/api/accounts', { method: 'POST', body: { name: accountName, kind: 'taxable' } }); setAccountName(''); })} disabled={busy || !accountName.trim()}>新增账户</Button>
        </div>
      </section>

      <section className="section">
        <h2 className="section__title">数据</h2>
        <div className="actions">
          <Button onClick={() => download('/api/backup', { method: 'POST' }).catch((err) => toast(err.message))}>下载备份</Button>
          <Button onClick={() => download('/api/export/transactions.csv')}>导出交易 CSV</Button>
          <Button onClick={() => download('/api/export/positions.csv')}>导出持仓 CSV</Button>
        </div>
        <p className="caption">备份是单个 SQLite 文件，包含全部数据。恢复时停止 Ballast，把备份命名为 ballast.sqlite 放进新的数据目录再启动。</p>
      </section>

      {state.demo && (
        <section className="section">
          <h2 className="section__title">示例数据</h2>
          <p className="caption">当前是示例数据。恢复会清空现有数据并重建示例。</p>
          <Button variant="danger" onClick={() => setDialog('demo')}>恢复示例数据</Button>
        </section>
      )}

      <section className="section">
        <h2 className="section__title">关于</h2>
        <p>Ballast 0.1.0 · MIT 许可证</p>
        <p className="caption">数据只保存在本机。Ballast 不连接券商，不抓取行情，不发网络请求。源码地址发布后填写。</p>
      </section>

      {dialog === 'demo' && (
        <Dialog title="恢复示例数据？" confirmText="恢复" danger busy={busy} onClose={() => setDialog(null)} onConfirm={() => run(async () => api('/api/demo/reload', { method: 'POST', body: { confirm: 'RELOAD' } }))}>
          现有组合、账户、代码、交易和计划都会被删除，换成固定示例数据。此操作不能撤销。
          {error && <Alert tone="danger">{error}</Alert>}
        </Dialog>
      )}
    </>
  );
}
