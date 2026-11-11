import { parseDocument, visit } from 'yaml';
import { isReportId } from './etf-contract.ts';

export const MARKDOWN_PARSER_VERSION = '1.0.0';
export const MAX_MARKDOWN_SOURCE_BYTES = 512 * 1024;
export const MAX_MARKDOWN_EXPANDED_BYTES = 4 * 1024 * 1024;
export type MarkdownIssue = { path: string; message: string; code: string };
export type MarkdownRecord = Record<string, any>;
export type MarkdownVisualization = {
  id: string; title: string; purpose: string; suggestedChart: string;
  shape: MarkdownRecord; rows: unknown[][]; sourceIds: string[];
  metadata: MarkdownRecord; records: MarkdownRecord[];
};
export type MarkdownReport = {
  format: 'etf-markdown' | 'etf-json' | 'institutional-json'; institutionalData?: MarkdownRecord; companionHtml?: string; analysis?: import('./etf-analysis.ts').EtfAnalysis; rawJson?: string; storageSchemaVersion: 3; parserVersion: string;
  sourceHash: string; rawMarkdown: string; sourceBytes: number; expandedBytes: number;
  id: string; title: string; excerpt: string; period: { start: string; end: string };
  evidenceDate: string; frontmatter: MarkdownRecord; articleMarkdown: string;
  shared: MarkdownRecord; visualizations: MarkdownVisualization[]; warnings: MarkdownIssue[];
};
export type MarkdownValidation = { report: MarkdownReport | null; errors: MarkdownIssue[]; warnings: MarkdownIssue[] };
export type MarkdownEntry = {
  id: string; draft: MarkdownReport; revision: number; updatedAt: string;
  archived?: boolean;
  cover?: import('./etf-cover.ts').EtfCoverDescriptor | null;
  publishedVersion: number; publishedAt: string | null; hasUnpublishedChanges: boolean;
  reviewedRevision: number | null; reviewHash: string | null;
};
export type MarkdownListItem = Omit<MarkdownEntry, 'draft'> & { title: string; sourceHash: string; researchDate: string; dataStatus: string };
export type MarkdownSaveInput = { rawMarkdown?: string; rawSource?: string; baseRevision: number; requestId: string; cover?: import('./etf-cover.ts').EtfCoverInput | null };
export type MarkdownReviewInput = { id: string; baseRevision: number; sourceHash: string; requestId: string };
export type MarkdownPublishInput = { id: string; baseRevision: number; expectedPublishedVersion: number; reviewHash: string; reviewed: true; requestId: string };
export function isMarkdownReport(value: unknown): value is MarkdownReport {
  return !!value && typeof value === 'object' && ['etf-markdown', 'etf-json'].includes((value as MarkdownReport).format);
}
export async function markdownHash(raw: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
}
export class InvalidMarkdown extends Error {
  constructor(readonly issue: MarkdownIssue) { super(issue.message); }
}
export const invalid = (path: string, message: string, code = 'invalid_contract'): never => { throw new InvalidMarkdown({ path, message, code }); };
export const object = (v: unknown, path: string): MarkdownRecord => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) invalid(path, '需要 JSON 物件。');
  return v as MarkdownRecord;
};
export const array = (v: unknown, path: string): any[] => { if (!Array.isArray(v)) invalid(path, '需要陣列。'); return v as any[]; };
const validDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const date = (v: unknown, path: string) => { if (!validDate(v)) invalid(path, '需要有效 YYYY-MM-DD 日期。'); };
function isoWeek(start: string): string {
  const monday=new Date(start),thursday=new Date(monday.getTime()+3*86400000),year=thursday.getUTCFullYear();
  const jan4=new Date(Date.UTC(year,0,4)),firstMonday=jan4.getTime()-((jan4.getUTCDay()+6)%7)*86400000;
  return year+'-W'+String(1+Math.round((monday.getTime()-firstMonday)/(7*86400000))).padStart(2,'0');
}
function numericContext(value: unknown,path:string,nonnegative=false) {
  if(value!==null && (typeof value!=='number'||!Number.isFinite(value)||nonnegative&&value<0)) invalid(path,'背景數值須為有限數值或 null。');
}
const safeKeys = new Set(['__proto__', 'prototype', 'constructor']);
export function isSafeMarkdownUrl(value: string): boolean {
  if (value.startsWith('#')) return /^#[A-Za-z0-9_-]+$/.test(value);
  try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password; } catch { return false; }
}
function checkTree(value: unknown, path: string, depth = 0) {
  if (depth > 40) invalid(path, '資料巢狀層級過深。');
  if (typeof value === 'number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))) invalid(path, '數值必須有限且整數不可超出安全精度。');
  if (typeof value === 'string' && /<\s*\/?\s*(?:script|iframe|object|embed|svg|math|style|link|meta)\b/i.test(value)) invalid(path,'不接受主動 HTML 內容。','unsafe_content');
  if (typeof value === 'string' && /(?:^|_)(?:url|uri)$/.test(path.split('.').at(-1) || '') && !isSafeMarkdownUrl(value)) invalid(path, '來源連結只接受無憑證的 HTTP／HTTPS。', 'unsafe_url');
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    if (safeKeys.has(key)) invalid(path + '.' + key, '不安全的物件鍵。', 'unsafe_key');
    checkTree(child, path + '.' + key, depth + 1);
  }
}
export function parseJson(raw: string, path: string): any {
  let result: unknown;
  try { result = JSON.parse(raw); } catch { return invalid(path, 'JSON 語法錯誤。', 'invalid_json'); }
  const doc = parseDocument(raw, { schema: 'json', uniqueKeys: true });
  if (doc.errors.length) invalid(path, doc.errors[0].message, 'duplicate_json_key');
  checkTree(result, path); return result;
}
function jsonBlocks(raw: string, expected: number, path: string): any[] {
  const matches = [...raw.matchAll(/^```json\s*\n([\s\S]*?)\n```\s*$/gm)];
  if (matches.length !== expected) invalid(path, `需要 ${expected} 個完整 JSON 區塊。`);
  return matches.map((m, i) => parseJson(m[1], path + '.json[' + i + ']'));
}
function normalizeHeadings(raw: string): string {
  const names: Record<string, string> = { '重點分析':'Summary Analysis', '配置圖表':'Dashboard', '共用資料':'Shared Data', '用途':'Purpose', '建議圖形':'Suggested Chart', '資料結構':'Data Shape', '實際資料':'Data', '資料來源':'Sources' };
  return raw.replace(/^(#{2,4}) (.+)$/gm, (_s, h, n) => h + ' ' + (names[n] || n)).replace(/^### 圖表 (\d+)/gm, '### Visualization $1');
}
function typed(value: any, kind: any): boolean {
  if (typeof kind !== 'string') return false;
  if (kind.endsWith('?')) return value === null || typed(value, kind.slice(0, -1));
  return kind === 'null' ? value === null : kind === 'string' ? typeof value === 'string' : kind === 'boolean' ? typeof value === 'boolean' : kind === 'integer' ? Number.isSafeInteger(value) : kind === 'number' ? typeof value === 'number' && Number.isFinite(value) : kind === 'source_set' ? Number.isSafeInteger(value) && value >= 0 : false;
}
const commonRequired = ['etf_code','etf_name','industry_code','industry_name','data_status','missing_reason','source_ids'];
const amountRequired = ['increase_value_estimate_twd','decrease_value_estimate_twd','net_value_estimate_twd','baseline_weight_pct','current_weight_pct','delta_weight_pp','increased_stock_count','decreased_stock_count'];
const required: Record<string, string[]> = {
  industry_allocation_changes: [...commonRequired,...amountRequired,'research_date','baseline_date','price_date','method'],
  stock_holding_changes: [...commonRequired,'research_date','baseline_date','stock_code','stock_name','baseline_shares','current_shares','delta_shares','baseline_weight_pct','current_weight_pct','delta_weight_pp','price_date','close_price_twd','delta_value_estimate_twd','unit_adjusted_change_pct','holding_state'],
  weekly_industry_allocation_trend: [...commonRequired,...amountRequired,'period_id'],
};
export function sources(value: unknown, registry: MarkdownRecord, path: string): string[] {
  const ids = array(value, path);
  if (new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !Object.hasOwn(registry, id))) invalid(path, '來源 ID 重複或不存在。');
  return ids;
}
const amountBases = new Set(['research_estimate', 'provider_estimate']);
function validateEstimateMethod(value: unknown, basis: string, path: string) {
  if(value === undefined || value === null) return;
  if(typeof value !== 'string' || !value.trim()) invalid(path,'估值方法必須為非空文字。');
  const method=value as string;
  if(/(?:^|_)(?:actual|transaction|trade|traded|cashflow|cash_flow|net_flow|net_subscription|net_redemption)(?:_|$)/i.test(method)) invalid(path,'持股變動估值不能宣稱實際成交、現金流或淨申贖。','mixed_amount_basis');
  if((method==='provider_estimate' || method==='provider_reported_estimate') && basis!=='provider_estimate' || (method==='research_estimate' || method==='share_delta_times_close' || method==='week_end_share_delta_times_close') && basis!=='research_estimate') invalid(path,'估值方法與圖表口徑不符。','mixed_amount_basis');
}
export function validateRows(shape: MarkdownRecord, rows: unknown[][], shared: MarkdownRecord, ids: string[], path: string): { metadata: MarkdownRecord; records: MarkdownRecord[] } {
  if (Object.keys(shape).sort().join(',') !== 'columns,constants,lookups,metadata,visualization_id') invalid(path, '資料結構必須含固定五個欄位。');
  const vid = shape.visualization_id;
  if (!Object.hasOwn(required, vid)) invalid(path + '.visualization_id', '未知圖表識別碼。');
  const columns = array(shape.columns,path+'.columns'); const constants = object(shape.constants,path+'.constants'); const lookups = object(shape.lookups,path+'.lookups');
  const metadata = { ...shared.metadata, ...object(shape.metadata,path+'.metadata') };
  if(!amountBases.has(metadata.amount_basis)) invalid(path+'.metadata.amount_basis','每項圖表必須明示 research_estimate 或 provider_estimate。','mixed_amount_basis');
  if(shape.metadata.amount_basis!==undefined && shape.metadata.amount_basis!==shared.metadata.amount_basis && shared.metadata.amount_formula!==undefined && !Object.hasOwn(shape.metadata,'amount_formula')) invalid(path+'.metadata.amount_formula','圖表口徑不同時需另列公式；方法未知請明示 null，不可繼承另一口徑公式。','mixed_amount_basis');
  validateEstimateMethod(metadata.method,metadata.amount_basis,path+'.metadata.method');
  validateEstimateMethod(metadata.amount_formula,metadata.amount_basis,path+'.metadata.amount_formula');
  const methods=new Set<string>();
  const names = columns.map((c,i) => {
    if (!Array.isArray(c) || c.length !== 2 || typeof c[0] !== 'string' || !/^[a-z][a-z0-9_]*$/.test(c[0]) || !/^(string|integer|number|boolean|null|source_set)\??$/.test(c[1])) invalid(path+'.columns['+i+']','欄位名稱或型別錯誤。');
    return c[0];
  });
  const all = [...names,...Object.keys(constants),...Object.keys(lookups)];
  if (new Set(all).size !== all.length || all.some(n=>safeKeys.has(n))) invalid(path,'欄名重複、重疊或不安全。');
  if (required[vid].some(f=>!all.includes(f))) invalid(path,'缺少必要欄位：'+required[vid].filter(f=>!all.includes(f)).join(', '));
  if (!Number.isSafeInteger(metadata.record_count) || metadata.record_count !== rows.length || !Number.isSafeInteger(metadata.expected_record_count) || metadata.expected_record_count < rows.length) invalid(path+'.metadata.record_count','實際／預期筆數不符。');
  if (metadata.data_status === 'complete' && metadata.expected_record_count !== rows.length) invalid(path+'.metadata.expected_record_count','完整資料的預期與實際筆數必須一致。');
  if (!rows.length && !metadata.missing_reason && !metadata.unavailable_reason) invalid(path,'空圖表必須說明 unavailable 原因。');
  const grain = vid === 'weekly_industry_allocation_trend' ? ['period_id','etf_code','industry_code'] : ['research_date','baseline_date','etf_code',vid === 'stock_holding_changes' ? 'stock_code':'industry_code'];
  if (JSON.stringify(metadata.row_grain) !== JSON.stringify(grain)) invalid(path+'.metadata.row_grain','圖表粒度不符。');
  const seen = new Set<string>(); let decodedByteBudget=0;
  const records = rows.map((row,i)=> {
    const rp = path+'.rows['+i+']';
    if (!Array.isArray(row) || row.length !== columns.length) invalid(rp,'列寬與 columns 不符。');
    const record: MarkdownRecord = { ...constants };
    columns.forEach(([field,kind],j)=> {
      if (!typed(row[j],kind)) invalid(rp+'.'+field,'欄位型別錯誤。');
      if (kind === 'source_set') {
        if (field !== 'source_ids' || row[j] as number >= shared.source_sets.length) invalid(rp+'.'+field,'來源集合索引越界。');
        record[field] = [...shared.source_sets[row[j] as number]];
      } else record[field] = row[j];
    });
    for (const [field, spec] of Object.entries(lookups)) {
      if (!Array.isArray(spec) || spec.length !== 2 || spec.some(x=>typeof x!=='string')) invalid(path+'.lookups.'+field,'查找定義錯誤。');
      const dictionary = object(shared.dictionaries[spec[1]],path+'.lookups.'+field);
      if (!Object.hasOwn(dictionary,record[spec[0]])) invalid(rp+'.'+field,'名稱字典鍵不存在。');
      record[field] = dictionary[record[spec[0]]];
    }
    if(Object.hasOwn(record,'amount_basis') && record.amount_basis!==metadata.amount_basis) invalid(rp+'.amount_basis','單一圖表不能混合不同估值口徑。','mixed_amount_basis');
    validateEstimateMethod(record.method,metadata.amount_basis,rp+'.method');
    if(record.method!==undefined && record.method!==null) {
      if(metadata.method!==undefined && metadata.method!==null && record.method!==metadata.method) invalid(rp+'.method','資料列方法與圖表方法不符。','mixed_amount_basis');
      methods.add(record.method);
      if(methods.size>1) invalid(rp+'.method','單一圖表不能合計不同估值方法。','mixed_amount_basis');
    }
    sources(record.source_ids,shared.source_registry,rp+'.source_ids').forEach(id=> { if(!ids.includes(id)) invalid(rp+'.source_ids','資料列來源未列於圖表來源。'); });
    for (const f of required[vid]) {
      const v = record[f];
      const nullable = !['etf_code','etf_name','industry_code','industry_name','stock_code','stock_name','research_date','baseline_date','period_id','data_status','holding_state','source_ids','method'].includes(f);
      if (v === null && nullable) continue;
      if (/(?:_twd|_shares|_pct|_pp|_count)$/.test(f) && (typeof v !== 'number' || !Number.isFinite(v) || /(?:_shares|_count)$/.test(f) && !Number.isSafeInteger(v))) invalid(rp+'.'+f,'必要數值欄位型別不符。');
      if (f.endsWith('_date')) date(v,rp+'.'+f);
      if (['_name','_code'].some(suffix=>f.endsWith(suffix)) || ['method','period_id','missing_reason'].includes(f)) { if(typeof v!=='string'||!v) invalid(rp+'.'+f,'文字欄位必須為非空字串。'); }
      if (f.endsWith('_code') && (typeof v !== 'string' || !v)) invalid(rp+'.'+f,'代碼必須為非空字串。');
    }
    if (!shared.metadata.etf_codes.includes(record.etf_code)) invalid(rp+'.etf_code','基金不在固定樣本中。');
    if (record.research_date !== undefined && (record.research_date !== shared.metadata.research_date || record.baseline_date !== shared.metadata.baseline_date)) invalid(rp,'資料列比較日期與報告不同。');
    if (!['complete','partial','unavailable'].includes(record.data_status)) invalid(rp+'.data_status','資料狀態錯誤。');
    if (record.data_status !== 'complete' && !record.missing_reason) invalid(rp+'.missing_reason','部分／不可用資料須說明缺口。');
    if (vid === 'stock_holding_changes') {
      if (!['held','entered','exited','not_held','unknown'].includes(record.holding_state)) invalid(rp+'.holding_state','持股狀態錯誤。');
      if(record.holding_state === 'not_held' && [record.baseline_shares,record.current_shares,record.delta_shares].some(v=>v!==0)) invalid(rp,'not_held 必須兩端已確認為零。');
      if(record.holding_state==='entered' && !(record.baseline_shares===0 && typeof record.current_shares==='number' && record.current_shares>0) || record.holding_state==='exited' && !(typeof record.baseline_shares==='number' && record.baseline_shares>0 && record.current_shares===0) || record.holding_state==='held' && !(typeof record.baseline_shares==='number' && record.baseline_shares>0 && typeof record.current_shares==='number' && record.current_shares>0)) invalid(rp+'.holding_state','持股狀態與兩端股數不一致。');
      if(record.holding_state === 'unknown' && record.data_status === 'complete') invalid(rp,'未知持股不能宣稱完整。');
      if(typeof record.baseline_shares==='number' && typeof record.current_shares==='number' && record.delta_shares !== null && record.current_shares-record.baseline_shares!==record.delta_shares) invalid(rp+'.delta_shares','股數差與端點不符。');
      if(record.baseline_shares===0 && record.unit_adjusted_change_pct!==null) invalid(rp+'.unit_adjusted_change_pct','基期為零時每單位變化不適用。');
    } else {
      const a=record.increase_value_estimate_twd,b=record.decrease_value_estimate_twd,n=record.net_value_estimate_twd;
      if(a!==null && a<0 || b!==null && b>0) invalid(rp,'增加／減少估值正負號錯誤。');
      if([a,b,n].every(v=>typeof v==='number') && Math.abs(a+b-n)>Math.max(0.01,Math.abs(n)*1e-10)) invalid(rp,'淨估值不等於正負兩側合計。');
    }
    for(const [k,v] of Object.entries(record)) if(v!==null && typeof v==='number') {
      if(/^(baseline|current)_weight_pct$/.test(k) && (v<0||v>100) || /^(baseline|current)_shares$|_stock_count$|^close_price_twd$/.test(k) && v<0) invalid(rp+'.'+k,'數值超出合法範圍。');
    }
    decodedByteBudget+=new TextEncoder().encode(JSON.stringify(record)).byteLength;
    if(decodedByteBudget>MAX_MARKDOWN_EXPANDED_BYTES) invalid(path,'展開資料超過 4 MiB；請保留來源並縮減後重試。','expanded_too_large');
    const key=JSON.stringify(grain.map(k=>record[k])); if(seen.has(key)) invalid(rp,'圖表粒度鍵重複。'); seen.add(key);
    return record;
  });
  return {metadata,records};
}
export async function parseEtfMarkdown(raw: unknown): Promise<MarkdownValidation> {
  const warnings: MarkdownIssue[] = [];
  try {
    if(typeof raw!=='string') invalid('source','需要 Markdown 文字。');
    const original = raw as string; const sourceBytes=new TextEncoder().encode(original).byteLength;
    if(sourceBytes>MAX_MARKDOWN_SOURCE_BYTES) invalid('source','Markdown 超過 512 KiB；請保留來源並縮減後重試，不會截斷。','source_too_large');
    const normalized=original.replace(/\r\n/g,'\n');
    if(normalized.includes('\0')) invalid('source','文字含無效字元。');
    const front=normalized.match(/^---\n([\s\S]*?)\n---\n/); if(!front) invalid('frontmatter','缺少 YAML 前置資料。');
    const yaml=parseDocument(front![1],{schema:'core',uniqueKeys:true});
    visit(yaml,(_key,node:any)=> { if(node?.tag || node?.anchor || node?.constructor?.name==='Alias') invalid('frontmatter','YAML 不接受標籤、錨點或別名。'); });
    if(yaml.errors.length || yaml.warnings.length) invalid('frontmatter',yaml.errors[0]?.message||yaml.warnings[0].message,'invalid_yaml');
    const fm=object(yaml.toJS({maxAliasCount:0}),'frontmatter'); checkTree(fm,'frontmatter');
    validateResearchMetadata(fm);
    const rest=normalized.slice(front![0].length); const h1=[...rest.matchAll(/^# (.+)$/gm)];
    if(h1.length!==1) invalid('title','需要唯一 H1 標題。');
    const headings=[...normalizeHeadings(rest).matchAll(/^## (.+)$/gm)];
    if(headings.length!==2||headings[0][1]!=='Summary Analysis'||headings[1][1]!=='Dashboard') invalid('sections','需要依序為重點分析、配置圖表兩個 H2。');
    const norm=normalizeHeadings(rest);
    // Heading translations differ in length: extract article from the unmodified source.
    const originalH2=[...rest.matchAll(/^## (.+)$/gm)];
    const articleMarkdown=rest.slice(originalH2[0].index!+originalH2[0][0].length,originalH2[1].index).trim();
    const safeProse=rest.replace(/^```json\s*\n[\s\S]*?\n```\s*$/gm,'').replace(/<a id="[A-Za-z][A-Za-z0-9_-]*"><\/a>/g,'');
    if(/<\/?[A-Za-z!][^>]*>/.test(safeProse)||/!\[/.test(safeProse)) invalid('article','不接受 HTML 或內嵌影像。','unsafe_content');
    for(const m of safeProse.matchAll(/\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^\n]*["'])?\s*\)/g)) if(!isSafeMarkdownUrl(m[1])) invalid('article.links','連結協定不安全。','unsafe_url');
    for(const m of safeProse.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm)) if(!isSafeMarkdownUrl(m[1])) invalid('article.links','引用連結協定不安全。','unsafe_url');
    if(!articleMarkdown) invalid('article','重點分析不可空白。');
    for(const name of ['關鍵數據','操作方向與原因','跟進條件','週度背景']) if(!articleMarkdown.includes('### '+name)) warnings.push({path:'article',message:'原文缺少「'+name+'」小標，保留全文，請作者檢查閱讀排版。',code:'missing_reading_heading'});
    const pieces=norm.slice(norm.indexOf('## Dashboard\n')+'## Dashboard\n'.length).split(/^### /m);
    if(pieces.length!==5||!pieces[1].startsWith('Shared Data\n')) invalid('dashboard','需要共用資料及三項圖表。');
    const shared=object(jsonBlocks(pieces[1],1,'shared')[0],'shared');
    const periodIds=validateResearchShared(fm,shared);
    const visualizations: MarkdownVisualization[]=[];const seen=new Set<string>();
    for(const [i,piece] of pieces.slice(2).entries()) {
      if(!piece.startsWith('Visualization ')) invalid('dashboard','未知圖表章節。');
      const order=[...piece.matchAll(/^#### (.+)$/gm)].map(m=>m[1]);
      if(JSON.stringify(order)!==JSON.stringify(['Purpose','Suggested Chart','Data Shape','Data','Sources'])) invalid('visualizations['+i+']','圖表需要依序五個 H4。');
      const [shapeValue,rowsValue,sourceValue]=jsonBlocks(piece,3,'visualizations['+i+']');const shape=object(shapeValue,'shape');const rows=array(rowsValue,'rows');
      const ids=sources(object(sourceValue,'sources').source_ids,shared.source_registry,'visualizations['+i+'].sources');
      const expanded=validateRows(shape,rows,shared,ids,'visualizations['+i+']');
      if(seen.has(shape.visualization_id)) invalid('dashboard','圖表識別碼重複。'); seen.add(shape.visualization_id);
      if(shape.visualization_id==='weekly_industry_allocation_trend'&&expanded.records.some(r=>!periodIds.has(r.period_id))) invalid('weekly','資料列週期間不存在。');
      const sections=piece.split(/^#### /m);
      visualizations.push({id:shape.visualization_id,title:piece.split('\n')[0].replace(/^Visualization \d+[:：]?\s*/,''),purpose:sections[1].replace(/^Purpose\n/,'').trim(),suggestedChart:sections[2].replace(/^Suggested Chart\n/,'').trim(),shape,rows,sourceIds:ids,...expanded});
    }
    if(Object.keys(required).some(id=>!seen.has(id))) invalid('dashboard','缺少必要圖表。');
    if(fm.data_status!=='complete') warnings.push({path:'frontmatter.data_status',code:'partial_coverage',message:'報告為部分覆蓋／不可用，請審閱原文、資料缺口與估值界線。'});
    if(shared.weekly_periods.filter((p:any)=>p.complete).length<2) warnings.push({path:'weekly',code:'insufficient_complete_weeks',message:'完整可比週少於兩週，不足以主張趨勢。'});
    const expandedBytes=new TextEncoder().encode(JSON.stringify({shared,visualizations})).byteLength;
    if(expandedBytes>MAX_MARKDOWN_EXPANDED_BYTES) invalid('dashboard','展開資料超過 4 MiB；請縮減來源後重試，不會截斷。','expanded_too_large');
    const title=typeof fm.article_title==='string'&&fm.article_title.trim()?fm.article_title.trim():h1[0][1];
    const excerpt=articleMarkdown.split(/\n\s*\n/)[0].replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*#_]/g,'').slice(0,280);
    return {report:{format:'etf-markdown',storageSchemaVersion:3,parserVersion:MARKDOWN_PARSER_VERSION,sourceHash:await markdownHash(original),rawMarkdown:original,sourceBytes,expandedBytes,id:fm.report_id,title,excerpt,period:{start:fm.baseline_date,end:fm.research_date},evidenceDate:fm.data_checked_date,frontmatter:fm,articleMarkdown,shared,visualizations,warnings},errors:[],warnings};
  } catch(caught) {
    const issue=caught instanceof InvalidMarkdown?caught.issue:{path:'source',message:'無法解析 Markdown，請檢查格式。',code:'parse_error'};
    return {report:null,errors:[issue],warnings};
  }
}

export function validateResearchMetadata(fm: MarkdownRecord, version = '4.0.0') {
    for(const k of ['research_date','baseline_date','data_checked_date']) date(fm[k],'frontmatter.'+k);
    if(fm.baseline_date>=fm.research_date||fm.data_checked_date<fm.research_date) invalid('frontmatter','比較日需早於研究日，補查日不可早於研究日。');
    if(fm.schema_version!==version) invalid('frontmatter.schema_version','不支援的資料版本。','unsupported_version');
    if(!isReportId(fm.report_id)) invalid('frontmatter.report_id','報告 ID 格式錯誤。');
    if(fm.timezone!=='Asia/Taipei' || !['complete','partial','unavailable'].includes(fm.data_status)) invalid('frontmatter','時區或資料狀態錯誤。');
    if(!Array.isArray(fm.etf_codes)||!fm.etf_codes.length||fm.etf_codes.some((x:any)=>typeof x!=='string'||!x)||new Set(fm.etf_codes).size!==fm.etf_codes.length) invalid('frontmatter.etf_codes','基金樣本需為唯一代碼字串。');
}

export function validateResearchShared(fm: MarkdownRecord, shared: MarkdownRecord) {
    if(shared.schema_version!=='4.0.0') invalid('shared.schema_version','共用資料版本不支援。');
    for(const field of ['metadata','dictionaries','source_registry','contract']) object(shared[field],'shared.'+field);
    for(const field of ['source_sets','fund_context','valuation_context','weekly_periods','weekly_fund_context']) array(shared[field],'shared.'+field);
    for(const k of ['report_id','research_date','baseline_date','data_checked_date','timezone','etf_codes','data_status']) if(JSON.stringify(shared.metadata[k])!==JSON.stringify(fm[k])) invalid('shared.metadata.'+k,'與 YAML 前置資料不一致。');
    for(const [dictionary,entries] of Object.entries(shared.dictionaries)) for(const [key,value] of Object.entries(object(entries,'shared.dictionaries.'+dictionary))) if(typeof value!=='string'||!value||!key) invalid('shared.dictionaries.'+dictionary,'名稱字典必須為代碼對文字。');
    for(const name of ['etfs','stocks','industries']) object(shared.dictionaries[name],'shared.dictionaries.'+name);
    if(!Object.keys(shared.contract).length) invalid('shared.contract','需保留型別、單位與 null 契約。');
    for(const name of ['requested_etf_count','usable_etf_count']) if(shared.metadata[name]!==undefined && (!Number.isSafeInteger(shared.metadata[name])||shared.metadata[name]<0||shared.metadata[name]>fm.etf_codes.length)) invalid('shared.metadata.'+name,'基金覆蓋筆數不符。');
    if(fm.data_status!=='complete' && !shared.metadata.missing_reason && !array(shared.metadata.limitations||[],'shared.metadata.limitations').length) invalid('shared.metadata','部分覆蓋需說明資料限制。');
    if(shared.metadata.currency!==undefined && shared.metadata.currency!=='TWD') invalid('shared.metadata.currency','估值幣別必須為 TWD。');
    if(shared.metadata.amount_basis!==undefined && !['research_estimate','provider_estimate'].includes(shared.metadata.amount_basis)) invalid('shared.metadata.amount_basis','此契約的部位估值不可標為實際交易現金流。');
    for(const [id,value] of Object.entries(shared.source_registry)) {
      const s=object(value,'sources.'+id);
      for(const field of ['source_id','title','url','data_period','published_date','checked_at','checked_date','source_type']) if(!Object.hasOwn(s,field)) invalid('sources.'+id,'缺少來源欄位 '+field);
      if(s.source_id!==id||typeof s.title!=='string'||typeof s.url!=='string'||!isSafeMarkdownUrl(s.url)||typeof s.source_type!=='string') invalid('sources.'+id,'來源識別或連結錯誤。');
      if(s.checked_date!==null) date(s.checked_date,'sources.'+id+'.checked_date');
      if(s.published_date!==null) date(s.published_date,'sources.'+id+'.published_date');
      if(s.checked_at!==null && (typeof s.checked_at!=='string'||!Number.isFinite(Date.parse(s.checked_at)))) invalid('sources.'+id+'.checked_at','來源查核時間格式錯誤。');
      if(s.data_period!==null && typeof s.data_period!=='string') invalid('sources.'+id+'.data_period','來源期間需為文字或 null。');
    }
    shared.source_sets.forEach((ids:any,i:number)=>sources(ids,shared.source_registry,'shared.source_sets['+i+']'));
    const periodIds=new Set<string>();
    shared.weekly_periods.forEach((v:any,i:number)=> {
      const p=object(v,'weekly_periods['+i+']');
      if(typeof p.period_id!=='string'||!/^\d{4}-W\d{2}$/.test(p.period_id)||periodIds.has(p.period_id)) invalid('weekly_periods['+i+']','週期間鍵錯誤或重複。'); periodIds.add(p.period_id);
      for(const f of ['week_start','week_end','baseline_date','observation_end']) date(p[f],'weekly_periods['+i+'].'+f);
      if(typeof p.complete!=='boolean'||p.week_start>p.week_end||p.observation_end>p.week_end||p.baseline_date>=p.observation_end) invalid('weekly_periods['+i+']','週日期／完整性錯誤。');
      if(new Date(p.week_start).getUTCDay()!==1 || new Date(p.week_end).getUTCDay()!==0 || Date.parse(p.week_end)-Date.parse(p.week_start)!==6*86400000 || isoWeek(p.week_start)!==p.period_id || p.baseline_date>=p.week_start || p.observation_end<p.week_start || p.observation_end>fm.research_date) invalid('weekly_periods['+i+']','ISO 週、週端點或研究日界線不符。');
      const expected=array(p.expected_trading_dates,'weekly_periods.expected_trading_dates'),observed=array(p.observed_trading_dates,'weekly_periods.observed_trading_dates');
      for(const d of [...expected,...observed]) date(d,'weekly_periods.trading_dates');
      if(expected.some((d,j)=>d<p.week_start||d>p.week_end||j>0&&d<=expected[j-1])||observed.some((d,j)=>d>p.observation_end||j>0&&d<=observed[j-1]) || p.complete&&expected.length>0&&p.observation_end!==expected.at(-1)) invalid('weekly_periods['+i+']','交易日必須依序位於本週及觀察截止日。');
      if(new Set(expected).size!==expected.length||new Set(observed).size!==observed.length||observed.some(d=>!expected.includes(d))||p.complete&&JSON.stringify(expected)!==JSON.stringify(observed)) invalid('weekly_periods['+i+']','完整週與已覆蓋交易日不符。');
      sources(p.source_ids,shared.source_registry,'weekly_periods.source_ids');
    });
    for(const name of ['fund_context','valuation_context','weekly_fund_context']) {
      const contextKeys=new Set<string>();
      shared[name].forEach((v:any,i:number)=> {
        const c=object(v,'shared.'+name+'['+i+']'); sources(c.source_ids,shared.source_registry,'shared.'+name+'['+i+'].source_ids');
        const cp='shared.'+name+'['+i+']';
        const need=name==='fund_context'?['etf_code','units_change_pct']:name==='weekly_fund_context'?['period_id','etf_code','baseline_units','current_units','units_change_pct']:['research_date','stock_code','price_date','reference_price_twd','valuation_method','denominator','denominator_period','valuation_result','assumption_type'];
        for(const field of need) if(!Object.hasOwn(c,field)) invalid(cp+'.'+field,'缺少背景必要欄位。');
        for(const [field,value] of Object.entries(c)) {
          if(field.endsWith('_date')&&value!==null) date(value,cp+'.'+field);
          if(/(?:_twd|_units|_pct)$/.test(field)||['denominator','valuation_result'].includes(field)) numericContext(value,cp+'.'+field,field.endsWith('_units')||field==='reference_price_twd');
          if(['etf_code','stock_code','period_id','valuation_method','denominator_period','assumption_type'].includes(field)&&(typeof value!=='string'||!value)) invalid(cp+'.'+field,'背景識別／方法須為非空文字。');
        }
        if(c.research_date!==undefined&&c.research_date!==fm.research_date || c.baseline_date!==undefined&&c.baseline_date!==fm.baseline_date || c.price_date!==undefined&&c.price_date!==null&&c.price_date>fm.research_date) invalid(cp,'背景比較日期與研究日不符。');
        if(name==='valuation_context'&&!Object.hasOwn(shared.dictionaries.stocks,c.stock_code)) invalid(cp+'.stock_code','估值股票不在名稱字典。');
        if(name==='weekly_fund_context'&&c.baseline_units===0&&c.units_change_pct!==null) invalid(cp+'.units_change_pct','基期份額為零時比例不適用。');
        if(c.etf_code!==undefined&&!fm.etf_codes.includes(c.etf_code)) invalid('shared.'+name,'基金不在樣本。');
        if(name==='weekly_fund_context'&&!periodIds.has(c.period_id)) invalid('shared.'+name,'週期間不存在。');
        const key=JSON.stringify(name==='weekly_fund_context'?[c.period_id,c.etf_code]:name==='fund_context'?[c.etf_code]:[c.research_date,c.stock_code,c.valuation_method]);
        if(contextKeys.has(key)) invalid('shared.'+name,'背景資料粒度鍵重複。'); contextKeys.add(key);
      });
    }
    return periodIds;
}
