import { useFooterVersion } from './research-footer';
import { useEffect, useRef, useState } from 'react';
import { BarChart3, Check, CircleAlert, FileText, FolderOpen, Image as ImageIcon, Link, Plus, RefreshCw, Upload } from 'lucide-react';
import { MAX_MARKDOWN_SOURCE_BYTES, type MarkdownEntry, type MarkdownIssue, type MarkdownListItem, type MarkdownValidation } from '../shared/etf-markdown';
import { EtfTabs, EtfTabPanel } from './active-etf';
import { parseEtfResearchSource, researchSource, researchFilename } from '../shared/etf-research';
import { MAX_ETF_COVER_BYTES, validateEtfCover, type EtfCoverDescriptor, type EtfCoverInput } from '../shared/etf-cover';
import { MarkdownEtfReader } from './etf-markdown-reader';
import './etf-markdown-author.css';

export type MarkdownAuthorAction = 'validate' | 'save' | 'get' | 'list' | 'review' | 'publish' | 'visibility' | 'status';
export type MarkdownEtfAuthorProps = {
  sessionToken: string;
  request: (action: MarkdownAuthorAction, payload: Record<string, unknown>) => Promise<unknown>;
  onDirtyChange: (dirty: boolean) => void;
  onExit?: () => void;
};
type Pending = { action: 'save' | 'review' | 'publish' | 'visibility'; requestId: string; reportId: string };
type Notice = { tone: 'success' | 'error' | 'neutral'; message: string };
type CoverChoice = { input: EtfCoverInput; descriptor: EtfCoverDescriptor; sourceHash: string; filename: string };
const tabs = [{ id: 'import', label: '資料匯入' }, { id: 'validation', label: '驗證與缺口' }, { id: 'preview', label: '預覽' }, { id: 'history', label: '發布紀錄' }];
const pendingKey = 'pocketstocks_etf_markdown_pending';
function restoredPending(): Pending | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(pendingKey) || 'null');
    return value && ['save', 'review', 'publish', 'visibility'].includes(value.action) && typeof value.requestId === 'string' && typeof value.reportId === 'string' ? value : null;
  } catch { return null; }
}
function codeOf(error: unknown): number {
  if (!error || typeof error !== 'object') return 0;
  const e = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  return Number(e.status ?? e.statusCode ?? e.response?.status ?? 0);
}
async function deadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), 25000); })]); }
  finally { clearTimeout(timer); }
}
function initialTab() {
  const value = new URLSearchParams(location.hash.split('?')[1] || '').get('authorTab');
  return tabs.some(tab => tab.id === value) ? value! : 'import';
}
function listItem(entry: MarkdownEntry): MarkdownListItem {
  const { draft, ...rest } = entry;
  return { ...rest, title: draft.title, sourceHash: draft.sourceHash, researchDate: draft.period.end, dataStatus: String(draft.shared.metadata?.data_status || 'partial') };
}
function readableTime(value: string | null) {
  if (!value) return '尚未發布';
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(value));
}
function Issues({ issues, warning = false }: { issues: MarkdownIssue[]; warning?: boolean }) {
  return issues.length ? <div className='md-author-issues'><h3>{warning ? '來源與資料缺口' : '請先修正以下問題'}</h3><ul>{issues.map((issue, i) => <li key={i}><code>{issue.path}</code><span>{issue.message}</span></li>)}</ul></div> : null;
}

function ResearchFormat({ report }: { report: MarkdownEntry['draft'] }) {
  const isJson = report.format === 'etf-json';
  return <details className='md-author-source'>
    <summary>來源格式與解析識別</summary>
    <dl className='md-author-metadata'>
      <dt>研究來源</dt><dd>{isJson ? 'JSON 研究資料' : '歷史 Markdown 研究'}</dd>
      <dt>來源檔</dt><dd>{researchFilename(report)}</dd>
      <dt>資料格式</dt><dd>{String(report.frontmatter.schema_version)}</dd>
      {isJson && <><dt>文字格式</dt><dd>{report.analysis?.format_version}</dd></>}
      <dt>圖表格式</dt><dd>{String(report.shared.schema_version)}</dd>
      <dt>解析版本</dt><dd>{report.parserVersion}</dd>
    </dl>
    <p className='etf-note'>文章、三組圖表與來源由同一份研究檔管理。report.html 只負責展示，不需另外匯入或發布。</p>
  </details>;
}

function CoverPreview({ cover, report, filename = 'cover.jpg', status }: {
  cover: EtfCoverDescriptor; report: MarkdownEntry['draft']; filename?: string; status: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [cover.url]);
  return <figure className='md-author-cover-preview'>
    {failed ? <p role='status'>封面暫時無法載入。已保存研究可重新載入，取得新的預覽連結。</p> : <img src={cover.url} alt={report.title + '，' + report.period.end + ' 研究封面'} width={480} height={360} onError={() => setFailed(true)} />}
    <figcaption><strong>{filename}</strong><span>{status} · 480 × 360 · JPEG · {(cover.bytes / 1024).toFixed(1)} KiB</span><span>關聯研究日 {report.period.end} · {report.id}</span><code>SHA-256 {cover.sha256}</code></figcaption>
  </figure>;
}

