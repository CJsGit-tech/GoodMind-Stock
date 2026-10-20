import { useFooterVersion } from './research-footer';
import { LoadingSkeleton, PendingIndicator } from './loading';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, CircleAlert, RotateCcw, Upload } from 'lucide-react';
import {
  ActiveEtfAuthorView, EtfTabs, EtfTabPanel, ReportBody,
  type AuthorProps, type ReaderEtfReport,
} from './active-etf';
import {
  QA_DATA_SCOPE, MAX_CHUNK_BYTES, MAX_CHUNK_FACTS, MAX_CHUNKS, MAX_SNAPSHOT_BYTES,
  MAX_SNAPSHOT_PAGES, MAX_SNAPSHOT_PAGE_BYTES, bytes, canonical, parseManifest,
} from '../shared/etf-data-contract';
import type {
  Batch, BatchManifest, DataFund, DataLineage, FactInput, ReceiptResult,
  SnapshotManifest, SourceRef, ValidationSummary,
} from '../shared/etf-data-contract';
import { parseReportJson } from '../shared/etf-contract';
import './etf-data-author.css';
import { MarkdownEtfAuthor } from './etf-markdown-author';

type Endpoint = (path: string, payload: Record<string, unknown>) => Promise<unknown>;
type WorkspaceProps = AuthorProps & { requestEndpoint: Endpoint };
type Notice = { tone: 'neutral' | 'success' | 'error'; message: string };
type ValidationRetry = { path: string; expectedRevision: number };
type Pending = { requestId: string; targetId: string; operation: string; retry?: ValidationRetry };
function validationRetry(path: string, payload: Record<string, unknown>, targetId: string): ValidationRetry | undefined {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(targetId) || path !== '/api/admin/etf-data/batches/' + encodeURIComponent(targetId) + '/validate' || !Number.isSafeInteger(payload.expectedRevision) || (payload.expectedRevision as number) < 1) return undefined;
  return { path, expectedRevision: payload.expectedRevision as number };
}
function storedPending(name: string): Pending | null {
  const item = sessionRead<Pending | null>(name + ':pending', null);
  if (!item || typeof item.requestId !== 'string' || !/^[A-Za-z0-9._-]{1,150}$/.test(item.requestId) || typeof item.targetId !== 'string' || typeof item.operation !== 'string') return null;
  const retry = item.retry && validationRetry(item.retry.path, { expectedRevision: item.retry.expectedRevision }, item.targetId);
  return { requestId: item.requestId, targetId: item.targetId, operation: item.operation, ...(retry ? { retry } : {}) };
}
type Head = { publicationId: string; version: number; hash: string; updatedAt: string };
type DataPackage = { manifest: BatchManifest; chunks: { facts: FactInput[] }[] };
type BatchSummary = Pick<Batch, 'id' | 'revision' | 'status' | 'publicationId' | 'updatedAt'> & {
  scopeId: string; requestedDate: string; receivedChunks: number; chunkCount: number;
};
type PrivatePreview = {
  batchId: string; revision: number; status: string; funds: DataFund[]; sourceRefs: SourceRef[];
  validation: ValidationSummary | null; currentHead: Head | null; nextCursor: string | null; reason?: string;
};
type PreviewRowKind = 'holding' | 'allocation' | 'change';
function mergePreviewRows(left: Record<string, unknown>[], right: Record<string, unknown>[], kind: PreviewRowKind) {
  const fields = kind === 'holding' ? ['securityId', 'sourceDocumentId', 'sourceRowKey']
    : kind === 'allocation' ? ['industryId', 'taxonomyVersion']
      : ['sourceDocumentId', 'securityId', 'startDate', 'endDate', 'sourceDate'];
  return [...new Map([...left, ...right].map(row => [
    canonical(fields.map(field => row[field] ?? null)), row,
  ])).values()];
}
function preciseWeightSubtotal(row: Record<string, unknown>): string {
  const value = row.knownWeightSumPct as { value?: string | null; precision?: string } | undefined;
  const count = row.knownWeightCount;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0
    || value?.precision !== 'exact' || typeof value.value !== 'string'
    || (count === 0 && !/^-?0(?:\.0+)?$/.test(value.value))) {
    return '無精確權重可彙總';
  }
  return value.value + '%';
}
function mergePrivatePreview(previous: PrivatePreview, incoming: PrivatePreview): PrivatePreview {
  const funds = new Map(previous.funds.map(fund => [fund.setId, fund]));
  for (const fund of incoming.funds) {
    const old = funds.get(fund.setId);
    funds.set(fund.setId, {
      ...old, ...fund,
      holdings: mergePreviewRows(old?.holdings || [], fund.holdings, 'holding'),
      allocations: mergePreviewRows(old?.allocations || [], fund.allocations, 'allocation'),
      reportedChanges: mergePreviewRows(old?.reportedChanges || [], fund.reportedChanges, 'change'),
    });
  }
  const sources = new Map([...previous.sourceRefs, ...incoming.sourceRefs].map(source => [
    canonical([source.sourceDocumentId, source.contentHash]), source,
  ]));
  return { ...incoming, funds: [...funds.values()], sourceRefs: [...sources.values()] };
}
type Body = {
  id: string; reportId: string; baseRevision: number; expectedPublishedVersion: number;
  revision: number; manifest: SnapshotManifest; sealed: boolean; reviewed: boolean;
  reportSummary: { title: string; excerpt: string; period: { start: string; end: string }; evidenceDate: string } | null;
  dataLineage: DataLineage | null; reviewHash: string | null; publishedVersion?: number;
};
type BodyValidation = { blockingErrors: string[]; warnings: string[]; reviewHash: string | null };
type Plan = {
  requestId: string; batchId: string; revision: number; publicationId: string; version: number;
  scopeId: string; tradeDate: string; setIds: string[]; reviewHash: string; dataLineage: DataLineage;
};
const taskTabs = [
  { id: 'import', label: '資料匯入' }, { id: 'validation', label: '驗證與缺口' },
  { id: 'preview', label: '預覽' }, { id: 'history', label: '發布紀錄' },
];
const labels: Record<string, string> = {
  uploading: '匯入中', validating: '驗證中', needs_attention: '待修正', ready: '可審閱',
  reviewed: '已審閱', published: '已發布', cancelled: '已取消',
  complete: '完整清單', partial: '部分清單', unknown: '未知', verified: '已核對',
  unverified: '未核對', conflict: '有衝突', confirmed: '日期已確認', unconfirmed: '日期未確認',
  fund: '基金', security: '證券', industry: '產業', assignment: '分類對應', session: '交易日',
  metrics: '基金數值', holding: '完整持股', change: '來源異動', source: '來源文件',
};
function unpack<T>(value: unknown): T {
  const result = value && typeof value === 'object' && 'data' in value ? (value as { data: unknown }).data : value;
  return (result && typeof result === 'object' && 'data' in result ? (result as { data: unknown }).data : result) as T;
}
function sessionRead<T>(key: string, fallback: T): T {
  try { return JSON.parse(window.sessionStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function sessionWrite(key: string, value: unknown) {
  try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Saved server tasks remain recoverable. */ }
}
function isAuthorRoute() { return window.location.hash.split('?')[0] === '#/admin/active-etf'; }
function routeParams() { return new URLSearchParams(window.location.hash.split('?')[1] || ''); }
function routeUpdate(values: Record<string, string | null>, push = false) {
  const params = routeParams();
  Object.entries(values).forEach(([key, value]) => { if (value === null) params.delete(key); else params.set(key, value); });
  const next = '#/admin/active-etf?' + params.toString();
  if (window.location.hash === next) return;
  if (push) window.location.hash = next.slice(1); else window.history.replaceState(window.history.state, '', next);
}
function tabValue(key: string) {
  const value = routeParams().get(key);
  return taskTabs.some(tab => tab.id === value) ? value! : 'import';
}
function today() { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function errorDetails(caught: unknown) {
  const value = caught as { status?: number; statusCode?: number; message?: string; response?: { status?: number; data?: unknown } };
  const data = unpack<{ error?: string; errorCode?: string; state?: string; errors?: string[] }>(value.response?.data || {});
  return { status: value.status || value.statusCode || value.response?.status,
    state: data.state, message: typeof data.error === 'string' ? (data.error + (Array.isArray(data.errors) ? ' ' + data.errors.join('；') : '')).slice(0, 3000) : value.message || '資料暫時無法讀取。' };
}
async function deadline<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof window.setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new Error('操作逾時，結果尚未確認。')), 30000); });
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timer));
}
async function rawHash(value: string) {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(part => part.toString(16).padStart(2, '0')).join('');
}
function useTaskIO(request: Endpoint, name: string) {
  const requestRef = useRef(request); requestRef.current = request;
  const active = useRef(true); const busyRef = useRef(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<Pending | null>(() => storedPending(name));
  const [retryReady, setRetryReady] = useState(false);
  const pendingRef = useRef(pending);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  function pendingChange(value: Pending | null) {
    pendingRef.current = value; if (active.current) { setPending(value); setRetryReady(false); } sessionWrite(name + ':pending', value);
  }
  async function run<T>(operation: string, path: string, payload: Record<string, unknown>, mutation = false, targetId = '', retryOriginal = false): Promise<T | null> {
    if (busyRef.current) return null;
    const original = pendingRef.current;
    const exactRetry = retryOriginal && retryReady && original?.retry && original.targetId === targetId && path === original.retry.path && payload.requestId === original.requestId && payload.expectedRevision === original.retry.expectedRevision && Object.keys(payload).every(key => ['requestId', 'expectedRevision'].includes(key));
    if (mutation && original && !exactRetry) { setNotice({ tone: 'neutral', message: '上次操作尚未確認，請先查詢狀態。' }); return null; }
    busyRef.current = true; setBusy(operation); setNotice(null);
    const sent = mutation ? { ...payload, requestId: payload.requestId || crypto.randomUUID() } : payload;
    const retry = mutation ? validationRetry(path, sent, targetId) : undefined;
    if (mutation) pendingChange({ requestId: String(sent.requestId), targetId, operation, ...(retry ? { retry } : {}) });
    try {
      const result = unpack<T>(await deadline(requestRef.current(path, sent)));
      if (!active.current) return null;
      if (retry) {
        const receipt = result as ReceiptResult;
        if (receipt?.state !== 'committed' || receipt.requestId !== String(sent.requestId)) {
          setNotice({ tone: 'neutral', message: '驗證回應尚未確認同一請求成功，請保留原請求並查詢狀態。' }); return null;
        }
      }
      if (mutation) pendingChange(null);
      return result;
    } catch (caught) {
      if (!active.current) return null;
      const error = errorDetails(caught);
      const known = error.status && error.status >= 400 && error.status < 500 && error.status !== 429 && error.state !== 'unresolved';
      if (mutation && known) pendingChange(null);
      setNotice({ tone: mutation && !known ? 'neutral' : 'error', message:
        error.status === 401 || error.status === 403 ? '作者權限已失效，請重新登入後恢復已保存任務。' :
        mutation && !known ? '操作結果尚未確認。請保留同一請求並查詢狀態，不要重新提交。' : error.message });
      return null;
    } finally { busyRef.current = false; if (active.current) setBusy(''); }
  }
  async function check() {
    const marker = pendingRef.current; if (!marker) return null;
    const result = await run<ReceiptResult>('查詢操作狀態', '/api/admin/etf-data/requests/' + encodeURIComponent(marker.requestId) + '/status', {});
    if (result && result.requestId !== marker.requestId) {
      setRetryReady(false); setNotice({ tone: 'neutral', message: '狀態回應與原請求不符，未清除待確認操作。請稍後再查詢。' }); return null;
    }
    if (result?.state === 'committed' || result?.state === 'known_failed') {
      pendingChange(null); setNotice({ tone: result.state === 'committed' ? 'success' : 'error', message: result.state === 'committed' ? '已確認上次操作成功；將載入伺服器保存版本。' : '已確認上次操作未套用，保存的公開版本維持原狀。' });
    } else if (result?.state === 'unresolved') {
      setRetryReady(!!marker.retry);
      setNotice({ tone: 'neutral', message: marker.retry ? '結果仍未確認。可稍後查詢，或以原請求重新確認同一版本的驗證；先前操作可能仍在處理。' : '結果仍未確認。請稍後再次查詢；這次操作沒有可安全重送的原始驗證資訊。' });
    }
    return result;
  }
  async function retryValidation() {
    const marker = pendingRef.current;
    if (!marker?.retry || !retryReady) return null;
    return run<ReceiptResult>(marker.operation, marker.retry.path, { requestId: marker.requestId, expectedRevision: marker.retry.expectedRevision }, true, marker.targetId, true);
  }
  return { busy, notice, setNotice, pending, run, check, retryReady, retryValidation };
}
type IO = ReturnType<typeof useTaskIO>;
function Feedback({ io, recover }: { io: IO; recover: (receipt: ReceiptResult) => void }) {
  return <>{io.busy && <PendingIndicator>{io.busy}…</PendingIndicator>}{io.notice && <div className={'etf-notice ' + io.notice.tone} role={io.notice.tone === 'error' ? 'alert' : 'status'}><CircleAlert size={18} aria-hidden='true' /><span>{io.notice.message}</span></div>}
    {io.pending && <section className='etf-pending' role='status'><strong>{io.busy && io.busy !== '查詢操作狀態' ? '正在處理，請等候結果' : '上次操作尚未確認'}</strong><p>先查詢相同請求的結果，再繼續匯入或發布。請求識別：<code style={{ overflowWrap: 'anywhere' }}>{io.pending.requestId}</code></p><button type='button' disabled={!!io.busy} onClick={() => void io.check().then(value => { if (value?.state === 'committed') recover(value); })}>查詢操作狀態</button>{io.retryReady && io.pending.retry && <button type='button' disabled={!!io.busy} onClick={() => void io.retryValidation().then(value => { if (value?.state === 'committed') recover(value); })}>以原請求重新確認驗證</button>}</section>}</>;
}
function Confirm({ title, children, label, onCancel, onConfirm, busy = '' }: {
  title: string; children: ReactNode; label: string; onCancel: () => void; onConfirm: () => void; busy?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
      if (event.key !== 'Tab') return;
      const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons[buttons.length - 1]?.focus(); }
      else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) { event.preventDefault(); buttons[0]?.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className='etf-confirm-backdrop'><div ref={ref} className='etf-confirm-dialog' role='dialog' aria-modal='true' aria-labelledby='etf-task-confirm-title'>
    <h2 id='etf-task-confirm-title'>{title}</h2>{busy && <PendingIndicator>{busy}…</PendingIndicator>}{children}<div><button type='button' onClick={onCancel}>返回檢查</button><button type='button' onClick={onConfirm}>{label}</button></div>
  </div></div>;
}
export function EtfAuthorWorkspace(props: WorkspaceProps) {
  const [workflow, setWorkflow] = useState(() => routeParams().get('workflow') || 'reports');
  const [snapshotRaw, setSnapshotRaw] = useState('');
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const [destination, setDestination] = useState<string | null>(null);
  useEffect(() => { props.onDirtyChange(dirty); }, [dirty]);
  useEffect(() => {
    const sync = () => {
      if (!isAuthorRoute()) return;
      const next = routeParams().get('workflow') || 'reports';
      if (next === workflow) return;
      if (dirtyRef.current) { routeUpdate({ workflow }); setDestination(next); }
      else setWorkflow(next);
    };
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, [workflow]);
  function navigate(next: string) {
    if (dirtyRef.current) { setDestination(next); return; }
    setDirty(false); setWorkflow(next); routeUpdate({ workflow: next }, true);
  }
  function openSavedSnapshot(bodyId: string) {
    dirtyRef.current = false; setSnapshotRaw(''); setDirty(false); setWorkflow('snapshot');
    routeUpdate({ workflow: 'snapshot', bodyId, snapshotTab: 'import' });
  }
  function openSnapshot(raw: string) {
    dirtyRef.current = false; setSnapshotRaw(raw); setDirty(false); setWorkflow('snapshot');
    routeUpdate({ workflow: 'snapshot', bodyId: null, snapshotTab: 'import' });
  }
  return <div className='etf-author-workspace'>
    <div inert={!!destination}>
      <nav className='etf-author-mode-nav' aria-label='ETF 作者工作'>
        <a href='#/admin/active-etf?workflow=markdown' aria-current={workflow === 'markdown' ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate('markdown'); }}>研究文章</a>
        <a href='#/admin/active-etf?workflow=reports' aria-current={workflow === 'reports' || workflow === 'snapshot' ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate('reports'); }}>歷史 JSON 報告</a>
        <a href='#/admin/active-etf?workflow=daily' aria-current={workflow === 'daily' ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate('daily'); }}>每日資料</a>
      </nav>
      {workflow === 'markdown' ? <MarkdownEtfAuthor sessionToken={props.sessionToken} request={(action, payload) => props.requestEndpoint('/api/admin/etf-research/' + action, payload)} onDirtyChange={setDirty} /> :
        workflow === 'daily' ? <DailyAuthor request={props.requestEndpoint} requestReport={props.request} onDirtyChange={setDirty} onSnapshot={openSnapshot} /> :
        workflow === 'snapshot' ? <SnapshotAuthor request={props.requestEndpoint} initialRaw={snapshotRaw} onDirtyChange={setDirty} onBack={() => navigate(routeParams().get('pairedBatch') ? 'daily' : 'reports')} /> :
        <ActiveEtfAuthorView {...props} onDirtyChange={setDirty} onSchema2Import={openSnapshot} onSchema2Open={openSavedSnapshot} />}
    </div>
    {destination && <Confirm title='離開目前任務？' label='放棄未保存變更並繼續' onCancel={() => setDestination(null)} onConfirm={() => { const next = destination; dirtyRef.current = false; setDestination(null); setDirty(false); setWorkflow(next); routeUpdate({ workflow: next }, true); }}><p>未保存的輸入會遺失；已保存的任務仍可恢復。結果尚未確認的操作請先查詢狀態。</p></Confirm>}
  </div>;
}

