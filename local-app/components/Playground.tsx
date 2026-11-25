import { useEffect, useRef, useState } from 'react';
import { api } from '@appdeploy/client';
import { Bot, Send, Settings2, ShieldCheck, Sparkles, Trash2, Wrench } from 'lucide-react';
import { useI18n } from './i18n';
import { translate, type Locale } from './locale-core';

type Message = { role: 'user' | 'assistant'; content: string; result?: RunResult };
type ToolEntry = { name: string; label: { 'zh-TW': string; en: string }; description: { 'zh-TW': string; en: string } };
type RunResult = {
  answer: string;
  toolCalls: { name: string; label: string; summary: string; count?: number }[];
  sourceLabel: 'sample' | 'published' | 'draft'; graphVersion: number; model: string;
  usage?: { inputTokens: number; outputTokens: number }; durationMs?: number;
};
export function localizeToolTrace(call: { name: string; count?: number }, tools: Pick<ToolEntry, 'name' | 'label'>[], locale: Locale) {
  return {
    label: tools.find(tool => tool.name === call.name)?.label[locale] || translate('工具執行', locale),
    summary: typeof call.count === 'number' && Number.isFinite(call.count)
      ? translate('已讀取 {count} 筆結果', locale, { count: call.count })
      : translate('工具執行完成', locale),
  };
}
export function prepareHistory(messages: { role: 'user' | 'assistant'; content: string }[], remainingBudget = 12000) {
  let budget = Math.max(0, Math.min(12000, Number.isFinite(remainingBudget) ? Math.floor(remainingBudget) : 0));
  return messages.slice(-8).reverse().map(message => {
    const content = message.content.slice(0, Math.min(2000, budget));
    budget -= content.length;
    return { role: message.role, content };
  }).filter(message => message.content.length > 0).reverse();
}
const errorCopy: Record<string, string> = {
  AUTH_REQUIRED: '登入已逾時，請重新登入。你的問題仍會保留。',
  AI_NOT_CONFIGURED: 'AI 尚未完成設定，請管理者確認服務金鑰。',
  RATE_LIMITED: '請求次數已達上限，請稍後再試。',
  RUN_IN_PROGRESS: '此請求仍在處理中，請勿重複送出。',
  RUN_FAILED: '無法取得回覆。請稍後重試；我不會以猜測補上答案。',
  RUN_COMPLETED: '此請求已處理完成。若要再次執行，請明確建立新請求。',
  INVALID_INPUT: '請確認問題與設定符合長度及範圍限制。',
};
export function playgroundErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return 'RUN_FAILED';
  const details = error as {
    status?: number; statusCode?: number;
    response?: { status?: number; statusCode?: number; data?: { errorCode?: string } };
  };
  const status = details.response?.status ?? details.response?.statusCode ?? details.status ?? details.statusCode;
  if (status === 401) return 'AUTH_REQUIRED';
  const code = details.response?.data?.errorCode;
  if (typeof code === 'string' && code in errorCopy) return code;
  return status === 429 ? 'RATE_LIMITED' : 'RUN_FAILED';
}

