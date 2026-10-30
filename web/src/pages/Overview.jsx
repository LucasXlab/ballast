import { useState } from 'react';
import { api } from '../api.js';
import { Alert, Bar, Button, Empty, Input, Spinner, Tag, useToast } from '../components.jsx';
import { formatMoney, formatPercent, parseMicros } from '../format.js';

export default function Overview({ state, refresh, navigate }) {
  const [amount, setAmount] = useState('1000');
  const [minTrade, setMinTrade] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  if (!state) return <Spinner />;
  const currency = state.portfolio?.baseCurrency ?? 'CNY';
  const hasPositions = state.positions.length > 0;
  const missing = state.positions.some((p) => !p.priceMicros);
  const missingSleeves = state.targets.filter((t) => t.targetBp > 0 && !state.symbols.some((s) => !s.archived && s.sleeveId === t.sleeveId));

  async function generate(event) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const plan = await api('/api/plans', { method: 'POST', body: {
        amountMicros: parseMicros(amount, '投入金额'),
        minTradeMicros: minTrade ? parseMicros(minTrade, '最小单笔金额') : 0,
      } });
      toast('计划已生成');
      navigate(`/plans/${plan.id}`);
    } catch (err) {
      if (err.code === 'sleeve_without_symbol') setError(`${err.message}。去持仓页给该分类新增代码，或到目标页把该分类目标改成 0。`);
      else setError(err.message);
    }
    finally { setBusy(false); }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">总览</p>
          <h1 className="page-title">先把钱放对位置</h1>
        </div>
        <Button variant="primary" onClick={() => document.querySelector('.invest-form input')?.focus()} disabled={!hasPositions}>生成计划</Button>
      </header>

      {missingSleeves.length > 0 && <Alert>这些目标分类还没有代码：{missingSleeves.map((t) => t.name).join('、')}。每个目标大于 0 的分类至少要有一个代码，否则无法生成计划。去 <button className="link" onClick={() => navigate('/holdings')}>持仓页</button> 新增代码，或到 <button className="link" onClick={() => navigate('/targets')}>目标页</button> 把目标改成 0。</Alert>}
      {missing && <Alert>有持仓代码没有价格。先到 <button className="link" onClick={() => navigate('/holdings')}>持仓页</button> 填写价格，生成计划更可靠。</Alert>}

      <section className="summary">
        <div>
          <p className="summary__label">总市值</p>
          <p className="display">{formatMoney(state.totals.marketValueMicros, currency)}</p>
        </div>
        <p className="summary__meta">共 {state.totals.positionCount} 个持仓 · {state.sleeves.length} 个分类 · 成本 {formatMoney(state.totals.costBasisMicros, currency)}</p>
      </section>

      <section className="section">
        <h2 className="section__title">分类偏离</h2>
        {state.sleeves.length === 0 ? <Empty title="还没有分类">先到设置页创建分类。</Empty> : (
          <div className="targets">
            {state.targets.map((target) => (
              <div className="target-row" key={target.sleeveId}>
                <div className="target-row__name">{target.name}</div>
                <Bar valueBp={target.actualBp} targetBp={target.targetBp} />
                <div className="target-row__value">{formatPercent(target.actualBp)} <span className="muted">/ {formatPercent(target.targetBp)}</span></div>
                <div className={target.status === 'outside' ? 'target-row__drift is-outside' : 'target-row__drift'}>{formatPercent(target.driftBp, { signed: true })}</div>
                <Tag tone={target.status === 'outside' ? 'warn' : 'ok'}>{target.status === 'outside' ? '超出偏离带' : '带内'}</Tag>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2 className="section__title">本次投入</h2>
        {!hasPositions ? (
          <Empty title="还没有持仓。" action={<Button variant="primary" onClick={() => navigate('/holdings')}>录入第一笔买入</Button>}>先新增代码和买入，再生成计划。</Empty>
        ) : (
          <form className="invest-form" onSubmit={generate}>
            <label className="sr-only" htmlFor="amount">投入金额</label>
            <Input id="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="投入金额" />
            <label className="sr-only" htmlFor="min">最小单笔金额</label>
            <Input id="min" inputMode="decimal" value={minTrade} onChange={(e) => setMinTrade(e.target.value)} placeholder="最小单笔（可选）" />
            <Button variant="primary" type="submit" disabled={busy}>{busy ? '生成中…' : '生成计划'}</Button>
          </form>
        )}
        <p className="caption">只买入，不卖出；按整手计算。</p>
        {error && <Alert tone="danger">{error}</Alert>}
      </section>

      <section className="section">
        <h2 className="section__title">最近计划</h2>
        {!state.lastPlan ? <Empty title="还没有计划。">输入投入金额，生成第一份买入计划。</Empty> : (
          <table className="table">
            <caption className="sr-only">最近计划</caption>
            <thead><tr><th>时间</th><th>投入</th><th className="is-secondary">计划买入</th><th className="is-secondary">剩余现金</th><th>状态</th><th /></tr></thead>
            <tbody>
              <tr>
                <td>{state.lastPlan.createdAt.slice(0, 10)}</td>
                <td className="num">{formatMoney(state.lastPlan.amountMicros, currency)}</td>
                <td className="num is-secondary">{formatMoney(state.lastPlan.plannedMicros, currency)}</td>
                <td className="num is-secondary">{formatMoney(state.lastPlan.cashLeftMicros, currency)}</td>
                <td><Tag tone={state.lastPlan.status === 'executed' ? 'ok' : state.lastPlan.status === 'abandoned' ? 'danger' : 'warn'}>{state.lastPlan.status === 'executed' ? '已执行' : state.lastPlan.status === 'abandoned' ? '已放弃' : '草稿'}</Tag></td>
                <td><Button size="small" onClick={() => navigate(`/plans/${state.lastPlan.id}`)}>查看</Button></td>
              </tr>
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
