import { useState } from 'react';
import { api } from '../api.js';
import { Alert, Bar, Button, Dialog, Field, Input, Select, Spinner, Tag, useToast } from '../components.jsx';
import { formatMoney, formatPercent, todayFrom } from '../format.js';

export default function PlanDetail({ id, state, plan, reloadPlan, refresh, navigate }) {
  const [accountId, setAccountId] = useState(state?.accounts.find((a) => !a.archived)?.id ?? '');
  const [tradedAt, setTradedAt] = useState(todayFrom(state));
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [abandonConfirm, setAbandonConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  if (!plan) return <Spinner />;
  const currency = state?.portfolio?.baseCurrency ?? 'CNY';
  const accountOptions = (state?.accounts ?? []).filter((a) => !a.archived).map((a) => ({ value: a.id, label: a.name }));

  async function execute() {
    setBusy(true); setError('');
    try {
      await api(`/api/plans/${id}/execute`, { method: 'POST', body: { accountId, tradedAt, note } });
      setConfirm(false);
      await reloadPlan(); await refresh();
      toast('计划已执行，持仓已更新');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function abandon() {
    setBusy(true);
    try { await api(`/api/plans/${id}/abandon`, { method: 'POST' }); await reloadPlan(); await refresh(); toast('计划已放弃'); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow"><button className="link" onClick={() => navigate('/plans')}>计划</button> / {plan.createdAt.slice(0, 10)}</p>
          <h1 className="page-title">买入计划</h1>
        </div>
        <Tag tone={plan.status === 'executed' ? 'ok' : plan.status === 'abandoned' ? 'danger' : 'warn'}>{plan.status === 'executed' ? '已执行' : plan.status === 'abandoned' ? '已放弃' : '草稿'}</Tag>
      </header>

      <section className="metrics">
        <div><p className="caption">投入金额</p><p className="metric">{formatMoney(plan.amountMicros, currency)}</p></div>
        <div><p className="caption">计划买入</p><p className="metric">{formatMoney(plan.plannedMicros, currency)}</p></div>
        <div><p className="caption">剩余现金</p><p className="metric">{formatMoney(plan.cashLeftMicros, currency)}</p></div>
        <div><p className="caption">执行后最大偏离</p><p className="metric">{formatPercent(plan.maxDriftAfterBp)}</p></div>
      </section>

      {plan.warnings.map((w) => <Alert key={w.code}>{w.message}</Alert>)}
      {error && <Alert tone="danger">{error}</Alert>}

      <section className="section">
        <h2 className="section__title">买入项</h2>
        {plan.items.length === 0 ? <p className="muted">没有可买入项。</p> : (
          <table className="table">
            <caption className="sr-only">买入项</caption>
            <thead><tr><th>代码</th><th>名称</th><th>分类</th><th className="num">份额</th><th className="num">价格</th><th className="num">金额</th></tr></thead>
            <tbody>
              {plan.items.map((item) => (
                <tr key={item.symbolId}>
                  <td className="mono">{item.ticker}</td><td>{item.symbolName}</td><td>{item.sleeveName}</td>
                  <td className="num">{item.quantityMicros / 1e6}</td><td className="num">{item.priceMicros / 1e6}</td><td className="num">{formatMoney(item.amountMicros, currency)}</td>
                </tr>
              ))}
              <tr className="table__total"><td colSpan={5}>合计</td><td className="num">{formatMoney(plan.plannedMicros, currency)}</td></tr>
            </tbody>
          </table>
        )}
      </section>

      <section className="section">
        <h2 className="section__title">偏离对比</h2>
        <div className="targets">
          {plan.sleeves.map((s) => (
            <div className="target-row" key={s.sleeveId}>
              <div className="target-row__name">{s.name}<span className="caption"> {formatPercent(s.targetBp)}</span></div>
              <div className="compare"><span className="caption">买入前</span><Bar valueBp={s.driftBeforeBp + s.targetBp} targetBp={s.targetBp} /><span className="caption">买入后</span><Bar valueBp={s.driftAfterBp + s.targetBp} targetBp={s.targetBp} /></div>
              <div className={s.driftAfterBp > s.bandBp || s.driftAfterBp < -s.bandBp ? 'target-row__drift is-outside' : 'target-row__drift'}>{formatPercent(s.driftBeforeBp, { signed: true })} → {formatPercent(s.driftAfterBp, { signed: true })}</div>
            </div>
          ))}
        </div>
      </section>

      {plan.status === 'draft' && (
        <section className="section">
          <h2 className="section__title">执行</h2>
          <div className="form-row">
            <Field label="账户" id="exec-account"><Select id="exec-account" value={accountId} onChange={setAccountId} options={accountOptions} /></Field>
            <Field label="成交日期" id="exec-date"><Input id="exec-date" type="date" value={tradedAt} onChange={(e) => setTradedAt(e.target.value)} /></Field>
            <Field label="备注（可选）" id="exec-note"><Input id="exec-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
          </div>
          <div className="actions">
            <Button variant="primary" onClick={() => setConfirm(true)} disabled={!accountId || busy}>标记为已执行</Button>
            <Button variant="ghost" onClick={() => setAbandonConfirm(true)} disabled={busy}>放弃计划</Button>
          </div>
          <p className="caption">执行会生成 {plan.items.length} 条买入记录，不能撤销。</p>
        </section>
      )}
      {plan.status === 'executed' && <Alert tone="success">执行于 {plan.executedAt?.slice(0, 16).replace('T', ' ')}（UTC）{plan.accountId ? `，账户「${state.accounts.find((a) => a.id === plan.accountId)?.name ?? '已删除账户'}」` : ''}。交易记录可在持仓页查看。</Alert>}
      {plan.status === 'abandoned' && <Alert>放弃于 {plan.abandonedAt?.slice(0, 16).replace('T', ' ')}（UTC）。</Alert>}

      {confirm && (
        <Dialog title="执行这份计划？" confirmText="执行" danger busy={busy} onClose={() => setConfirm(false)} onConfirm={execute}>
          会生成 {plan.items.length} 条买入记录，写入账户「{accountOptions.find((o) => o.value === accountId)?.label}」，且不能撤销。
        </Dialog>
      )}
      {abandonConfirm && (
        <Dialog title="放弃这份计划？" confirmText="放弃" danger busy={busy} onClose={() => setAbandonConfirm(false)} onConfirm={abandon}>
          放弃后不能执行，只能重新生成。现有持仓和交易不会改变。
        </Dialog>
      )}
    </>
  );
}
