import { withCompetitionProjections } from './competitionProjections';
import { searchableNames } from './locale-core';
import { computeResearch, emptyResearchQuery, type ResearchIntent, type ResearchQuery, type ResearchResult } from './researchScope';
import type { Graph, NodeRecord } from './types';

type QuestionContext = {
  entity?: NodeRecord;
  intent?: ResearchIntent;
  choices?: NodeRecord[];
  query?: ResearchQuery;
  research?: ResearchResult;
  matchedCounterparty?: NodeRecord;
  askedShipping?: boolean;
  askedEndCustomer?: boolean;
  endCustomerEvidence?: NodeRecord;
  unknownTerm?: string;
};

export type QuestionResult = QuestionContext & (
  | { kind: 'unsupported' | 'unknown-entity' }
  | { kind: 'ambiguous'; choices: NodeRecord[] }
  | { kind: 'not-recorded' | 'filtered'; entity: NodeRecord; query: ResearchQuery }
  | { kind: 'answer'; entity: NodeRecord; query: ResearchQuery; research: ResearchResult }
  | { kind: 'unnamed-end-customer'; entity: NodeRecord; query: ResearchQuery; research: ResearchResult; endCustomerEvidence: NodeRecord }
);

const umcId = 'entity:b1236908-e801-4cae-89ea-acd8d514c7d0';
const silithId = 'entity:ce7fd3da-64d8-4d32-a97d-367e5eee1c8c';
const umcRelease = 'https://www.umc.com/en/News/press_release/Content/technology_related/20260714';
const normalize = (input: string) => input.normalize('NFKC').toLowerCase()
  .replace(/[’‘]/g, "'").replace(/[‐‑–—]/g, '-').trim().replace(/\s+/g, ' ');
const chars = (value: unknown) => typeof value === 'string' ? value : '';
const plainTicker = /^\d{4,6}$/;
const qualifier = /^(?:[a-z][a-z\d]{1,9}\s*:\s*[a-z\d][a-z\d.-]*|\d{4,6}\.[a-z]{1,5})$/;
const canonicalQualifier = (text: string) => {
  const input = normalize(text).replace(/\s*:\s*/g, ':');
  const suffix = /^(\d{4,6})\.(tw|two)$/.exec(input);
  return suffix ? `${suffix[2] === 'tw' ? 'twse' : 'tpex'}:${suffix[1]}` : input;
};

type Aliases = { names: string[]; tickers: string[]; qualified: string[] };
function aliases(node: NodeRecord): Aliases {
  const names = [
    ...searchableNames(node), chars(node.name_en), chars(node.name_zh_TW),
    chars(node.legal_name), chars(node.legal_name_en), chars(node.legal_name_zh_TW),
    ...(Array.isArray(node.aliases) ? node.aliases.filter((value): value is string => typeof value === 'string') : []),
  ];
  const tickers = node.type === 'Company' ? [chars(node.ticker)].filter(Boolean).map(normalize) : [];
  const qualified: string[] = [];
  const listing = normalize(chars(node.exchange) || chars(node.market_exchange));
  const market = ['twse', 'tpex', 'nasdaq', 'nyse'].includes(listing) ? listing : '';
  if (market && tickers[0] && /^[a-z\d]+$/.test(tickers[0])) qualified.push(`${market}:${tickers[0]}`);
  // Official TWSE ISIN list / issuer profile, TW0002303005. Never infer a listing from a numeric ticker.
  // https://www.twse.com.tw/pdf/ch/2303_ch.pdf
  if (node.id === umcId && tickers[0] === '2303' && node.type === 'Company') {
    qualified.push('twse:2303', 'nyse:umc');
    names.push('聯華電子', '聯華電子股份有限公司', 'United Microelectronics', 'United Microelectronics Corporation');
  }
  return {
    names: [...new Set(names.map(normalize).filter(value => value && !qualifier.test(value) && !plainTicker.test(value)))],
    tickers,
    qualified: [...new Set(qualified)],
  };
}

function rankEntity(node: NodeRecord, input: string): number {
  const values = aliases(node);
  if (qualifier.test(input)) return values.qualified.includes(canonicalQualifier(input)) ? 0 : Infinity;
  if (plainTicker.test(input)) return values.tickers.includes(input) ? 0 : Infinity;
  if (values.tickers.includes(input) || values.names.includes(input)) return 0;
  if (input.length < 2) return Infinity;
  if (values.names.some(name => name.startsWith(input))) return 1;
  return values.names.some(name => name.includes(input)) ? 2 : Infinity;
}