function parseAuthorJson(raw: string): unknown {
  if (bytes(raw) > MAX_SNAPSHOT_BYTES) throw new Error('資料包超過 16 MiB，請縮小內容。');
  return parseReportJson(raw, MAX_SNAPSHOT_BYTES);
}
function parsePackage(raw: string): DataPackage {
  const input = parseAuthorJson(raw) as { manifest?: unknown; chunks?: unknown };
  const manifest = parseManifest(input.manifest);
  if (!Array.isArray(input.chunks) || input.chunks.length !== manifest.chunkCount || input.chunks.length > MAX_CHUNKS) throw new Error('資料分批數與任務資訊不一致。');
  const chunks = input.chunks.map((value, index) => {
    const chunk = value as { facts?: FactInput[] };
    if (!Array.isArray(chunk.facts) || !chunk.facts.length || chunk.facts.length > MAX_CHUNK_FACTS) throw new Error('第 ' + (index + 1) + ' 批需有 1 至 80 筆資料。');
    if (bytes({ facts: chunk.facts, requestId: crypto.randomUUID(), expectedRevision: 1000000, chunkNo: index }) > MAX_CHUNK_BYTES - 4096) throw new Error('第 ' + (index + 1) + ' 批資料超過請求大小，請再拆分。');
    return { facts: chunk.facts };
  });
  return { manifest, chunks };
}
function EvidenceLinks({ sources }: { sources: SourceRef[] }) {
  return <div className='etf-source-line'>{sources.map(source => <span key={source.sourceDocumentId}><a href={source.url} target='_blank' rel='noopener noreferrer'>{source.provider}<span className='sr-only'>（開啟新分頁）</span></a><small>揭露 {source.declaredDate || '未知'} · 評價 {source.valuationDate || '未知'} · {source.officialStatus === 'official' ? '官方來源' : source.officialStatus === 'third_party' ? '第三方來源' : '未核對來源'}</small></span>)}</div>;
}
function DailyAuthor({ request, requestReport, onDirtyChange, onSnapshot }: {
  request: Endpoint; requestReport: AuthorProps['request']; onDirtyChange: (dirty: boolean) => void; onSnapshot: (raw: string) => void;
}) {
  const io = useTaskIO(request, 'pocketstocks:etf:daily');
  const [raw, setRaw] = useState(''); const [savedRaw, setSavedRaw] = useState('');
  const [batch, setBatch] = useState<Batch | null>(null);
  const batchRef = useRef(batch); batchRef.current = batch;
  const [head, setHead] = useState<Head | null>(null);
  useFooterVersion(head?.version, '每日資料版本');
  const [month, setMonth] = useState(() => routeParams().get('month') || today().slice(0, 7));
  const [jobsState, setJobsState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [jobs, setJobs] = useState<BatchSummary[]>([]); const [nextJobs, setNextJobs] = useState<string | null>(null);
  const [tab, setTab] = useState(() => tabValue('dataTab'));
  const [preview, setPreview] = useState<PrivatePreview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirm, setConfirm] = useState<'publish' | 'cancel' | 'restore' | 'replace' | null>(null);
  const [replaceId, setReplaceId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [pairMode, setPairMode] = useState<'none' | 'report' | 'snapshot'>(() => routeParams().get('pairedBatch') && routeParams().get('bodyId') ? 'snapshot' : 'none');
  const [pairId, setPairId] = useState(() => routeParams().get('pairedBatch') && routeParams().get('bodyId') || ''); const [pairReport, setPairReport] = useState<{ id: string; revision: number; draft: ReaderEtfReport } | null>(null);
  const [pairBody, setPairBody] = useState<Body | null>(null); const [pairAck, setPairAck] = useState(false);
  const [pairEnabled, setPairEnabled] = useState(false); const [pairLoading, setPairLoading] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<{ publication: { id: string; scopeId: string; tradeDate: string; version: number }; currentHead: Head | null } | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [restoreId, setRestoreId] = useState(''); const [restoreReason, setRestoreReason] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = raw !== savedRaw; const locked = !!io.busy || !!io.pending || uploading || pairLoading;
  const parsed = useMemo(() => {
    if (!raw.trim()) return { value: null, error: '' };
    try { return { value: parsePackage(raw), error: '' }; }
    catch (caught) { return { value: null, error: caught instanceof Error ? caught.message : '資料包格式錯誤。' }; }
  }, [raw]);
  const editable = useMemo(() => {
    try {
      const input = parseAuthorJson(raw) as DataPackage;
      return input?.manifest && Array.isArray(input.manifest.sets) && Array.isArray(input.manifest.fundSelections) && Array.isArray(input.manifest.sourceSelections) && Array.isArray(input.manifest.selectedSetIds) && Array.isArray(input.chunks) ? input : null;
    } catch { return null; }
  }, [raw]);
  const locationState = useRef({ id: batch?.id, dirty, locked, month });
  locationState.current = { id: batch?.id, dirty, locked, month };
  const fullPreview = !!preview && preview.revision === batch?.revision && !preview.nextCursor && preview.funds.length > 0;
  useEffect(() => { onDirtyChange(dirty || !!io.pending || uploading || pairLoading); }, [dirty, io.pending, uploading, pairLoading]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (dirty || io.pending || uploading) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect);
  }, [dirty, io.pending, uploading]);
  useEffect(() => {
    const initialId = routeParams().get('batchId');
    void (async () => { await loadJobs(); if (initialId && isAuthorRoute() && routeParams().get('workflow') === 'daily' && routeParams().get('batchId') === initialId) await loadBatch(initialId); })();
    const sync = () => {
      if (!isAuthorRoute()) return;
      const params = routeParams(); const id = params.get('batchId'); const current = locationState.current;
      setTab(tabValue('dataTab'));
      if (id && id !== (current.id || initialId)) {
        if (current.locked || current.dirty) {
          routeUpdate({ batchId: current.id || initialId || null, month: current.month });
          if (current.locked) { io.setNotice({ tone: 'neutral', message: '請先確認目前操作結果，再切換任務。' }); return; }
          setReplaceId(id); setConfirm('replace'); return;
        }
        void loadBatch(id);
      }
    };
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  function selectTab(value: string) { setTab(value); routeUpdate({ workflow: 'daily', dataTab: value, batchId: batch?.id || routeParams().get('batchId') || null, month }, true); }
  function applyBatch(value: Batch, currentHead?: Head | null) {
    setBatch(value); batchRef.current = value; setAcknowledged(value.status === 'reviewed');
    setJobs(current => current.map(job => job.id === value.id ? {
      ...job, revision: value.revision, status: value.status, publicationId: value.publicationId,
      updatedAt: value.updatedAt, scopeId: value.manifest.scopeId, requestedDate: value.manifest.requestedDate,
      receivedChunks: value.receivedChunks.length, chunkCount: value.manifest.chunkCount,
    } : job));
    setPreview(null); setPlan(null); setPairAck(false);
    if (value.manifest.scopeId === QA_DATA_SCOPE) { setPairMode('none'); setPairReport(null); setPairBody(null); }
    if (currentHead !== undefined) setHead(currentHead);
    routeUpdate({ workflow: 'daily', batchId: value.id, month: value.manifest.requestedDate.slice(0, 7) });
    sessionWrite('pocketstocks:etf:lastBatch', value.id);
  }
  async function loadJobs(cursor?: string) {
    setJobsState('loading');
    const value = await io.run<{ items: BatchSummary[]; nextToken: string | null }>('載入任務', '/api/admin/etf-data/batches/list', { month, ...(cursor ? { nextToken: cursor } : {}) });
    if (!value) { setJobsState('error'); return; }
    setJobs(current => cursor ? [...current, ...value.items] : value.items); setNextJobs(value.nextToken); setJobsState('ready');
  }
  async function loadBatch(id: string, preserveInput = false) {
    const value = await io.run<{ batch: Batch; currentHead: Head | null }>('載入保存任務', '/api/admin/etf-data/batches/' + encodeURIComponent(id) + '/get', {});
    if (value) { applyBatch(value.batch, value.currentHead); setMonth(value.batch.manifest.requestedDate.slice(0, 7)); if (!preserveInput) { setRaw(''); setSavedRaw(''); } }
  }
  async function importFile(file: File | undefined) {
    if (!file || locked) return;
    if (file.size > MAX_SNAPSHOT_BYTES) { io.setNotice({ tone: 'error', message: '每日資料包超過 16 MiB，請縮小內容或拆成不同日期的任務。' }); return; }
    try { setRaw(await file.text()); setAcknowledged(false); setPairAck(false); }
    catch { io.setNotice({ tone: 'error', message: '檔案無法讀取，請重新選擇。' }); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  }
  async function create() {
    if (!parsed.value) return;
    const value = await io.run<{ batch: Batch }>('建立私有任務', '/api/admin/etf-data/batches', { manifest: parsed.value.manifest }, true);
    if (value) { applyBatch(value.batch); setSavedRaw(raw); io.setNotice({ tone: 'success', message: '私有任務已建立。資料尚未公開，請繼續匯入各批資料。' }); }
  }
  async function upload() {
    const source = parsed.value; const initial = batchRef.current;
    if (!source || !initial || canonical(source.manifest) !== canonical(initial.manifest)) { io.setNotice({ tone: 'error', message: '資料包與任務來源不同。請建立新修訂任務，勿覆寫原集合。' }); return; }
    let current: Batch = initial;
    setUploading(true); setAcknowledged(false); setPairAck(false);
    try {
      for (let index = 0; index < source.chunks.length; index++) {
        const value = await io.run<{ batch: Batch }>('保存第 ' + (index + 1) + '／' + source.chunks.length + ' 批', '/api/admin/etf-data/batches/' + current.id + '/chunks',
          { expectedRevision: current.revision, chunkNo: index, facts: source.chunks[index].facts }, true, current.id);
        if (!value) return;
        current = value.batch; applyBatch(current);
      }
      setSavedRaw(raw); io.setNotice({ tone: 'success', message: '所有批次已保存。已存在的資料會核對內容，不重複建立股票列。請驗證資料。' });
    } finally { setUploading(false); }
  }
  async function validate() {
    if (!batch || dirty) return;
    const value = await io.run<{ batch: Batch }>('驗證與封存', '/api/admin/etf-data/batches/' + batch.id + '/validate', { expectedRevision: batch.revision }, true, batch.id);
    if (value) { applyBatch(value.batch); selectTab('validation'); }
  }
  async function loadPreview(cursor?: string) {
    if (!batch) return;
    const value = await io.run<PrivatePreview>('載入私有預覽', '/api/admin/etf-data/batches/' + batch.id + '/preview', cursor ? { cursor } : {});
    if (!value) return;
    if (value.batchId !== batch.id || value.revision !== batch.revision) { io.setNotice({ tone: 'error', message: '任務版本已變更，請重新載入並審閱，不混用不同版本。' }); return; }
    setHead(value.currentHead);
    setPreview(previous => cursor && previous ? mergePrivatePreview(previous, value) : value);
  }
  async function review() {
    if (!batch?.validation?.reviewHash || !acknowledged || !fullPreview || dirty) return;
    const value = await io.run<{ batch: Batch }>('記錄審閱', '/api/admin/etf-data/batches/' + batch.id + '/review',
      { expectedRevision: batch.revision, reviewHash: batch.validation.reviewHash, acknowledged: true }, true, batch.id);
    if (value) { applyBatch(value.batch); io.setNotice({ tone: 'success', message: '目前資料、來源選擇及缺口已記錄審閱。發布前請重新載入同版預覽。' }); }
  }
  function selectSource(fundId: string, setId: string, reason?: string) {
    if (!editable) return;
    const value = editable; const previous = value.manifest.sets.find(set => set.fundId === fundId && value.manifest.selectedSetIds.includes(set.setId));
    const manifest = { ...value.manifest,
      selectedSetIds: value.manifest.selectedSetIds.map(id => id === previous?.setId ? setId : id),
      sourceSelections: value.manifest.sourceSelections.map(selection => selection.fundId === fundId ? { fundId, setId, reason: reason ?? selection.reason } : selection) };
    setRaw(JSON.stringify({ ...value, manifest }, null, 2)); setAcknowledged(false); setPairAck(false);
  }
  async function preparePair() {
    if (!batch?.reviewedPayloadHash) return;
    const params = routeParams();
    const savedRequest = params.get('pairedBatch') === batch.id && params.get('plannedHead') === String(head?.version || 0) ? params.get('plannedRequest') : null;
    const requestId = plan?.requestId || savedRequest || crypto.randomUUID();
    const value = await io.run<Plan>('確認預計發布版本', '/api/admin/etf-data/batches/' + batch.id + '/plan', { requestId, expectedHeadVersion: head?.version || 0 });
    if (value) setPlan(value);
  }
  async function loadPair() {
    setPairAck(false); setPairReport(null); setPairBody(null); setPairEnabled(false);
    if (!pairId.trim()) return;
    setPairLoading(true);
    try {
      if (pairMode === 'report') {
        const value = unpack<{ entry: { id: string; revision: number; draft: ReaderEtfReport | null } }>(await deadline(requestReport('get', { id: pairId })));
        if (!value.entry?.draft || value.entry.draft.schemaVersion !== 1) throw new Error('此項目是完整快照，請改選完整研究快照。');
        setPairReport({ ...value.entry, draft: value.entry.draft });
      } else if (pairMode === 'snapshot') {
        const value = unpack<{ body: Body; schema2PublicationEnabled: boolean }>(await deadline(request('/api/admin/etf-reports/bodies/' + encodeURIComponent(pairId) + '/get', {})));
        setPairBody(value.body); setPairEnabled(value.schema2PublicationEnabled);
        if (value.body.sealed) {
          const report = await readBody(request, value.body, () => true);
          setPairReport({ id: value.body.reportId, revision: value.body.revision, draft: report });
        }
        if (!value.schema2PublicationEnabled) io.setNotice({ tone: 'neutral', message: '完整快照尚待讀者與作者相容驗證，目前不能發布。已保存的快照仍保持私有。' });
      }
    } catch (caught) { io.setNotice({ tone: 'error', message: errorDetails(caught).message }); }
    finally { setPairLoading(false); }
  }
  async function publish() {
    if (!batch || !acknowledged || !fullPreview || dirty || !pairReady || batch.status !== 'reviewed') return;
    const requestId = plan?.requestId || crypto.randomUUID();
    const report = pairMode === 'report' && pairReport ? { id: pairReport.id, baseRevision: pairReport.revision }
      : pairMode === 'snapshot' && pairBody ? { bodyId: pairBody.id } : null;
    const value = await io.run<{ batch: Batch; publication: { id: string; version: number } }>('確認發布', '/api/admin/etf-data/batches/' + batch.id + '/publish',
      { requestId, expectedRevision: batch.revision, expectedHeadVersion: head?.version || 0,
        reviewHash: batch.reviewedPayloadHash, confirmed: true, ...(report ? { report } : {}) }, true, batch.id);
    setConfirm(null);
    if (value) { applyBatch(value.batch); setSavedRaw(raw); await loadBatch(value.batch.id); selectTab('history'); io.setNotice({ tone: 'success', message: '發布已確認。每日資料' + (report ? '與指定報告已成套' : '已獨立') + '更新，舊完整報告快照保持原樣。' }); }
  }
  async function cancel() {
    if (!batch) return;
    const value = await io.run<ReceiptResult>('取消未發布任務', '/api/admin/etf-data/batches/' + batch.id + '/cancel', { expectedRevision: batch.revision }, true, batch.id);
    setConfirm(null); if (value?.state === 'committed') await loadBatch(batch.id);
  }
  async function loadRestore() {
    if (!restoreId.trim() || !batch) return;
    const value = await io.run<{ publication: { id: string; scopeId: string; tradeDate: string; version: number }; currentHead: Head | null }>('載入回復來源版本', '/api/admin/etf-data/publications/' + encodeURIComponent(restoreId) + '/get', {});
    if (!value) return;
    if (value.publication.scopeId !== batch.manifest.scopeId || value.publication.tradeDate !== batch.manifest.requestedDate) {
      setRestoreTarget(null); io.setNotice({ tone: 'error', message: '指定舊版本與目前任務的範圍或資料日不同，請開啟對應日期的任務再回復。' }); return;
    }
    setRestoreTarget(value);
  }
  async function restore() {
    if (!restoreTarget?.currentHead || !restoreReason.trim() || !batch) return;
    const value = await io.run<ReceiptResult>('建立回復版本', '/api/admin/etf-data/publications/' + encodeURIComponent(restoreTarget.publication.id) + '/restore',
      { expectedHeadVersion: restoreTarget.currentHead.version, expectedScopeId: batch.manifest.scopeId, expectedTradeDate: batch.manifest.requestedDate, reason: restoreReason, confirmed: true }, true, batch.id);
    setConfirm(null);
    if (value?.state === 'committed') { await loadBatch(batch.id); io.setNotice({ tone: 'success', message: '回復已建立新的公開版本；舊歷史與完整報告均保留。' }); setRestoreTarget(null); }
  }
  const planCurrent = !!plan && plan.batchId === batch?.id && plan.revision === batch?.revision && plan.version === (head?.version || 0) + 1;
  const pairSummary = pairMode !== 'none' && pairReport
    ? '已載入：' + pairReport.draft.title + '（報告 ' + pairReport.id + '） · '
      + (pairMode === 'snapshot' ? '快照' : '報告') + '已保存 r' + pairReport.revision
      + (pairMode === 'snapshot' && pairBody ? ' · 將更新指定報告的公開內容' : '')
    : '';
  const pairReady = pairMode === 'none' || (pairAck && planCurrent && (pairMode === 'report' ? !!pairReport : !!pairBody?.reviewed && pairEnabled && !!plan && pairBody.dataLineage?.publicationIds.includes(plan.publicationId) && plan.setIds.every(id => pairBody.dataLineage?.setIds.includes(id))));
  const canPublish = batch?.status === 'reviewed' && acknowledged && fullPreview && !dirty && !locked && pairReady;
  return <div className='etf-author eda-root'>
    <div inert={!!confirm}>
      <header className='etf-author-heading'><div><span className='etf-kicker'>作者工作區 · 私有每日資料</span><h1>ETF 每日資料</h1><p>每個任務處理一個資料日。保存、驗證與預覽都不會公開。</p></div></header>
      <Feedback io={io} recover={value => { const id = value.batchId || batch?.id; if (id) void loadBatch(id); }} />
      {uploading && <PendingIndicator>正在匯入並保存資料批次…</PendingIndicator>}
      {pairLoading && <PendingIndicator>正在載入指定報告…</PendingIndicator>}
      <div className='etf-author-layout'>
        <aside className='etf-author-list' aria-label='每日資料任務'>
          <div className='eda-month'><label>任務月份<input type='month' value={month} disabled={locked} onChange={event => setMonth(event.target.value)} /></label><button type='button' disabled={locked} onClick={() => void loadJobs()}><RotateCcw size={15} />載入</button></div>
          {jobsState === 'loading' ? <LoadingSkeleton media={false} label='正在載入每日資料任務…' rows={3} /> : jobsState === 'error' ? <p role='alert'>任務清單暫時無法載入，請使用上方載入按鈕重試。</p> : !jobs.length && <p>此月份尚未列出保存任務。</p>}
          <ul>{jobs.map(job => <li key={job.id}><button type='button' disabled={locked} aria-pressed={batch?.id === job.id} onClick={() => { if (dirty) { setReplaceId(job.id); setConfirm('replace'); } else void loadBatch(job.id); }}><strong>{job.scopeId === QA_DATA_SCOPE ? '測試 · ' : ''}{job.requestedDate}</strong><span>{labels[job.status] || job.status} · r{job.revision}</span><small>{job.receivedChunks}／{job.chunkCount} 批已保存</small></button></li>)}</ul>
          {nextJobs && <button type='button' disabled={locked} onClick={() => void loadJobs(nextJobs)}>載入更多任務</button>}
        </aside>
        <section className='etf-author-editor' aria-label='每日資料審閱任務'>
          {batch?.manifest.scopeId === QA_DATA_SCOPE && <p className='etf-note' role='status'>合成測試任務：僅發布至獨立測試範圍，不改研究資料；基金、股票與交易日曆均為虛構。</p>}
          <div className='etf-author-toolbar'><span>{batch ? batch.manifest.requestedDate + ' · r' + batch.revision + ' · ' + (labels[batch.status] || batch.status) : '尚未建立任務'}{dirty && ' · 有未保存變更'}</span>{batch && <button type='button' disabled={!!io.busy || uploading || pairLoading} onClick={() => void loadBatch(batch.id, true)}>重新載入任務與公開版本</button>}</div>
          <EtfTabs idPrefix='etf-daily-task' label='每日資料任務內容' tabs={taskTabs} value={tab} onChange={selectTab} />
          <EtfTabPanel idPrefix='etf-daily-task' id='import' active={tab === 'import'}>
            <h2>資料匯入</h2><p>匯入已整理的每日資料包，格式為 manifest 與 chunks。每批最多 80 筆；不會從網頁即時擷取或自動發布。</p>
            <div className='etf-import-controls'><button type='button' disabled={locked} onClick={() => fileRef.current?.click()}><Upload size={16} />匯入每日 JSON</button><input ref={fileRef} type='file' accept='.json,application/json' hidden onChange={event => void importFile(event.target.files?.[0])} /></div>
            <label className='etf-json-label'>每日資料包<textarea value={raw} disabled={locked} rows={14} spellCheck={false} onChange={event => { setRaw(event.target.value); setAcknowledged(false); setPairAck(false); }} placeholder='貼上包含 manifest 與 chunks 的每日資料 JSON。' /></label>
            {parsed.error && <p className='eda-inline-error' role='alert'>{parsed.error}</p>}
            {editable && <><p className='etf-note'>目標日 {editable.manifest.requestedDate} · {editable.chunks.length} 批 · {editable.chunks.reduce((count, chunk) => count + (Array.isArray(chunk.facts) ? chunk.facts.length : 0), 0)} 筆原始資料。完整度、官方核對與日期對齊各自判定。</p>
              {editable?.manifest.fundSelections.map(fund => {
                const chosen = editable!.manifest.sourceSelections.find(item => item.fundId === fund.fundId);
                const options = editable!.manifest.sets.filter(item => item.fundId === fund.fundId);
                return <div className='eda-source-choice' key={fund.fundId}><label>{fund.code} {fund.name} 的來源集合<select disabled={locked} value={chosen?.setId || ''} onChange={event => selectSource(fund.fundId, event.target.value)}>{options.map(set => <option key={set.setId} value={set.setId}>{set.holdingDate || '日期未知'} · {set.sourceRevision} · {labels[set.officialVerification]}／{labels[set.dateAlignment]}</option>)}</select></label><label>來源選擇理由<input disabled={locked} value={chosen?.reason || ''} maxLength={1000} onChange={event => selectSource(fund.fundId, chosen?.setId || '', event.target.value)} /></label></div>;
              })}
            </>}
            <div className='etf-author-actions'><button type='button' disabled={!parsed.value || locked} onClick={() => void create()}>{batch ? '建立新的修訂任務' : '建立私有任務'}</button><button type='button' disabled={!parsed.value || !batch || locked || ['published', 'cancelled'].includes(batch.status)} onClick={() => void upload()}>保存／繼續匯入各批資料</button></div>
            <p className='etf-note'>重新開啟未完成任務後，請重新選取原資料包並繼續匯入。系統會核對已保存內容；不重複股票列。來源或內容更正須使用新集合識別碼，並保留原版本關聯。</p>
          </EtfTabPanel>
          <EtfTabPanel idPrefix='etf-daily-task' id='validation' active={tab === 'validation'}>
            <h2>驗證與缺口</h2>
            {batch ? <><p>已保存 {batch.receivedChunks.length}／{batch.manifest.chunkCount} 批。未完成批次、筆數或來源內容不一致會阻擋發布。</p>
              <div className='etf-table-scroll' tabIndex={0} role='region' aria-label='每日資料完整度與來源'><table className='etf-table'><thead><tr><th>基金／集合</th><th>資料日</th><th>預期持股數</th><th>清單完整度</th><th>官方核對</th><th>日期對齊</th></tr></thead><tbody>{batch.manifest.sets.map(set => <tr key={set.setId}><th>{batch.manifest.fundSelections.find(fund => fund.fundId === set.fundId)?.code || set.fundId}<small>{set.setId}</small></th><td>{set.holdingDate || '未知'}</td><td>{set.expectedHoldings}</td><td>{labels[set.stockListCompleteness]}</td><td>{labels[set.officialVerification]}</td><td>{labels[set.dateAlignment]}</td></tr>)}</tbody></table></div>
              <h3>目前保存的來源選擇</h3><ul className='eda-source-reasons'>{batch.manifest.sourceSelections.map(selection => <li key={selection.fundId}><strong>{batch.manifest.fundSelections.find(fund => fund.fundId === selection.fundId)?.code || selection.fundId}</strong><span>{selection.reason}</span><small>集合 {selection.setId}</small></li>)}</ul>
              {batch.validation ? <><p className='etf-note'>實際資料筆數：{Object.entries(batch.validation.counts).map(([kind, count]) => (labels[kind] || kind) + ' ' + count + ' 筆').join('；')}</p>
                {!!batch.validation.blockingErrors.length && <ul className='etf-errors' role='alert'>{batch.validation.blockingErrors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
                {!!batch.validation.warnings.length && <ul className='etf-warnings'>{batch.validation.warnings.map((message, index) => <li key={index}>{message}</li>)}</ul>}
                <p>{batch.validation.complete ? '結構與來源集合已封存；仍需人工閱讀全部預覽與缺口。' : '尚有阻擋項目，不能發布。'}</p>
              </> : <p className='etf-note'>尚未執行伺服器驗證，不能將匯入成功當成官方核對完成。</p>}
              <button type='button' disabled={locked || dirty || ['published', 'cancelled'].includes(batch.status)} onClick={() => void validate()}>驗證並封存資料</button>
            </> : <p>先建立並保存資料任務。</p>}
          </EtfTabPanel>
          <EtfTabPanel idPrefix='etf-daily-task' id='preview' active={tab === 'preview'}>
            <h2>私有預覽</h2><p>固定目前任務版本；缺值不補零。資料未封存時不顯示假預覽。</p>
            <button type='button' disabled={!batch || locked || dirty} onClick={() => void loadPreview()}>載入保存版本的預覽</button>
            {preview && <><p className='etf-note'>r{preview.revision} · 預計更新公開資料。{preview.nextCursor ? '目前仍有未載入的資料，請載入全部後再審閱。' : '本次預覽分頁已全部載入。'}</p>
              {!preview.funds.length && <p>{preview.reason === 'not_sealed' ? '資料尚未封存，請先完成匯入及驗證。' : '目前沒有可預覽的資料。'}</p>}
              {preview.funds.map(fund => <section className='eda-fund-preview' key={fund.setId}><h3>{fund.fund.code} {fund.fund.name}</h3><p className='etf-note'>{fund.holdingDate || '日期未知'} · {labels[fund.stockListCompleteness]} · {labels[fund.officialVerification]} · {labels[fund.dateAlignment]}。已載入 {fund.holdings.length} 筆持股。</p>
                <div className='etf-table-scroll' tabIndex={0} role='region' aria-label={fund.fund.code + '私有完整持股預覽'}><table className='etf-table'><thead><tr><th>股票／識別</th><th>市場</th><th>原股數</th><th>占基金比例</th><th>分類識別</th><th>來源列</th></tr></thead><tbody>{fund.holdings.map((row, index) => <tr key={String(row.id || index)}><th>{String(row.sourceName || row.securityId)}<small>{String(row.securityId)}</small></th><td>{String(row.sourceMarket || '未知')}</td><td>{String((row.shares as { raw?: string })?.raw || '未知')}</td><td>{String((row.weightPct as { raw?: string })?.raw || '未知')}</td><td>{String(row.industryId || '未分類')}</td><td>{String(row.sourceRowKey || '未知')}</td></tr>)}</tbody></table></div>
                {fund.metrics && <p className='etf-note'>基金規模原值 {String((fund.metrics.aumNtd as { raw?: string })?.raw || '未知')}；基金單位數原值 {String((fund.metrics.fundUnits as { raw?: string })?.raw || '未知')}。</p>}
                <details><summary>來源揭露異動（{fund.reportedChanges.length} 筆已載入）</summary><div className='etf-table-scroll' tabIndex={0} role='region' aria-label={fund.fund.code + '來源異動預覽'}><table className='etf-table'><thead><tr><th>證券識別</th><th>起訖／來源日</th><th>原股數差</th><th>權重差百分點</th><th>來源估計金額</th><th>來源列</th></tr></thead><tbody>{fund.reportedChanges.map((row, index) => <tr key={String(row.id || index)}><th>{String(row.securityId || '未知')}</th><td>{String(row.startDate || '未知')} → {String(row.endDate || '未知')}<small>來源 {String(row.sourceDate || '未知')}</small></td><td>{String((row.deltaShares as { raw?: string })?.raw || '未知')}</td><td>{String((row.weightDeltaPp as { raw?: string })?.raw || '未知')}</td><td>{String((row.estimateNtd as { raw?: string })?.raw || '未知')}<small>{String(row.estimateMethod || '未提供估計方法')}</small></td><td>{String(row.sourceRowKey || '未知')}</td></tr>)}</tbody></table></div></details>
                <details><summary>產業配置與精度</summary><div className='etf-table-scroll' tabIndex={0} role='region' aria-label={fund.fund.code + '產業配置預覽'}><table className='etf-table'><thead><tr><th>產業</th><th>可讀精確權重小計</th><th>股票數</th><th>非精確／未知</th></tr></thead><tbody>{fund.allocations.map((row, index) => <tr key={String(row.id || index)}><th>{String(row.label || row.industryId)}</th><td>{preciseWeightSubtotal(row)}</td><td>{String(row.stockCount ?? '未知')}</td><td>{String(row.impreciseCount ?? '未知')}／{String(row.unknownCount ?? '未知')}</td></tr>)}</tbody></table></div></details>
              </section>)}
              <EvidenceLinks sources={preview.sourceRefs} />
              {preview.nextCursor && <button type='button' disabled={locked} onClick={() => void loadPreview(preview.nextCursor!)}>載入更多持股與來源異動</button>}
            </>}
            {pairReport && <><h3>一起發布的研究報告預覽</h3><ReportBody report={pairReport.draft} version={pairReport.revision} preview active={tab === 'preview'} /></>}
          </EtfTabPanel>
          <EtfTabPanel idPrefix='etf-daily-task' id='history' active={tab === 'history'}>
            <h2>發布紀錄</h2>
            {batch ? <><p>資料日 {batch.manifest.requestedDate} · 保存 r{batch.revision} · {labels[batch.status]}。</p><p className='etf-note'>本任務發布識別 {batch.publicationId || '尚未發布'}。更正與回復會建立新版本，已發布完整報告保持原樣。</p>
              <label className='etf-review-check'><input type='checkbox' checked={acknowledged} disabled={locked || dirty || !batch.validation?.complete || !fullPreview} onChange={event => setAcknowledged(event.target.checked)} /><span>我已閱讀此版本的全部資料、來源選擇理由及缺口。</span></label>
              <button type='button' disabled={locked || dirty || !acknowledged || !fullPreview || batch.status !== 'ready'} onClick={() => void review()}>記錄目前版本審閱</button>
              <div className='etf-filter'><label>發布內容<select value={pairMode} disabled={locked} onChange={event => { setPairMode(event.target.value as typeof pairMode); setPairAck(false); setPairReport(null); setPairBody(null); }}><option value='none'>僅每日資料</option><option value='report' disabled={batch?.manifest.scopeId === QA_DATA_SCOPE}>每日資料與已保存研究報告</option><option value='snapshot' disabled={batch?.manifest.scopeId === QA_DATA_SCOPE}>每日資料與完整研究快照</option></select></label>
                {pairMode !== 'none' && <><label>{pairMode === 'report' ? '研究報告 ID' : '完整快照任務 ID'}<input value={pairId} maxLength={120} disabled={locked} onChange={event => { setPairId(event.target.value); setPairAck(false); setPairReport(null); setPairBody(null); }} /></label><button type='button' disabled={locked || !pairId.trim()} onClick={() => void loadPair()}>載入指定報告</button></>}
              </div>
              {pairSummary && <p className='etf-note'>{pairSummary}</p>}
              {pairMode !== 'none' && <><button type='button' disabled={locked || batch.status !== 'reviewed'} onClick={() => void preparePair()}>確認本次資料版本</button>{plan && <details><summary>本次報告應引用的固定資料版本</summary><pre className='eda-json-evidence'>{JSON.stringify(plan.dataLineage, null, 2)}</pre><p className='etf-note'>完整快照須先引用這份資料版本，再保存、驗證並審閱。以下只建立資料版本框架，仍須匯入完整研究內容；公開版本變更後此計畫即失效。</p><button type='button' onClick={() => { routeUpdate({ pairedBatch: batch.id, plannedRequest: plan.requestId, plannedHead: String(head?.version || 0) }); onSnapshot(JSON.stringify({ schemaVersion: 2, dataLineage: plan.dataLineage }, null, 2)); }}>建立引用此版本的完整快照</button></details>}
                <label className='etf-review-check'><input type='checkbox' checked={pairAck} disabled={locked || (pairMode === 'report' ? !pairReport : !pairBody?.reviewed)} onChange={event => setPairAck(event.target.checked)} /><span>我已審閱指定報告與每日資料一致，確認成套發布版本。</span></label></>}
              <div className='etf-author-actions'><button type='button' disabled={!canPublish} onClick={() => setConfirm('publish')}>確認發布內容</button><button type='button' disabled={locked || ['published', 'cancelled'].includes(batch.status)} onClick={() => setConfirm('cancel')}>取消未發布任務</button></div>
              <div className='eda-restore'><h3>回復指定資料版本</h3><p className='etf-note'>回復會把指定舊內容建立成新版本；不刪除歷史，也不改寫舊報告。</p><label>舊資料發布識別<input value={restoreId} disabled={locked} maxLength={120} onChange={event => { setRestoreId(event.target.value); setRestoreTarget(null); }} /></label><label>回復理由<input value={restoreReason} disabled={locked} maxLength={1000} onChange={event => setRestoreReason(event.target.value)} /></label><button type='button' disabled={locked || !restoreId.trim()} onClick={() => void loadRestore()}>載入回復來源版本</button>{restoreTarget && <><p className='etf-note'>{restoreTarget.publication.tradeDate} · 已載入回復來源</p><button type='button' disabled={locked || !restoreReason.trim() || !restoreTarget.currentHead} onClick={() => setConfirm('restore')}>檢查回復內容</button></>}</div>
            </> : <p>選擇已保存任務，查看已確認的發布與版本資訊。</p>}
          </EtfTabPanel>
        </section>
      </div>
    </div>
    {confirm === 'replace' && <Confirm title='開啟其他資料任務？' label='放棄未保存輸入並開啟' onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); void loadBatch(replaceId); }}><p>目前輸入尚未保存；伺服器已保存的資料與公開版本仍保留。</p></Confirm>}
    {confirm === 'publish' && <Confirm busy={io.busy} title='發布這份每日資料？' label='確認發布至 STAGING' onCancel={() => setConfirm(null)} onConfirm={() => void publish()}><p>{batch?.manifest.requestedDate}，將更新目前公開資料。{pairMode === 'none' ? '只發布每日資料，不需要研究報告。' : '每日資料與指定報告必須全部成功才切換。'}來源缺口會保留。</p>{pairSummary && <p>{pairSummary}</p>}</Confirm>}
    {confirm === 'cancel' && <Confirm busy={io.busy} title='取消未發布任務？' label='確認取消任務' onCancel={() => setConfirm(null)} onConfirm={() => void cancel()}><p>任務將停止發布，已保存來源與操作紀錄會保留。</p></Confirm>}
    {confirm === 'restore' && <Confirm busy={io.busy} title='將舊資料回復為新版本？' label='確認建立回復版本' onCancel={() => setConfirm(null)} onConfirm={() => void restore()}><p>資料日 {restoreTarget?.publication.tradeDate}，將以回復來源建立新公開版本；既有完整報告不會改變。理由：{restoreReason}</p></Confirm>}
  </div>;
}

async function buildBody(raw: string): Promise<{ manifest: SnapshotManifest; contents: string[] }> {
  const encoded = new TextEncoder().encode(raw);
  if (!encoded.byteLength || encoded.byteLength > MAX_SNAPSHOT_BYTES) throw new Error('完整快照需小於 16 MiB。');
  const contents: string[] = []; const pages: SnapshotManifest['pages'] = [];
  for (let offset = 0; offset < encoded.length;) {
    let end = Math.min(encoded.length, offset + MAX_SNAPSHOT_PAGE_BYTES);
    while (end < encoded.length && (encoded[end] & 0xc0) === 0x80) end--;
    let content = new TextDecoder('utf-8', { fatal: true }).decode(encoded.slice(offset, end));
    while (bytes({ requestId: crypto.randomUUID(), pageNo: pages.length, content }) > 196 * 1024) {
      end = offset + Math.floor((end - offset) * 0.8);
      while (end < encoded.length && (encoded[end] & 0xc0) === 0x80) end--;
      if (end <= offset) throw new Error('完整快照包含無法分批的內容。');
      content = new TextDecoder('utf-8', { fatal: true }).decode(encoded.slice(offset, end));
    }
    pages.push({ pageNo: pages.length, pageId: crypto.randomUUID(), pageHash: await rawHash(content), byteLength: end - offset });
    contents.push(content); offset = end;
    if (pages.length > MAX_SNAPSHOT_PAGES) throw new Error('完整快照分批後超過 128 頁，請縮小資料包。');
  }
  return { manifest: { pages, bodyHash: await rawHash(raw), bodyBytes: encoded.byteLength }, contents };
}
async function readBody(request: Endpoint, body: Body, current: () => boolean): Promise<ReaderEtfReport> {
  const manifest = body.manifest;
  if (!manifest || !Array.isArray(manifest.pages) || !manifest.pages.length || manifest.pages.length > MAX_SNAPSHOT_PAGES || !Number.isSafeInteger(manifest.bodyBytes) || manifest.bodyBytes < 1 || manifest.bodyBytes > MAX_SNAPSHOT_BYTES || !/^[a-f0-9]{64}$/.test(manifest.bodyHash)) throw new Error('完整快照清單超過上限或格式錯誤。');
  const pageIds = new Set<string>(); let total = 0;
  manifest.pages.forEach((ref, index) => {
    if (ref.pageNo !== index || typeof ref.pageId !== 'string' || pageIds.has(ref.pageId) || !/^[a-f0-9]{64}$/.test(ref.pageHash) || !Number.isSafeInteger(ref.byteLength) || ref.byteLength < 1 || ref.byteLength > MAX_SNAPSHOT_PAGE_BYTES) throw new Error('完整快照頁序或大小不符。');
    pageIds.add(ref.pageId); total += ref.byteLength;
  });
  if (total !== manifest.bodyBytes) throw new Error('完整快照總大小不符。');
  const contents: string[] = [];
  for (const ref of body.manifest.pages) {
    if (!current()) throw new Error('工作區已切換。');
    const page = unpack<{ bodyId: string; pageNo: number; pageHash: string; content: string }>(await deadline(request('/api/admin/etf-reports/bodies/' + body.id + '/page', { pageNo: ref.pageNo })));
    if (!current()) throw new Error('工作區已切換。');
    if (page.bodyId !== body.id || page.pageNo !== ref.pageNo || page.pageHash !== ref.pageHash || typeof page.content !== 'string' ||
      bytes(page.content) !== ref.byteLength || await rawHash(page.content) !== ref.pageHash) throw new Error('完整快照頁的大小或內容核對失敗，未顯示部分報告。');
    contents.push(page.content);
  }
  const raw = contents.join('');
  if (!current() || bytes(raw) !== body.manifest.bodyBytes || await rawHash(raw) !== body.manifest.bodyHash) throw new Error('完整快照重建核對失敗，未顯示部分報告。');
  const report = parseAuthorJson(raw) as ReaderEtfReport;
  if (report.id !== body.reportId || report.schemaVersion !== 2 || !report.dataLineage || !Array.isArray(report.summary) || !Array.isArray(report.rows) || !Array.isArray(report.funds) || !Array.isArray(report.operations) || !Array.isArray(report.warnings)) throw new Error('完整快照格式不符。');
  return report;
}
function SnapshotAuthor({ request, initialRaw, onDirtyChange, onBack }: {
  request: Endpoint; initialRaw: string; onDirtyChange: (dirty: boolean) => void; onBack: () => void;
}) {
  const io = useTaskIO(request, 'pocketstocks:etf:snapshot');
  const [raw, setRaw] = useState(initialRaw); const [savedHash, setSavedHash] = useState('');
  const [body, setBody] = useState<Body | null>(null);
  useFooterVersion(body?.publishedVersion, '公開版本');
  const [enabled, setEnabled] = useState(false);
  const [tab, setTab] = useState(() => tabValue('snapshotTab'));
  const [baseRevision, setBaseRevision] = useState(0); const [publishedVersion, setPublishedVersion] = useState(0);
  const [preview, setPreview] = useState<ReaderEtfReport | null>(null);
  const [validation, setValidation] = useState<BodyValidation | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirm, setConfirm] = useState(false); const [working, setWorking] = useState('');
  const [rawChanged, setRawChanged] = useState(!!initialRaw);
  const fileRef = useRef<HTMLInputElement>(null); const generation = useRef(0);
  const loadingBodyId = useRef<string | null>(null);
  const locationState = useRef({ id: body?.id, dirty: rawChanged, locked: false });
  const locked = !!io.busy || !!io.pending || !!working;
  locationState.current = { id: body?.id, dirty: rawChanged, locked };
  useEffect(() => { onDirtyChange(rawChanged || !!io.pending || !!working); }, [rawChanged, io.pending, working]);
  useEffect(() => {
    const id = routeParams().get('bodyId'); if (id) void loadBody(id);
    const sync = () => {
      if (!isAuthorRoute()) return;
      const params = routeParams(); const id = params.get('bodyId'); const current = locationState.current;
      setTab(tabValue('snapshotTab'));
      const activeId = loadingBodyId.current || current.id;
      if (id && id !== activeId) {
        if (current.dirty || current.locked || loadingBodyId.current) { routeUpdate({ bodyId: activeId || null }); io.setNotice({ tone: 'neutral', message: '請先保存目前輸入或確認操作結果，再開啟其他完整快照。' }); return; }
        void loadBody(id);
      }
    };
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { generation.current++; window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (rawChanged || io.pending || working) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect);
  }, [rawChanged, io.pending, working]);
  function selectTab(value: string) { setTab(value); routeUpdate({ workflow: 'snapshot', snapshotTab: value, bodyId: loadingBodyId.current || body?.id || routeParams().get('bodyId') || null }, true); }
  function applyBody(value: Body, capability?: boolean) {
    setBody(value); setBaseRevision(value.baseRevision); setPublishedVersion(value.expectedPublishedVersion);
    setAcknowledged(value.reviewed); setSavedHash(value.manifest.bodyHash);
    if (capability !== undefined) setEnabled(capability);
    routeUpdate({ workflow: 'snapshot', bodyId: value.id });
  }
  async function loadBody(id: string) {
    if (loadingBodyId.current) return;
    loadingBodyId.current = id;
    try {
      const value = await io.run<{ body: Body; schema2PublicationEnabled: boolean }>('載入完整快照', '/api/admin/etf-reports/bodies/' + encodeURIComponent(id) + '/get', {});
      if (value) { applyBody(value.body, value.schema2PublicationEnabled); setRaw(''); setRawChanged(false); setPreview(null); setValidation(null); }
    } finally {
      if (loadingBodyId.current === id) loadingBodyId.current = null;
    }
  }
  async function loadPreview() {
    if (!body?.sealed) return;
    const token = ++generation.current; setWorking('正在重建與核對完整快照'); setPreview(null);
    try {
      const report = await readBody(request, body, () => generation.current === token);
      if (generation.current === token) setPreview(report);
    } catch (caught) { if (generation.current === token) io.setNotice({ tone: 'error', message: errorDetails(caught).message }); }
    finally { if (generation.current === token) setWorking(''); }
  }
  async function save() {
    if (!raw.trim() || locked) return;
    const token = ++generation.current; setWorking('準備完整快照'); setAcknowledged(false); setPreview(null); setValidation(null);
    try {
      const parsed = parseAuthorJson(raw) as ReaderEtfReport;
      if (parsed.schemaVersion !== 2 || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(parsed.id) || !parsed.dataLineage) throw new Error('請匯入 schemaVersion 2、有效報告 ID 與完整資料版本。');
      let currentBody = body; let contents: string[];
      const hash = await rawHash(raw);
      if (currentBody && hash === savedHash && currentBody.baseRevision === baseRevision && currentBody.expectedPublishedVersion === publishedVersion) {
        if (currentBody.sealed) { setRawChanged(false); io.setNotice({ tone: 'neutral', message: '相同完整快照已保存並封存，無須重複上傳。' }); return; }
        const encoded = new TextEncoder().encode(raw); let offset = 0;
        contents = currentBody.manifest.pages.map(ref => {
          const content = new TextDecoder('utf-8', { fatal: true }).decode(encoded.slice(offset, offset + ref.byteLength)); offset += ref.byteLength; return content;
        });
        if (offset !== encoded.byteLength) throw new Error('重新匯入的資料包與保存版本大小不同。');
      } else {
        const prepared = await buildBody(raw); contents = prepared.contents;
        const value = await io.run<{ body: Body; schema2PublicationEnabled: boolean }>('建立私有完整快照', '/api/admin/etf-reports/bodies',
          { reportId: parsed.id, baseRevision, expectedPublishedVersion: publishedVersion, manifest: prepared.manifest }, true);
        if (!value || generation.current !== token) return;
        currentBody = value.body; applyBody(currentBody, value.schema2PublicationEnabled);
      }
      for (const ref of currentBody.manifest.pages) {
        if (generation.current !== token || await rawHash(contents[ref.pageNo]) !== ref.pageHash) throw new Error('資料包與此快照頁不一致。');
        setWorking('保存完整快照 ' + (ref.pageNo + 1) + '／' + currentBody.manifest.pages.length);
        const value = await io.run<{ bodyId: string; pageNo: number; pageHash: string }>('保存完整快照頁', '/api/admin/etf-reports/bodies/' + currentBody.id + '/pages',
          { pageNo: ref.pageNo, content: contents[ref.pageNo] }, true, currentBody.id);
        if (!value) return;
        if (value.bodyId !== currentBody.id || value.pageHash !== ref.pageHash || value.pageNo !== ref.pageNo) throw new Error('保存回應與完整快照不一致。');
      }
      if (generation.current === token) { setRawChanged(false); io.setNotice({ tone: 'success', message: '完整快照已私有保存，所有頁面尚未公開。請驗證並重建預覽。' }); }
    } catch (caught) { if (generation.current === token) io.setNotice({ tone: 'error', message: errorDetails(caught).message }); }
    finally { if (generation.current === token) setWorking(''); }
  }
  async function validate() {
    if (!body || rawChanged) return;
    const value = await io.run<{ body: Body; validation: BodyValidation }>('驗證完整快照', '/api/admin/etf-reports/bodies/' + body.id + '/validate',
      { expectedRevision: body.revision }, true, body.id);
    if (value) { applyBody(value.body); setValidation(value.validation); selectTab('validation'); setPreview(null); }
  }
  async function review() {
    if (!body?.reviewHash || !preview || !acknowledged || rawChanged) return;
    const value = await io.run<{ body: Body; schema2PublicationEnabled: boolean }>('記錄完整快照審閱', '/api/admin/etf-reports/bodies/' + body.id + '/review',
      { expectedRevision: body.revision, reviewHash: body.reviewHash, acknowledged: true }, true, body.id);
    if (value) applyBody(value.body, value.schema2PublicationEnabled);
  }
  async function publish() {
    if (!body?.reviewHash || !body.reviewed || !enabled || rawChanged || !acknowledged) return;
    const value = await io.run<{ body: Body; version?: number }>('確認發布完整快照', '/api/admin/etf-reports/bodies/' + body.id + '/publish',
      { expectedRevision: body.revision, reviewHash: body.reviewHash, confirmed: true }, true, body.id);
    setConfirm(false);
    if (value) { applyBody({ ...value.body, publishedVersion: value.version }); selectTab('history'); io.setNotice({ tone: 'success', message: '完整快照發布已確認，數據、評論及來源屬於同一發布版本。' }); }
  }
  async function importFile(file: File | undefined) {
    if (!file || locked) return;
    if (file.size > MAX_SNAPSHOT_BYTES) { io.setNotice({ tone: 'error', message: '完整快照超過 16 MiB。' }); return; }
    try { setRaw(await file.text()); setRawChanged(true); setAcknowledged(false); setPreview(null); }
    catch { io.setNotice({ tone: 'error', message: '檔案無法讀取。' }); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  }
  return <div className='etf-author eda-root'>
    <div inert={confirm}>
      <button className='etf-back' type='button' disabled={locked} onClick={onBack}><ArrowLeft size={16} />返回原任務</button>
      <header className='etf-author-heading'><div><span className='etf-kicker'>作者工作區 · 私有完整研究</span><h1>完整研究快照</h1><p>完整內容會分批保存並核對；全部驗證成功後才可預覽或發布。</p></div></header>
      <Feedback io={io} recover={value => { const id = value.batchId || body?.id; if (id) void loadBody(id); }} />
      {working && <PendingIndicator className='etf-note'>{working}</PendingIndicator>}
      <EtfTabs idPrefix='etf-snapshot-task' label='完整快照任務內容' tabs={taskTabs} value={tab} onChange={selectTab} />
      <EtfTabPanel idPrefix='etf-snapshot-task' id='import' active={tab === 'import'}>
        <h2>資料匯入</h2>
        <div className='etf-import-controls'><button type='button' disabled={locked} onClick={() => fileRef.current?.click()}><Upload size={16} />匯入完整研究 JSON</button><input ref={fileRef} type='file' hidden accept='.json,application/json' onChange={event => void importFile(event.target.files?.[0])} /></div>
        <label className='etf-json-label'>完整研究資料包<textarea value={raw} disabled={locked} rows={16} spellCheck={false} onChange={event => { setRaw(event.target.value); setRawChanged(true); setAcknowledged(false); setPreview(null); }} /></label>
        <div className='etf-filter'><label>原保存版本<input type='number' min={0} step={1} value={baseRevision} disabled={locked} onChange={event => { setBaseRevision(Number(event.target.value)); setRawChanged(true); setAcknowledged(false); }} /></label><label>預期公開版本<input type='number' min={0} step={1} value={publishedVersion} disabled={locked} onChange={event => { setPublishedVersion(Number(event.target.value)); setRawChanged(true); setAcknowledged(false); }} /></label></div>
        <p className='etf-note'>新報告兩個版本皆為 0；修訂請填目前保存與公開版本。未確認的版本會被伺服器拒絕。修改內容會建立新的私有快照並使先前審閱失效。</p>
        <button type='button' disabled={locked || !raw.trim() || !Number.isSafeInteger(baseRevision) || baseRevision < 0 || !Number.isSafeInteger(publishedVersion) || publishedVersion < 0} onClick={() => void save()}>保存／繼續完整快照</button>
        {body && <p className='etf-note'>任務 {body.id} · r{body.revision} · {body.manifest.pages.length} 頁 · {body.manifest.bodyBytes.toLocaleString('zh-TW')} bytes。重新開啟後可重新匯入同一資料包繼續；未保存內容不會自動還原。</p>}
      </EtfTabPanel>
      <EtfTabPanel idPrefix='etf-snapshot-task' id='validation' active={tab === 'validation'}>
        <h2>驗證與缺口</h2>
        <p>{body?.sealed ? '所有頁面與完整內容已由伺服器核對並封存。' : '尚未封存完整快照；缺頁或內容核對不符會阻擋預覽與發布。'}</p>
        {body?.dataLineage && <p className='etf-note'>資料發布版本 {body.dataLineage.publicationIds.join('、') || '未提供'}；比較 {body.dataLineage.comparison.start || '未知'} → {body.dataLineage.comparison.end || '未知'}。</p>}
        <button type='button' disabled={locked || !body || rawChanged} onClick={() => void validate()}>驗證完整快照</button>
        {!!validation?.blockingErrors.length && <ul className='etf-errors' role='alert'>{validation.blockingErrors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
        {!!validation?.warnings.length && <ul className='etf-warnings'>{validation.warnings.map((message, index) => <li key={index}>{message}</li>)}</ul>}
        {preview?.warnings && <ul className='etf-warnings'>{preview.warnings.map((message, index) => <li key={index}>{message}</li>)}</ul>}
      </EtfTabPanel>
      <EtfTabPanel idPrefix='etf-snapshot-task' id='preview' active={tab === 'preview'}>
        <h2>私有預覽</h2><button type='button' disabled={locked || !body?.sealed || rawChanged} onClick={() => void loadPreview()}>重建並核對保存快照</button>
        {preview ? <ReportBody report={preview} version={body?.revision || 0} preview active={tab === 'preview'} /> : <p className='etf-note'>讀取全部保存頁面，核對每頁與完整內容後才會顯示。失敗時不顯示部分報告。</p>}
      </EtfTabPanel>
      <EtfTabPanel idPrefix='etf-snapshot-task' id='history' active={tab === 'history'}>
        <h2>發布紀錄</h2><p>{body ? '保存 r' + body.revision + ' · ' + (body.reviewed ? '已審閱' : body.sealed ? '待審閱' : '尚未封存') : '尚未保存完整快照'}</p>
        {body?.publishedVersion && <p>已確認公開</p>}
        <label className='etf-review-check'><input type='checkbox' checked={acknowledged} disabled={locked || !preview || rawChanged || !body?.sealed} onChange={event => setAcknowledged(event.target.checked)} /><span>我已閱讀這份完整快照的評論、來源、資料版本與全部缺口。</span></label>
        <div className='etf-author-actions'><button type='button' disabled={locked || !body?.sealed || !acknowledged || !preview || rawChanged || body.reviewed} onClick={() => void review()}>記錄完整快照審閱</button><button type='button' disabled={locked || !body?.reviewed || !acknowledged || rawChanged || !enabled} onClick={() => setConfirm(true)}>確認發布完整快照</button></div>
        {!enabled && <p className='etf-note' role='status'>完整快照格式尚待讀者與作者介面完成相容驗證，目前不能發布；私有保存、驗證與預覽仍可使用。</p>}
      </EtfTabPanel>
    </div>
    {confirm && <Confirm busy={io.busy} title='發布這份完整研究快照？' label='確認發布至 STAGING' onCancel={() => setConfirm(false)} onConfirm={() => void publish()}><p>{body?.reportSummary?.title}，將更新目前公開內容。原始舊報告與來源版本保留。</p></Confirm>}
  </div>;
}
