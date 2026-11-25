import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronRight, ExternalLink, Filter, Focus, Info, RotateCcw, Search } from 'lucide-react';
import { Graph, NodeRecord } from './types';
import { useI18n } from './i18n';
import {
  computeResearch,
  emptyResearchQuery,
  researchOptions,
  ResearchIntent,
  ResearchQuery,
  ResearchResult,
  ResearchRow,
} from './researchScope';

const copy = {
  title: ['研究範圍', 'Research scope'],
  reset: ['清除條件', 'Clear scope'],
  industry: ['選擇產業／市場', 'Choose an industry / market'],
  industries: ['產業', 'Industries'],
  standaloneMarkets: ['市場區隔', 'Market segments'],
  across: ['跨產業／不限產業', 'Across industries'],
  industryPlaceholder: ['選擇研究的產業或市場', 'Choose an industry or market'],
  market: ['市場／次產業', 'Market / subindustry'],
  allMarkets: ['整個產業', 'Entire industry'],
  intent: ['選擇研究方向', 'Choose a research question'],
  scope: ['縮小範圍（選填）', 'Narrow the scope (optional)'],
  company: ['企業', 'Company'],
  allCompanies: ['產業內所有企業', 'All companies in scope'],
  category: ['產品分類', 'Product category'],
  allCategories: ['所有產品分類', 'All product categories'],
  product: ['產品', 'Product'],
  allProducts: ['所有相關產品', 'All related products'],
  proofDepth: ['證據與探索深度', 'Evidence and depth'],
  proof: ['證據標記', 'Evidence label'],
  proofAll: ['所有標記', 'All labels'],
  proofOfficial: ['標記為官方揭露', 'Labeled official disclosure'],
  proofInferred: ['分析推論', 'Analyst inference'],
  depth: ['探索深度', 'Exploration depth'],
  hop: ['層', 'hop'],
  apply: ['查看研究結果', 'View research results'],
  update: ['更新研究結果', 'Update research results'],
  ready: ['選擇產業與研究方向後，才會查詢結果。', 'Choose an industry and a question before running a query.'],
  noIntents: ['這個範圍尚無可用的關係類別，請調整產業或市場。', 'No relationship categories are available in this scope. Try another industry or market.'],
  pending: ['新條件尚未套用；下方仍是上次查詢結果。', 'Changes are not applied. Results below still use the previous scope.'],
  restore: ['還原已套用條件', 'Restore applied scope'],
  applied: ['已套用', 'Applied'],
  results: ['研究結果', 'Research results'],
  findings: ['筆關係', 'relationships'],
  noResults: ['目前條件下沒有符合的紀錄', 'No records match this scope'],
  noResultsNote: ['這表示目前資料不足或條件未命中，不代表現實中沒有這類關係。', 'This reflects the available data and filters, not proof that these relationships do not exist.'],
  relax: ['查看所有證據標記', 'Include all evidence labels'],
  edit: ['調整研究條件', 'Edit research scope'],
  sourceWarning: ['證據標記不等於重新查證；推論不是已確認的交易或競爭。', 'Evidence labels are not re-verification. Inferences are not confirmed transactions or rivalry.'],
  noSources: ['未附可解析來源', 'No resolvable sources'],
  noSourcesNote: ['此紀錄未連結可解析的來源；請查看關係詳情並補充佐證。這不代表關係不存在。', 'This record has no resolvable linked sources. Inspect the relationship and add supporting evidence; missing sources do not establish absence.'],
  suppliesTo: ['供應給', 'Supplies to'],
  prospectiveCustomer: ['潛在客戶（尚未確認交易）', 'Prospective customer (not a confirmed transaction)'],
  sources: ['來源與佐證', 'Sources and evidence'],
  unverified: ['尚未重新查證', 'Not reverified'],
  noDate: ['未提供查核日期', 'No verification date recorded'],
  verifiedDate: ['查核日期', 'Verification date'],
  statusUnknown: ['未標記驗證狀態', 'Verification status not recorded'],
  derived: ['衍生分析', 'Derived analysis'],
  focus: ['在圖譜聚焦', 'Focus in graph'],
  inspect: ['查看關係詳情', 'Inspect relationship'],
  marketContext: ['市場情境', 'Market context'],
  context: ['參與者、產品與相關紀錄', 'Participants, products and context'],
  omitted: ['部分關係尚未納入圖譜；列表仍保留所有結果。點選聚焦可優先查看。', 'Some relationships are outside the graph limit. All results remain listed; focus a result to prioritize it.'],
  error: ['無法整理此範圍的結果。請重設條件後再試。', 'This scope could not be processed. Clear the scope and try again.'],
  currentScope: ['目前套用的研究條件', 'Currently applied research scope'],
  openSource: ['開啟來源', 'Open source'],
} as const;

