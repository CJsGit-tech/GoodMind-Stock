import { LoadingSkeleton, PendingIndicator } from './loading';
import { useEffect, useRef, useState } from 'react';
import { markdownHash } from '../shared/etf-markdown';
import type { MarkdownEntry, MarkdownListItem, MarkdownValidation } from '../shared/etf-markdown';
import { parseInstitutionalSource, INSTITUTIONAL_SOURCE_LIMIT } from '../shared/institutional-research';
import { validateEtfCover, type EtfCoverInput } from '../shared/etf-cover';
import { EtfTabs, EtfTabPanel } from './active-etf';
import { InstitutionalReader } from './institutional-reader';
import { useFooterVersion } from './research-footer';
import './etf-markdown-author.css';
type Props = {
    sessionToken: string;
    request: (action: string, payload: Record<string, unknown>) => Promise<any>;
    onDirtyChange: (v: boolean) => void;
};
type PendingOperation = {
    action: string;
    requestId: string;
    bundleHash?: string;
    baseRevision?: number;
    payload?: Record<string,unknown>;
};
const pendingKey = 'pocketstocks_institutional_pending';
function restorePending(): PendingOperation | null { try {
    const p = JSON.parse(sessionStorage.getItem(pendingKey) || 'null');
    return p && ['save', 'review', 'publish', 'visibility'].includes(p.action) && typeof p.requestId === 'string' ? p : null;
}
catch {
    return null;
} }
type Bundle = {
    raw: string;
    html: string;
    cover: EtfCoverInput;
    preview: string;
};
const tabs = [{ id: 'import', label: '資料匯入' }, { id: 'validation', label: '驗證與缺口' }, { id: 'preview', label: '預覽' }, { id: 'history', label: '發布紀錄' }];
export function InstitutionalAuthor({ sessionToken, request, onDirtyChange }: Props) {
    const [items, setItems] = useState<MarkdownListItem[]>([]), [loadError, setLoadError] = useState(''), [entry, setEntry] = useState<MarkdownEntry | null>(null), [bundle, setBundle] = useState<Bundle | null>(null), [validation, setValidation] = useState<MarkdownValidation | null>(null), [tab, setTab] = useState('import'), [busy, setBusy] = useState(''), [notice, setNotice] = useState(''), [error, setError] = useState(''), [accepted, setAccepted] = useState(false), [pending, setPending] = useState<PendingOperation | null>(restorePending);
    const [listLoading, setListLoading] = useState(true);
    const [confirmAction,setConfirmAction]=useState<'publish'|'visibility'|'discard'|null>(null);
    const confirmDialog=useRef<HTMLDivElement>(null), returnFocus=useRef<HTMLElement|null>(null), busyNow=useRef(busy);busyNow.current=busy;
    useEffect(()=>{
        if(!confirmAction)return;
        returnFocus.current=document.activeElement as HTMLElement;
        confirmDialog.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
        const oldOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
        const key=(event:KeyboardEvent)=>{
            if(event.key==='Escape'&&!busyNow.current){event.preventDefault();closeConfirm();}
            if(event.key!=='Tab')return;
            const buttons=[...(confirmDialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[])];
            if(event.shiftKey&&document.activeElement===buttons[0]){event.preventDefault();buttons.at(-1)?.focus();}
            else if(!event.shiftKey&&document.activeElement===buttons.at(-1)){event.preventDefault();buttons[0]?.focus();}
        };
        document.addEventListener('keydown',key);return()=>{document.body.style.overflow=oldOverflow;document.removeEventListener('keydown',key);returnFocus.current?.focus();};
    },[confirmAction]);
    const discardAnswer = useRef<((answer: boolean) => void) | null>(null);
    const [discardMessage, setDiscardMessage] = useState('');
    function closeConfirm(answer = false) { discardAnswer.current?.(answer); discardAnswer.current = null; setConfirmAction(null); }
    function confirmDiscard(message: string) { setDiscardMessage(message); setConfirmAction('discard'); return new Promise<boolean>(resolve => { discardAnswer.current = resolve; }); }
    const retryPayload = useRef<any>(pending?.payload || null);
    const input = useRef<HTMLInputElement>(null), generation = useRef(0), fileGeneration = useRef(0), lock = useRef(false), requestRef = useRef(request);
    requestRef.current = request;
    useEffect(() => { try {
        if (pending)
            sessionStorage.setItem(pendingKey, JSON.stringify(pending));
        else
            sessionStorage.removeItem(pendingKey);
    }
    catch { /* The open workspace still retains recovery state. */ } }, [pending]);
    const dirty = !!bundle, report = validation?.report || entry?.draft;
    useFooterVersion(entry?.publishedVersion, '公開版本');
    useEffect(() => { onDirtyChange(dirty || !!pending); return () => onDirtyChange(false); }, [dirty, pending, onDirtyChange]);
    useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (dirty || pending) {
        e.preventDefault();
        e.returnValue = '';
    } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty, pending]);
    async function list() { const current = generation.current; setListLoading(true); setLoadError(''); try {
        let cursor: string | undefined;
        const all: MarkdownListItem[] = [];
        const seen = new Set();
        do {
            const r = await requestRef.current('list', { nextToken: cursor });
            all.push(...r.items);
            cursor = r.nextToken;
            if (cursor && seen.has(cursor))
                throw Error('cursor');
            seen.add(cursor);
        } while (cursor);
        if (generation.current !== current) return;
        setItems(all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        const wanted = new URLSearchParams(location.hash.split('?')[1] || '').get('reportId');
        if (wanted && !entry && !pending && all.some(i => i.id === wanted)) {
            const loaded = await requestRef.current('get', { id: wanted });
            if (generation.current === current) apply(loaded.entry);
        }
    }
    catch {
        if (generation.current === current) setLoadError('草稿清單無法載入，請重試。');
    } finally { if (generation.current === current) setListLoading(false); } }
    useEffect(() => { generation.current++; void list(); return () => { generation.current++; fileGeneration.current++; }; }, [sessionToken]);
    function apply(value: MarkdownEntry) { setEntry(value); setBundle(null); setValidation({ report: value.draft, errors: [], warnings: value.draft.warnings }); setAccepted(false); setItems(old => [{ ...value, title: value.draft.title, sourceHash: value.draft.sourceHash, researchDate: value.draft.period.end, dataStatus: value.draft.frontmatter.data_status }, ...old.filter(r => r.id !== value.id)]); const p = new URLSearchParams(); p.set('reportId', value.id); history.replaceState(null, '', '#/admin/institutional-flows?' + p); }
    async function load(id: string) { if (lock.current || pending)
        return; if (dirty && !await confirmDiscard('放棄尚未保存的三檔內容，載入草稿？'))
        return; lock.current = true; setBusy('載入草稿'); setError(''); try {
        const r = await requestRef.current('get', { id });
        apply(r.entry);
        setTab('import');
    }
    catch {
        setError('草稿無法載入，請重新登入或重試。');
    }
    finally {
        lock.current = false;
        setBusy('');
    } }
    async function importFiles(files: FileList | null) {
        if (!files || lock.current || pending && !(pending.action === 'save' && !retryPayload.current))
            return;
        const selected = Array.from(files), names = selected.map(f => f.name);
        setNotice('');
        setError('');
        if (selected.length !== 3 || ['data.json', 'report.html', 'cover.jpg'].some(n => names.filter(x => x === n).length !== 1)) {
            setError('請同時選擇同一份研究的 data.json、report.html 與 cover.jpg 三個檔案。');
            return;
        }
        const json = selected.find(f => f.name === 'data.json')!, html = selected.find(f => f.name === 'report.html')!, jpg = selected.find(f => f.name === 'cover.jpg')!;
        if (json.size > INSTITUTIONAL_SOURCE_LIMIT || html.size > 65536 || jpg.size > 1048576) {
            setError('檔案過大：JSON最多4 MiB、HTML最多64 KiB、封面最多1 MiB。');
            return;
        }
        if (dirty && !await confirmDiscard('以這三個檔案取代尚未保存的內容？'))
            return;
        const gen = generation.current, file = ++fileGeneration.current;
        lock.current = true;
        setBusy('讀取與驗證');
        try {
            const [raw, template, pixels] = await Promise.all([json.text(), html.text(), jpg.arrayBuffer()]);
            const bytes = new Uint8Array(pixels);
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192)
                binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            const cover = { contentBase64: btoa(binary), filename: 'cover.jpg' };
            const parsed = await parseInstitutionalSource(raw);
            if (!parsed.report) {
                if (gen === generation.current && file === fileGeneration.current) {
                    setValidation(parsed);
                    setError(parsed.errors.map(e => e.message).join(' '));
                }
                return;
            }
            const checkedCover = await validateEtfCover(cover);
            if (!checkedCover.cover)
                throw Error(checkedCover.errors.map(e => e.message).join(' '));
            const preview = 'data:image/jpeg;base64,' + cover.contentBase64;
            await new Promise<void>((resolve, reject) => { const image = new Image(); image.onload = () => image.naturalWidth === 480 && image.naturalHeight === 360 ? resolve() : reject(Error('封面尺寸不符。')); image.onerror = () => reject(Error('無法解碼JPEG封面。')); image.src = preview; });
            const checked = await requestRef.current('validate', { rawSource: raw, reportHtml: template, cover }) as MarkdownValidation;
            if (gen !== generation.current || file !== fileGeneration.current)
                return;
            setValidation(checked);
            if (checked.errors.length || !checked.report) {
                setError(checked.errors.map(e => e.message).join(' '));
                return;
            }
            // A source ID selects the existing revision; unrelated drafts never supply its baseRevision.
            const current = items.find(i => i.id === checked.report!.id);
            if (current) {
                const loaded = await requestRef.current('get', { id: current.id });
                if (gen !== generation.current)
                    return;
                setEntry(loaded.entry);
            }
            else
                setEntry(null);
            if (pending) {
                const hash = await markdownHash(JSON.stringify({ raw, html: template, cover }));
                if (hash !== pending.bundleHash)
                    throw Error('請重新選擇結果未確認時的同一組三檔；目前內容未取代。');
                retryPayload.current = { rawSource: raw, reportHtml: template, cover, baseRevision: pending.baseRevision, requestId: pending.requestId };
            }
            setBundle({ raw, html: template, cover, preview });
            setAccepted(false);
            setNotice('三檔驗證完成，尚未保存或公開。');
            setTab('import');
        }
        catch (e) {
            if (gen === generation.current)
                setError(e instanceof Error ? e.message : '三檔驗證失敗，請重試。');
        }
        finally {
            lock.current = false;
            if (gen === generation.current)
                setBusy('');
        }
    }
    async function mutate(action: 'save' | 'review' | 'publish' | 'visibility', confirmed=false) {
        if (lock.current || pending)
            return;
        if((action==='publish'||action==='visibility')&&!confirmed){setConfirmAction(action);return;}
        const requestId = crypto.randomUUID();
        const current = entry;
        let payload: any;
        if (action === 'save') {
            if (!bundle || !validation?.report)
                return;
            payload = { rawSource: bundle.raw, reportHtml: bundle.html, cover: bundle.cover, baseRevision: current?.revision || 0, requestId };
        }
        else {
            if (!current || dirty)
                return;
            payload = { id: current.id, baseRevision: current.revision, requestId };
            if (action === 'review')
                payload.sourceHash = current.draft.sourceHash;
            if (action === 'publish') {
                if (current.reviewedRevision !== current.revision || !current.reviewHash)
                    return;
                Object.assign(payload, { expectedPublishedVersion: current.publishedVersion, reviewHash: current.reviewHash, reviewed: true });
            }
            if (action === 'visibility') {
                Object.assign(payload, { expectedPublishedVersion: current.publishedVersion, archived: !current.archived, expectedUpdatedAt: current.updatedAt });
            }
        }
        lock.current = true;
        setBusy('處理中');
        setError('');
        setPending({ action, requestId, ...(action !== 'save' ? {payload} : {}), ...(action === 'save' ? { baseRevision: payload.baseRevision, bundleHash: await markdownHash(JSON.stringify({ raw: bundle!.raw, html: bundle!.html, cover: bundle!.cover })) } : {}) });
        retryPayload.current = payload;
        try {
            const r = await requestRef.current(action, payload);
            apply(r.entry);setConfirmAction(null);
            setPending(null);
            setNotice(action === 'save' ? '已保存私有草稿，尚未公開。' : action === 'review' ? '已記錄審閱。' : action === 'publish' ? '已發布至目前環境。' : '已更新公開狀態。');
            if (action === 'save')
                setTab('preview');
        }
        catch (e: any) {
            if ([400, 401, 403, 404, 409, 413].includes(Number(e.status || e.statusCode || e.response?.status))) {
                setPending(null);
                setError('操作未套用，請核對資料、登入或重新載入草稿後重試。');
            }
            else
                setError('結果尚未確認。請先查詢操作結果，勿重複保存。');
        }
        finally {
            lock.current = false;
            setBusy('');
        }
    }
    async function retryOriginal() { if (!pending || !retryPayload.current || lock.current)
        return; lock.current = true; setBusy('確認原操作'); try {
        const r = await requestRef.current(pending.action, retryPayload.current);
        apply(r.entry);
        setPending(null);
        setError('');
        setNotice('已保存私有草稿，尚未公開。');
        setTab('preview');
    }
    catch {
        setError('仍無法完成，請保留目前內容並稍後查詢。');
    }
    finally {
        lock.current = false;
        setBusy('');
    } }
    async function recover() { if (!pending || lock.current)
        return; lock.current = true; setBusy('查詢結果'); try {
        const r = await requestRef.current('status', { requestId: pending.requestId });
        if (r.state === 'applied') {
            apply(r.entry);setConfirmAction(null);
            setPending(null);
            setError('');
            setNotice('已確認操作結果。');
        }
        else
            setError('尚未找到操作結果，請稍後再次查詢。');
    }
    catch {
        setError('查詢失敗，請稍後重試。');
    }
    finally {
        lock.current = false;
        setBusy('');
    } }
    const saved = !!entry && !dirty, reviewed = saved && entry.reviewedRevision === entry.revision;
    return <section className='institutional-author etf-author md-author'><div inert={!!confirmAction}><header className='etf-heading'><div><p className='etf-note'>Author · 獨立法人研究</p><h1>三大法人發布</h1><p>匯入研究套件，保存草稿後預覽文章與四組資金方向。</p></div></header>
 <div className='md-author-layout'><aside className='md-author-saved'><h2>法人研究草稿</h2><button disabled={!!busy || !!pending} onClick={async () => { if (dirty && !await confirmDiscard('放棄尚未保存的內容？'))
        return; history.replaceState(null, '', '#/admin/institutional-flows'); setEntry(null); setBundle(null); setValidation(null); setTab('import'); setError(''); setNotice(''); }}>新增法人研究</button>{loadError && <p role='alert'>{loadError}<button onClick={() => void list()}>重新載入清單</button></p>}{listLoading ? <LoadingSkeleton media={false} label='正在載入法人研究草稿…' rows={3} /> : !items.length && !loadError && <p>尚無法人研究草稿</p>}{items.map(i => <button key={i.id} aria-current={entry?.id === i.id ? 'page' : undefined} disabled={!!busy || !!pending} onClick={() => void load(i.id)}><strong>{i.title}</strong><small>{i.researchDate} · {i.publishedVersion ? (i.archived ? '已下架' : '已發布') : '私有草稿'}</small></button>)}</aside>
 <main className='md-author-workspace'>{error && <p role='alert' className='institutional-warning'>{error}</p>}{notice && <p role='status'>{notice}</p>}{busy && <PendingIndicator>{busy}…</PendingIndicator>}{pending && !busy && <><button onClick={() => void recover()}>查詢操作結果</button>{retryPayload.current && <button onClick={() => void retryOriginal()}>以原識別碼重試</button>}</>}
 {busy === '載入草稿' && <LoadingSkeleton kind='article' metrics={4} label='正在載入法人草稿…' />}
 <EtfTabs idPrefix='institutional-author' label='三大法人發布任務' tabs={tabs} value={tab} onChange={setTab}/>
 <EtfTabPanel idPrefix='institutional-author' id='import' active={tab === 'import'}><section className='institutional-package'><h2>匯入三檔研究套件</h2><p>同時選擇 data.json、report.html、cover.jpg。HTML保留作來源核對，文章與圖表由JSON呈現。</p><button type='button' disabled={!!busy || !!pending && !(pending.action === 'save' && !retryPayload.current)} onClick={() => input.current?.click()}>選擇三個研究檔案</button><input hidden type='file' ref={input} multiple accept='.json,.html,.jpg' aria-label='選擇法人研究三檔' onChange={e => { void importFiles(e.target.files); e.target.value = ''; }}/>
 {report && <><div className='institutional-files'><span>data.json · {report.sourceBytes.toLocaleString()} bytes</span><span>report.html · {bundle || entry?.draft.companionHtml ? '已取得' : '未取得'}</span><span>cover.jpg · {bundle || entry?.cover ? '已取得' : '未取得'}</span></div><h3>{report.title}</h3><p>{report.excerpt}</p><dl className='md-author-metadata'><dt>研究日</dt><dd>{report.period.end}</dd><dt>資料查核日</dt><dd>{report.evidenceDate}</dd><dt>觀察組別</dt><dd>外資／投信 × 上市／上櫃</dd></dl>{(bundle?.preview || entry?.cover?.url) && <img width='240' height='180' src={bundle?.preview || entry?.cover?.url} alt='法人研究摘要封面'/>}</>}
 <div className='etf-author-actions'><button type='button' disabled={!bundle || !validation?.report || !!busy || !!pending} onClick={() => void mutate('save')}>保存私有草稿</button><button type='button' onClick={() => setTab('validation')}>查看驗證</button></div></section></EtfTabPanel>
 <EtfTabPanel idPrefix='institutional-author' id='validation' active={tab === 'validation'}><h2>{validation?.report ? '三檔結構驗證完成' : '尚未完成驗證'}</h2>{validation?.errors.map((e, i) => <p key={i}>{e.path}：{e.message}</p>)}{validation?.warnings.map((e, i) => <p key={i} className='institutional-warning'>{e.message}</p>)}<p>JSON為唯一文章來源；官方市場金額與收盤價估算分列。結構驗證不等於市場數據已完整查證。</p><button disabled={!saved} onClick={() => setTab('preview')}>預覽已保存草稿</button></EtfTabPanel>
 <EtfTabPanel idPrefix='institutional-author' id='preview' active={tab === 'preview'}>{saved && entry ? <><p className='md-author-preview-state'>私有預覽 · 草稿 r{entry.revision} · {entry.publishedVersion ? '公開版維持原狀' : '尚無公開版本'}</p><InstitutionalReader key={entry.draft.sourceHash} report={entry.draft} coverUrl={entry.cover?.url}/><label className='etf-review-check'><input type='checkbox' checked={accepted || !!reviewed} disabled={!!busy || !!pending || !!reviewed} onChange={e => setAccepted(e.target.checked)}/>我已核對封面、四組分析、圖表、來源與缺口。</label><div className='etf-author-actions'><button disabled={!accepted || !!reviewed || !!busy || !!pending} onClick={() => void mutate('review')}>{reviewed ? '已完成審閱' : '記錄本次審閱'}</button><button disabled={!reviewed || !entry.hasUnpublishedChanges || !!busy || !!pending} onClick={() => void mutate('publish')}>確認發布…</button></div></> : <p>請先保存私有草稿，再預覽同一版本的文章。</p>}</EtfTabPanel>
 <EtfTabPanel idPrefix='institutional-author' id='history' active={tab === 'history'}><h2>{entry?.publishedVersion ? '法人文章發布紀錄' : '尚無發布紀錄'}</h2>{entry && <><p>{entry.draft.title} · 草稿 r{entry.revision}</p><p>{entry.publishedAt ? new Date(entry.publishedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '這份研究仍為私有草稿。'}</p>{entry.publishedVersion > 0 && <><a href={'#/institutional-flows/' + encodeURIComponent(entry.id) + '?v=' + entry.publishedVersion}>查看法人公開文章</a><button disabled={!!busy || !!pending} onClick={() => void mutate('visibility')}>{entry.archived ? '恢復公開文章…' : '下架公開文章…'}</button></>}<details><summary>來源識別</summary><p>JSON SHA-256：{entry.draft.sourceHash}</p><p>三檔綁定同一草稿修訂；修改後重新審閱。</p></details></>}</EtfTabPanel>
 </main></div></div>
 {confirmAction&&<div className='etf-confirm-backdrop'><div ref={confirmDialog} className='etf-confirm-dialog' role='dialog' aria-modal='true' aria-labelledby='institutional-confirm-title'>
 <h2 id='institutional-confirm-title'>{confirmAction==='discard'?'放棄尚未保存的內容？':confirmAction==='publish'?'確認發布這篇法人研究？':entry?.archived?'恢復公開文章？':'下架公開文章？'}</h2>
 <p>{entry?.draft.title}</p><p>研究日 {entry?.draft.period.end}</p>
 <p>{confirmAction==='discard'?discardMessage:confirmAction==='publish'?'將一起發布已審閱的文章、四組圖表、來源與封面。':entry?.archived?'恢復原已發布版本；目前草稿不會一併發布。':'公開列表與文章將暫時隱藏，草稿及歷史版本保留。'}</p>
 {busy ? <PendingIndicator>正在確認操作…</PendingIndicator> : <p role='status'>{pending?'結果尚未確認，請先查詢。':error}</p>}
 <div><button type='button' disabled={!!busy} onClick={()=>closeConfirm()}>取消</button><button type='button' disabled={!!busy||!!pending} onClick={()=>confirmAction==='discard'?closeConfirm(true):void mutate(confirmAction,true)}>{confirmAction==='discard'?'放棄變更':confirmAction==='publish'?'確認發布':entry?.archived?'恢復公開文章':'下架公開文章'}</button>{pending&&<button disabled={!!busy} onClick={()=>void recover()}>查詢操作結果</button>}</div>
 </div></div>}
 </section>;
}
