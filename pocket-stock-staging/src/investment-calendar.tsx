import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink, List, X } from 'lucide-react';
import { api } from '@appdeploy/client';
import { withReaderDeadline } from './reader-sign-in';
import { CatalogSearch } from './catalog-search';
import { CatalogSelect } from './catalog-select';
import { LoadingSkeleton } from './loading';
import { CALENDAR_CATEGORIES, calendarDays, emptyCalendar, eventDay, eventTime, type CalendarState, type CalendarZone, type SavedCalendarEvent } from '../shared/investment-calendar';
import './investment-calendar.css';

function today(zone: string) { return eventDay({ startsAt: new Date().toISOString() } as SavedCalendarEvent, zone); }
function routeState() {
  const query = new URLSearchParams(location.hash.split('?')[1] || '');
  const zone: CalendarZone = query.get('tz') === 'America/New_York' ? 'America/New_York' : 'Asia/Taipei';
  const requestedMonth = query.get('month') || '';
  return { month: /^20\d{2}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : today(zone).slice(0, 7),
    zone, view: query.get('view') === 'list' ? 'list' : 'month', category: query.get('category') || '', entity: query.get('entity') || '',
    query: (query.get('q') || '').slice(0, 200), confirmed: query.get('confirmed') === '1', eventId: query.get('event') || '', date: query.get('date') || '' };
}
const readableDate = (date: string) => `${Number(date.slice(5, 7))} 月 ${Number(date.slice(8, 10))} 日`;
const zoneLabel = (zone: string) => zone === 'Asia/Taipei' ? '台北時間' : '美東時間';
function localStamp(value: string | null) { return value ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '尚未匯入'; }