const intentCopy: Record<ResearchIntent, readonly [string, string]> = {
  competition: ['競爭關係', 'Competition'],
  supply: ['供應鏈', 'Supply chain'],
  customers: ['客戶', 'Customers'],
  opportunities: ['潛在客戶', 'Opportunities'],
  cooperation: ['合作關係', 'Cooperation'],
  group: ['集團結構', 'Corporate groups'],
};

function reconcileQuery(graph: Graph, query: ResearchQuery): ResearchQuery {
  const next = { ...query };
  // Repeat once after clearing a parent scope so children use its updated options.
  for (let pass = 0; pass < 2; pass++) {
    const options = researchOptions(graph, next);
    if (next.industry && next.industry !== '*' && ![...options.industries, ...(options.standaloneMarkets || [])].some(node => node.id === next.industry)) {
      return { ...emptyResearchQuery };
    }
    if (next.market && !options.markets.some(node => node.id === next.market)) next.market = '';
    if (next.intent && !options.intents.includes(next.intent)) next.intent = '';
    if (next.company && !options.companies.some(node => node.id === next.company)) next.company = '';
    if (next.category && !options.categories.some(node => node.id === next.category)) next.category = '';
    if (next.product && !options.products.some(node => node.id === next.product)) next.product = '';
  }
  return next;
}

export type ResearchControlsProps = {
  graph: Graph;
  onApply: (result: ResearchResult | null) => void;
  onFocus: (id: string, edgeId?: string) => void;
  onInspect: (edgeId: string) => void;
};

