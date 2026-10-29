import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Empty, Spinner, Tag } from '../components.jsx';
import { formatMoney, formatPercent } from '../format.js';

export default function Plans({ state, navigate }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/plans').then(setData).catch((err) => setError(err.message)); }, []);
  const currency = state?.portfolio?.baseCurrency ?? 'CNY';
  if (error) return <p className="alert alert--danger">{error}</p>;
  if (!data) return <Spinner />;
  return (
    <>
      <header className="page-head"><div><p className="eyebrow">计划</p><h1 className="page-title">买入计划</h1></div></header>
      {data.items.length === 0 ? <Empty title="还没有计划。">到总览页输入投入金额，生成第一份计划。</Empty> : (
        <table className="table">
          <caption className="sr-only">计划历史</caption>
          <thead><tr><th>时间</th><th className="num">投入</th><th className="num">计划买入</th><th className="num">剩余现金</th><th className="num">买入前最大偏离</th><th className="num">买入后最大偏离</th><th>状态</th><th /></tr></thead>
          <tbody>
            {data.items.map((p) => (
              <tr key={p.id}>
                <td>{p.createdAt.slice(0, 10)}</td>
                <td className="num">{formatMoney(p.amountMicros, currency)}</td>
                <td className="num">{formatMoney(p.plannedMicros, currency)}</td>
                <td className="num">{formatMoney(p.cashLeftMicros, currency)}</td>
                <td className="num">{formatPercent(p.maxDriftBeforeBp)}</td>
                <td className="num">{formatPercent(p.maxDriftAfterBp)}</td>
                <td><Tag tone={p.status === 'executed' ? 'ok' : p.status === 'abandoned' ? 'danger' : 'warn'}>{p.status === 'executed' ? '已执行' : p.status === 'abandoned' ? '已放弃' : '草稿'}</Tag></td>
                <td><button className="link" onClick={() => navigate(`/plans/${p.id}`)}>查看</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
