import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';
import { Spinner, ToastContext } from './components.jsx';
import Overview from './pages/Overview.jsx';
import PlanDetail from './pages/PlanDetail.jsx';
import Holdings from './pages/Holdings.jsx';
import Targets from './pages/Targets.jsx';
import Plans from './pages/Plans.jsx';
import Settings from './pages/Settings.jsx';
import Setup from './pages/Setup.jsx';
import NotFound from './pages/NotFound.jsx';
import { cls } from './format.js';

const StateContext = createContext(null);
export function useAppState() { return useContext(StateContext); }

function Toast({ message, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [message, onDone]);
  return <div className="toast" role="status">{message}</div>;
}

function PlanRoute({ id, state, refresh, navigate }) {
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setPlan(await api(`/api/plans/${id}`)); } catch (err) { setError(err.message); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  if (error) return <p className="alert alert--danger">{error}</p>;
  if (!plan) return <Spinner />;
  return <PlanDetail id={id} state={state} plan={plan} reloadPlan={load} refresh={refresh} navigate={navigate} />;
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [menu, setMenu] = useState(false);

  const navigate = useCallback((to) => {
    if (to === window.location.pathname) return;
    window.history.pushState({}, '', to);
    setPath(to);
    setMenu(false);
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const refresh = useCallback(async () => {
    try { setState(await api('/api/state')); setError(''); }
    catch (err) { setError(err.message); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (state && !state.setupComplete && path !== '/setup') navigate('/setup');
    if (state?.setupComplete && path === '/setup') navigate('/');
  }, [state, path, navigate]);

  const say = useCallback((message) => setToast(message), []);
  if (error) return <main className="boot"><div className="alert alert--danger">{error} <button className="link" onClick={refresh}>重试</button></div></main>;
  if (!state) return <main className="boot"><Spinner /></main>;
  if (!state.setupComplete) return <ToastContext.Provider value={say}><Setup refresh={refresh} />{toast && <Toast message={toast} onDone={() => setToast('')} />}</ToastContext.Provider>;

  const planMatch = path.match(/^\/plans\/([^/]+)$/);
  let page;
  if (path === '/') page = <Overview state={state} refresh={refresh} navigate={navigate} />;
  else if (planMatch) page = <PlanRoute id={planMatch[1]} state={state} refresh={refresh} navigate={navigate} />;
  else if (path === '/holdings') page = <Holdings state={state} refresh={refresh} navigate={navigate} />;
  else if (path === '/targets') page = <Targets state={state} refresh={refresh} />;
  else if (path === '/plans') page = <Plans state={state} navigate={navigate} />;
  else if (path === '/settings') page = <Settings state={state} refresh={refresh} />;
  else page = <NotFound navigate={navigate} />;

  const links = [
    ['/', '总览'], ['/holdings', '持仓'], ['/targets', '目标'], ['/plans', '计划'], ['/settings', '设置'],
  ];
  return (
    <StateContext.Provider value={state}>
      <ToastContext.Provider value={say}>
        <div className="shell">
          <aside className={cls('sidebar', menu && 'sidebar--open')}>
            <button className="sidebar__brand" onClick={() => navigate('/')}>Ballast<span>压舱</span></button>
            <nav className="nav" aria-label="主导航">
              {links.map(([to, label]) => (
                <button key={to} className={cls('nav__link', (to === '/' ? path === '/' : path.startsWith(to)) && 'is-active')} onClick={() => navigate(to)}>{label}</button>
              ))}
            </nav>
            <div className="sidebar__foot">
              {state.demo && <p className="caption">示例数据</p>}
              <p className="caption">本机 · v0.1.0</p>
            </div>
          </aside>
          {menu && <button className="drawer-backdrop" aria-label="关闭菜单" onClick={() => setMenu(false)} />}
          <div className="main">
            <header className="topbar">
              <button className="topbar__menu" aria-label="打开菜单" onClick={() => setMenu((v) => !v)}>菜单</button>
              <button className="sidebar__brand sidebar__brand--small" onClick={() => navigate('/')}>Ballast</button>
            </header>
            <main className="content">{page}</main>
          </div>
        </div>
        {toast && <Toast message={toast} onDone={() => setToast('')} />}
      </ToastContext.Provider>
    </StateContext.Provider>
  );
}