export function searchEntities(graph: Graph, input: string, options?: { type?: string | null; limit?: number }): { entities: NodeRecord[]; totalMatches: number } {
  const term = normalize(input);
  const limit = typeof options?.limit === 'number' && Number.isFinite(options.limit) ? Math.max(0, Math.min(100, Math.floor(options.limit))) : 12;
  if (!term || term.length > 300) return { entities: [], totalMatches: 0 };
  const matches = graph.nodes
    .filter(node => node.verification_status !== 'rejected' && (!options?.type || node.type === options.type))
    .map(node => ({ node, rank: rankEntity(node, term) }))
    .filter(({ rank }) => Number.isFinite(rank))
    .sort((a, b) => a.rank - b.rank || a.node.id.localeCompare(b.node.id, 'en'));
  return { entities: matches.slice(0, limit).map(({ node }) => node), totalMatches: matches.length };
}

type Mention = { start: number; end: number; candidates: NodeRecord[] };
function companyMentions(graph: Graph, text: string): Mention[] {
  const mentions: Mention[] = [];
  const qualifiedSpans: [number, number][] = [];
  // Consume listing-like strings first so a wrong qualifier cannot silently fall back to its bare ticker.
  const listed = /(?<![a-z\d._-])(?:[a-z][a-z\d]{1,9}\s*:\s*[a-z\d]+(?:\.[a-z\d]+)?|\d{4,6}\.[a-z]{1,5})(?![a-z\d._-])/g;
  for (const match of text.matchAll(listed)) {
    const start = match.index!, end = start + match[0].length;
    qualifiedSpans.push([start, end]);
    const candidates = searchEntities(graph, match[0], { type: 'Company', limit: 100 }).entities;
    mentions.push({ start, end, candidates });
  }
  for (const node of graph.nodes) {
    if (node.type !== 'Company' || node.verification_status === 'rejected') continue;
    const values = aliases(node);
    for (const value of [...values.names, ...values.tickers]) {
      for (let start = text.indexOf(value); start >= 0; start = text.indexOf(value, start + value.length)) {
        const end = start + value.length;
        if (qualifiedSpans.some(([left, right]) => left < end && right > start)) continue;
        if (/[a-z\d]/.test(value[0]) && /[a-z\d_.:-]/.test(text[start - 1] || ' ')) continue;
        if (/[a-z\d]/.test(value[value.length - 1]) && /[a-z\d_.:-]/.test(text[end] || ' ')) continue;
        mentions.push({ start, end, candidates: [node] });
      }
    }
  }
  mentions.sort((a, b) => a.start - b.start || b.end - a.end);
  const accepted: Mention[] = [];
  for (const mention of mentions) {
    const last = accepted.at(-1);
    if (last?.start === mention.start && last.end === mention.end) {
      last.candidates = [...new Map([...last.candidates, ...mention.candidates].map(node => [node.id, node])).values()];
    } else if (!last || mention.start >= last.end) accepted.push(mention);
  }
  // A name followed by its matching ticker (or vice versa) is one mention and can disambiguate it.
  const merged: Mention[] = [];
  for (const mention of accepted) {
    const last = merged.at(-1);
    const overlap = last?.candidates.filter(node => mention.candidates.some(other => other.id === node.id)) || [];
    const separator = last ? text.slice(last.end, mention.start) : '';
    if (last && overlap.length > 0 && /^[\s()\/／-]*$/.test(separator)) {
      last.end = mention.end;
      last.candidates = overlap;
    } else merged.push(mention);
  }
  return merged;
}

