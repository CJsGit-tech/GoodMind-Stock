import { syncPrimaryName, workspaceQualityNotices } from './presentation';
import { MetadataEditor } from './MetadataEditor';
import { sortWorkspaceRows, WorkspaceSort } from './workspaceSort';
import { useWorkspaceDialog } from './useWorkspaceDialog';
import { searchableNames, localizedName as nameInLocale } from './locale-core';
import { useI18n } from './i18n';
import { filterWorkspaceRows, pruneWorkspaceFilters, emptyWorkspaceFilters, WorkspaceFilters } from './workspaceFilters';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Sparkles,
  ArrowRight,
  Check,
  Code2,
  Database,
  Download,
  Edit3,
  Eye,
  ExternalLink,
  GitBranch,
  Layers3,
  LockKeyhole,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { validateGraph } from '../shared/model';
import {
  Graph,
  groupLabels,
  statusLabels,
  typeColor,
  typeLabels,
} from './types';

type Mode = 'nodes' | 'edges' | 'entityTypes' | 'edgeTypes';
type RecordEntry = Record<string, unknown>;
const tabs: { key: Mode; label: string; icon: typeof Database }[] = [
  { key: 'nodes', label: '實體資料', icon: Database },
  { key: 'edges', label: '關係資料', icon: GitBranch },
  { key: 'entityTypes', label: '實體類別', icon: Layers3 },
  { key: 'edgeTypes', label: '關係定義', icon: Code2 },
];
const coreKeys: Record<Mode, string[]> = {
  nodes: ['id', 'name', 'type'],
  edges: ['id', 'predicate', 'from', 'to'],
  entityTypes: ['name', 'definition'],
  edgeTypes: ['predicate', 'group', 'from', 'to', 'storage', 'meaning'],
};
function messageFor(error: unknown) {
  const e = error as {
    message?: string;
    response?: { data?: { error?: string; errors?: string[] } };
  };
  return (
    e.response?.data?.errors?.join('\n') ||
    e.response?.data?.error ||
    e.message ||
    '儲存失敗，請保留內容並重試。'
  );
}
export function Workspace({
  graph,
  user,
  onSave,
  onSignIn,
  suspended = false,
  playground,
}: {
  graph: Graph;
  user: { userId: string } | null;
  onSave: (g: Graph) => Promise<void>;
  onSignIn: () => Promise<void>;
  suspended?: boolean;
  playground?: React.ReactNode;
}) {
  const { locale, t: translate, name: localizedName, nameLanguage, typeLabel, groupLabel, statusLabel, propertyLabel } = useI18n();
  const [filters, setFilters] = useState<WorkspaceFilters>(emptyWorkspaceFilters);
  const updateFilter = (key: keyof WorkspaceFilters, value: string) =>
    setFilters(current => ({ ...current, [key]: value }));
  const [mode, setMode] = useState<Mode>('nodes');
  const [activePlayground, setActivePlayground] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<WorkspaceSort>('name-asc');
  const [inspected, setInspected] = useState<RecordEntry | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLElement>(null);
  const deleteRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<RecordEntry | null>(null);
  const [originalKey, setOriginalKey] = useState('');
  const [extra, setExtra] = useState<RecordEntry>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteEntry, setDeleteEntry] = useState<RecordEntry | null>(null);
  const keyField =
    mode === 'entityTypes' ? 'name' : mode === 'edgeTypes' ? 'predicate' : 'id';
  const byId = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
  const matchingRows = filterWorkspaceRows(graph, mode, { ...filters, query }, row => [
    JSON.stringify(row),
    mode === 'nodes' ? searchableNames(row as unknown as Graph['nodes'][number]).join(' ') : '',
    row.type ? typeLabel(String(row.type)) : '',
    row.verification_status ? statusLabel(String(row.verification_status)) : '',
    row.from && byId[String(row.from)] ? searchableNames(byId[String(row.from)]).join(' ') : '',
    row.to && byId[String(row.to)] ? searchableNames(byId[String(row.to)]).join(' ') : '',
    row.group ? groupLabel(String(row.group)) : '',
    translate(String(row.definition || row.meaning || '')),
  ].join(' '));
  const recordName = (row: RecordEntry) => mode === 'nodes'
    ? localizedName(row as unknown as Graph['nodes'][number])
    : mode === 'entityTypes' ? typeLabel(String(row.name))
    : propertyLabel(String(row.predicate));
  const endpointName = (id: unknown) => byId[String(id)] ? localizedName(byId[String(id)]) : translate('未指定');
  const rows = sortWorkspaceRows(matchingRows, sort, locale,
    row => mode === 'edges' ? `${recordName(row)} ${endpointName(row.from)} ${endpointName(row.to)}` : recordName(row),
    row => String(row[keyField]));
  const closeDetail = useCallback(() => setInspected(null), []);
  const closeEditor = useCallback(() => setDraft(null), []);
  const closeDelete = useCallback(() => setDeleteEntry(null), []);
  useWorkspaceDialog(detailRef, !!inspected && !suspended, closeDetail);
  useWorkspaceDialog(editorRef, !!draft && !suspended, closeEditor, saving);
  useWorkspaceDialog(deleteRef, !!deleteEntry && !suspended, closeDelete, saving);
  const options = {
    types: [...new Set(graph.nodes.map(node => node.type))].sort(),
    statuses: [...new Set((mode === 'nodes' ? graph.nodes : graph.edges).map(row => String(row.verification_status || '__unmarked')))].sort(),
    predicates: [...new Set(graph.edges.map(edge => edge.predicate))].sort(),
    endpoints: [...new Set(graph.edges.flatMap(edge => [edge.from, edge.to]))].sort(),
    groups: [...new Set(graph.edgeTypes.map(edge => edge.group))].sort(),
    storage: [...new Set(graph.edgeTypes.map(edge => edge.storage))].sort(),
    usage: [...new Set(graph.entityTypes.map(entity =>
      graph.nodes.some(node => node.type === entity.name) || graph.edgeTypes.some(edge => edge.from === entity.name || edge.to === entity.name)
        ? 'used' : 'unused'))],

  };
  const optionSignature = JSON.stringify(options);
  useEffect(() => {
    setFilters(current => pruneWorkspaceFilters(graph, mode, current));
  }, [optionSignature, mode]);
  const activeFilterCount = Object.values(filters).filter(Boolean).length + (query ? 1 : 0);
  const issues = useMemo(() => workspaceQualityNotices(graph), [graph]);
  const activeTab = tabs.find(t => t.key === mode)!;
  function openEditor(entry?: RecordEntry) {
    setInspected(null);
    setError('');
    setNotice('');
    setOriginalKey(entry ? String(entry[keyField]) : '');
    const defaults: Record<Mode, RecordEntry> = {
      nodes: { id: `entity:${crypto.randomUUID()}`, name: '', type: graph.entityTypes[0]?.name || 'Company' },
      edges: { id: `relation:${crypto.randomUUID()}`, predicate: graph.edgeTypes.find(item => !item.storage.includes('only'))?.predicate || 'SELLS', from: '', to: '' },
      entityTypes: { name: '', definition: '' },
      edgeTypes: {
        predicate: '',
        group: 'products',
        from: 'Company',
        to: 'Product',
        storage: 'asserted',
        meaning: '',
      },
    };
    setDraft(entry ? { ...entry, ...(mode === 'nodes' ? { name: localizedName(entry as unknown as Graph['nodes'][number]) } : {}) } : defaults[mode]);
    const properties = entry
      ? Object.fromEntries(
          Object.entries(entry).filter(([key]) => !coreKeys[mode].includes(key))
        )
      : mode === 'edges'
        ? { verification_status: 'hypothesis', evidence_ids: [] }
        : {};
    setExtra(mode === 'nodes' && entry ? { ...properties, localized_names: { ...(properties.localized_names as Record<string, unknown> || {}), 'zh-TW': nameInLocale(entry as unknown as Graph['nodes'][number], 'zh-TW'), en: nameInLocale(entry as unknown as Graph['nodes'][number], 'en') } } : properties);
  }
  function setField(key: string, value: string) {
    setDraft(current => (current ? { ...current, [key]: value } : null));
    if (mode === 'nodes' && key === 'name') setExtra(current => ({ ...current, localized_names: { ...(current.localized_names as Record<string, unknown> || {}), [locale]: value } }));
  }
  function updateMetadata(next: RecordEntry) {
    if (mode === 'nodes') setDraft(current => current ? syncPrimaryName(current, extra, next, locale) : current);
    setExtra(next);
  }
  async function saveEditor(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setError('');
    try {
      const record = {
        ...extra,
        ...Object.fromEntries(coreKeys[mode].map(key => [key, draft[key]])),
      };
      const nextRows = originalKey
        ? (graph[mode] as unknown as RecordEntry[]).map(r =>
            r[keyField] === originalKey ? record : r
          )
        : [...(graph[mode] as unknown as RecordEntry[]), record];
      const next = { ...graph, [mode]: nextRows } as Graph;
      const errors = validateGraph(next);
      if (errors.length) throw new Error(errors.join('\n'));
      setSaving(true);
      await onSave(next);
      setDraft(null);
      setNotice('已儲存至你的私人工作區。重新載入後仍會保留。');
    } catch (err) {
      setError('儲存失敗，請確認必填欄位、來源與關係選擇，再重試。');
    } finally {
      setSaving(false);
    }
  }
  function beginDelete(record: RecordEntry) {
    setInspected(null);
    setError('');
    setNotice('');
    if (
      mode === 'entityTypes' &&
      (graph.nodes.some(n => n.type === record.name) ||
        graph.edgeTypes.some(
          e => e.from === record.name || e.to === record.name
        ))
    ) {
      setError('此實體類別仍被資料或關係定義使用。請先移除引用，才能刪除。');
      return;
    }
    if (
      mode === 'edgeTypes' &&
      graph.edges.some(e => e.predicate === record.predicate)
    ) {
      setError('此關係定義仍被關係資料使用。請先移除引用，才能刪除。');
      return;
    }
    setDeleteEntry(record);
  }
  async function confirmDelete() {
    if (!deleteEntry) return;
    setSaving(true);
    setError('');
    try {
      let next = {
        ...graph,
        [mode]: (graph[mode] as unknown as RecordEntry[]).filter(
          r => r[keyField] !== deleteEntry[keyField]
        ),
      } as Graph;
      if (mode === 'nodes') {
        const id = deleteEntry.id;
        const clean = <T extends RecordEntry>(item: T): T => {
          if (!Array.isArray(item.evidence_ids)) return item;
          return {
            ...item,
            evidence_ids: item.evidence_ids.filter(value => value !== id),
          };
        };
        next = {
          ...next,
          nodes: next.nodes.map(clean),
          edges: next.edges
            .filter(e => e.from !== id && e.to !== id)
            .map(clean),
        };
      }
      const errors = validateGraph(next);
      if (errors.length) throw new Error(errors.join('\n'));
      await onSave(next);
      setDeleteEntry(null);
      setNotice('已刪除，私人圖譜已更新。');
    } catch (err) {
      setError('操作未完成，請重新載入後再試。');
    } finally {
      setSaving(false);
    }
  }
  function exportGraph() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'good-mind-graph.json';
    a.click();
    URL.revokeObjectURL(url);
  }
  const predicate = graph.edgeTypes.find(e => e.predicate === draft?.predicate);
  return (
    <div className="workspace-layout">
      <aside className="workspace-nav panel">
        <div className="panel-heading">
          <strong>{translate('工作區')}</strong>
          <span className="version-label">v1.0</span>
        </div>
        <div className="workspace-tabs">
          {tabs.map(t => (
            <button
              key={t.key}
              className={!activePlayground && mode === t.key ? 'active' : ''}
              onClick={() => {
                setActivePlayground(false);
                setMode(t.key);
                setInspected(null);
                setQuery('');
                setFilters(emptyWorkspaceFilters);
                setError('');
                setNotice('');
              }}
            >
              <t.icon size={18} />
              <span>{translate(t.label)}</span>
              <small>{graph[t.key].length}</small>
            </button>
          ))}
          {playground && <button className={activePlayground ? 'active' : ''} onClick={() => {
            setActivePlayground(true);
            setInspected(null);
            setDraft(null);
            setDeleteEntry(null);
          }}><Sparkles size={18} /><span>{translate('AI 實驗室')}</span></button>}
        </div>

      </aside>
      {playground && <div className="workspace-playground-slot" hidden={!activePlayground} style={{ display: activePlayground ? undefined : 'none' }}>{playground}</div>}
      <section className="workspace-main panel" hidden={activePlayground} style={{ display: activePlayground ? 'none' : undefined }}>
        <div className="workspace-head workspace-data-head">
          <div>
            <h2>{translate(activeTab.label)} <span className="workspace-result-count" aria-live="polite">{rows.length}<span> / {graph[mode].length}</span></span></h2>
            <span className="workspace-access" title={translate('編輯只會改變你的圖譜，不會覆寫公開示範資料或其他人的研究。')}>
              <LockKeyhole size={12} /> {translate(user ? '私人工作區' : '唯讀')}
            </span>
          </div>
          <div className="workspace-header-actions">
            <details className="workspace-utility"
              onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.removeAttribute('open'); }}
              onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.currentTarget.removeAttribute('open'); event.currentTarget.querySelector('summary')?.focus(); } }}>
              <summary aria-label={translate('下載備份')} title={translate('下載備份')}><Download size={16} /></summary>
              <button onClick={event => { exportGraph(); event.currentTarget.closest('details')?.removeAttribute('open'); }}><Download size={16} />{translate('下載備份')}</button>
            </details>
            {!user && <button className="text-button" onClick={() => void onSignIn()}>{translate('登入開始編輯')}</button>}
            <button className="primary" data-workspace-focus-fallback disabled={!user} onClick={() => openEditor()}>
              <Plus size={15} />{translate('新增資料')}
            </button>
          </div>
        </div>
        {error && !draft && (
          <div className="error-banner" role="alert">
            {translate(error)}
          </div>
        )}
        {notice && (
          <div className="success-banner" role="status">
            <Check size={16} />
            {translate(notice)}
          </div>
        )}
        <div className="table-toolbar">
          <label className="search-input">
            <Search size={16} />
            <input
              data-workspace-focus-fallback
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={translate('搜尋 {category}…', { category: translate(activeTab.label) })}
              aria-label={translate('搜尋工作區資料')}
            />
          </label>
          <label className="workspace-sort">
            <span>{translate('排序')}</span>
            <select aria-label={translate('工作區排序')} value={sort} onChange={event => setSort(event.target.value as WorkspaceSort)}>
              <option value="name-asc">{translate('名稱：升冪')}</option>
              <option value="name-desc">{translate('名稱：降冪')}</option>
              <option value="source">{translate('原始順序')}</option>
            </select>
          </label>
        </div>
        <div className="workspace-filter-row">
          {mode === 'nodes' && (
            <label>{translate('實體類型')}
              <select aria-label={translate('工作區實體類型篩選')} value={filters.type} onChange={e => updateFilter('type', e.target.value)}>
                <option value="">{translate('全部類型')}</option>
                {options.types.map(value => <option key={value} value={value}>{typeLabel(value)}</option>)}
              </select>
            </label>
          )}
          {(mode === 'nodes' || mode === 'edges') && (
            <label>{translate('驗證狀態')}
              <select aria-label={translate('工作區驗證狀態篩選')} value={filters.status} onChange={e => updateFilter('status', e.target.value)}>
                <option value="">{translate('全部狀態')}</option>
                {options.statuses.map(value => <option key={value} value={value}>{value === '__unmarked' ? translate('未標記') : statusLabel(value)}</option>)}
              </select>
            </label>
          )}
          {mode === 'edges' && <>
            <label>{translate('關係定義')}
              <select aria-label={translate('工作區關係定義篩選')} value={filters.predicate} onChange={e => updateFilter('predicate', e.target.value)}>
                <option value="">{translate('全部關係')}</option>
                {options.predicates.map(value => <option key={value} value={value}>{propertyLabel(value)}</option>)}
              </select>
            </label>
            <label>{translate('相連實體')}
              <select aria-label={translate('相連實體篩選')} value={filters.endpoint} onChange={e => updateFilter('endpoint', e.target.value)}>
                <option value="">{translate('全部實體')}</option>
                {options.endpoints.map(value => <option key={value} value={value} lang={nameLanguage(byId[value])}>{byId[value] ? localizedName(byId[value]) : translate('未指定')}</option>)}
              </select>
            </label>
          </>}
          {mode === 'entityTypes' && (
            <label>{translate('引用情況')}
              <select aria-label={translate('類別引用情況篩選')} value={filters.usage} onChange={e => updateFilter('usage', e.target.value)}>
                <option value="">{translate('全部類別')}</option>
                {options.usage.includes('used') && <option value="used">{translate('使用中')}</option>}
                {options.usage.includes('unused') && <option value="unused">{translate('尚未使用')}</option>}
              </select>
            </label>
          )}
          {mode === 'edgeTypes' && <>
            <label>{translate('關係群組')}
              <select aria-label={translate('關係群組篩選')} value={filters.group} onChange={e => updateFilter('group', e.target.value)}>
                <option value="">{translate('全部群組')}</option>
                {options.groups.map(value => <option key={value} value={value}>{groupLabel(value)}</option>)}
              </select>
            </label>
            <label>{translate('儲存規則')}
              <select aria-label={translate('儲存規則篩選')} value={filters.storage} onChange={e => updateFilter('storage', e.target.value)}>
                <option value="">{translate('全部儲存規則')}</option>
                {options.storage.map(value => <option key={value} value={value}>{propertyLabel(value)}</option>)}
              </select>
            </label>
          </>}
          <button className="text-button" disabled={!activeFilterCount} onClick={() => { setQuery(''); setFilters(emptyWorkspaceFilters); }}>
            {translate('清除篩選')}{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </button>
        </div>
        <div className="workspace-record-cards" aria-label={translate('資料清單')}>
          {rows.map(row => {
            const key = String(row[keyField]);
            return (
              <article className="workspace-record-card" key={key} onClick={() => user && openEditor(row)}>
                <button className="record-title-button" onClick={() => openEditor(row)} disabled={!user} aria-label={translate('編輯 {name}', { name: recordName(row) })}>
                  <span>
                    <strong lang={mode === 'nodes' ? nameLanguage(row as unknown as Graph['nodes'][number]) : undefined}>{recordName(row)}</strong>

                  </span>
                  <Edit3 size={16} />
                </button>
                {mode === 'nodes' ? (
                  <div className="record-card-meta">
                    <span className="soft-label">{typeLabel(String(row.type))}</span>
                    <span>{row.verification_status ? statusLabel(String(row.verification_status)) : translate('未標記')}</span>
                    {row.ticker ? <span>{propertyLabel('ticker')} · {String(row.ticker)}</span> : null}
                  </div>
                ) : mode === 'edges' ? (
                  <div className="record-card-meta">
                    <p className="record-card-endpoints"><span>{endpointName(row.from)}</span><ArrowRight size={13} /><span>{endpointName(row.to)}</span></p>
                    <span>{row.verification_status ? statusLabel(String(row.verification_status)) : translate('未標記')}</span>
                  </div>
                ) : mode === 'entityTypes' ? (
                  <p className="record-card-description">{translate(String(row.definition))}</p>
                ) : (
                  <div className="record-card-meta">
                    <p className="record-card-endpoints"><span>{typeLabel(String(row.from))}</span><ArrowRight size={13} /><span>{typeLabel(String(row.to))}</span></p>
                    <span>{groupLabel(String(row.group))}</span>
                    <span>{propertyLabel(String(row.storage))}</span>
                  </div>
                )}
                <div className="record-card-actions" onClick={event => event.stopPropagation()}>

                  <button disabled={!user} onClick={() => openEditor(row)} aria-label={translate('編輯 {name}', { name: recordName(row) })}><Edit3 size={14} />{translate('編輯')}</button>
                  <button disabled={!user} onClick={() => beginDelete(row)} aria-label={translate('刪除 {name}', { name: recordName(row) })}><Trash2 size={14} />{translate('刪除')}</button>
                </div>
              </article>
            );
          })}
          {!rows.length && <p className="table-empty">{translate('沒有符合的資料。')}</p>}
        </div>
        {issues.length > 0 && (
          <details className="quality-panel">
            <summary>
              <AlertTriangle size={15} />
              {translate('資料品質提醒 · {count} 項', { count: issues.length })}
            </summary>
            <ul>
              {issues.map((issue, i) => (
                <li key={`${issue.node.id}-${issue.category}`}><strong>{localizedName(issue.node)}</strong>：{translate(issue.category === 'incomplete' ? '關係資料尚未完整：請補齊參與者、產品或市場關聯，再納入分析。' : '尚未設定驗證狀態：請編輯此項目並選擇驗證狀態。')}</li>
              ))}
            </ul>
            <p>{translate('未完整的商業紀錄可保留為草稿，但不得解讀為已證實關係。')}</p>
          </details>
        )}
        <details className="workspace-footnote"><summary>{translate('資料規則')}</summary><p>{translate('系統會檢查資料關聯與來源引用。推論得到的關係不能直接標記為已確認事實。')}</p></details>
      </section>
      {draft && (
        <div className="modal-backdrop">
          <section
            className="editor-modal card-editor"
            ref={editorRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="editor-title"
          >
            <div className="modal-heading">
              <div>
                <small>{translate('私人工作區')}</small>
                <h2 id="editor-title">
                  {translate(originalKey ? '編輯 {category}' : '新增 {category}', { category: translate(activeTab.label) })}
                </h2>
              </div>
              <button
                className="quiet"
                aria-label={translate('關閉編輯器')}
                disabled={saving}
                onClick={() => setDraft(null)}
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={e => void saveEditor(e)}>
              <div className="editor-fields">
                {mode === 'nodes' && (
                  <>

                    <label className="field-label">{translate('名稱')}<input
                        required
                        value={String(draft.name)}
                        onChange={e => setField('name', e.target.value)}
                        placeholder={translate('公司或產品名稱')}
                      />
                    </label>
                    <label className="field-label">{translate('實體類別')}<select
                        value={String(draft.type)}
                        onChange={e => setField('type', e.target.value)}
                      >
                        {graph.entityTypes.map(t => (
                          <option key={t.name} value={t.name}>
                            {typeLabel(t.name)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                {mode === 'edges' && (
                  <>

                    <label className="field-label">{translate('關係定義')}<select
                        value={String(draft.predicate)}
                        onChange={e => {
                          setDraft(current => ({
                            ...current,
                            predicate: e.target.value,
                            from: '',
                            to: '',
                          }));
                        }}
                      >
                        {graph.edgeTypes
                          .filter(
                            t =>
                              !['derived_only', 'query_derived_only'].includes(
                                t.storage
                              )
                          )
                          .map(t => (
                            <option key={t.predicate} value={t.predicate}>
                              {propertyLabel(t.predicate)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <p className="form-help">{translate(predicate?.meaning || '')}</p>
                    <label className="field-label">
                      {translate('起點')} · {typeLabel(predicate?.from || '')}
                      <select
                        required
                        value={String(draft.from)}
                        onChange={e => setField('from', e.target.value)}
                      >
                        <option value="">{translate('選擇起點實體')}</option>
                        {graph.nodes
                          .filter(n => n.type === predicate?.from)
                          .map(n => (
                            <option key={n.id} value={n.id} lang={nameLanguage(n)}>
                              {localizedName(n)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label className="field-label">
                      {translate('終點')} · {typeLabel(predicate?.to || '')}
                      <select
                        required
                        value={String(draft.to)}
                        onChange={e => setField('to', e.target.value)}
                      >
                        <option value="">{translate('選擇終點實體')}</option>
                        {graph.nodes
                          .filter(n => n.type === predicate?.to)
                          .map(n => (
                            <option key={n.id} value={n.id} lang={nameLanguage(n)}>
                              {localizedName(n)}
                            </option>
                          ))}
                      </select>
                    </label>
                  </>
                )}
                {mode === 'entityTypes' && (
                  <>
                    <label className="field-label">{translate('類別名稱')}<input
                        required
                        disabled={!!originalKey}
                        value={originalKey ? typeLabel(String(draft.name)) : String(draft.name)}
                        onChange={e => setField('name', e.target.value)}
                        placeholder={translate('輸入類別名稱')}
                      />
                    </label>
                    <label className="field-label">{translate('定義')}<textarea
                        required
                        rows={4}
                        value={translate(String(draft.definition))}
                        onChange={e => setField('definition', e.target.value)}
                        placeholder={translate('描述此類別的語意與邊界')}
                      />
                    </label>
                  </>
                )}
                {mode === 'edgeTypes' && (
                  <>
                    <label className="field-label">{translate('關係名稱')}<input
                        required
                        disabled={!!originalKey}
                        value={originalKey ? propertyLabel(String(draft.predicate)) : String(draft.predicate)}
                        onChange={e => setField('predicate', e.target.value)}
                        placeholder={translate('輸入關係名稱')}
                      />
                    </label>
                    <label className="field-label">{translate('關係群組')}<select
                        value={String(draft.group)}
                        onChange={e => setField('group', e.target.value)}
                      >
                        {[...new Set([...Object.keys(groupLabels), ...graph.edgeTypes.map(edge => edge.group)])].map(value => (
                          <option key={value} value={value}>
                            {groupLabel(value)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="two-fields">
                      {['from', 'to'].map(key => (
                        <label className="field-label" key={key}>
                          {key === 'from' ? translate('起點類別') : translate('終點類別')}
                          <select
                            value={String(draft[key])}
                            onChange={e => setField(key, e.target.value)}
                          >
                            {graph.entityTypes.map(t => (
                              <option key={t.name} value={t.name}>
                                {typeLabel(t.name)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    <label className="field-label">{translate('儲存規則')}<select
                        value={String(draft.storage)}
                        onChange={e => setField('storage', e.target.value)}
                      >
                        {[
                          'asserted',
                          'derived_or_asserted',
                          'asserted_or_derived',
                          'derived_only',
                          'query_derived_only',
                        ].map(s => (
                          <option key={s} value={s}>
                            {propertyLabel(s)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field-label">{translate('語意定義')}<textarea
                        required
                        rows={3}
                        value={translate(String(draft.meaning))}
                        onChange={e => setField('meaning', e.target.value)}
                      />
                    </label>
                  </>
                )}
                {(mode === 'nodes' || mode === 'edges') && (
                  <MetadataEditor value={extra} onChange={updateMetadata} graph={graph} mode={mode} entityType={String(draft.type || '')} />
                )}
                {error && (
                  <div className="form-error" role="alert">
                    {translate(error)}
                  </div>
                )}
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="outline"
                  disabled={saving}
                  onClick={() => setDraft(null)}
                >{translate('取消')}</button>
                <button type="submit" className="primary" disabled={saving}>
                  {saving ? translate('儲存中…') : translate('儲存變更')}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {deleteEntry && (
        <div className="modal-backdrop">
          <section
            className="confirm-modal"
            ref={deleteRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
          >
            <div className="danger-symbol">
              <Trash2 size={23} />
            </div>
            <h2 id="delete-title">{translate('確認刪除這筆資料？')}</h2>
            <p>{recordName(deleteEntry)}</p>
            <p>
              {mode === 'nodes'
                ? translate('相關連結與來源引用也會一併移除。此變更只影響管理工作區。')
                : translate('此變更只影響你的私人工作區。刪除後可透過新增重新建立。')}
            </p>
            {error && (
              <div className="form-error" role="alert">
                {translate(error)}
              </div>
            )}
            <div className="modal-actions">
              <button
                className="outline"
                disabled={saving}
                onClick={() => setDeleteEntry(null)}
              >{translate('取消')}</button>
              <button
                className="danger-button"
                disabled={saving}
                onClick={() => void confirmDelete()}
              >
                {saving ? translate('刪除中…') : translate('確認刪除')}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
