import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { cls } from './format.js';

export const ToastContext = createContext(() => {});
export function useToast() { return useContext(ToastContext); }

export function Button({ variant = 'secondary', size, type = 'button', children, ...props }) {
  return <button type={type} className={cls('btn', `btn--${variant}`, size && `btn--${size}`)} {...props}>{children}</button>;
}

export function Field({ label, hint, error, children, id }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      {children}
      {hint && <p className="field__hint">{hint}</p>}
      {error && <p className="field__error">{error}</p>}
    </div>
  );
}

export function Input({ invalid, ...props }) {
  return <input className={cls('input', invalid && 'input--invalid')} {...props} />;
}

export function Select({ value, onChange, options, label, id, disabled }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const choose = (index) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  };
  return (
    <div className={cls('select', open && 'select--open', disabled && 'select--disabled')} ref={root}>
      <button
        type="button" id={id} className="select__button" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((a) => Math.min(options.length - 1, a + 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          if (event.key === 'Enter' && open) { event.preventDefault(); choose(active); }
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        <span className={selected ? '' : 'select__placeholder'}>{selected?.label ?? label ?? '请选择'}</span>
        <span className="select__arrow" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <ul className="select__menu" role="listbox" id={listId}>
          {options.map((option, index) => (
            <li key={option.value} role="option" aria-selected={option.value === value}>
              <button type="button" className={cls('select__option', index === active && 'is-active')} onClick={() => choose(index)} onMouseEnter={() => setActive(index)}>
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Tag({ tone = 'default', children }) {
  return <span className={cls('tag', tone !== 'default' && `tag--${tone}`)}>{children}</span>;
}

export function Dialog({ title, children, onClose, footer, confirmText = '确认', onConfirm, danger = false, busy = false }) {
  const titleId = useId();
  const panel = useRef(null);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    const first = panel.current?.querySelector('input, select, button');
    first?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panel}>
        <h2 className="dialog__title" id={titleId}>{title}</h2>
        <div className="dialog__body">{children}</div>
        <div className="dialog__footer">
          {footer ?? (
            <>
              <Button onClick={onClose} disabled={busy}>取消</Button>
              <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>{busy ? '处理中…' : confirmText}</Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function Alert({ tone = 'warning', children }) {
  return <div className={cls('alert', `alert--${tone}`)} role="status">{children}</div>;
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <h3 className="empty__title">{title}</h3>
      {children && <p className="empty__text">{children}</p>}
      {action}
    </div>
  );
}

export function Bar({ valueBp, targetBp }) {
  const value = Math.max(0, Math.min(10000, valueBp));
  const target = Math.max(0, Math.min(10000, targetBp));
  return (
    <div className="bar" aria-hidden="true">
      <div className="bar__fill" style={{ width: `${value / 100}%` }} />
      <div className="bar__target" style={{ left: `${target / 100}%` }} />
    </div>
  );
}

export function Spinner({ label = '正在读取…' }) {
  return <p className="loading" role="status">{label}</p>;
}

export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try { setState({ loading: false, error: null, data: await fn() }); }
    catch (error) { setState({ loading: false, error, data: null }); }
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data })) };
}

export function DetailList({ details }) {
  if (!details?.length) return null;
  return (
    <ul className="detail-list">
      {details.slice(0, 20).map((detail, index) => (
        <li key={index}>{detail.line ? `第 ${detail.line} 行：` : detail.field ? `${detail.field}：` : ''}{detail.message}</li>
      ))}
    </ul>
  );
}