const competition = /競爭|競品|同業對手|競業|\bcompet(?:itors?|ition|es?|ed|ing|itive rivals?)\b|\brivals?\b/;
const cooperation = /合作|協議|合資|聯盟|\b(?:collaborat\w*|partner(?:s|ship|ships|ed|ing)?|cooperat\w*|agreements?|joint venture)\b/;
const upstream = /供應商|上游|供貨商|原料商|誰供應|誰供貨|\b(?:suppliers?|upstream|sourcing|sourced from)\b|\b(?:who|what companies) suppl(?:y|ies)\b/;
const downstream = /客戶|下游|買家|供應給|供貨給|賣給|出貨給|交付給|\b(?:customers?|clients?|buyers?|downstream)\b|\b(?:sells?|ships?|suppl(?:y|ies)|deliver(?:s|ed)?) to\b/;
const supply = /供應|供貨|供應鏈|出貨|交付|採購|\b(?:supply|supplies|supplied|ships?|shipped|shipping|shipments?|deliver\w*|purchas\w*|buys?|bought)\b/;
const shipping = /出貨|交付|量產交貨|\b(?:shipped|ships?|shipments?|shipping|deliver\w*)\b/;
const endCustomer = /終端(?:的)?客戶|最終(?:的)?客戶|雲端(?:基礎設施)?客戶|雲端服務商|雲端大廠|\b(?:end|ultimate|cloud(?: infrastructure)?) (?:customers?|clients?|buyers?|providers?)\b|\b(?:hyperscaler|csp)s?\b/;
const official = /已公布|已公告|已揭露|公開宣布|\b(?:publicly|officially) announced\b|\bannounced (?:collaborations?|partnerships?|agreements?)\b|只(?:看|限|要)?官方|官方(?:揭露|公告|來源|證據|消息)?|只(?:看|要|限)?已證實|只(?:看|要|限)?已確認|\b(?:official(?:ly)?(?: disclosed)?|confirmed(?: only)?|verified(?: only)?|official sources?)\b/;
const inferred = /只(?:看|限|要)?(?:分析)?推論|\b(?:inferred only|analyst inferences? only)\b/;
const outOfScope = /股價|目標價|本益比|配息|推薦買|該買|估值|未來股價|\b(?:share price|stock price|price target|valuation|p\/e|should i buy|dividend|market cap)\b/;
const timeConstraint = /(?:19|20)\d{2}\s*(?:年|[\/-]\d)|(?:\bin|\bas of|\bbefore|\bafter|\bsince|\bduring) (?:19|20)\d{2}\b|(?:19|20)\d{2}\s*(?:q[1-4]|customers?|suppliers?|competitors?|partners?)\b|\b(?:latest|recent(?:ly)?|last (?:year|month|quarter)|this (?:year|month|quarter))\b|最新|近期|今年|去年|上季度|本季/;
const explicitMarket = /市場|产业|產業|領域|行業|產業別|\b(?:in|for|within|across) (?:the )?[^?.,;]{1,100}\b(?:market|sector|industry|segment)\b|\b(?:market|sector|industry|segment) (?:competitors?|customers?|suppliers?|partners?)\b/;
const commercialConstraint = /(?:認證|驗證|資格認定|產能預留|產能保留|試產|爬坡|量產|下單|訂單|合約金額)|\b(?:capacity reserv\w*|qualified|qualification|purchase orders?|ordered|pilot production|ramp(?:ing)?|mass production|contract value)\b/;
const unsupportedModifiers = /潛在|可能|推測|預計|考慮|尚未|未公布|有機會|計畫|傳聞|\b(?:prospective|potential|planned|possible|might|could|would|rumou?red|expected)\b/;
const unsupportedProductOrGeography = /電源競品|電源供應商|電源客戶|電池競品|車用競品|太陽能|光伏|歐洲|美國|日本|中國|東南亞|海外|國內|\b(?:solar|photovoltaic|power supply|power adapter|battery|automotive|in europe|in japan|in china|in taiwan|u\.?s\.? customers?)\b/;

type Direction = 'upstream' | 'downstream';
export type TypedQuestion = {
  entity: string;
  counterparty?: string;
  intent: 'competition' | 'supply' | 'customers' | 'cooperation';
  direction?: Direction;
  proof?: ResearchQuery['proof'];
  verifiedDelivery?: boolean;
  askedEndCustomer?: boolean;
  market?: string;
};
export type ParsedQuestion = TypedQuestion;
type Parsed = { intent: ResearchIntent; direction?: Direction; askedShipping: boolean; askedEndCustomer: boolean; proof: ResearchQuery['proof']; industry?: string };

function marketScope(graph: Graph, text: string): string | null | undefined {
  const matches = graph.nodes.filter(node => ['Industry', 'MarketSegment'].includes(node.type) &&
    node.verification_status !== 'rejected' && aliases(node).names.some(term => term.length > 2 &&
      new RegExp(`(?<![a-z0-9])${term.replace(/[.*+?^\$${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`).test(text)));
  if (/\bic[ -]*載板|\bic substrates?\b/.test(text)) {
    for (const node of graph.nodes) {
      if (node.type === 'MarketSegment' && node.verification_status !== 'rejected' && aliases(node).names.includes('半導體 ic 載板') &&
          !matches.some(match => match.id === node.id)) matches.push(node);
    }
  }
  if (matches.length > 1) return null;
  if (matches.length === 1) {
    // A known term does not authorize crossing into an additional or comparative market clause.
    if (/以及|或者|\b(?:or|versus)\b/.test(text)) return null;
    return matches[0].id;
  }
  return explicitMarket.test(text) ? null : undefined;
}