export function Playground({ sessionToken, onUnauthorized }: { sessionToken: string; onUnauthorized: () => void }) {
  const { locale, t } = useI18n();
  const [tools, setTools] = useState<ToolEntry[]>([]);
  const [models, setModels] = useState<string[]>(['gpt-6-luna']);
  const [configured, setConfigured] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [catalogRevision, setCatalogRevision] = useState(0);
  const [model, setModel] = useState('gpt-6-luna');
  const [source, setSource] = useState<'published' | 'draft'>('published');
  const [temperature, setTemperature] = useState(0.3);
  const [maxOutputTokens, setMaxOutputTokens] = useState(800);
  const [instructions, setInstructions] = useState('');
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [error, setError] = useState('');
  const locked = useRef(false);
  const pending = useRef<{ signature: string; requestId: string } | null>(null);
  const tokenRef = useRef(sessionToken);
  const unauthorizedRef = useRef(onUnauthorized);
  tokenRef.current = sessionToken;
  unauthorizedRef.current = onUnauthorized;
  const conversationEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    setConsent(false);
    setCatalogBusy(true);
    setCatalogError('');
    setConfigured(false);
    if (!sessionToken) { setCatalogBusy(false); return; }
    void api.post('/api/admin/playground/catalog', { sessionToken }).then((response: { data: { tools?: ToolEntry[]; models?: string[]; configured?: boolean } }) => {
      if (cancelled) return;
      setTools(response.data.tools || []);
      const available = (response.data.models || []).filter((value: string) => ['gpt-6-luna'].includes(value));
      setModels(available);
      setModel(current => available.includes(current) ? current : available[0] || 'gpt-6-luna');
      setConfigured(response.data.configured === true && available.length > 0);
    }).catch((reason: unknown) => {
      if (cancelled) return;
      const code = playgroundErrorCode(reason);
      setCatalogError(code);
      if (code === 'AUTH_REQUIRED') unauthorizedRef.current();
    }).finally(() => { if (!cancelled) setCatalogBusy(false); });
    return () => { cancelled = true; };
  }, [sessionToken, catalogRevision]);
  useEffect(() => { conversationEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [messages, busy]);
  const sourceName = (value: string) => t(value === 'draft' ? '管理草稿' : value === 'sample' ? '示範資料' : '已發布圖譜');
  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (locked.current || !consent || !configured || !sessionToken || !prompt.trim()) return;
    locked.current = true;
    setBusy(true);
    setError('');
    const question = prompt.trim();
    const token = sessionToken;
    const input = { source, locale, model, temperature, maxOutputTokens, instructions, prompt: question, history: prepareHistory(messages, 12000 - question.length - instructions.length) };
    const signature = JSON.stringify(input);
    if (!pending.current || pending.current.signature !== signature) pending.current = { signature, requestId: crypto.randomUUID() };
    setPendingPrompt(question);
    try {
      const response = await api.post('/api/admin/playground/run', { ...input, sessionToken: token, requestId: pending.current.requestId });
      if (tokenRef.current !== token) return;
      const result = response.data as RunResult;
      if (typeof result.answer !== 'string' || !result.answer.trim()) throw new Error('Missing answer');
      setMessages(current => [...current, { role: 'user', content: question }, { role: 'assistant', content: result.answer, result }]);
      setPrompt('');
      pending.current = null;
    } catch (reason) {
      if (tokenRef.current !== token) return;
      const code = playgroundErrorCode(reason);
      setError(code);
      if (code === 'AUTH_REQUIRED') unauthorizedRef.current();
    } finally {
      locked.current = false;
      setBusy(false);
      setPendingPrompt('');
    }
  }
  function clearConversation() {
    if (locked.current) return;
    setMessages([]); setPrompt(''); setError(''); pending.current = null;
  }
  return <section className="playground panel" aria-labelledby="playground-heading">
    <header className="playground-heading"><div><span className="playground-eyebrow"><Sparkles size={14} />{t('管理者專用')}</span><h2 id="playground-heading">{t('AI 實驗室')}</h2><p>{t('用自然語言探索圖譜，檢查 AI 如何找到答案。')}</p></div><span className="playground-readonly"><ShieldCheck size={15} />{t('唯讀工具')}</span></header>
    <div className="playground-layout">
      <aside className="playground-settings">
        <details open><summary><Settings2 size={16} />{t('執行設定')}</summary>
          <label className="field-label">{t('模型')}<select value={model} disabled={busy || catalogBusy} onChange={event => setModel(event.target.value)}>{models.map(item => <option key={item}>{item}</option>)}</select></label>
          <label className="field-label">{t('資料範圍')}<select value={source} disabled={busy} onChange={event => { setSource(event.target.value as 'published' | 'draft'); setConsent(false); setMessages([]); setError(''); pending.current = null; }}><option value="published">{t('已發布圖譜')}</option><option value="draft">{t('管理草稿')}</option></select></label>
          <p className="playground-note">{t('草稿不會發布，也不會修改圖譜。')} {t('切換資料範圍會開始新對話，避免混用草稿與已發布資料。')}</p>
          <label className="field-label">{t('回覆變化程度')} <span>{temperature.toFixed(1)}</span><input aria-label={t('回覆變化程度')} type="range" min="0" max="1" step="0.1" value={temperature} disabled={busy} onChange={event => setTemperature(Number(event.target.value))} /></label>
          <label className="field-label">{t('回覆長度上限')}<input type="number" min="256" max="1600" step="1" value={maxOutputTokens} disabled={busy} onChange={event => setMaxOutputTokens(Number(event.target.value))} /><small>{t('以 token 計算，範圍 256 至 1600。')}</small></label>
          <label className="field-label">{t('回答指引')}<textarea rows={4} maxLength={2000} value={instructions} disabled={busy} onChange={event => setInstructions(event.target.value)} placeholder={t('例如：先用繁體中文摘要，再列出證據與不確定之處。')} /><small>{instructions.length} / 2000</small></label>
        </details>
        <details className="playground-catalog"><summary><Wrench size={16} />{t('可使用的圖譜工具')} <span>{tools.length}</span></summary>
          {tools.map(tool => <article className="playground-tool" key={tool.name}><strong>{tool.label[locale]}</strong><span className="playground-function-name">{tool.name}</span><p>{tool.description[locale]}</p><small>{t('唯讀')}</small></article>)}
          {catalogBusy && <p role="status">{t('正在載入工具…')}</p>}
        </details>
      </aside>
      <div className="playground-chat">
        <div className="playground-chat-toolbar"><span>{sourceName(source)}</span><button className="quiet" onClick={clearConversation} disabled={busy || (!messages.length && !prompt)}><Trash2 size={14} />{t('清除對話')}</button></div>
        {catalogError && <div className="error-banner" role="alert"><span>{t(errorCopy[catalogError] || errorCopy.RUN_FAILED)}</span><button onClick={() => setCatalogRevision(value => value + 1)}>{t('重新載入')}</button></div>}
        {!catalogBusy && !catalogError && !configured && <div className="error-banner" role="alert">{t(errorCopy.AI_NOT_CONFIGURED)}</div>}
        <div className="playground-messages" role="log" aria-label={t('AI 對話')} aria-live="polite">
          {!messages.length && !busy && <div className="playground-empty"><Bot size={34} /><h3>{t('從一個問題開始')}</h3><p>{t('例如：哪些公司在機器人應用上存在競爭？請說明依據。')}</p></div>}
          {messages.map((message, index) => <article className={`playground-message ${message.role}`} key={index}><strong>{t(message.role === 'user' ? '你' : 'AI 助理')}</strong><p>{message.content}</p>{message.result && <details className="playground-trace"><summary>{t('查看執行紀錄')} · {(message.result.toolCalls || []).length} {t('次工具呼叫')}</summary><p>{message.result.model} · {sourceName(message.result.sourceLabel)} · {t('版本')} {message.result.graphVersion}</p>{message.result.usage && <p>{t('輸入')} {message.result.usage.inputTokens} / {t('輸出')} {message.result.usage.outputTokens} token{typeof message.result.durationMs === 'number' ? ` · ${(message.result.durationMs / 1000).toFixed(1)} ${t('秒')}` : ''}</p>}{(message.result.toolCalls || []).map((call, callIndex) => <div className="playground-tool-run" key={callIndex}><strong>{localizeToolTrace(call, tools, locale).label}</strong><span className="playground-function-name">{call.name}</span><p>{localizeToolTrace(call, tools, locale).summary}</p></div>)}</details>}</article>)}
          {busy && <><article className="playground-message user"><strong>{t('你')}</strong><p>{pendingPrompt}</p></article><p className="playground-waiting" role="status">{t('正在查詢圖譜並整理回覆…')}</p></>}
          <div ref={conversationEnd} />
        </div>
        <form className="playground-composer" onSubmit={event => void run(event)}>
          <div className="playground-consent"><p>{t('執行時，你的問題、回答指引、近期對話，以及查詢取得的圖譜資料會傳送至 OpenAI，並可能產生 API 使用費用。')}</p><label><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /><span>{t('我同意本次登入期間依所選資料範圍執行。')}</span></label></div>
          <label className="sr-only" htmlFor="playground-prompt">{t('輸入問題')}</label><textarea id="playground-prompt" rows={3} maxLength={4000} required disabled={busy} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={t('輸入想探索的公司、產品或關係…')} />
          {error && <div className="form-error" role="alert"><p>{t(errorCopy[error] || errorCopy.RUN_FAILED)}</p>{['RUN_COMPLETED', 'RUN_FAILED'].includes(error) && <button type="button" className="quiet" disabled={busy} onClick={() => { pending.current = null; setError(''); }}>{t('準備新請求（再次執行可能產生費用）')}</button>}</div>}
          <div className="playground-submit"><span>{prompt.length} / 4000</span><button className="primary" type="submit" disabled={busy || catalogBusy || !configured || !consent || !prompt.trim() || !sessionToken || maxOutputTokens < 256 || maxOutputTokens > 1600 || !Number.isInteger(maxOutputTokens)}><Send size={15} />{t(busy ? '處理中…' : '執行')}</button></div>
          <p className="playground-note">{t('對話僅保留於目前頁面；重新整理或登出後清除。AI 回答可能有誤，請檢查來源。')}</p>
        </form>
      </div>
    </div>
  </section>;
}