export function MarkdownEtfAuthor({ sessionToken, request, onDirtyChange, onExit }: MarkdownEtfAuthorProps) {
  const [items, setItems] = useState<MarkdownListItem[]>([]);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [listRetry, setListRetry] = useState(0);
  const [raw, setRaw] = useState('');
  const [savedRaw, setSavedRaw] = useState('');
  const [filename, setFilename] = useState('');
  const [coverChoice, setCoverChoice] = useState<CoverChoice | null | undefined>(undefined);
  const [coverError, setCoverError] = useState('');
  const [coverNotice, setCoverNotice] = useState('');
  const [entry, setEntry] = useState<MarkdownEntry | null>(null);
  useFooterVersion(entry?.publishedVersion, '公開版本');
  const [validation, setValidation] = useState<MarkdownValidation | null>(null);
  const [validatedRaw, setValidatedRaw] = useState('');
  const [tab, setTab] = useState(initialTab);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, setPending] = useState<Pending | null>(restoredPending);
  const [reviewAccepted, setReviewAccepted] = useState(false);
  const [publishDialog, setPublishDialog] = useState(false);
  const [visibilityDialog, setVisibilityDialog] = useState(false);
  const [replaceAction, setReplaceAction] = useState<(() => void) | null>(null);
  const requestRef = useRef(request); requestRef.current = request;
  const generation = useRef(0);
  const editGeneration = useRef(0);
  const busyRef = useRef(''); busyRef.current = busy;
  const entryRef = useRef(entry); entryRef.current = entry;
  const rawRef = useRef(raw); rawRef.current = raw;
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const fileReadGeneration = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const coverReadGeneration = useRef(0);
  const sourceInput = useRef<HTMLTextAreaElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const initialReport = useRef(new URLSearchParams(location.hash.split('?')[1] || '').get('reportId'));
  const savedCover = entry?.cover || null;
  const currentCover = coverChoice === undefined ? savedCover : coverChoice?.descriptor || null;
  const coverDirty = (currentCover?.sha256 || null) !== (savedCover?.sha256 || null);
  const dirty = raw !== savedRaw || coverDirty;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const valid = validation?.report && !validation.errors.length && validatedRaw === raw;
  const report = valid ? validation.report : null;
  const saved = !!entry && !dirty && raw === researchSource(entry.draft);
  const reviewed = saved && entry.reviewedRevision === entry.revision && !!entry.reviewHash;
  const canPublish = saved && valid && reviewed && !busy && !pending && entry.hasUnpublishedChanges;
  const modal = publishDialog || visibilityDialog || !!replaceAction;

  function working(value: string) { busyRef.current = value; setBusy(value); }
  function setOperation(value: Pending | null) {
    pendingRef.current = value; setPending(value);
    try { if (value) sessionStorage.setItem(pendingKey, JSON.stringify(value)); else sessionStorage.removeItem(pendingKey); } catch { /* Keep recovery available in this open workspace. */ }
  }
  function selectTab(value: string) {
    setTab(value);
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    params.set('workflow', 'markdown'); params.set('authorTab', value);
    if (entryRef.current) params.set('reportId', entryRef.current.id);
    else if (!rawRef.current) params.delete('reportId');
    history.replaceState(history.state, '', '#/admin/active-etf?' + params.toString());
  }
  function requireReplacement(action: () => void) {
    if (busyRef.current || pendingRef.current) { setNotice({ tone: 'neutral', message: '請先確認目前操作結果，再切換研究。' }); return; }
    if (!dirtyRef.current) { action(); return; }
    returnFocus.current = document.activeElement as HTMLElement;
    setReplaceAction(() => action);
  }
  function applyEntry(value: MarkdownEntry, message: string) {
    editGeneration.current += 1;
    setEntry(value); setRaw(researchSource(value.draft)); setSavedRaw(researchSource(value.draft)); setFilename(researchFilename(value.draft));
    setCoverChoice(undefined); setCoverError(''); setCoverNotice(''); coverReadGeneration.current += 1;
    setValidation({ report: value.draft, errors: [], warnings: value.draft.warnings }); setValidatedRaw(researchSource(value.draft));
    setItems(current => [listItem(value), ...current.filter(item => item.id !== value.id)]);
    setReviewAccepted(false); setOperation(null); setNotice({ tone: 'success', message });
    const params = new URLSearchParams(location.hash.split('?')[1] || ''); params.set('workflow', 'markdown'); params.set('reportId', value.id);
    history.replaceState(history.state, '', '#/admin/active-etf?' + params.toString());
  }
  async function loadEntry(id: string, approved = false, nextTab = 'import') {
    if (!approved) { requireReplacement(() => void loadEntry(id, true, nextTab)); return; }
    const current = generation.current; working('load'); setNotice(null);
    try {
      const value = await deadline(requestRef.current('get', { id })) as { entry: MarkdownEntry };
      if (generation.current !== current) return;
      if (!value.entry?.draft || !researchSource(value.entry.draft)) throw new Error('invalid entry');
      applyEntry(value.entry, '已載入私有草稿，公開版本維持原狀。'); setTab(nextTab);
    } catch (error) { if (generation.current === current) failure(error, '草稿暫時無法載入，請再試一次。'); }
    finally { if (generation.current === current) working(''); }
  }
  function failure(error: unknown, fallback: string) {
    const code = codeOf(error);
    setNotice({ tone: 'error', message: code === 401 || code === 403 ? '作者登入已逾時或權限不足。輸入內容仍保留，請重新登入後繼續。' : code === 409 ? '版本已變更，這次操作未套用。目前輸入仍保留；請重新載入已保存版本後比較。' : fallback });
  }
  useEffect(() => { onDirtyChange(dirty || !!pending); }, [dirty, pending, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => { if (dirtyRef.current || pendingRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', protect); return () => window.removeEventListener('beforeunload', protect);
  }, []);
  useEffect(() => {
    generation.current += 1; const current = generation.current; let active = true; working(''); setListState('loading');
    void (async () => {
      try {
        const loaded = new Map<string, MarkdownListItem>(); const seen = new Set<string>(); let nextToken = '';
        do {
          const value = await deadline(requestRef.current('list', nextToken ? { nextToken } : {})) as { items: MarkdownListItem[]; nextToken?: string };
          if (!Array.isArray(value.items)) throw new Error('invalid list');
          value.items.forEach(item => loaded.set(item.id, item)); nextToken = value.nextToken || '';
          if (seen.has(nextToken) && nextToken) throw new Error('repeated cursor'); seen.add(nextToken);
        } while (nextToken && active && generation.current === current);
        if (active && generation.current === current) { setItems([...loaded.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); setListState('ready'); }
      } catch (error) { if (active && generation.current === current) { setListState('error'); failure(error, '已保存研究暫時無法載入，請重新載入清單。'); } }
    })();
    return () => { active = false; generation.current += 1; };
  }, [sessionToken, listRetry]);
  useEffect(() => {
    if (listState === 'ready' && initialReport.current && !rawRef.current && !pendingRef.current) {
      const id = initialReport.current; initialReport.current = null; void loadEntry(id, true, tab);
    }
  }, [listState]);
  useEffect(() => {
    if (!modal) return;
    dialog.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); setPublishDialog(false); setVisibilityDialog(false); setReplaceAction(null); }
      if (event.key !== 'Tab') return;
      const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || [])];
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keydown); returnFocus.current?.focus(); };
  }, [modal]);
  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(location.hash.split('?')[1] || '');
      if (params.get('workflow') !== 'markdown') return;
      const target = params.get('authorTab'); const nextTab = tabs.some(t => t.id === target) ? target! : 'import';
      const id = params.get('reportId');
      if (id && id !== entryRef.current?.id) {
        const restore = new URLSearchParams(params);
        if (entryRef.current) restore.set('reportId', entryRef.current.id); else restore.delete('reportId');
        history.replaceState(history.state, '', '#/admin/active-etf?' + restore.toString());
        requireReplacement(() => void loadEntry(id, true, nextTab)); return;
      }
      setTab(nextTab);
    };
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);

  async function validateSource(input = raw, replace = false, fileName = filename): Promise<MarkdownValidation | null> {
    if (busyRef.current || pendingRef.current) return null;
    const current = generation.current; const edit = editGeneration.current; working('validate'); setNotice(null);
    try {
      const local = await parseEtfResearchSource(input);
      const value = local.errors.length ? local : await deadline(requestRef.current('validate', { rawSource: input })) as MarkdownValidation;
      if (generation.current !== current || editGeneration.current !== edit) return null;
      if (!Array.isArray(value.errors) || !Array.isArray(value.warnings)) throw new Error('invalid validation');
      if (replace && (!value.report || value.errors.length)) {
        setNotice({ tone: 'error', message: '選取的檔案無法匯入，原有編輯內容已保留。' });
        setImportIssues(value.errors); selectTab('validation'); requestAnimationFrame(() => document.getElementById('md-author-panel-validation')?.focus()); return value;
      }
      const accept = () => {
        const associatedSource = coverChoice?.sourceHash || entryRef.current?.draft.sourceHash;
        if (value.report && associatedSource && associatedSource !== value.report.sourceHash) {
          setCoverChoice(null); setCoverError(''); setCoverNotice('研究來源已變更，先前封面未沿用。請為這份研究重新選擇封面，或不附封面保存。');
        }
        if (replace) {
          editGeneration.current += 1; setRaw(input); setFilename(fileName); setReviewAccepted(false);
          if (entryRef.current?.id !== value.report?.id) { setEntry(null); entryRef.current = null; setSavedRaw('');
            const params = new URLSearchParams(location.hash.split('?')[1] || ''); params.delete('reportId'); history.replaceState(history.state, '', '#/admin/active-etf?' + params.toString()); }
        }
        setValidation(value); setValidatedRaw(input); setImportIssues([]);
        const unchanged = !coverDirty && !!entryRef.current && entryRef.current.id === value.report?.id && input === researchSource(entryRef.current.draft);
        setNotice({ tone: value.errors.length ? 'error' : 'success', message: value.errors.length ? '請依問題位置修正；內容尚未保存或公開。' : unchanged ? '內容與已保存草稿一致，不需再次保存或發布。' : '解析完成，尚未保存或發布。結構驗證不代表已查證市場資料。' });
        if (!replace || value.errors.length) { selectTab('validation'); if (value.errors.length) requestAnimationFrame(() => document.getElementById('md-author-panel-validation')?.focus()); }
      };
      if (replace && dirtyRef.current) { returnFocus.current = document.activeElement as HTMLElement; setReplaceAction(() => accept); }
      else accept();
      return value;
    } catch (error) { if (generation.current === current && editGeneration.current === edit) failure(error, '目前無法驗證，原有輸入仍保留。請稍後重新驗證。'); return null; }
    finally { if (generation.current === current) working(''); }
  }
  const [importIssues, setImportIssues] = useState<MarkdownIssue[]>([]);
  async function importFile(file?: File) {
    if (!file || busyRef.current || pendingRef.current) return;
    if (!/\.(?:json|md)$/i.test(file.name) || !file.size || file.size > MAX_MARKDOWN_SOURCE_BYTES) {
      setNotice({ tone: 'error', message: !/\.(?:json|md)$/i.test(file.name) ? '請選擇 data.json，或歷史 report.md。report.html 是閱讀模板，請匯入同資料夾的 data.json。' : !file.size ? '檔案是空的，請選擇含有完整研究內容的 data.json。' : '檔案超過 512 KiB，請縮減來源後重試。原有內容已保留。' }); return;
    }
    const read = ++fileReadGeneration.current; const current = generation.current; working('read');
    try {
      const text = await file.text();
      if (read !== fileReadGeneration.current || current !== generation.current) return;
      working(''); await validateSource(text, true, file.name);
    } catch { if (read === fileReadGeneration.current && current === generation.current) { working(''); setNotice({ tone: 'error', message: '檔案讀取失敗，原有內容已保留。請重新選檔。' }); } }
  }
  async function importCover(file?: File) {
    if (!file || busyRef.current || pendingRef.current) return;
    if (!report) { setCoverError('請先選擇並驗證研究資料，再選擇這份研究的封面。'); return; }
    if (!/\.jpe?g$/i.test(file.name) || (file.type && file.type !== 'image/jpeg')) { setCoverError('封面只接受 JPEG（.jpg／.jpeg）。原有封面已保留。'); return; }
    if (!file.size || file.size > MAX_ETF_COVER_BYTES) { setCoverError('封面須為非空 JPEG，且不得超過 1 MiB。原有封面已保留。'); return; }
    const read = ++coverReadGeneration.current, current = generation.current, edit = editGeneration.current;
    const inputSource = raw, sourceHash = report.sourceHash; working('cover'); setCoverError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = ''; for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      const input = { contentBase64: btoa(binary), filename: file.name };
      const checked = await validateEtfCover(input);
      if (!checked.cover || checked.errors.length) throw new Error(checked.errors.map(error => error.message).join('；') || '封面格式無法驗證。');
      const url = 'data:image/jpeg;base64,' + checked.cover.contentBase64;
      const image = new Image(); image.src = url; await image.decode();
      if (image.naturalWidth !== 480 || image.naturalHeight !== 360) throw new Error('封面尺寸必須為 480 × 360 像素。');
      const validated = await deadline(requestRef.current('validate', { rawSource: inputSource, cover: input })) as MarkdownValidation & { coverErrors?: MarkdownIssue[] };
      if (validated.errors.length || validated.coverErrors?.length) throw new Error((validated.coverErrors?.length ? validated.coverErrors : validated.errors).map(error => error.message).join('；'));
      if (current !== generation.current || read !== coverReadGeneration.current || edit !== editGeneration.current) return;
      if (checked.cover.sha256 === (entryRef.current?.cover?.sha256 || null)) {
        setCoverChoice(undefined); setCoverNotice('封面與已保存版本一致，不需再次保存。');
      } else {
        const { contentBase64: _content, ...descriptor } = checked.cover;
        setCoverChoice({ input, descriptor: { ...descriptor, url }, sourceHash, filename: file.name });
        setCoverNotice('封面已選擇，尚未保存或公開。保存後需重新預覽及審閱。');
      }
      setReviewAccepted(false);
    } catch (error) {
      if (current === generation.current && read === coverReadGeneration.current && edit === editGeneration.current) setCoverError((error instanceof Error ? error.message : '封面無法讀取。') + ' 原有封面已保留。');
    } finally { if (current === generation.current && read === coverReadGeneration.current) working(''); }
  }
  function removeCover() {
    if (busyRef.current || pendingRef.current || !currentCover) return;
    setCoverChoice(null); setCoverError(''); setReviewAccepted(false);
    setCoverNotice('本次草稿將不附封面。尚未保存，原公開版本不受影響。');
  }
  async function mutate(action: 'save' | 'review' | 'publish') {
    if (busyRef.current || pendingRef.current || !report) return;
    if (action !== 'save' && (!saved || !entry)) return;
    if (action === 'review' && !reviewAccepted || action === 'publish' && !canPublish) return;
    const requestId = crypto.randomUUID();
    const payload = action === 'save' ? { rawSource: raw, baseRevision: entry?.id === report.id ? entry.revision : items.find(i => i.id === report.id)?.revision || 0, requestId, ...(coverChoice === undefined ? {} : { cover: coverChoice?.input || null }) }
      : action === 'review' ? { id: entry!.id, baseRevision: entry!.revision, sourceHash: entry!.draft.sourceHash, requestId }
      : { id: entry!.id, baseRevision: entry!.revision, expectedPublishedVersion: entry!.publishedVersion, reviewHash: entry!.reviewHash, reviewed: true, requestId };
    const current = generation.current; setOperation({ action, requestId, reportId: report.id }); working(action); setPublishDialog(false); setNotice(null);
    try {
      const value = await deadline(requestRef.current(action, payload)) as { entry: MarkdownEntry };
      if (generation.current !== current) return;
      if (!value.entry?.draft) throw new Error('invalid mutation');
      applyEntry(value.entry, action === 'save' ? '私有草稿已保存。文章與內嵌資料尚未公開。' : action === 'review' ? '已記錄這個修訂的審閱，可確認發布。' : '發布已確認。文章、三組資料、來源與缺口已同版公開。');
      if (action === 'publish') selectTab('history');
    } catch (error) {
      if (generation.current !== current) return;
      if (codeOf(error) >= 400 && codeOf(error) < 500) { setOperation(null); failure(error, '操作未套用，請檢查資料後重試。'); }
      else setNotice({ tone: 'neutral', message: '操作結果尚未確認。請先查詢狀態，勿重複保存、審閱或發布。' });
    } finally { if (generation.current === current) working(''); }
  }
  async function changeVisibility() {
    if (busyRef.current || pendingRef.current || !entry || !saved || !entry.publishedVersion) return;
    const current = generation.current;
    const requestId = crypto.randomUUID();
    setOperation({ action: 'visibility', requestId, reportId: entry.id });
    working('visibility'); setNotice(null);
    try {
      const value = await deadline(requestRef.current('visibility', {
        id: entry.id, baseRevision: entry.revision,
        expectedPublishedVersion: entry.publishedVersion,
        expectedUpdatedAt: entry.updatedAt, archived: !entry.archived, requestId,
      })) as { entry: MarkdownEntry };
      if (generation.current !== current) return;
      if (!value.entry?.draft) throw new Error('invalid visibility response');
      applyEntry(value.entry, value.entry.archived
        ? '已下架公開文章。草稿、封面與歷史版本均保留，可從發布紀錄恢復。'
        : '已恢復原公開版本，沒有建立新版本。');
      setVisibilityDialog(false);
    } catch (error) {
      if (generation.current !== current) return;
      if (codeOf(error) >= 400 && codeOf(error) < 500) {
        setOperation(null); failure(error, '公開狀態未變更，請重新載入後再試。');
      } else {
        setNotice({ tone: 'neutral', message: '公開狀態尚未確認。請先查詢操作狀態，勿重複提交。' });
      }
    } finally { if (generation.current === current) working(''); }
  }
  async function checkStatus() {
    const operation = pendingRef.current; if (!operation || busyRef.current) return;
    const current = generation.current; working('status');
    try {
      const value = await deadline(requestRef.current('status', { requestId: operation.requestId })) as { state: 'applied' | 'unresolved'; entry?: MarkdownEntry };
      if (generation.current !== current) return;
      if (value.state === 'applied' && value.entry) { applyEntry(value.entry, '已確認上次操作成功，沒有重複提交。'); if (operation.action === 'publish' || operation.action === 'visibility') { setVisibilityDialog(false); selectTab('history'); } }
      else setNotice({ tone: 'neutral', message: '操作結果仍未確認。請保留工作區，稍後再查詢；系統不會重新提交。' });
    } catch (error) { if (generation.current === current) failure(error, '目前無法查詢結果，請稍後再查詢。'); }
    finally { if (generation.current === current) working(''); }
  }
  function newResearch() {
    requireReplacement(() => { editGeneration.current += 1; setEntry(null); entryRef.current = null; setRaw(''); rawRef.current = ''; setSavedRaw(''); setFilename(''); setCoverChoice(undefined); setCoverError(''); setCoverNotice(''); setValidation(null); setValidatedRaw(''); setReviewAccepted(false); setImportIssues([]); setNotice(null); selectTab('import'); });
  }
  function edit(value: string) {
    editGeneration.current += 1; setRaw(value); setValidation(null); setValidatedRaw(''); setReviewAccepted(false); setImportIssues([]);
    setNotice({ tone: 'neutral', message: '內容已修改，請重新驗證、保存及審閱。公開版本不受影響。' });
  }
  const sourceCount = report ? Object.keys(report.shared.source_registry || {}).length : 0;
  return <div className='etf-author md-author'>
    <div inert={modal || undefined}>
      <header className='etf-author-heading'><div><h1>ETF 報告</h1><p>從 data.json 匯入研究，可搭配 cover.jpg 封面。驗證後保存私有草稿，再預覽、審閱及發布。</p></div>{onExit && <button type='button' onClick={() => requireReplacement(onExit)}>返回上傳選擇</button>}</header>
      {notice && <div className={'etf-notice ' + notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}><CircleAlert size={19} /><span>{notice.message}</span></div>}
      {pending && <div className='etf-pending' role='status'><h2>操作結果尚未確認</h2><p>先查詢上次 {pending.action === 'save' ? '保存' : pending.action === 'review' ? '審閱' : pending.action === 'visibility' ? '公開狀態變更' : '發布'} 結果，再進行其他操作。重新整理仍會保留查詢識別碼。</p><button type='button' disabled={!!busy} onClick={() => void checkStatus()}><RefreshCw size={16} />查詢操作狀態</button></div>}
      <div className={'md-author-layout' + (tab === 'preview' ? ' md-author-preview-layout' : '')}>
        <aside className='md-author-list' aria-label='已保存研究'><div className='md-author-list-heading'><h2>已保存研究</h2><button type='button' disabled={!!busy || !!pending} onClick={newResearch}><Plus size={17} />新增研究</button></div>
          {listState === 'loading' && <p role='status'>載入研究中…</p>}
          {listState === 'error' && <button type='button' disabled={!!busy || !!pending} onClick={() => setListRetry(n => n + 1)}>重新載入清單</button>}
          {listState === 'ready' && !items.length && <p>尚未保存研究。選擇 data.json 開始。</p>}
          <ul>{items.map(item => <li key={item.id}><button type='button' aria-pressed={entry?.id === item.id} disabled={!!busy || !!pending} onClick={() => void loadEntry(item.id)}><strong>{item.title}</strong><span>{item.researchDate} · 草稿 r{item.revision}</span><small>{item.publishedVersion ? `${item.archived ? '已下架' : '公開'} · ${item.hasUnpublishedChanges ? '有未發布修訂' : '與草稿一致'}` : '私有草稿 · 尚未公開'}</small></button></li>)}</ul>
        </aside>
        <main className='md-author-main'>
          <div className='md-author-source-state'><span>{dirty ? '尚未保存的變更' : entry ? `草稿 r${entry.revision}${entry.hasUnpublishedChanges ? ' · 尚未發布的修訂' : ' · 與公開版一致'}` : '新增研究'}</span><span>來源檔 {filename || '尚未選擇'}</span></div>
          <EtfTabs idPrefix='md-author' label='ETF 研究作者任務' tabs={tabs} value={tab} onChange={selectTab} />
          <EtfTabPanel idPrefix='md-author' id='import' active={tab === 'import'}>
            <form noValidate onSubmit={event => { event.preventDefault(); void validateSource(); }}>
              <div className='etf-import-controls'><button className='md-author-primary' type='button' disabled={!!busy || !!pending} onClick={() => fileInput.current?.click()}><FolderOpen size={18} />{filename ? '重新選擇研究檔' : '選擇 data.json'}</button><input ref={fileInput} className='md-author-file' type='file' accept='.json,application/json,.md,text/markdown' aria-label='選擇研究資料檔' disabled={!!busy || !!pending} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importFile(file); }} /></div>
              <p className='etf-note'>data.json 為主要來源，最多 512 KiB；歷史 report.md 仍可讀取。report.html 是閱讀模板，不需上傳。選檔與驗證不會保存或公開。</p>
              {report && <><h3>解析後的文章資訊</h3><dl className='md-author-metadata'><dt>標題</dt><dd>{report.title}</dd><dt>研究日</dt><dd>{report.period.end}</dd><dt>比較日</dt><dd>{report.period.start}</dd><dt>補查日</dt><dd>{report.evidenceDate}</dd><dt>固定樣本</dt><dd>{(report.shared.metadata?.etf_codes || []).join('、')}</dd></dl><div className='etf-table-scroll' tabIndex={0} role='region' aria-label='解析資料摘要'><table className='etf-table md-author-counts'><caption>資料摘要（解析自研究檔）</caption><thead><tr><th>文章</th>{report.visualizations.map(v => <th key={v.id}>{v.id === 'industry_allocation_changes' ? '產業異動' : v.id === 'stock_holding_changes' ? '個股異動' : '週度趨勢'}</th>)}<th>來源</th></tr></thead><tbody><tr><td>已取得</td>{report.visualizations.map(v => <td key={v.id}>{v.rows.length} 筆</td>)}<td>{sourceCount} 筆</td></tr></tbody></table></div><ResearchFormat report={report} /></>}
              <section className='md-author-cover' aria-labelledby='md-author-cover-title'>
                <h3 id='md-author-cover-title'>研究封面（選填）</h3>
                <p id='md-author-cover-help' className='etf-note'>選擇同份研究的 cover.jpg：480 × 360 像素、RGB JPEG，最多 1 MiB。封面會隨研究同版保存與發布，不會另建文章。</p>
                <div className='etf-import-controls'><button type='button' disabled={!report || !!busy || !!pending} onClick={() => coverInput.current?.click()}><ImageIcon size={17} aria-hidden='true' />{currentCover ? '更換 cover.jpg' : '選擇 cover.jpg'}</button><input ref={coverInput} className='md-author-file' type='file' accept='.jpg,.jpeg,image/jpeg' aria-label='選擇研究封面 JPEG' aria-describedby='md-author-cover-help' disabled={!report || !!busy || !!pending} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void importCover(file); }} />
                  {currentCover && <button type='button' disabled={!!busy || !!pending} onClick={removeCover}>移除封面</button>}
                  {coverDirty && entry && report?.sourceHash === entry.draft.sourceHash && <button type='button' disabled={!!busy || !!pending} onClick={() => { setCoverChoice(undefined); setCoverError(''); setCoverNotice('封面變更已取消，恢復已保存的封面狀態。'); setReviewAccepted(false); }}>取消封面變更</button>}
                </div>
                {coverError && <p className='md-author-cover-error' role='alert'>{coverError}</p>}
                {coverNotice && <p className='etf-note' role='status'>{coverNotice}</p>}
                {currentCover && report ? <CoverPreview cover={currentCover} report={report} filename={coverChoice?.filename || 'cover.jpg'} status={coverDirty ? '尚未保存' : '已保存封面'} /> : <p className='etf-note'>{coverChoice === null && savedCover ? '本次待保存修訂將移除封面。' : '目前未附封面；可先保存完整研究。'}</p>}
              </section>
              <details className='md-author-source' open={!report || undefined}><summary>編輯來源原文</summary><label htmlFor='md-author-source-input'>來源內容</label><p id='md-author-source-help' className='etf-note'>可貼上完整 data.json，或歷史 report.md。JSON 的段落、粗體與數據重點依原始標記呈現。修改後需重新驗證、保存及審閱。</p><textarea className='resize-none' id='md-author-source-input' ref={sourceInput} value={raw} disabled={!!busy || !!pending} aria-describedby={'md-author-source-help' + (validation?.errors.length ? ' md-author-current-errors' : '')} aria-invalid={!!validation?.errors.length} onChange={event => edit(event.target.value)} spellCheck={false} style={{ resize: 'none' }} /><button type='submit' disabled={!raw.trim() || !!busy || !!pending}>重新驗證</button></details>
              <div className='etf-author-actions'><button type='button' className='md-author-primary' disabled={!valid || !dirty || !!busy || !!pending} onClick={() => void mutate('save')}><Upload size={17} />{busy === 'save' ? '正在保存…' : '保存私有草稿'}</button><button type='button' onClick={() => selectTab('validation')}>查看驗證</button></div>
            </form>
          </EtfTabPanel>
          <EtfTabPanel idPrefix='md-author' id='validation' active={tab === 'validation'}>
            <h2>{importIssues.length || validation?.errors.length ? '資料需要修正' : validation ? validation.warnings.length ? '資料部分覆蓋' : '結構驗證完成' : '尚未驗證'}</h2>
            <Issues issues={importIssues} /><div id='md-author-current-errors'><Issues issues={validation?.errors || []} /></div><Issues issues={validation?.warnings || []} warning />
            <p className='etf-note'>缺值與來源限制會隨文章呈現，不會補成零。解析通過不代表已查證市場資料。</p>
            {!validation && !importIssues.length && <p>請先選擇 data.json，或貼上完整研究內容後驗證。</p>}
            <div className='etf-author-actions'><button type='button' disabled={!raw.trim() || !!busy || !!pending} onClick={() => void validateSource()}><RefreshCw size={17} />重新驗證目前內容</button><button type='button' disabled={!saved || !valid || !!busy || !!pending} onClick={() => selectTab('preview')}>預覽已保存草稿</button><button type='button' onClick={() => { selectTab('import'); requestAnimationFrame(() => sourceInput.current?.focus()); }}>返回編輯</button></div>
          </EtfTabPanel>
          <EtfTabPanel idPrefix='md-author' id='preview' active={tab === 'preview'}>
            {saved && entry ? <><div className='md-author-preview-state'><span>私有預覽 · 草稿 r{entry.revision} · 尚未公開的修訂不影響原公開版</span><span>{entry.publishedVersion ? (entry.archived ? '已下架' : '現行公開') : '尚無公開版本'}</span></div>{entry.cover && <CoverPreview cover={entry.cover} report={entry.draft} status={'已保存 · 草稿 r' + entry.revision} />}<MarkdownEtfReader report={entry.draft} version={entry.revision} publishedAt={entry.publishedAt} preview />
              <label className='etf-review-check'><input type='checkbox' checked={reviewAccepted || !!reviewed} disabled={!!busy || !!pending || !!reviewed} onChange={event => setReviewAccepted(event.target.checked)} /><span>{entry.cover ? '我已閱讀封面、完整文章、三組圖表、來源與缺口，確認本次修訂。' : '我已閱讀完整文章、三組圖表、來源與缺口，確認本次修訂。'}</span></label><div className='etf-author-actions'><button type='button' onClick={() => selectTab('import')}>返回編輯</button><button type='button' disabled={!reviewAccepted || !!reviewed || !!busy || !!pending} onClick={() => void mutate('review')}><Check size={17} />{reviewed ? '已完成審閱' : '記錄本次審閱'}</button><button type='button' className='md-author-primary' disabled={!canPublish} onClick={event => { returnFocus.current = event.currentTarget; setPublishDialog(true); }}>確認發布…</button></div></> : <div className='md-author-empty'><FileText size={30} /><h2>先保存私有草稿</h2><p>預覽與發布會使用同一份已保存修訂。請先驗證並保存目前內容。</p><button type='button' onClick={() => selectTab('import')}>返回資料匯入</button></div>}
          </EtfTabPanel>
          <EtfTabPanel idPrefix='md-author' id='history' active={tab === 'history'}>
            <h2>{entry?.publishedVersion ? (entry.archived ? '已下架' : '已發布') : '尚無發布紀錄'}</h2>
            {entry ? <><dl className='md-author-metadata'><dt>報告標題</dt><dd>{entry.draft.title}</dd><dt>來源檔</dt><dd>{researchFilename(entry.draft)}</dd><dt>草稿修訂</dt><dd>r{entry.revision}{entry.hasUnpublishedChanges ? ' · 有尚未公開的修訂' : ' · 與公開版一致'}</dd><dt>發布時間（台北）</dt><dd>{readableTime(entry.publishedAt)}</dd><dt>發布內容</dt><dd>完整文章、三組圖表資料、來源與缺口；若附封面，會同篇同版發布。</dd></dl>{entry.publishedVersion > 0 && <div className='etf-author-actions'><button type='button' disabled={!saved || !!busy || !!pending} onClick={event => { returnFocus.current = event.currentTarget; setVisibilityDialog(true); }}>{entry.archived ? '恢復公開文章…' : '下架公開文章…'}</button>{entry.archived && <p className='etf-note'>草稿、封面與歷史版本均保留；恢復會使用原已發布版本。</p>}</div>}{entry.publishedVersion > 0 && !entry.archived && <a href={'#/active-etf/' + encodeURIComponent(entry.id) + '?v=' + entry.publishedVersion + (entry.id === 'history' ? '&report=1' : '')} onClick={event => { if (dirty || pending) { event.preventDefault(); requireReplacement(() => { location.hash = '#/active-etf/' + encodeURIComponent(entry.id) + '?v=' + entry.publishedVersion + (entry.id === 'history' ? '&report=1' : ''); }); } }}>查看公開文章 →</a>}<ResearchFormat report={entry.draft} /><details className='md-author-source'><summary>來源與版本識別</summary><p>文章 ID：{entry.id}</p><p>來源 SHA-256：<code className='md-author-hash'>{entry.draft.sourceHash}</code></p><p>已審閱修訂：{entry.reviewedRevision ? 'r' + entry.reviewedRevision : '尚未審閱'}</p></details></> : <p>選擇一篇已保存研究，查看草稿及最新發布版本。</p>}
          </EtfTabPanel>
          {busy && <p className='md-author-busy' role='status' aria-live='polite'>{busy === 'read' ? '正在讀取檔案…' : busy === 'validate' ? '正在解析與驗證…' : busy === 'cover' ? '正在驗證封面…' : busy === 'load' ? '正在載入草稿…' : busy === 'status' ? '正在查詢操作結果…' : busy === 'publish' ? '正在確認發布…' : busy === 'visibility' ? '正在更新公開狀態…' : busy === 'review' ? '正在記錄審閱…' : '正在保存草稿…'}</p>}
        </main>
        <aside className='md-author-scope'><h2>發布範圍</h2><ul><li><FileText size={22} />完整文章</li><li><BarChart3 size={22} />三組圖表資料</li><li><Link size={22} />來源與缺口</li>{currentCover && <li><ImageIcon size={22} aria-hidden='true' />研究封面</li>}</ul><p>文章、內嵌資料及所選封面同版發布。</p><p className='etf-note'>AI 可協助解析與整理，公開發布仍由 Author 管理。</p></aside>
      </div>
    </div>
    {modal && <div className='etf-confirm-backdrop'><div ref={dialog} className='etf-confirm-dialog' role='dialog' aria-modal='true' aria-labelledby='md-author-dialog-title'>
      <h2 id='md-author-dialog-title'>{replaceAction ? '有尚未保存的變更' : visibilityDialog ? entry?.archived ? '恢復公開文章？' : '下架公開文章？' : '確認發布這篇研究？'}</h2>
      {replaceAction ? <><p>繼續會放棄目前未保存的研究與封面變更。已保存草稿與公開版本不受影響。</p><div><button type='button' onClick={() => setReplaceAction(null)}>繼續編輯</button><button type='button' onClick={() => { const action = replaceAction; setReplaceAction(null); action(); }}>放棄變更並繼續</button></div></> : visibilityDialog ? <><p>{entry?.draft.title}</p><p>{entry?.archived ? '將恢復原已發布內容，不會發布目前尚未公開的草稿。' : '下架後會從公開列表移除，原公開網址也將無法閱讀。草稿、封面與所有歷史版本均保留，可隨時恢復原公開版本。'}</p><p role='status'>{busy === 'visibility' ? '正在更新公開狀態…' : pending ? '結果尚未確認，請先查詢操作狀態。' : notice?.tone === 'error' ? notice.message : ''}</p><div><button type='button' disabled={!!busy} onClick={() => setVisibilityDialog(false)}>取消</button><button type='button' disabled={!!busy || !!pending || !saved} onClick={() => void changeVisibility()}>{entry?.archived ? '恢復公開文章' : '下架公開文章'}</button>{pending && <button type='button' disabled={!!busy} onClick={() => void checkStatus()}>查詢操作狀態</button>}</div></> : <><p>{entry?.draft.title}</p><dl className='md-author-metadata'><dt>研究日</dt><dd>{entry?.draft.period.end}</dd><dt>發布內容</dt><dd>已保存且審閱的草稿；舊公開內容保留。</dd></dl>{entry?.cover && <CoverPreview cover={entry.cover} report={entry.draft} status={'將發布 · 草稿 r' + entry.revision} />}<p>將一起發布完整文章、三組圖表資料、來源與缺口{entry?.cover ? '及封面' : ''}。{entry?.publishedVersion ? '讀者將看到新版本，舊公開版本仍保留。' : '發布後讀者即可閱讀這篇研究。'}</p><div><button type='button' onClick={() => setPublishDialog(false)}>取消</button><button type='button' disabled={!canPublish} onClick={() => void mutate('publish')}>確認發布</button></div></>}
    </div></div>}
  </div>;
}