function hasUnsupportedConstraint(text: string, askedEndCustomer: boolean, askedShipping: boolean) {
  if (timeConstraint.test(text) || (official.test(text) && inferred.test(text))) return true;
  if (!commercialConstraint.test(text)) return false;
  if (askedEndCustomer && /認證|驗證|資格認定|\bqualifi(?:ed|cation)\b/.test(text)) return false;
  if (askedShipping && /產能預留|產能保留|量產|爬坡|\b(?:capacity reserv\w*|ramp(?:ing)?|mass production)\b/.test(text)) return false;
  return true;
}

function parse(graph: Graph, text: string): Parsed | null {
  if (!text || outOfScope.test(text) || unsupportedModifiers.test(text)) return null;
  const askedShipping = shipping.test(text), askedEndCustomer = endCustomer.test(text);
  const industry = marketScope(graph, text);
  if (industry === null || (!industry && unsupportedProductOrGeography.test(text)) || hasUnsupportedConstraint(text, askedEndCustomer, askedShipping)) return null;
  const up = upstream.test(text), down = downstream.test(text);
  const categories = [competition.test(text), cooperation.test(text), up || down || supply.test(text) || askedEndCustomer];
  // A supply agreement can be asked about shipment, but the agreement itself never proves delivery.
  if (categories.filter(Boolean).length !== 1 && !(askedShipping && !categories[0] && categories[1])) return null;
  let direction: Direction | undefined = up === down ? undefined : up ? 'upstream' : 'downstream';
  if (/採購自|跟.{1,40}(買|採購)|向.{1,40}(買|採購)|\b(?:buys?|bought|purchases?) from\b/.test(text)) direction = 'upstream';
  if (/誰(?:向|跟).{0,30}(?:買|採購)|\b(?:who|which companies|what companies) (?:buys?|bought|purchases?) from\b/.test(text)) direction = 'downstream';
  const intent = categories[0] ? 'competition' : categories[1] && !askedShipping ? 'cooperation' : direction === 'downstream' || askedEndCustomer ? 'customers' : 'supply';
  const proof = inferred.test(text) ? 'inferred' : official.test(text) ? 'official' : 'all';
  return { intent, direction, askedShipping, askedEndCustomer, proof, industry };
}

function explicitlyDirectional(text: string) {
  return /供應給|供貨給|賣給|出貨給|交付給|供應.{0,10}給|\b(?:sells?|ships?|suppl(?:y|ies)|deliver(?:s|ed)?)\s+(?:\w+\s+){0,4}to\b/.test(text);
}

