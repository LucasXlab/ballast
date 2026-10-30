import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Alert, Button, DetailList, Dialog, Empty, Field, Input, Select, Spinner, Tag, useToast } from '../components.jsx';
import { formatMoney, formatPercent, formatPrice, microsInput, parseMicros, todayFrom } from '../format.js';

function previewCsv(text) {
  const lines = String(text ?? '').replace(/^\ufeff/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  const parse = (line) => {
    const fields = [];
    let i = 0;
    while (i <= line.length) {
      if (line[i] === '"') {
        i += 1;
        let value = '';
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') { value += '"'; i += 2; continue; }
          if (line[i] === '"') { i += 1; break; }
          value += line[i]; i += 1;
        }
        fields.push(value);
        if (i >= line.length) break;
        if (line[i] === ',') i += 1;
      } else {
        let value = '';
        while (i < line.length && line[i] !== ',') { value += line[i]; i += 1; }
        fields.push(value.trim());
        if (i >= line.length) break;
        if (line[i] === ',') i += 1;
      }
    }
    return fields;
  };
  return lines.slice(0, 6).map(parse);
}

export default function Holdings({ state, refresh, navigate }) {
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState('');
  const [errorDetails, setErrorDetails] = useState([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [code, setCode] = useState({ ticker: '', name: '', sleeveId: '', lot: '100', price: '', date: '' });
  const [trade, setTrade] = useState({ accountId: '', symbolId: '', side: 'buy', qty: '', price: '', fee: '0', date: '', note: '' });
  const [priceForm, setPriceForm] = useState({ symbolId: '', price: '', date: '' });
  const [csv, setCsv] = useState({ filename: '', text: '' });
  const [deleteTx, setDeleteTx] = useState(null);
  if (!state) return <Spinner />;
  const currency = state.portfolio.baseCurrency;
  const accounts = state.accounts.filter((a) => !a.archived);
  const activeSymbols = state.symbols.filter((s) => !s.archived);
  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));
  const symbolOptions = activeSymbols.map((s) => ({ value: s.id, label: `${s.ticker} ${s.name}` }));
  const sleeveOptions = state.sleeves.map((s) => ({ value: s.id, label: s.name }));

  function openTrade(symbolId = '') {
    setError('');
    setTrade({ accountId: accounts[0]?.id ?? '', symbolId, side: 'buy', qty: '', price: activeSymbols.find((s) => s.id === symbolId) ? microsInput(activeSymbols.find((s) => s.id === symbolId).priceMicros) : '', fee: '0', date: todayFrom(state), note: '' });
    setDialog('trade');
  }
  function openCode() {
    setError('');
    setCode({ ticker: '', name: '', sleeveId: state.sleeves[0]?.id ?? '', lot: '100', price: '', date: todayFrom(state) });
    setDialog('code');
  }
  function openPrice(symbol) {
    setError('');
    setPriceForm({ symbolId: symbol.id, price: microsInput(symbol.priceMicros), date: symbol.priceAsOf ?? todayFrom(state) });
    setDialog('price');
  }
  function openImport() {
    setError(''); setCsv({ filename: '', text: '' }); setDialog('import');
  }
  async function run(action) {
    setBusy(true); setError(''); setErrorDetails([]);
    try { await action(); await refresh(); setDialog(null); toast('已保存'); }
    catch (err) { setError(err.message); setErrorDetails(err.details ?? []); }
    finally { setBusy(false); }
  }

  return (
    <>
      <header className="page-head">
        <div><p className="eyebrow">持仓</p><h1 className="page-title">代码、价格与成交</h1></div>
        <div className="actions">
          <Button variant="primary" onClick={() => (activeSymbols.length ? openTrade() : openCode())}>{activeSymbols.length ? '新增买入' : '新增代码'}</Button>
          <Button onClick={openCode}>新增代码</Button>
          <Button onClick={openImport}>导入 CSV</Button>
        </div>
      </header>
      {!activeSymbols.length && <p className="caption">先新增一个代码，才能记录买入。</p>}
      {error && !dialog && <Alert tone="danger">{error}</Alert>}

      <section className="metrics">
        <div><p className="caption">总市值</p><p className="metric">{formatMoney(state.totals.marketValueMicros, currency)}</p></div>
        <div><p className="caption">成本</p><p className="metric">{formatMoney(state.totals.costBasisMicros, currency)}</p></div>
        <div><p className="caption">未实现盈亏</p><p className="metric">{formatMoney(state.totals.unrealizedMicros, currency)}</p></div>
        <div><p className="caption">持仓数</p><p className="metric">{state.totals.positionCount}</p></div>
      </section>

      <section className="section">
        <h2 className="section__title">代码</h2>
        {state.symbols.length === 0 ? <Empty title="还没有代码。" action={<Button variant="primary" onClick={openCode}>新增代码</Button>}>先添加你要买的 ETF 或股票。</Empty> : (
          <table className="table">
            <caption className="sr-only">代码与价格</caption>
            <thead><tr><th>代码</th><th className="is-secondary">名称</th><th className="is-secondary">分类</th><th className="num is-secondary">每手份数</th><th className="num">现价</th><th className="is-secondary">价格日期</th><th className="is-secondary">状态</th><th /></tr></thead>
            <tbody>
              {state.symbols.map((symbol) => (
                <tr key={symbol.id} className={symbol.archived ? 'is-muted' : ''}>
                  <td className="mono">{symbol.ticker}</td><td className="is-secondary">{symbol.name}</td><td className="is-secondary">{symbol.sleeveName}</td>
                  <td className="num is-secondary">{symbol.lotSizeMicros / 1e6}</td>
                  <td className="num">{symbol.priceMicros ? formatPrice(symbol.priceMicros) : '—'}</td>
                  <td className="is-secondary">{symbol.priceAsOf ?? '—'}</td>
                  <td className="is-secondary"><Tag tone={symbol.archived ? 'danger' : 'default'}>{symbol.archived ? '已归档' : '在用'}</Tag></td>
                  <td className="row-actions">
                    <Button size="small" onClick={() => openPrice(symbol)}>改价格</Button>
                    <Button size="small" variant="ghost" onClick={() => run(async () => api(`/api/symbols/${symbol.id}`, { method: 'PATCH', body: { archived: !symbol.archived } }))}>{symbol.archived ? '恢复' : '归档'}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <h2 className="section__title">持仓</h2>
        {state.positions.length === 0 ? <Empty title="还没有持仓。" action={<Button variant="primary" onClick={() => (activeSymbols.length ? openTrade() : openCode())}>{activeSymbols.length ? '新增买入' : '新增代码'}</Button>}>新增一笔买入后，这里会按账户显示。</Empty> : (
          <table className="table">
            <caption className="sr-only">持仓</caption>
            <thead><tr><th className="is-secondary">账户</th><th>代码</th><th className="is-secondary">名称</th><th className="is-secondary">分类</th><th className="num">份额</th><th className="num is-secondary">平均成本</th><th className="num">现价</th><th className="is-secondary">价格日期</th><th className="num">市值</th><th className="num is-secondary">未实现盈亏</th></tr></thead>
            <tbody>
              {state.positions.map((p) => (
                <tr key={`${p.accountId}-${p.symbolId}`}>
                  <td className="is-secondary">{p.accountName}</td><td className="mono">{p.ticker}</td><td className="is-secondary">{p.name}</td><td className="is-secondary">{p.sleeveName}</td>
                  <td className="num">{p.quantityMicros / 1e6}</td><td className="num is-secondary">{formatPrice(p.avgCostMicros)}</td>
                  <td className="num">{formatPrice(p.priceMicros)}</td><td className="is-secondary">{p.priceAsOf ?? '—'}</td>
                  <td className="num">{formatMoney(p.marketValueMicros, currency)}</td><td className="num is-secondary">{formatMoney(p.unrealizedMicros, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <h2 className="section__title">交易记录</h2>
        <Transactions state={state} currency={currency} onDelete={setDeleteTx} />
        <p className="caption"><button className="link" onClick={() => { window.location.href = '/api/export/transactions.csv'; }}>导出交易 CSV</button> · <button className="link" onClick={() => { window.location.href = '/api/export/positions.csv'; }}>导出持仓 CSV</button></p>
      </section>

      {dialog === 'code' && (
        <Dialog title="新增代码" confirmText="保存" busy={busy} onClose={() => setDialog(null)} onConfirm={() => run(async () => api('/api/symbols', { method: 'POST', body: {
          ticker: code.ticker, name: code.name, sleeveId: code.sleeveId, lotSizeMicros: parseMicros(code.lot, '每手份数'),
          priceMicros: code.price ? parseMicros(code.price, '价格') : undefined, priceAsOf: code.price ? code.date : undefined,
        } }))}>
          <div className="form-grid">
            <Field label="代码" id="code-ticker"><Input id="code-ticker" value={code.ticker} onChange={(e) => setCode({ ...code, ticker: e.target.value.toUpperCase() })} placeholder="510300" /></Field>
            <Field label="名称" id="code-name"><Input id="code-name" value={code.name} onChange={(e) => setCode({ ...code, name: e.target.value })} placeholder="沪深300ETF" /></Field>
            <Field label="分类" id="code-sleeve"><Select id="code-sleeve" value={code.sleeveId} onChange={(v) => setCode({ ...code, sleeveId: v })} options={sleeveOptions} /></Field>
            <Field label="每手份数" id="code-lot" hint="A 股 ETF 常见 100 份；1 表示 1 份"><Input id="code-lot" inputMode="decimal" value={code.lot} onChange={(e) => setCode({ ...code, lot: e.target.value })} /></Field>
            <Field label="当前价格（可选）" id="code-price"><Input id="code-price" inputMode="decimal" value={code.price} onChange={(e) => setCode({ ...code, price: e.target.value })} /></Field>
            <Field label="价格日期" id="code-date"><Input id="code-date" type="date" value={code.date} onChange={(e) => setCode({ ...code, date: e.target.value })} /></Field>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          {errorDetails.length > 0 && <DetailList details={errorDetails} />}
        </Dialog>
      )}

      {dialog === 'trade' && (
        <Dialog title="新增买入 / 卖出" confirmText="保存" busy={busy} onClose={() => setDialog(null)} onConfirm={() => run(async () => api('/api/transactions', { method: 'POST', body: {
          accountId: trade.accountId, symbolId: trade.symbolId, side: trade.side, quantityMicros: parseMicros(trade.qty, '份额'),
          priceMicros: parseMicros(trade.price, '价格'), feeMicros: parseMicros(trade.fee || '0', '费用'), tradedAt: trade.date, note: trade.note,
        } }))}>
          <div className="form-grid">
            <Field label="账户" id="trade-account"><Select id="trade-account" value={trade.accountId} onChange={(v) => setTrade({ ...trade, accountId: v })} options={accountOptions} /></Field>
            <Field label="代码" id="trade-symbol"><Select id="trade-symbol" value={trade.symbolId} onChange={(v) => setTrade({ ...trade, symbolId: v, price: microsInput(activeSymbols.find((s) => s.id === v)?.priceMicros ?? 0) })} options={symbolOptions} /></Field>
            <Field label="方向" id="trade-side"><Select id="trade-side" value={trade.side} onChange={(v) => setTrade({ ...trade, side: v })} options={[{ value: 'buy', label: '买入' }, { value: 'sell', label: '卖出' }]} /></Field>
            <Field label="份额" id="trade-qty"><Input id="trade-qty" inputMode="decimal" value={trade.qty} onChange={(e) => setTrade({ ...trade, qty: e.target.value })} /></Field>
            <Field label="价格" id="trade-price"><Input id="trade-price" inputMode="decimal" value={trade.price} onChange={(e) => setTrade({ ...trade, price: e.target.value })} /></Field>
            <Field label="费用" id="trade-fee"><Input id="trade-fee" inputMode="decimal" value={trade.fee} onChange={(e) => setTrade({ ...trade, fee: e.target.value })} /></Field>
            <Field label="成交日期" id="trade-date"><Input id="trade-date" type="date" value={trade.date} onChange={(e) => setTrade({ ...trade, date: e.target.value })} /></Field>
            <Field label="备注（可选）" id="trade-note"><Input id="trade-note" value={trade.note} maxLength={200} onChange={(e) => setTrade({ ...trade, note: e.target.value })} /></Field>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          {errorDetails.length > 0 && <DetailList details={errorDetails} />}
        </Dialog>
      )}

      {dialog === 'price' && (
        <Dialog title="更新价格" confirmText="保存" busy={busy} onClose={() => setDialog(null)} onConfirm={() => run(async () => api('/api/prices', { method: 'PUT', body: { prices: [{ symbolId: priceForm.symbolId, priceMicros: parseMicros(priceForm.price, '价格'), priceAsOf: priceForm.date }] } }))}>
          <Field label="价格" id="price-value"><Input id="price-value" inputMode="decimal" value={priceForm.price} onChange={(e) => setPriceForm({ ...priceForm, price: e.target.value })} /></Field>
          <Field label="价格日期" id="price-date"><Input id="price-date" type="date" value={priceForm.date} onChange={(e) => setPriceForm({ ...priceForm, date: e.target.value })} /></Field>
          {error && <Alert tone="danger">{error}</Alert>}
          {errorDetails.length > 0 && <DetailList details={errorDetails} />}
        </Dialog>
      )}

      {dialog === 'import' && (
        <Dialog title="导入交易 CSV" confirmText="导入" busy={busy} onClose={() => setDialog(null)} onConfirm={() => run(async () => api('/api/imports', { method: 'POST', body: { filename: csv.filename || 'transactions.csv', csv: csv.text } }))}>
          <Field label="选择文件" id="csv-file"><input id="csv-file" className="input" type="file" accept=".csv,text/csv" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCsv({ filename: file.name, text: await file.text() }); }} /></Field>
          <Field label="或粘贴 CSV" id="csv-text" hint="列：date,account,symbol,side,quantity,price,fee,note"><textarea id="csv-text" className="input textarea" rows={8} value={csv.text} onChange={(e) => setCsv({ ...csv, text: e.target.value })} /></Field>
          <p className="caption"><button className="link" onClick={() => { window.location.href = '/api/imports/template'; }}>下载模板</button> · 账户和代码必须先在系统里存在</p>
          {csv.text.trim() && (() => {
            const rows = previewCsv(csv.text);
            if (rows.length === 0) return null;
            return (
              <div className="preview">
                <p className="caption">前 {Math.max(0, rows.length - 1)} 行预览（最多 5 行数据）</p>
                <table className="table table--preview">
                  <caption className="sr-only">CSV 预览</caption>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={index} className={index === 0 ? 'table__total' : ''}>
                        {row.map((cell, cellIndex) => <td key={cellIndex}>{cell.length > 24 ? `${cell.slice(0, 24)}…` : cell}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {csv.text.split(/\r?\n/).filter((l) => l.trim()).length > 6 && <p className="caption">只显示前 5 行数据，导入时会处理整个文件。</p>}
              </div>
            );
          })()}
          {error && <Alert tone="danger">{error}</Alert>}
          {errorDetails.length > 0 && <DetailList details={errorDetails} />}
        </Dialog>
      )}

      {deleteTx && (
        <Dialog title="删除这笔交易？" confirmText="删除" danger busy={busy} onClose={() => setDeleteTx(null)} onConfirm={() => run(async () => api(`/api/transactions/${deleteTx.id}`, { method: 'DELETE' }))}>
          删除后持仓和市值会重新计算，且不能撤销。
          {error && <Alert tone="danger">{error}</Alert>}
          {errorDetails.length > 0 && <DetailList details={errorDetails} />}
        </Dialog>
      )}
    </>
  );
}

function Transactions({ state, currency, onDelete }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [errorDetails, setErrorDetails] = useState([]);
  useEffect(() => {
    let alive = true;
    api('/api/transactions?limit=50').then((data) => { if (alive) setItems(data.items); }).catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [state]);
  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      {items && items.length === 0 && <Empty title="还没有交易。" />}
      {items && items.length > 0 && (
        <table className="table">
          <caption className="sr-only">交易记录</caption>
          <thead><tr><th>日期</th><th>账户</th><th>代码</th><th>方向</th><th className="num">份额</th><th className="num">价格</th><th className="num">费用</th><th>来源</th><th /></tr></thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td>{t.tradedAt}</td><td>{t.accountName}</td><td className="mono">{t.ticker}</td><td>{t.side === 'buy' ? '买入' : '卖出'}</td>
                <td className="num">{t.quantityMicros / 1e6}</td><td className="num">{formatPrice(t.priceMicros)}</td><td className="num">{formatPrice(t.feeMicros)}</td>
                <td>{t.source === 'manual' ? '手工' : t.source === 'plan' ? '计划' : '导入'}</td>
                <td>{t.source === 'manual' && <Button size="small" variant="ghost" onClick={() => onDelete(t)}>删除</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
