import { useI18n } from './i18n';
import Head from 'next/head';
import { useEffect, useRef, useState } from 'react';
import { api } from '@appdeploy/client';
import { LogIn, LogOut, Network, RefreshCw, LockKeyhole } from 'lucide-react';
import { Graph } from './types';
import { GraphExplorer } from './GraphExplorer';
import { Workspace } from './Workspace';
import { Playground } from './Playground';
import { PublishControls } from './PublishControls';

const SESSION_KEY = 'goodmind.admin.session';
const statusOf = (error: unknown): number | undefined => {
  const value = error as { status?: number; statusCode?: number; response?: { status?: number; statusCode?: number } };
  return value?.response?.status || value?.response?.statusCode || value?.status || value?.statusCode;
};
export function AppShell({ workspace = false }: { workspace?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const brand = locale === 'en' ? 'GoodMind' : '股脈';
  const [graph, setGraph] = useState<Graph | null>(null);
  const [publicPublished, setPublicPublished] = useState(false);
  const [version, setVersion] = useState(0);
  const [publishedVersion, setPublishedVersion] = useState(0);
  const pendingPublish = useRef<{ version: number; id: string } | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const pendingSave = useRef<{ payload: string; version: number; id: string } | null>(null);
  function remember(token: string | null) {
    setSessionToken(token);
    try { if (token) sessionStorage.setItem(SESSION_KEY, token); else sessionStorage.removeItem(SESSION_KEY); } catch { /* usable without storage */ }
  }
  async function load(token = sessionToken) {
    setLoading(true);
    setError('');
    try {
      if (workspace && !token) return;
      const result = workspace
        ? await api.post('/api/admin/graph', { sessionToken: token })
        : await api.get('/api/graph');
      setGraph(result.data.graph);
      if (!workspace) setPublicPublished(result.data.published === true);
      setVersion(result.data.version);
      if (workspace) setPublishedVersion(result.data.publishedVersion ?? 0);
    } catch (err) {
      if (workspace && statusOf(err) === 401) {
        remember(null);
        setAuthError('登入已失效，請重新登入。');
      } else setError('暫時無法載入資料，請稍後重試。');
    } finally { setLoading(false); }
  }
  useEffect(() => {
    let token: string | null = null;
    if (workspace) {
      try { token = sessionStorage.getItem(SESSION_KEY); } catch { /* session-only login */ }
      setSessionToken(token);
    }
    void load(token);
  }, [workspace]);
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError('');
    try {
      const response = await api.post('/api/admin/login', { username, password });
      remember(response.data.sessionToken);
      setPassword('');
      // Keep an in-progress draft mounted when reauthenticating after expiry.
      if (!graph) await load(response.data.sessionToken);
    } catch (err) {
      setAuthError(statusOf(err) === 429 ? '嘗試次數過多，請稍後再試。' : statusOf(err) === 401 ? '帳號或密碼不正確。' : '暫時無法登入，請稍後重試。');
      setPassword('');
    } finally { setAuthBusy(false); }
  }
  async function signOut() {
    setAuthBusy(true);
    try {
      await api.post('/api/admin/logout', { sessionToken });
      remember(null);
      setGraph(null);
      pendingSave.current = null;
      setAuthError('');
    } catch (err) {
      if (statusOf(err) === 401) { remember(null); setGraph(null); }
      else setError('暫時無法登出，請重試。');
    } finally { setAuthBusy(false); }
  }
  async function save(next: Graph) {
    const payload = JSON.stringify(next);
    if (!pendingSave.current || pendingSave.current.payload !== payload || pendingSave.current.version !== version)
      pendingSave.current = { payload, version, id: crypto.randomUUID() };
    try {
      const result = await api.put('/api/admin/graph', { graph: next, version, requestId: pendingSave.current.id, sessionToken });
      pendingSave.current = null;
      setGraph(result.data.graph);
      setVersion(result.data.version);
    } catch (err) {
      if (statusOf(err) === 401) { remember(null); setAuthError('登入已失效，請重新登入。'); }
      throw new Error(statusOf(err) === 409 ? '資料已在其他視窗更新，請重新載入後再編輯。' : '儲存未完成，請保留內容並重試。');
    }
  }
  async function publish() {
    if (!pendingPublish.current || pendingPublish.current.version !== version)
      pendingPublish.current = { version, id: crypto.randomUUID() };
    try {
      const result = await api.post('/api/admin/publish', { sessionToken, version, requestId: pendingPublish.current.id });
      setPublishedVersion(result.data.publishedVersion);
      pendingPublish.current = null;
    } catch (err) {
      if (statusOf(err) === 401) { remember(null); setAuthError('登入已失效，請重新登入。'); }
      throw new Error(statusOf(err) === 409 ? '草稿已變更，請重新載入並確認內容後再發布。' : '發布未完成，請重試。');
    }
  }
  const login = (
    <section className="admin-login" aria-label={t('管理者登入')}>
      <div className="admin-lock"><LockKeyhole size={28} /></div>
      <p className="admin-eyebrow">{t('管理者專用')}</p>
      <h2>{t('登入工作區')}</h2>
      <p>{t('使用管理帳號安全管理圖譜與資料。')}</p>
      <form onSubmit={signIn}>
        <label>{t('帳號')}<input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required maxLength={200} disabled={authBusy} /></label>
        <label>{t('密碼')}<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required maxLength={1000} disabled={authBusy} /></label>
        {authError && <p className="error-banner" role="alert">{t(authError)}</p>}
        <button className="primary" type="submit" disabled={authBusy}><LogIn size={17} />{t(authBusy ? '正在登入…' : '登入')}</button>
      </form>
      <a href="https://good-mind-mxn7j5.v2.appdeploy.ai/good-mind/">{t('返回知識圖譜')}</a>
    </section>
  );
  return <>
    <Head>
      <title>{`${workspace ? t('工作區') : t('知識圖譜')} · ${brand}`}</title>
      <meta name="description" content={t('探索公司、產品、產業與證據之間的脈絡。')} />
      {workspace && <meta name="robots" content="noindex, nofollow" />}
    </Head>
    <header className="topbar">
      <a className="brand" href="https://good-mind-mxn7j5.v2.appdeploy.ai/good-mind/"><Network size={25} /><span>{brand}</span></a>
      <nav aria-label={t('主要導覽')}><a href="https://good-mind-mxn7j5.v2.appdeploy.ai/good-mind/" className={!workspace ? 'active' : ''}>{t('知識圖譜')}</a></nav>
      <div className="account">
        <div className="language-switch" role="group" aria-label={t('語言')}>
          <button aria-pressed={locale === 'zh-TW'} lang="zh-TW" onClick={() => setLocale('zh-TW')}>{t('繁中')}</button>
          <button aria-pressed={locale === 'en'} lang="en" onClick={() => setLocale('en')}>EN</button>
        </div>
        {workspace && sessionToken && <button className="quiet" disabled={authBusy} onClick={() => void signOut()}><LogOut size={16} /><span>{t('登出')}</span></button>}
      </div>
    </header>
    <main className={workspace ? 'workspace-app' : 'graph-workbench'}>
      <h1 className="sr-only">{workspace ? t('工作區') : t('知識圖譜')}</h1>
      {error && <div className="error-banner" role="alert"><span>{t(error)}</span><button onClick={() => void load()}><RefreshCw size={14} />{t('重新載入')}</button></div>}
      {loading ? <div className="empty-panel" role="status">{t('正在載入知識圖譜…')}</div> : workspace ? <>
        {graph && <div inert={!sessionToken ? true : undefined}><PublishControls draftVersion={version} publishedVersion={publishedVersion} onPublish={publish} /><Workspace playground={<Playground sessionToken={sessionToken ?? ''} onUnauthorized={() => { remember(null); setAuthError('登入已失效，請重新登入。'); }} />} suspended={!sessionToken} graph={graph} user={{ userId: 'administrator' }} onSave={save} onSignIn={async () => undefined} /></div>}
        {!sessionToken && (graph ? <div className="admin-reauth-backdrop" role="dialog" aria-modal="true">{login}</div> : login)}
      </> : graph ? <GraphExplorer graph={graph} privateGraph={false} publishedGraph={publicPublished} /> : null}
      {!workspace && <footer><span>{t(publicPublished ? '資料由管理者發布，請依來源與驗證狀態判讀。' : '示範來源尚未重新查證；競爭僅為分析推論。')}</span><details><summary>{t('來源說明')}</summary><p>{t(publicPublished ? '公開圖譜來自管理者確認發布的版本。關係是否經過查證，請查看各項資料的來源與驗證狀態。' : '示範資料僅供探索；競爭關係是分析推論，不代表已確認的商業往來。')}</p></details></footer>}
    </main>
  </>;
}
