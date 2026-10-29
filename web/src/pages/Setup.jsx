import { useState } from 'react';
import { api } from '../api.js';
import { Alert, Button, Field, Input, Select } from '../components.jsx';

export default function Setup({ refresh }) {
  const [name, setName] = useState('长期组合');
  const [currency, setCurrency] = useState('CNY');
  const [template, setTemplate] = useState('three_sleeve');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api('/api/setup', { method: 'POST', body: { portfolioName: name, baseCurrency: currency, template } }); await refresh(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return (
    <main className="setup">
      <p className="eyebrow">Ballast 压舱</p>
      <h1 className="page-title">先建立你的组合</h1>
      <p className="muted">数据只保存在本机。Ballast 不连接券商，不抓取行情。</p>
      <form className="setup__form" onSubmit={submit}>
        <Field label="组合名称" id="setup-name"><Input id="setup-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
        <Field label="基础币种" id="setup-currency"><Select id="setup-currency" value={currency} onChange={setCurrency} options={[{ value: 'CNY', label: '人民币 CNY' }, { value: 'USD', label: '美元 USD' }, { value: 'EUR', label: '欧元 EUR' }, { value: 'HKD', label: '港币 HKD' }, { value: 'JPY', label: '日元 JPY' }, { value: 'GBP', label: '英镑 GBP' }]} /></Field>
        <fieldset className="choices">
          <legend>目标模板</legend>
          <label><input type="radio" name="template" checked={template === 'three_sleeve'} onChange={() => setTemplate('three_sleeve')} /> 三分类：股票 60% / 债券 30% / 现金 10%</label>
          <label><input type="radio" name="template" checked={template === 'blank'} onChange={() => setTemplate('blank')} /> 单分类：默认 100%</label>
        </fieldset>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button variant="primary" type="submit" disabled={busy || !name.trim()}>{busy ? '创建中…' : '开始使用'}</Button>
      </form>
    </main>
  );
}
