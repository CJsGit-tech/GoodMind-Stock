import { useEffect, useRef, useState } from 'react';
import { api } from '@appdeploy/client';
import { withReaderDeadline } from './reader-sign-in';
import { CALENDAR_SOURCE_LIMIT, emptyCalendar, mergeCalendar, parseCalendarBundle, type CalendarBundle, type CalendarState } from '../shared/investment-calendar';
import './investment-calendar.css';

type Props = { request: (action: string, payload: Record<string, unknown>) => Promise<any>; onDirtyChange: (dirty: boolean) => void };
export function InvestmentCalendarAuthor({ request, onDirtyChange }: Props) {
  const [raw, setRaw] = useState(''), [bundle, setBundle] = useState<CalendarBundle | null>(null);
  const [state, setState] = useState<CalendarState>(emptyCalendar), [ready, setReady] = useState(false);
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const fileGeneration = useRef(0), mounted = useRef(true), lock = useRef(false);
  const dirty = !!raw || !!pending;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  useEffect(() => {
    mounted.current = true;
    void readState();
    return () => { mounted.current = false; fileGeneration.current++; };
  }, []);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [dirty]);
  async function readState() {
    try {
      const response = await withReaderDeadline(api.get('/api/calendar/events'), 15000, 'calendar_read_timeout');
      const value = response.data;
      if (!Array.isArray(value.events) || !Array.isArray(value.sources)) throw Error();
      if (mounted.current) { setState(value); setReady(true); }
    } catch { if (mounted.current) { setReady(false); setError('無法取得本機日曆版本，請重新載入資料。'); } }
  }
  function edit(value: string) { setRaw(value); setBundle(null); setConsent(false); setError(''); setNotice(''); }
  async function chooseFile(file: File | undefined) {
    if (!file) return;
    const generation = ++fileGeneration.current;
    if (file.size > CALENDAR_SOURCE_LIMIT) { setError('JSON 檔案不可超過 128 KiB，原輸入已保留。'); return; }
    try { const value = await file.text(); if (generation === fileGeneration.current && mounted.current) edit(value); }
    catch { if (mounted.current) setError('檔案讀取失敗，原輸入已保留。'); }
  }
  const preview = bundle ? mergePreview() : null;
  function mergePreview() { try { return mergeCalendar(state, bundle!, new Date().toISOString()); } catch { return null; } }
  function validate() {
    try {
      const value = parseCalendarBundle(raw);
      mergeCalendar(state, value, new Date().toISOString());
      setBundle(value); setError(''); setNotice('資料格式有效。請核對下方事件與來源，再確認匯入。');
    } catch (caught) { setBundle(null); setError((caught as Error).message); setNotice(''); }
  }
  async function save() {
    if (lock.current || !ready || (!pending && (!bundle || !consent))) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    const payload = pending || { rawSource: raw, baseRevision: state.revision, requestId: crypto.randomUUID(), usageConfirmed: true };
    setPending(payload);
    try {
      const result = await request('import', payload);
      if (!mounted.current) return;
      setPending(null); setRaw(''); setBundle(null); setConsent(false);
      setNotice(`已保存本機日曆：新增 ${result.added} 筆、更新 ${result.changed} 筆、相同 ${result.unchanged} 筆。版本 ${result.revision}。`);
      await readState();
    } catch (caught: any) {
      if (!mounted.current) return;
      const status = caught?.status ?? caught?.response?.status;
      // Validation/conflict failures are definitive; ambiguous failures keep the same request.
      if (status === 400 || status === 409) { setPending(null); setBundle(null); setConsent(false); await readState(); }
      setError(status === 409 ? '日曆版本已更新，輸入已保留。請重新驗證並預覽。' : caught?.message || '匯入結果未確認，請以相同請求重試。');
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className='calendar-author' aria-labelledby='calendar-author-title'><p className='calendar-eyebrow'>LOCAL CALENDAR</p><h1 id='calendar-author-title'>手動匯入投資日曆</h1>
    <p>選擇少量、有明確來源與使用依據的 JSON，核對後保存本機。匯入不會存取來源網址，也不會建立排程或更新雲端。</p>
    <div className='calendar-import-actions'><a href={new URL('../samples/investment-calendar.json', import.meta.url).href} download='investment-calendar-sample.json'>下載官方來源樣本</a><a href='#/calendar'>查看投資行事曆</a><span>目前本機版本 {state.revision} · {state.events.length} 筆</span></div>
    <label>選擇事件 JSON<input type='file' accept='.json,application/json' aria-label='選擇事件 JSON' disabled={busy || !!pending} onChange={e => { void chooseFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
    <label htmlFor='calendar-source'>JSON 內容</label><textarea id='calendar-source' value={raw} spellCheck={false} disabled={busy || !!pending} onChange={e => edit(e.target.value)} placeholder='貼上事件 JSON，或選擇檔案。最多 100 筆事件、128 KiB。' />
    <div className='calendar-import-actions'><button type='button' onClick={validate} disabled={!raw || busy || !!pending || !ready}>驗證並預覽</button><button type='button' onClick={() => { setError(''); void readState(); }} disabled={busy || !!pending}>重新載入資料</button></div>
    {error && <div className='calendar-import-message' role='alert'>{error}</div>}{notice && <div className='calendar-import-message' role='status'>{notice}</div>}
    {bundle && preview && <div className='calendar-import-preview'><h2>匯入預覽</h2><p>新增 {preview.added} 筆 · 更新 {preview.changed} 筆 · 相同 {preview.unchanged} 筆</p><ul>{bundle.events.map(event => <li key={event.id}>{event.sourceDate} · {event.title} · {event.precision === 'exact' ? '時間已定' : '時間未公布'}</li>)}</ul>
      <h3>來源與使用依據</h3>{bundle.sources.map(source => <p key={source.id}><a href={source.url} target='_blank' rel='noopener noreferrer' referrerPolicy='no-referrer'>{source.name}</a> · {source.usageBasis} <a href={source.usageUrl} target='_blank' rel='noopener noreferrer' referrerPolicy='no-referrer'>使用依據</a></p>)}
      <label className='calendar-import-consent'><input type='checkbox' checked={consent} disabled={busy || !!pending} onChange={e => setConsent(e.target.checked)} />我已確認來源允許本次使用，並核對日期與時區；未包含未授權全文或機密資料。</label>
      <button type='button' className='calendar-import-primary' onClick={() => void save()} disabled={busy || !ready || (!pending && !consent)}>{busy ? '保存中…' : pending ? '以相同請求重試' : '確認匯入本機'}</button></div>}
    {pending && !bundle && <button type='button' onClick={() => void save()} disabled={busy}>以相同請求重試</button>}
  </section>;
}