export function InvestmentCalendar() {
  const [route, setRoute] = useState(routeState);
  const [state, setState] = useState<CalendarState>(emptyCalendar);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const detailHeading = useRef<HTMLHeadingElement>(null), returnFocus = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    document.title = '投資行事曆 — PocketStocks · 本機 Staging';
    const sync = () => setRoute(routeState());
    window.addEventListener('hashchange', sync); window.addEventListener('popstate', sync);
    return () => { window.removeEventListener('hashchange', sync); window.removeEventListener('popstate', sync); };
  }, []);
  useEffect(() => {
    let active = true;
    setStatus('loading');
    void withReaderDeadline(api.get('/api/calendar/events'), 15000, 'calendar_read_timeout').then(response => {
      const value = response.data as CalendarState;
      if (!Array.isArray(value.events) || !Array.isArray(value.sources) || !Number.isSafeInteger(value.revision)) throw Error('invalid');
      if (active) { setState(value); setStatus('ready'); }
    }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [attempt]);
  function update(patch: Partial<typeof route>, replace = false) {
    const next = { ...route, ...patch };
    const query = new URLSearchParams({ month: next.month, view: next.view, tz: next.zone });
    for (const [name, value] of Object.entries({ category: next.category, entity: next.entity, q: next.query, event: next.eventId, date: next.date, confirmed: next.confirmed ? '1' : '' })) if (value) query.set(name, value);
    const hash = '#/calendar?' + query;
    if (hash === location.hash) return;
    if (replace) { history.replaceState(null, '', hash); setRoute(next); } else location.hash = hash;
  }
  function monthOffset(offset: number) {
    const [year, month] = route.month.split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
    if (next >= '2000-01' && next <= '2099-12') update({ month: next, eventId: '', date: '' });
  }
  function closeDetail() {
    if (!returnFocus.current?.isConnected) returnFocus.current = document.querySelector<HTMLButtonElement>(`[data-event-id="${CSS.escape(route.eventId)}"]`);
    update({ eventId: '' });
  }
  useLayoutEffect(() => { if (!route.eventId && returnFocus.current?.isConnected) returnFocus.current.focus(); }, [route.eventId]);
  useEffect(() => {
    if (!route.eventId) return;
    detailHeading.current?.focus();
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeDetail(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [route.eventId, status]);
  const filtered = state.events.filter(event => (!route.category || event.category === route.category) && (!route.entity || event.entity === route.entity)
    && (!route.confirmed || event.confirmation === 'confirmed') && (!route.query || `${event.title} ${event.entity} ${event.period}`.toLocaleLowerCase().includes(route.query.toLocaleLowerCase())));
  const events = filtered.filter(event => event.startsAt && eventDay(event, route.zone).startsWith(route.month)).sort((a, b) => a.startsAt!.localeCompare(b.startsAt!));
  const pending = filtered.filter(event => !event.startsAt && event.sourceDate.startsWith(route.month));
  const selected = state.events.find(event => event.id === route.eventId);
  const entities = [...new Set(state.events.map(event => event.entity))].sort();
  const days = calendarDays(route.month), currentDay = today(route.zone);
  const selectedDate = days.includes(route.date) && route.date.startsWith(route.month) ? route.date : '';
  const dayEvents = selectedDate ? events.filter(event => eventDay(event, route.zone) === selectedDate) : [];
  const coveredMonths = [...new Set(state.events.flatMap(event => [eventDay(event, route.zone).slice(0, 7), event.sourceDate.slice(0, 7)]))].sort();
  function open(event: SavedCalendarEvent, button: HTMLButtonElement) { returnFocus.current = button; update({ eventId: event.id }); }
  const eventButton = (event: SavedCalendarEvent, compact = false) => <button key={event.id} type='button' className={'calendar-event ' + event.category + (event.status === 'cancelled' ? ' cancelled' : '')}
    data-event-id={event.id} onClick={e => open(event, e.currentTarget)} aria-pressed={event.id === route.eventId}>
    <span className='calendar-event-time'>{eventTime(event, route.zone)}</span><span className='calendar-event-title'>{event.title}</span>
    {!compact && <span className='calendar-event-entity'>{event.entity} · {event.period}</span>}
    {(event.confirmation === 'estimated' || event.status === 'cancelled') && <span className='calendar-state'>{event.status === 'cancelled' ? '已取消' : '預估'}</span>}
  </button>;
  return <section className='investment-calendar' aria-labelledby='investment-calendar-title'>
    <div className='calendar-heading'><div><p className='calendar-eyebrow'>RESEARCH CALENDAR</p><h1 id='investment-calendar-title'>投資行事曆</h1><p>查看美國經濟數據、利率會議與公司財報日程。</p></div>
      <div className='calendar-update'><span>本機匯入資料</span><p>最後匯入 {localStamp(state.importedAt)}</p><a href='#/admin/calendar'>管理日曆資料</a></div></div>
    <p className='calendar-scope'>少量來源樣本，並非完整市場日程。頁面只讀本機資料，由 Author 或外部 Codex 排程匯入。</p>
    <div className='calendar-toolbar'><div className='calendar-month-controls'>
      <button type='button' aria-label='上一個月' onClick={() => monthOffset(-1)} disabled={route.month === '2000-01'}><ChevronLeft size={19} /></button>
      <label className='calendar-month-label'><span className='sr-only'>選擇月份</span><input aria-label='選擇月份' type='month' min='2000-01' max='2099-12' value={route.month} onChange={e => { if (/^20\d{2}-(0[1-9]|1[0-2])$/.test(e.target.value)) update({ month: e.target.value, eventId: '', date: '' }); }} /></label>
      <button type='button' aria-label='下一個月' onClick={() => monthOffset(1)} disabled={route.month === '2099-12'}><ChevronRight size={19} /></button>
      <button type='button' onClick={() => update({ month: today(route.zone).slice(0, 7), date: today(route.zone), eventId: '' })}>今天</button>
    </div><div className='calendar-view-controls' aria-label='日曆檢視'>
      <button type='button' aria-pressed={route.view === 'month'} onClick={() => update({ view: 'month' })}><CalendarDays size={16} />月曆</button>
      <button type='button' aria-pressed={route.view === 'list'} onClick={() => update({ view: 'list', date: '' })}><List size={16} />清單</button>
    </div><CatalogSelect label='顯示時區' value={route.zone} options={[{ value: 'Asia/Taipei', label: '台北時間' }, { value: 'America/New_York', label: '美東時間' }]} onChange={zone => update({ zone: zone as CalendarZone, eventId: '', date: '' })} /></div>
    <div className='calendar-filters'><CatalogSearch label='搜尋日曆事件' placeholder='搜尋事件、機構或公司' value={route.query} onChange={query => update({ query, eventId: '' }, true)} />
      <CatalogSelect label='事件類別' value={route.category} options={[{ value: '', label: '所有類別' }, ...Object.entries(CALENDAR_CATEGORIES).map(([value, label]) => ({ value, label }))]} onChange={category => update({ category, eventId: '' })} />
      <CatalogSelect label='公司或機構' value={route.entity} options={[{ value: '', label: '所有公司／機構' }, ...entities.map(value => ({ value, label: value }))]} onChange={entity => update({ entity, eventId: '' })} />
      <label className='calendar-confirmed'><input type='checkbox' checked={route.confirmed} onChange={e => update({ confirmed: e.target.checked })} />只看已確認</label>
      {(route.category || route.entity || route.query || route.confirmed) && <button type='button' className='calendar-reset' onClick={() => update({ category: '', entity: '', query: '', confirmed: false, eventId: '' })}>清除篩選</button>}
    </div>
    {status === 'loading' && <LoadingSkeleton kind='article' label='正在讀取本機行事曆…' />}
    {status === 'error' && <div role='alert' className='calendar-message'><strong>行事曆暫時無法載入</strong><p>{state.revision ? '保留下方上次讀取的資料；最後匯入時間不變。' : '請確認本機服務正常，再重新載入。'}</p><button type='button' onClick={() => setAttempt(n => n + 1)}>重新載入日曆</button></div>}
    {status !== 'loading' && <>
      <div className='calendar-summary' role='status'><span>{route.month.replace('-', ' 年 ')} 月 · {zoneLabel(route.zone)} · {events.length} 筆時間已定 · {pending.length} 筆來源日期待定</span><span>本機版本 {state.revision}</span></div>
      {!state.events.length ? <div className='calendar-message'><h2>尚未匯入日曆資料</h2><p>由作者手動匯入有來源與使用依據的 JSON，即可開始瀏覽。</p><a href='#/admin/calendar'>前往手動匯入</a></div> : <>
        {!events.length && !pending.length && <div role='status' className='calendar-message'><strong>{route.category || route.entity || route.query || route.confirmed ? '沒有符合條件的事件' : '此月份資料尚未齊備'}</strong><p>本機已有來源樣本月份：{coveredMonths.join('、')}。沒有列出不代表當月沒有市場事件。</p></div>}
        <div className={'calendar-layout' + (selected ? ' has-detail' : '')}><div className='calendar-primary'>
          {route.view === 'month' ? <div className='calendar-grid' aria-label={`${route.month} 月曆，${zoneLabel(route.zone)}`}>
            {['一', '二', '三', '四', '五', '六', '日'].map(day => <div className='calendar-weekday' key={day}>週{day}</div>)}
            {days.map(day => { const rows = events.filter(event => eventDay(event, route.zone) === day); return <div key={day} className={'calendar-cell' + (!day.startsWith(route.month) ? ' outside' : '') + (day === selectedDate ? ' selected' : '') + (day === currentDay ? ' today' : '')}>
              <button className='calendar-date' type='button' aria-label={`${day}，${rows.length} 筆事件`} aria-current={day === currentDay ? 'date' : undefined} aria-pressed={day === selectedDate} onClick={() => update({ date: day, month: day.slice(0, 7), eventId: '' })}>{Number(day.slice(8))}</button>
              {rows.slice(0, 3).map(event => eventButton(event, true))}
              {rows.length > 3 && <button className='calendar-more' type='button' onClick={() => update({ date: day })}>另有 {rows.length - 3} 項</button>}
            </div>; })}
          </div> : <div className='calendar-agenda'>{[...new Set(events.map(event => eventDay(event, route.zone)))].map(day => <section key={day}><h2>{readableDate(day)}</h2>{events.filter(event => eventDay(event, route.zone) === day).map(event => eventButton(event))}</section>)}</div>}
          {selectedDate && <section className='calendar-day-list' aria-label='當日完整事件'><h2>{readableDate(selectedDate)} · 完整事件</h2>{dayEvents.length ? dayEvents.map(event => eventButton(event)) : <p>本機樣本沒有這一天的事件。</p>}</section>}
          {pending.length > 0 && <section className='calendar-pending' aria-labelledby='calendar-pending-title'><h2 id='calendar-pending-title'>來源日期已知，時間待定</h2><p>以下保留來源地日期，不代表已確定的台灣日期。</p>{pending.map(event => <button type='button' key={event.id} data-event-id={event.id} className={'calendar-event' + (event.status === 'cancelled' ? ' cancelled' : '')} onClick={e => open(event, e.currentTarget)}><span className='calendar-event-time'>來源 {event.sourceDate}{event.sourceEndDate ? '～' + event.sourceEndDate : ''}</span><span className='calendar-event-title'>{event.title}</span><span>{event.status === 'cancelled' ? '已取消' : event.confirmation === 'confirmed' ? '日期已確認' : '預估日期'} · 時間未公布</span></button>)}</section>}
        </div>
        {route.eventId && !selected && <aside className='calendar-detail'><p>這筆事件不在目前的本機資料中。</p><button type='button' onClick={closeDetail}>關閉詳情</button></aside>}
        {selected && <aside className='calendar-detail' aria-labelledby='calendar-detail-title'><button className='calendar-detail-close' type='button' aria-label='關閉事件詳情' onClick={closeDetail}><X size={18} /></button>
          <p className='calendar-eyebrow'>{CALENDAR_CATEGORIES[selected.category]}</p><h2 ref={detailHeading} tabIndex={-1} id='calendar-detail-title'>{selected.title}</h2>
          <p>{selected.entity} · {selected.period}</p><span className='calendar-state'>{selected.status === 'cancelled' ? '已取消' : selected.confirmation === 'confirmed' ? '官方已確認' : '預估，待確認'}</span>
          <dl><dt>台北時間</dt><dd>{selected.startsAt ? `${eventDay(selected, 'Asia/Taipei')} ${eventTime(selected, 'Asia/Taipei')}` : '時間未公布，台灣日期待確認'}</dd>
            <dt>來源時間</dt><dd>{selected.sourceDate}{selected.sourceEndDate ? '～' + selected.sourceEndDate : ''} {eventTime(selected, selected.sourceTimezone)}<small>{selected.sourceTimezone}</small></dd></dl>
          {selected.startsAt && Date.parse(selected.startsAt) < Date.now() && selected.status !== 'cancelled' && <p className='calendar-detail-note'>預定時間已過；本月曆不提供發布結果，狀態待來源核實。</p>}
          {selected.note && <p className='calendar-detail-note'>{selected.note}</p>}
          {(() => { const source = state.sources.find(s => s.id === selected.sourceId); return source && <div className='calendar-source'><h3>原始來源</h3><a href={source.url} target='_blank' rel='noopener noreferrer' referrerPolicy='no-referrer'>{source.name}<ExternalLink size={13} /></a><p>最後查核 {localStamp(source.checkedAt)}</p><p>{source.usageBasis}</p><a href={source.usageUrl} target='_blank' rel='noopener noreferrer' referrerPolicy='no-referrer'>使用依據</a></div>; })()}
          {selected.history.length > 0 && <div className='calendar-source'><h3>修訂紀錄</h3>{selected.history.map((change, i) => <p key={i}>原日程 {change.previous.sourceDate} {eventTime(change.previous, change.previous.sourceTimezone)}<small>於 {localStamp(change.changedAt)} 手動修訂</small></p>)}</div>}
        </aside>}
        </div>
      </>}
    </>}
  </section>;
}