function explicitUnknownCounterparty(text: string, mention: Mention, intent: ResearchIntent): string | undefined {
  const after = text.slice(mention.end).replace(/^['’]s\b|^[）)]/, '').trim();
  const before = text.slice(0, mention.start).trim();
  const tail = /^(?:和|與|跟|對|vs\.?\s+|(?:compete(?:s)?\s+|collaborate(?:s|d)?\s+|partner(?:s|ed)?\s+)with\s+|(?:suppl(?:y|ies|ied)|ship(?:s|ped)?|sell(?:s)?|deliver(?:s|ed)?)\s+(?:to\s+)?|(?:buy(?:s)?|bought|purchase(?:s|d)?)\s+from\s+|供應給|出貨給|採購自)\s*(.+)$/.exec(after);
  if (tail) {
    const term = tail[1].replace(/(?:是否|是|有沒有|有無)?(?:直接|間接)?(?:競爭|競品|供應|供貨|採購|出貨|交付|合作)(?:的)?(?:關係|協議)?(?:嗎|呢)?[？?。.!！\s]*$/, '')
      .replace(/(?:嗎|呢|\?|？|!|！|。|\.)+$/, '').trim();
    const generic = /^(?:誰|哪些|哪幾家|什麼公司|哪些公司|上下游|客戶|下游客戶|雲端客戶|終端客戶|誰[有是]|whom|who|anyone|which (?:companies|firms)|its (?:customers?|buyers?)|the cloud(?: customer)?|曾經|有過|是否|了嗎|to)\b/;
    if (term && !generic.test(term) && !/^(?:誰|哪些|哪幾家|什麼|雲端|終端|最終|任何|有沒有|了)/.test(term)) return term;
  }
  if (intent === 'supply' || intent === 'customers') {
    const ownership = /^(.+?)(?:是|為|is (?:an? )?|are (?:the )?)$/.exec(before);
    if (ownership && /^(?:的)?(?:客戶|供應商)|^(?:'s )?(?:customer|supplier)/.test(after) && !/^(?:誰|哪家|哪些|是否|who|what|which companies)\s*$/.test(ownership[1].trim())) {
      return ownership[1].trim();
    }
    const englishOwnership = /^(?:(?:is|are) )?(.+?) (?:an? )?(?:customer|supplier|buyer|client) of$/.exec(before);
    if (englishOwnership && !/^(?:who|what|which companies|which firms)$/.test(englishOwnership[1])) return englishOwnership[1];
    const chineseLead = /^(.+?)(?:有沒有|有|曾)?(?:供應|供貨|出貨|交付)(?:給)?$/.exec(before);
    if (chineseLead && !/^(?:誰|哪家|哪些|是否|有誰|有沒有誰)/.test(chineseLead[1])) return chineseLead[1].trim();
    const lead = /^(?:(?:does|did)\s+)?(.+?)\s+(?:suppl(?:y|ies|ied)|ship(?:s|ped)?|deliver(?:s|ed)?)\s+(?:to\s+)?$/.exec(before);
    if (lead && !/^(?:who|what companies|which companies|which firms)$/.test(lead[1])) return lead[1];
  }
  return undefined;
}

export function runQuestion(graph: Graph, input: string, choiceId?: string): QuestionResult {
  if (typeof input !== 'string' || input.length > 300) return { kind: 'unsupported' };
  const text = normalize(input);
  // Parse only words outside matched entity names. For example, a company name may itself contain "Supply".
  const found = companyMentions(graph, text);
  let grammar = text;
  for (const item of [...found].reverse()) grammar = grammar.slice(0, item.start) + ' ' + grammar.slice(item.end);
  const parsed = parse(graph, grammar);
  if (!parsed) return { kind: 'unsupported' };
  const { intent, askedShipping, askedEndCustomer } = parsed;
  const context = { intent, askedShipping, askedEndCustomer };
  if (!found.length) return { kind: 'unknown-entity', ...context };
  const unique = found.filter((mention, index) => mention.candidates.length !== 1 ||
    !found.slice(0, index).some(other => other.candidates.length === 1 && mention.candidates[0].id === other.candidates[0].id));
  if (unique.length > 2 || (unique.length === 2 && /\bor\b|或者|或是|以及/.test(text.slice(unique[0].end, unique[1].start)))) {
    return { kind: 'unsupported', ...context };
  }
  const ambiguous = unique.filter(mention => mention.candidates.length > 1);
  if (ambiguous.length > 1) return { kind: 'unsupported', ...context };
  for (const mention of unique) {
    if (!mention.candidates.length) return { kind: 'unknown-entity', ...context, unknownTerm: text.slice(mention.start, mention.end) };
    if (mention.candidates.length > 1 && !mention.candidates.some(node => node.id === choiceId)) {
      return { kind: 'ambiguous', ...context, choices: mention.candidates };
    }
  }
  const entityOf = (mention: Mention) => mention.candidates.find(node => node.id === choiceId) || mention.candidates[0];
  const entity = entityOf(unique[0]);
  const matchedCounterparty = unique[1] ? entityOf(unique[1]) : undefined;
  if (!matchedCounterparty && !askedEndCustomer) {
    const unknownTerm = explicitUnknownCounterparty(text, unique[0], intent);
    if (unknownTerm) return { kind: 'unknown-entity', ...context, entity, unknownTerm };
  }
  let direction = parsed.direction;
  if (intent === 'supply' || intent === 'customers') {
    if (matchedCounterparty) {
      const between = text.slice(unique[0].end, unique[1].start);
      const afterSecond = text.slice(unique[1].end);
      if (explicitlyDirectional(between)) direction = 'downstream';
      else if (/^(?:是不是|是否是|是|為)\s*$/.test(between.trim()) && /^(?:的)?\s*客戶/.test(afterSecond)) direction = 'upstream';
      else if (/^(?:是不是|是否是|是|為)\s*$/.test(between.trim()) && /^(?:的)?\s*供應商/.test(afterSecond)) direction = 'downstream';
      else if (/\bcustomer of\s*$/.test(between)) direction = 'upstream';
      else if (/\bsupplier of\s*$/.test(between)) direction = 'downstream';
    }
    else if (!matchedCounterparty && /\b(?:suppl(?:y|ies)|ship(?:s|ped)?|deliver(?:s|ed)?)\b|供應|交付|出貨/.test(grammar)) {
      const before = text.slice(0, unique[0].start);
      const after = text.slice(unique[0].end);
      if (/誰.{0,18}(供應|出貨|交付)|\b(?:suppl(?:y|ies)|ship(?:s|ped)?|deliver(?:s|ed)?)\s*(?:to\s*)?$/.test(before)) direction = 'upstream';
      else if (!direction && /供應給|供應誰|賣給|出貨給|交付給|\b(?:suppl(?:y|ies)|ships?|delivers?)\b/.test(after)) direction = 'downstream';
    }
  }
  return answerResolved(graph, entity, { ...parsed, intent: direction === 'upstream' && intent === 'customers' ? 'supply' : intent, direction }, matchedCounterparty);
}

function exactCompanies(graph: Graph, text: string, manualId: boolean): NodeRecord[] {
  if (manualId) {
    const selected = graph.nodes.find(node => node.id === text && node.type === 'Company' && node.verification_status !== 'rejected');
    if (selected) return [selected];
  }
  const term = normalize(text);
  return graph.nodes.filter(node => node.type === 'Company' && node.verification_status !== 'rejected' && rankEntity(node, term) === 0);
}

const validTerm = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 140;

/** Resolve a manual selection or a schema-validated parser output. A model never supplies IDs or claims. */
export function runTypedQuestion(graph: Graph, question: TypedQuestion, choiceId?: string, originalInput?: string): QuestionResult {
  if (!question || typeof question !== 'object' || !validTerm(question.entity) ||
      (question.counterparty !== undefined && !validTerm(question.counterparty)) ||
      !['competition', 'supply', 'customers', 'cooperation'].includes(question.intent) ||
      (question.direction !== undefined && !['upstream', 'downstream'].includes(question.direction)) ||
      (question.proof !== undefined && !['all', 'official', 'inferred'].includes(question.proof)) ||
      (question.verifiedDelivery !== undefined && typeof question.verifiedDelivery !== 'boolean') ||
      (question.market !== undefined && !validTerm(question.market)) ||
      (question.askedEndCustomer !== undefined && typeof question.askedEndCustomer !== 'boolean')) return { kind: 'unsupported' };

  let parsed: Parsed = {
    intent: question.intent, direction: question.direction, proof: question.proof || 'all',
    askedShipping: question.verifiedDelivery === true, askedEndCustomer: question.askedEndCustomer === true,
  };
  const terms = [question.entity, ...(question.counterparty ? [question.counterparty] : [])];
  const candidates = terms.map(term => exactCompanies(graph, term, originalInput === undefined));
  if (originalInput !== undefined) {
    if (typeof originalInput !== 'string' || originalInput.length > 300) return { kind: 'unsupported' };
    const text = normalize(originalInput);
    const industry = marketScope(graph, text);
    if (!text || outOfScope.test(text) || unsupportedModifiers.test(text) || industry === null || (!industry && unsupportedProductOrGeography.test(text)) ||
        hasUnsupportedConstraint(text, endCustomer.test(text), shipping.test(text))) return { kind: 'unsupported' };
    if (question.market && (!industry || marketScope(graph, normalize(question.market)) !== industry)) return { kind: 'unsupported' };
    const deterministic = runQuestion(graph, originalInput, choiceId);
    if (deterministic.kind !== 'unsupported') return deterministic;

    const mentions = companyMentions(graph, text);
    if (mentions.some(mention => !mention.candidates.length)) {
      const unknown = mentions.find(mention => !mention.candidates.length)!;
      return { kind: 'unknown-entity', intent: parsed.intent, unknownTerm: text.slice(unknown.start, unknown.end) };
    }
    // A model may parse phrasing, but may not insert entities absent from the input,
    // ignore an explicit second entity, or select an ambiguous alias on the user's behalf.
    const mentionIds = mentions.map(mention => new Set(mention.candidates.map(node => node.id)));
    for (let index = 0; index < terms.length; index++) {
      const matching = mentionIds.filter(ids => candidates[index].some(node => ids.has(node.id)));
      if (!matching.length) {
        if (!text.includes(normalize(terms[index]))) return { kind: 'unsupported' };
        return { kind: 'unknown-entity', intent: parsed.intent, unknownTerm: terms[index] };
      }
      const sourced = new Set(matching.flatMap(ids => [...ids]));
      candidates[index] = graph.nodes.filter(node => sourced.has(node.id));
    }
    if (mentionIds.some(ids => !candidates.some(nodes => nodes.some(node => ids.has(node.id))))) {
      return { kind: 'unsupported' };
    }
    if (mentions.length > 2 || [competition.test(text), cooperation.test(text), upstream.test(text) || downstream.test(text) || supply.test(text)].filter(Boolean).length > 1) {
      return { kind: 'unsupported' };
    }
    parsed = {
      ...parsed,
      industry,
      proof: official.test(text) ? 'official' : inferred.test(text) ? 'inferred' : parsed.proof,
      askedShipping: parsed.askedShipping || shipping.test(text),
      askedEndCustomer: parsed.askedEndCustomer || endCustomer.test(text),
    };
  }
  if ((parsed.direction || parsed.askedShipping || parsed.askedEndCustomer) && !['supply', 'customers'].includes(parsed.intent)) {
    return { kind: 'unsupported' };
  }
  if (parsed.intent === 'customers' && parsed.direction === 'upstream') return { kind: 'unsupported' };
  const context = { intent: parsed.intent, askedShipping: parsed.askedShipping, askedEndCustomer: parsed.askedEndCustomer };
  for (let index = 0; index < candidates.length; index++) {
    if (!candidates[index].length) return { kind: 'unknown-entity', ...context, unknownTerm: terms[index] };
  }
  if (candidates.filter(nodes => nodes.length > 1).length > 1) return { kind: 'unsupported', ...context };
  const ambiguous = candidates.find(nodes => nodes.length > 1 && !nodes.some(node => node.id === choiceId));
  if (ambiguous) return { kind: 'ambiguous', ...context, choices: ambiguous };
  const [entity, matchedCounterparty] = candidates.map(nodes => nodes.find(node => node.id === choiceId) || nodes[0]);
  if (matchedCounterparty?.id === entity.id) return { kind: 'unsupported', ...context };
  return answerResolved(graph, entity, parsed, matchedCounterparty);
}

function answerResolved(graph: Graph, entity: NodeRecord, parsed: Parsed, matchedCounterparty?: NodeRecord): QuestionResult {
  const { intent, direction, askedShipping, askedEndCustomer } = parsed;
  const context = { intent, askedShipping, askedEndCustomer };
  const query = {
    ...emptyResearchQuery, industry: parsed.industry || '*', company: entity.id, intent,
    proof: parsed.proof, direction, counterparty: matchedCounterparty?.id, verifiedDelivery: askedShipping,
  } satisfies ResearchQuery;
  const base = { ...context, entity, query, matchedCounterparty };
  const projected = withCompetitionProjections(graph);
  if (askedEndCustomer) {
    // This exact issuer release says a leading cloud infrastructure customer qualified the
    // platform for deployment, but does not name it. SILITH is only the direct wafer recipient.
    if (entity.id === umcId && !matchedCounterparty && !parsed.industry && parsed.proof !== 'inferred') {
      const research = computeResearch(projected, { ...query, direction: 'downstream', counterparty: silithId, verifiedDelivery: true });
      const endCustomerEvidence = research.rows.find(row => row.subject.id === umcId && row.object.id === silithId)
        ?.sources.find(source => source.verification_status === 'officially_disclosed' && source.url === umcRelease);
      if (endCustomerEvidence) return { kind: 'unnamed-end-customer', ...base, research, endCustomerEvidence };
    }
    return { kind: 'not-recorded', ...base };
  }
  const research = computeResearch(projected, query);
  if (research.rows.length) return { kind: 'answer', ...base, research };
  if (query.proof !== 'all' || query.verifiedDelivery) {
    const unfiltered = computeResearch(projected, { ...query, proof: 'all', verifiedDelivery: false });
    if (unfiltered.rows.length) return { kind: 'filtered', ...base, research: unfiltered };
  }
  return { kind: 'not-recorded', ...base, research };
}
