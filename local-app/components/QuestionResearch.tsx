import { useEffect, useRef, useState } from 'react';
import { api } from '@appdeploy/client';
import { ArrowDownRight, ArrowRight, ChevronDown, ExternalLink, Search } from 'lucide-react';
import { useI18n } from './i18n';
import { runQuestion, runTypedQuestion, type TypedQuestion as ParsedQuestion, type QuestionResult } from './questionQuery';
import { computeResearch, type ResearchIntent, type ResearchResult } from './researchScope';
import type { Graph, NodeRecord } from './types';

const read = (value: unknown) => typeof value === 'string' ? value : '';
const isUrl = (value: unknown): value is string => /^https?:\/\//i.test(read(value));
const localizedNote = (value: unknown, en: boolean) => {
  const parts = read(value).split(' / ');
  return parts.length === 2 ? parts[en ? 1 : 0] : parts.join(' / ');
};
const supported = ['competition', 'customers', 'supply', 'cooperation'] as const;
type Intent = (typeof supported)[number];

export function QuestionResearch({ graph, onApply, onGraph, published }: {
  graph: Graph;
  onApply: (result: ResearchResult | null) => void;
  onGraph: (id: string, edgeId?: string) => void;
  published: boolean;
}) {
  const { locale, name, nameLanguage, statusLabel, propertyLabel } = useI18n();
  const en = locale === 'en';
  const tr = (zh: string, english: string) => en ? english : zh;
  const n = (node: NodeRecord) => <span lang={nameLanguage(node)}>{name(node)}</span>;
  const pickName = (id: string) => graph.nodes.find(node => node.id === id);
  const label = (intent: ResearchIntent) => ({
    competition: tr('競品', 'Competitors'), customers: tr('下游客戶', 'Downstream customers'),
    supply: tr('供應鏈', 'Supply chain'), cooperation: tr('已記錄合作', 'Documented collaboration'),
    opportunities: tr('潛在客戶', 'Customer opportunities'), group: tr('集團結構', 'Corporate structure'),
  })[intent];
  const [input, setInput] = useState('');
  const [result, setResult] = useState<QuestionResult | null>(null);
  const [submitted, setSubmitted] = useState('');
  const [parsed, setParsed] = useState<ParsedQuestion | null>(null);
  const [method, setMethod] = useState<'ai'|'local'|'filters'|''>('');
  const [busy, setBusy] = useState(false);
  const [companyId, setCompanyId] = useState('');
  const [intent, setIntent] = useState<Intent>('competition');
  const [proof, setProof] = useState<'all'|'official'>('all');
  const [direction, setDirection] = useState<''|'upstream'|'downstream'>('');
  const [counterpartyId, setCounterpartyId] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const running = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const companies = graph.nodes.filter(node => node.type === 'Company').sort((a, b) => name(a).localeCompare(name(b), locale));
  const examples = [
    tr('欣興有哪些競品？', 'Who are Unimicron’s competitors?'),
    tr('2303 有哪些已確認的客戶？', 'Who are UMC’s confirmed customers?'),
    tr('欣興和輝達有什麼合作？', 'How do Unimicron and NVIDIA collaborate?'),
  ];

  function present(next: QuestionResult, mode: typeof method) {
    setResult(next); setMethod(mode);
    onApply(next.kind === 'answer' && next.research?.rows.length ? next.research : null);
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
  }
  async function ask(question: string, online: boolean) {
    const clean = question.trim();
    if (!clean || running.current) return;
    running.current = true;
    setSubmitted(clean); setParsed(null);
    setResult(null); onApply(null);
    let next = runQuestion(graph, clean);
    let mode: typeof method = 'local';
    if (online) {
      setBusy(true);
      try {
        const response = await api.post('/api/question/parse', { question: clean, locale });
        if (!active.current) return;
        const payload = response.data as { parsed?: ParsedQuestion };
        if (payload?.parsed) {
          const interpreted = runTypedQuestion(graph, payload.parsed, undefined, clean);
          if (next.kind === 'unsupported' && interpreted.kind !== 'unsupported') {
            next = interpreted; setParsed(payload.parsed); mode = 'ai';
          }
        }
      } catch { /* The local query is already available; no provider details leave this surface. */ }
      if (!active.current) return;
      setBusy(false);
    }
    running.current = false;
    present(next, mode);
  }
  function runFilters() {
    const company = pickName(companyId);
    const other = pickName(counterpartyId);
    if (!company) return;
    const typed: ParsedQuestion = {
      entity: company.id,
      intent,
      proof,
      ...(intent === 'supply' && direction ? { direction } : {}),
      ...(other ? { counterparty: other.id } : {}),
    };
    setSubmitted(''); setParsed(typed);
    present(runTypedQuestion(graph, typed, company.id), 'filters');
  }

  const headline = result?.kind === 'answer' ? tr('研究結果', 'Research findings')
    : result?.kind === 'ambiguous' ? tr('你指的是哪家公司？', 'Which company did you mean?')
    : result?.kind === 'unknown-entity' ? tr('圖譜找不到這家公司', 'Company not found in the graph')
    : result?.kind === 'filtered' ? tr('有相關紀錄，但不符本次條件', 'Records exist outside these filters')
    : result?.kind === 'unnamed-end-customer' ? tr('終端客戶未具名', 'The end customer was not named')
    : result?.kind === 'not-recorded' ? tr('圖譜尚未收錄這項關係', 'This relationship is not recorded')
    : tr('這個問法目前不支援', 'This question is not supported yet');
  const rows = result?.kind === 'answer' ? result.research?.rows ?? [] : [];
  const caveat = result?.kind === 'unnamed-end-customer'
    ? tr('聯電公告提到一位通過驗證的雲端基礎設施客戶，但未公開名稱。SILITH 是公告所列的晶圓交付對象，不能當成該終端客戶。', 'UMC disclosed qualification by a cloud infrastructure customer without naming it. SILITH received the wafer delivery and is not identified as that end customer.')
    : result?.kind === 'not-recorded'
      ? tr('目前公開資料沒有足夠證據回答。沒有紀錄不代表沒有這項關係。', 'The public snapshot does not contain enough evidence to answer. That does not rule out a relationship.')
      : result?.kind === 'filtered'
        ? tr('可改用下方條件查詢，放寬證據條件或改查已記錄合作。合作公告不等於已出貨。', 'Use the filters below to broaden the evidence scope, or ask for documented cooperation. An agreement is not proof of shipment.')
        : result?.kind === 'unknown-entity'
          ? tr('試試完整公司名稱、英文名稱或股票代號。', 'Try the full company name, English name, or ticker.')
          : result?.kind === 'unsupported'
            ? tr('可查競品、供應商／客戶和已記錄合作。試試上方範例，或使用下方條件。', 'Ask about competitors, suppliers/customers, or documented cooperation. Try an example or use the filters below.') : '';
  const evidenceLink = (source: NodeRecord) => (
    <li key={source.id}>
      {isUrl(source.url) ? <a href={source.url} target="_blank" rel="noreferrer">{n(source)}<ExternalLink size={12} aria-hidden="true" /></a> : n(source)}
      <small>{read(source.last_verified_at) || tr('未標記查核日期', 'Verification date not recorded')}</small>
    </li>
  );

  return (
    <section className="question-workbench" aria-labelledby="question-title">
      <div className="question-lead">
        <div className="question-kicker"><span />{tr('股脈研究', 'GOODMIND RESEARCH')}<span className="question-kicker-separator">/</span>{published ? tr('公開圖譜', 'PUBLIC GRAPH') : tr('示範圖譜', 'SAMPLE GRAPH')}</div>
        <h2 id="question-title">{tr('你想查哪段關係？', 'What connection are you looking for?')}</h2>
        <p>{tr('先找答案和來源。需要追查時，再展開關係圖。', 'Start with findings and sources. Open the graph when you want to trace the connections.')}</p>
        <form className="question-form" onSubmit={event => { event.preventDefault(); void ask(input, true); }}>
          <label htmlFor="research-question" className="sr-only">{tr('輸入研究問題', 'Enter a research question')}</label>
          <div className="question-input-row">
            <Search size={21} aria-hidden="true" />
            <input id="research-question" maxLength={240} value={input} disabled={busy} onChange={event => setInput(event.target.value)} placeholder={examples[0]} aria-describedby="question-disclosure" required />
            <button type="submit" disabled={busy || !input.trim()}>{busy ? tr('正在解讀…', 'Interpreting…') : tr('提問', 'Ask')}<ArrowRight size={15} aria-hidden="true" /></button>
          </div>
          <p className="question-disclosure" id="question-disclosure">
            {tr('「提問」只將問題文字送交 OpenAI 解讀，不傳送圖譜。請勿輸入敏感資料。', 'Ask sends only the question text to OpenAI, not the graph. Do not enter sensitive information.')}
            <button type="button" disabled={busy || !input.trim()} onClick={() => void ask(input, false)}>{tr('不用 AI 查詢', 'Search without AI')}</button>
          </p>
        </form>
        <div className="question-examples" aria-label={tr('提問範例', 'Example questions')}>
          {examples.map(item => <button key={item} type="button" disabled={busy} onClick={() => setInput(item)}>{item}<ArrowDownRight size={13} aria-hidden="true" /></button>)}
        </div>
      </div>
      {busy && <p className="question-progress" role="status">{tr('正在解讀問題，再用公開圖譜找關係。', 'Interpreting the question, then checking the public graph.')}</p>}
      {result && (
        <section className="question-answer" aria-labelledby="question-answer-title">
          <header>
            <div>
              <h3 id="question-answer-title" ref={heading} tabIndex={-1}>{headline}</h3>
              <div className="question-scope">
                {result.entity && n(result.entity)}
                {result.intent && <span>{label(result.intent)}</span>}
                {result.matchedCounterparty && n(result.matchedCounterparty)}
                {(result.query?.market || (result.query?.industry !== '*' && result.query?.industry)) && (pickName(result.query.market || result.query.industry) ? n(pickName(result.query.market || result.query.industry)!) : null)}
                {result.query?.proof === 'official' && <span>{tr('僅官方揭露', 'Official disclosures only')}</span>}
                {result.query?.direction === 'upstream' && <span>{tr('上游', 'Upstream')}</span>}
                {result.query?.verifiedDelivery && <span>{tr('已交付', 'Delivered')}</span>}
              </div>
            </div>
            <small>{method === 'ai' ? tr('AI 解讀・圖譜查詢', 'AI interpretation · graph lookup') : method === 'filters' ? tr('條件查詢・不用 AI', 'Filter lookup · no AI') : tr('本機規則・圖譜查詢', 'Local rules · graph lookup')}</small>
          </header>
          {caveat && <p className="question-caveat">{caveat}</p>}
          {result.kind === 'filtered' && result.query && result.query.proof !== 'all' && !result.askedEndCustomer && <button type="button" className="question-relax" onClick={() => {
            if (!result.query) return;
            const query = { ...result.query, proof: 'all' as const };
            const research = computeResearch(graph, query);
            present({ ...result, query, research, kind: research.total ? 'answer' : 'filtered' }, method);
          }}>{tr('保留查詢範圍，顯示所有證據等級', 'Keep scope and include all evidence levels')}</button>}
          {result.kind === 'ambiguous' && <div className="question-choices">{result.choices?.map(choice => <button type="button" key={choice.id} onClick={() => {
            const next = parsed ? runTypedQuestion(graph, parsed, choice.id, submitted) : runQuestion(graph, submitted, choice.id);
            present(next, method);
          }}>{n(choice)}{choice.ticker ? <small>{read(choice.exchange)} {read(choice.ticker)}</small> : null}<ArrowRight size={13} /></button>)}</div>}
          {result.kind === 'unnamed-end-customer' && <ul className="question-sources">{result.research?.rows.flatMap(row => row.sources).filter((source, index, all) => all.findIndex(item => item.id === source.id) === index).map(evidenceLink)}</ul>}
          {rows.length > 0 && <ol className="question-rows">
            {rows.map(row => {
              const collaboration = row.subject.type === 'Collaboration';
              const supplies = ['HAS_SUPPLIER', 'SUPPLIES_TO'].includes(row.edge.predicate);
              const reversible = row.edge.symmetric === true && row.object.id === result.entity?.id;
              const subject = reversible ? row.object : row.subject;
              const object = reversible ? row.subject : row.object;
              const note = localizedNote(row.record?.notes ?? row.edge.notes, en);
              return <li key={row.id}>
                <div className="question-finding">
                  <div className="question-finding-title">
                    {collaboration ? n(row.subject) : <>{n(subject)} <span aria-hidden="true">{row.edge.symmetric ? '↔' : '→'}</span> {n(object)}</>}
                  </div>
                  <div className="question-find-tags">
                    <span>{collaboration ? tr('合作紀錄', 'Collaboration record') : supplies ? tr('供應給', 'Supplies to') : propertyLabel(row.edge.predicate)}</span>
                    <span className={row.edge.derived === true ? 'question-inferred' : ''}>{statusLabel(row.status) || tr('驗證狀態未標記', 'Verification not recorded')}</span>
                    {row.market && n(row.market)}
                  </div>
                  {!!row.context?.filter(node => node.id !== row.record?.id).length && <p className="question-row-context">
                    {row.context.filter(node => node.id !== row.record?.id).map((node, index) => <span key={node.id}>{index ? ' · ' : ''}{n(node)}</span>)}
                  </p>}
                  {note && <p className="question-row-context">{note}</p>}
                  {row.edge.derived === true && <p className="question-row-context">{tr('限此產品與市場的推論，不代表已確認同一客戶或競標。', 'Inference for the compared products and market, not a verified shared customer or bid.')}</p>}
                </div>
                <div className="question-evidence">
                  <strong>{tr('來源', 'Sources')}</strong>
                  {row.sources.length > 0 ? <ul className="question-sources">{row.sources.map(evidenceLink)}</ul> : <p>{tr('未附可查閱的來源。', 'No source is attached.')}</p>}
                </div>
              </li>;
            })}
          </ol>}
          {rows.length > 0 && <footer className="question-answer-footer">
            <span>{rows.length} {tr('筆關係', 'recorded relationships')}</span>
            <button type="button" onClick={() => onGraph(result.research?.rootId || result.entity?.id || rows[0].subject.id)}>
              {tr('查看這些關係的圖譜', 'Open graph for these findings')}<ArrowDownRight size={15} aria-hidden="true" />
            </button>
            {!!result.research?.omitted && <small>{tr('圖譜有 50 節點上限；上方結果清單完整保留。', 'The graph is capped at 50 nodes; the findings above are not truncated.')}</small>}
          </footer>}
        </section>
      )}
      <details className="question-filter">
        <summary>{tr('用條件查詢', 'Search with filters')}<ChevronDown size={16} aria-hidden="true" /></summary>
        <p>{tr('直接指定公司與關係，不呼叫 OpenAI。', 'Choose a company and relationship without calling OpenAI.')}</p>
        <form onSubmit={event => { event.preventDefault(); runFilters(); }} className="question-filter-grid">
          <label>{tr('公司', 'Company')}<select required value={companyId} onChange={event => { setCompanyId(event.target.value); if (counterpartyId === event.target.value) setCounterpartyId(''); }}><option value="">{tr('選擇公司', 'Choose company')}</option>{companies.map(company => <option value={company.id} key={company.id}>{name(company)}{company.ticker ? ` (${read(company.ticker)})` : ''}</option>)}</select></label>
          <label>{tr('要查的關係', 'Relationship')}<select value={intent} onChange={event => setIntent(event.target.value as Intent)}>{supported.map(item => <option key={item} value={item}>{label(item)}</option>)}</select></label>
          <label>{tr('另一家公司（選填）', 'Counterparty (optional)')}<select value={counterpartyId} onChange={event => setCounterpartyId(event.target.value)}><option value="">{tr('不限', 'Any')}</option>{companies.filter(company => company.id !== companyId).map(company => <option value={company.id} key={company.id}>{name(company)}</option>)}</select></label>
          {intent === 'supply' && <label>{tr('供應鏈方向', 'Supply direction')}<select value={direction} onChange={event => setDirection(event.target.value as typeof direction)}><option value="">{tr('上下游', 'Both directions')}</option><option value="upstream">{tr('上游供應商', 'Upstream suppliers')}</option><option value="downstream">{tr('下游客戶', 'Downstream buyers')}</option></select></label>}
          <label>{tr('證據等級', 'Evidence level')}<select value={proof} onChange={event => setProof(event.target.value as typeof proof)}><option value="all">{tr('全部（含推論）', 'All (including inferences)')}</option><option value="official">{tr('僅官方揭露', 'Official disclosures only')}</option></select></label>
          <button type="submit" disabled={busy || !companyId}>{tr('查詢關係', 'Find relationships')}<ArrowRight size={14} aria-hidden="true" /></button>
        </form>
      </details>
    </section>
  );
}