export function ResearchControls({ graph, onApply, onFocus, onInspect }: ResearchControlsProps) {
  const { locale, name, nameLanguage, statusLabel, propertyLabel } = useI18n();
  const language = locale === 'en' ? 1 : 0;
  const text = (key: keyof typeof copy) => copy[key][language];
  const intentName = (intent: ResearchIntent) => intentCopy[intent][language];
  const [draft, setDraft] = useState<ResearchQuery>(() => ({ ...emptyResearchQuery }));
  const [appliedQuery, setAppliedQuery] = useState<ResearchQuery | null>(null);
  const industryInput = useRef<HTMLSelectElement>(null);
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;
  const options = useMemo(() => researchOptions(graph, draft), [graph, draft]);
  const appliedState = useMemo(() => {
    if (!appliedQuery) return { result: null, failed: false };
    try {
      return { result: computeResearch(graph, appliedQuery), failed: false };
    } catch {
      return { result: null, failed: true };
    }
  }, [graph, appliedQuery]);
  const result = appliedState.result;
  useEffect(() => { onApplyRef.current(result); }, [result]);
  useEffect(() => {
    setDraft(previous => {
      const next = reconcileQuery(graph, previous);
      return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
    });
  }, [graph]);
  const dirty = appliedQuery !== null && JSON.stringify(draft) !== JSON.stringify(appliedQuery);
  const byId = useMemo(() => Object.fromEntries(graph.nodes.map(node => [node.id, node])), [graph]);
  const groupedRows = useMemo(() => {
    const groups = new Map<string, { subject: NodeRecord; rows: ResearchRow[] }>();
    for (const row of result?.rows || []) {
      const existing = groups.get(row.subject.id);
      if (existing) existing.rows.push(row);
      else groups.set(row.subject.id, { subject: row.subject, rows: [row] });
    }
    return [...groups.values()];
  }, [result]);

  function update(patch: Partial<ResearchQuery>) {
    setDraft(previous => {
      let next = { ...previous, ...patch };
      if ('industry' in patch) next = { ...emptyResearchQuery, industry: patch.industry || '' };
      else if ('market' in patch) next = { ...next, company: '', category: '', product: '' };
      else if ('intent' in patch) next = { ...next, company: '', category: '', product: '' };
      else if ('company' in patch) next = { ...next, category: '', product: '' };
      else if ('category' in patch) next.product = '';
      return reconcileQuery(graph, next);
    });
  }

  function clear() {
    setDraft({ ...emptyResearchQuery });
    setAppliedQuery(null);
    industryInput.current?.focus();
  }

  function apply() {
    if (!draft.industry || !draft.intent) return;
    setAppliedQuery({ ...draft });
  }

  const appliedNames = appliedQuery ? [
    byId[appliedQuery.industry],
    byId[appliedQuery.market],
    byId[appliedQuery.company],
    byId[appliedQuery.category],
    byId[appliedQuery.product],
  ].filter(Boolean) : [];

  return (
    <section className="research-workflow" aria-labelledby="research-heading">
      <div className="research-heading">
        <h2 id="research-heading"><Search size={17} />{text('title')}</h2>
        {(draft.industry || appliedQuery) && (
          <button type="button" className="research-reset" onClick={clear}>
            <RotateCcw size={13} />{text('reset')}
          </button>
        )}
      </div>
      <form className="research-form" onSubmit={event => { event.preventDefault(); apply(); }}>
        <div className="research-stages">
          <fieldset className="research-stage">
            <legend><span aria-hidden="true">01</span>{text('industry')}</legend>
            <label className="research-control-label">
              <span className="research-sr-only">{text('industry')}</span>
              <select ref={industryInput} value={draft.industry} onChange={event => update({ industry: event.target.value })}>
                <option value="">{text('industryPlaceholder')}</option>
                <option value="*">{text('across')}</option>
                {options.industries.length > 0 && <optgroup label={text('industries')}>
                  {options.industries.map(node => <option value={node.id} key={node.id} lang={nameLanguage(node)}>{name(node)}</option>)}
                </optgroup>}
                {!!options.standaloneMarkets?.length && <optgroup label={text('standaloneMarkets')}>
                  {options.standaloneMarkets.map(node => <option value={node.id} key={node.id} lang={nameLanguage(node)}>{name(node)}</option>)}
                </optgroup>}
              </select>
            </label>
            {draft.industry && byId[draft.industry]?.type !== 'MarketSegment' && options.markets.length > 0 && (
              <label className="research-control-label">
                <span>{text('market')}</span>
                <select value={draft.market} onChange={event => update({ market: event.target.value })}>
                  <option value="">{text('allMarkets')}</option>
                  {options.markets.map(node => <option value={node.id} key={node.id} lang={nameLanguage(node)}>{name(node)}</option>)}
                </select>
              </label>
            )}
          </fieldset>

          {draft.industry && (
            <fieldset className="research-stage research-intent-stage">
              <legend><span aria-hidden="true">02</span>{text('intent')}</legend>
              <div className="research-intents" role="group" aria-label={text('intent')}>
                {options.intents.map(intent => (
                  <button type="button" key={intent}
                    aria-pressed={draft.intent === intent}
                    onClick={() => update({ intent })}>
                    {draft.intent === intent && <Check size={13} />}
                    {intentName(intent)}
                  </button>
                ))}
              </div>
              {options.intents.length === 0 && <p className="research-field-note">{text('noIntents')}</p>}
            </fieldset>
          )}

          {draft.industry && draft.intent && (
            <fieldset className="research-stage research-narrow-stage">
              <legend><span aria-hidden="true">03</span>{text('scope')}</legend>
              <div className="research-narrow-fields">
                {options.companies.length > 0 && (
                  <label className="research-control-label">
                    <span>{text('company')}</span>
                    <select value={draft.company} onChange={event => update({ company: event.target.value })}>
                      <option value="">{text('allCompanies')}</option>
                      {options.companies.map(node => <option value={node.id} key={node.id} lang={nameLanguage(node)}>{name(node)}</option>)}
                    </select>
                  </label>
                )}
                {options.categories.length > 0 && (
                  <label className="research-control-label">
                    <span>{text('category')}</span>
                    <select value={draft.category} onChange={event => update({ category: event.target.value })}>
                      <option value="">{text('allCategories')}</option>
                      {options.categories.map(node => <option value={node.id} key={node.id} lang={nameLanguage(node)}>{name(node)}</option>)}
                    </select>
                  </label>
                )}
                {options.products.length > 0 && (
                  <label className="research-control-label">
                    <span>{text('product')}</span>
                    <select value={draft.product} onChange={event => update({ product: event.target.value })}>
                      <option value="">{text('allProducts')}</option>
                      {options.products.map(node => <option value={node.id} key={node.id} lang={nameLanguage(node)}>{name(node)}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <details className="research-proof-disclosure">
                <summary><Filter size={13} />{text('proofDepth')}</summary>
                <div className="research-proof-fields">
                  <label className="research-control-label">
                    <span>{text('proof')}</span>
                    <select value={draft.proof} onChange={event => update({ proof: event.target.value as ResearchQuery['proof'] })}>
                      <option value="all">{text('proofAll')}</option>
                      <option value="official">{text('proofOfficial')}</option>
                      <option value="inferred">{text('proofInferred')}</option>
                    </select>
                  </label>
                  <fieldset className="research-depth">
                    <legend>{text('depth')}</legend>
                    <div>
                      {([1, 2, 3] as const).map(depth => (
                        <label key={depth}>
                          <input type="radio" name="research-depth" value={depth} checked={draft.depth === depth} onChange={() => update({ depth })} />
                          <span>{depth} {text('hop')}{language === 1 && depth > 1 ? 's' : ''}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>
              </details>
            </fieldset>
          )}
        </div>
        <div className="research-submit-row">
          <p className="research-progress-note">
            {dirty ? text('pending') : !draft.intent ? text('ready') : text('sourceWarning')}
          </p>
          <button className="research-apply" type="submit" disabled={!draft.industry || !draft.intent}>
            {appliedQuery ? text('update') : text('apply')}<ArrowRight size={15} />
          </button>
        </div>
      </form>

      {appliedState.failed && (
        <div className="research-empty" role="alert">
          <Info size={19} /><p>{text('error')}</p><button onClick={clear} type="button">{text('reset')}</button>
        </div>
      )}
      {result && appliedQuery && (
        <div className="research-results" aria-labelledby="research-results-heading">
          <div className="research-results-header">
            <div>
              <h3 id="research-results-heading">{text('results')}<span>{result.rows.length} {text('findings')}</span></h3>
              <div className="research-applied-scope" aria-label={text('currentScope')}>
                <span className="research-applied-label"><Check size={11} />{text('applied')}</span>
                {appliedQuery.industry === '*' && <span>{text('across')}<ChevronRight size={11} aria-hidden="true" /></span>}
                {appliedNames.map(node => <span key={node.id} lang={nameLanguage(node)}>{name(node)}<ChevronRight size={11} aria-hidden="true" /></span>)}
                <strong>{appliedQuery.intent ? intentName(appliedQuery.intent) : ''}</strong>
              </div>
            </div>
            {dirty && <button className="research-restore" type="button" onClick={() => setDraft({ ...appliedQuery })}>{text('restore')}</button>}
          </div>
          {result.rows.length === 0 ? (
            <div className="research-empty">
              <Search size={21} />
              <h4>{text('noResults')}</h4>
              <p>{text('noResultsNote')}</p>
              <div>
                {appliedQuery.proof !== 'all' && (
                  <button type="button" onClick={() => {
                    const relaxed = { ...appliedQuery, proof: 'all' as const };
                    setDraft(relaxed); setAppliedQuery(relaxed);
                  }}>{text('relax')}</button>
                )}
                <button type="button" onClick={() => industryInput.current?.focus()}>{text('edit')}</button>
              </div>
            </div>
          ) : (
            <div className="research-result-groups">
              {groupedRows.map(group => (
                <section className="research-subject-group" key={group.subject.id}>
                  <h4 lang={nameLanguage(group.subject)}>{name(group.subject)}<span>{group.rows.length}</span></h4>
                  <ul>
                    {group.rows.map(row => (
                      <li className="research-result-row" key={row.id}>
                        <div className="research-finding">
                          <div className="research-finding-title">
                            <span className="research-predicate">{row.edge.predicate === 'HAS_SUPPLIER' ? text('suppliesTo') : row.edge.predicate === 'PROSPECTIVE_SELLER' ? text('prospectiveCustomer') : propertyLabel(row.edge.predicate)}</span>
                            <ArrowRight size={13} aria-hidden="true" />
                            <strong lang={nameLanguage(row.object)}>{name(row.object)}</strong>
                          </div>
                          <div className="research-finding-status">
                            <span className={row.edge.derived || row.status === 'analyst_inferred' ? 'research-status is-inferred' : 'research-status'}>
                              {row.status && row.status !== 'unknown' && row.status !== 'unmarked' ? statusLabel(row.status) : text('statusUnknown')}
                            </span>
                            {row.edge.derived === true && <span className="research-derived">{text('derived')}</span>}
                          </div>
                          {row.market && <p className="research-context"><span>{text('marketContext')}</span><b lang={nameLanguage(row.market)}>{name(row.market)}</b></p>}
                          {!!row.scopeReasons?.length && <p className="research-context">
                            <span>{locale === 'en' ? 'Industry match' : '產業命中依據'}</span>
                            {row.scopeReasons.map(reason => <b key={reason.company.id + reason.industry.id + reason.predicate}>
                              {name(reason.company)} · {propertyLabel(reason.predicate)} · {name(reason.industry)}
                            </b>)}
                          </p>}
                          {!!row.context?.length && (
                            <p className="research-context"><span>{text('context')}</span>
                              {row.context.map((node, index) => <b key={node.id} lang={nameLanguage(node)}>{index ? ' · ' : ''}{name(node)}</b>)}
                            </p>
                          )}
                          <details className="research-sources">
                            <summary>{row.sources.length ? `${text('sources')} (${row.sources.length})` : text('noSources')}</summary>
                            {row.sources.length ? (
                              <ul>
                                {row.sources.map(source => (
                                  <li key={source.id}>
                                    {typeof source.url === 'string' && /^https?:\/\//i.test(source.url) ? (
                                      <a href={source.url} target="_blank" rel="noreferrer" aria-label={`${text('openSource')}: ${name(source)}`}>
                                        <span lang={nameLanguage(source)}>{name(source)}</span><ExternalLink size={12} />
                                      </a>
                                    ) : <span lang={nameLanguage(source)}>{name(source)}</span>}
                                    <small>{source.reverified_for_package === false ? text('unverified') :
                                      source.last_verified_at ? `${text('verifiedDate')}: ${String(source.last_verified_at)}` : text('noDate')}</small>
                                  </li>
                                ))}
                              </ul>
                            ) : <p>{text('noSourcesNote')}</p>}
                          </details>
                        </div>
                        <div className="research-row-actions">
                          <button type="button" className="research-focus" onClick={() => onFocus(row.subject.id, row.edge.id)} aria-label={`${text('focus')}: ${name(row.subject)}`}>
                            <Focus size={14} />{text('focus')}
                          </button>
                          <button type="button" onClick={() => onInspect(row.edge.id)} aria-label={`${text('inspect')}: ${name(row.subject)} → ${name(row.object)}`}>
                            {text('inspect')}<ChevronRight size={13} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          {result.omitted > 0 && <p className="research-omitted" role="status"><Info size={14} />{text('omitted')} ({result.omitted})</p>}
          <p className="research-evidence-note"><Info size={13} />{text('sourceWarning')}</p>
        </div>
      )}
    </section>
  );
}
