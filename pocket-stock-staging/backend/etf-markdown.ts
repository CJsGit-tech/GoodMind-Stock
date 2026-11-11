import { db, error, isAppDatabaseError, json, storage } from '@appdeploy/sdk';
import type { RouterContext, RouterResponse, RouterRoutes } from '@appdeploy/sdk';
import { isReportId, isRequestId } from '../shared/etf-contract.ts';
import { MAX_MARKDOWN_SOURCE_BYTES, markdownHash } from '../shared/etf-markdown.ts';
import { parseEtfResearchSource, researchSource } from '../shared/etf-research.ts';
import type { MarkdownEntry, MarkdownListItem, MarkdownReport } from '../shared/etf-markdown.ts';
import { MAX_ETF_COVER_BYTES, MAX_ETF_COVER_BASE64_CHARS, validateEtfCover } from '../shared/etf-cover.ts';
import type { EtfCoverMetadata, EtfCoverDescriptor, ValidatedEtfCover } from '../shared/etf-cover.ts';
import { isPublicAssetUrl } from './public-book.ts';

export function createResearchWorkflow(options: { prefix?: string; parse?: typeof parseEtfResearchSource; maxSourceBytes?: number; requireTemplate?: boolean } = {}) {
const parseSource = options.parse || parseEtfResearchSource;
const sourceLimit = options.maxSourceBytes || MAX_MARKDOWN_SOURCE_BYTES;
const prefix = options.prefix || 'etf';
const DRAFTS = prefix+'_reports_v1', PUBLIC = prefix+'_public_reports_v1', SNAPSHOTS = prefix+'_report_snapshots_v1';
const RECEIPTS = prefix+'_request_receipts_v1', PAGES = prefix+'_markdown_pages_v3';
const OWNER = 'staging-master-secret-author';
const PAGE_CHARS = options.prefix ? 64 * 1024 : 16 * 1024;
type PageRef = { id: string; hash: string };
type Manifest = { sourceHash: string; parserVersion: string; sourceBytes: number; pages: PageRef[]; template?: { content: string; hash: string } };
type Summary = { id: string; title: string; excerpt: string; period: { start: string; end: string }; evidenceDate: string };
type StoredCover = EtfCoverMetadata & { storagePath: string };
type Draft = Summary & { archived?: boolean; storageSchemaVersion: 3; ownerKey: string; manifest: Manifest; cover?: StoredCover | null; revision: number; updatedAt: string; publishedVersion: number; publishedAt: string | null; publishedDraftRevision: number; reviewedRevision: number | null; reviewHash: string | null; dataStatus: string };
type Snapshot = { storageSchemaVersion: 3; reportId: string; manifest: Manifest; cover?: StoredCover | null; version: number; publishedAt: string };
type Receipt = { ownerKey: string; requestId: string; action: string; fingerprint: string; reportId: string; revision: number; publishedVersion: number };
type Helpers = { requireAdmin: (event: unknown, body?: unknown) => Promise<{ id: string } | null>; isSameOriginMutation: (event: unknown) => boolean };
class Failure extends Error {
  constructor(message: string, readonly status: number, readonly errorCode: string, readonly details: Record<string, unknown> = {}) { super(message); }
}
const fail = (message: string, status=400, code='invalid_request', details={}) : never => { throw new Failure(message,status,code,details); };
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as any : fail('請求格式錯誤。');
const revision = (value: unknown): number => Number.isSafeInteger(value) && (value as number)>=0 ? value as number : fail('需要有效草稿版本。');
const reportId = (value: unknown): string => isReportId(value) ? value : fail('報告 ID 格式錯誤。');
const requestId = (value: unknown): string => isRequestId(value) ? value : fail('請求識別碼格式錯誤。');
async function read<T>(table: string, id: string): Promise<T|null> { return (await db.get<T>(table,[id],{consistent:true}))[0]; }
function respond(caught: unknown): RouterResponse {
  if(caught instanceof Failure) return json({error:caught.message,errorCode:caught.errorCode,...caught.details},caught.status);
  if(isAppDatabaseError(caught)) return json({error:caught.code==='AppDatabaseQuotaExceeded'?'資料庫額度不足，請保留原檔稍後重試。':'資料結果尚未確認，請先查詢操作狀態。',errorCode:caught.code},caught.code==='AppDatabaseQuotaExceeded'?429:503);
  return error('研究資料暫時無法處理。',500);
}
function summary(report: MarkdownReport): Summary { return {id:report.id,title:report.title,excerpt:report.excerpt,period:report.period,evidenceDate:report.evidenceDate}; }
async function etfCoverDescriptor(value: unknown): Promise<EtfCoverDescriptor | null> {
  if (value === undefined || value === null) return null;
  const cover = value as StoredCover;
  if (!cover || typeof cover !== 'object' || typeof cover.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(cover.sha256) || cover.storagePath !== 'etf-covers/' + cover.sha256 + '.jpg' || cover.width !== 480 || cover.height !== 360 || cover.contentType !== 'image/jpeg' || !Number.isSafeInteger(cover.bytes) || cover.bytes <= 0 || cover.bytes > MAX_ETF_COVER_BYTES) fail('封面記錄完整性檢查失敗。',503,'cover_integrity');
  const signed = (await storage.url([cover.storagePath])).find(item => item.path === cover.storagePath)?.url;
  if (!signed || !isPublicAssetUrl(signed)) fail('封面暫時無法讀取，請稍後重新載入。',503,'cover_unavailable');
  return { sha256: cover.sha256, bytes: cover.bytes, width: 480, height: 360, contentType: 'image/jpeg', url: signed! };
}
function coverRef(cover: ValidatedEtfCover): StoredCover {
  return { sha256: cover.sha256, bytes: cover.bytes, width: 480, height: 360, contentType: 'image/jpeg', storagePath: 'etf-covers/' + cover.sha256 + '.jpg' };
}
async function checkedCover(value: unknown): Promise<ValidatedEtfCover> {
  const result = await validateEtfCover(value);
  if (!result.cover) fail('封面驗證未通過。',result.errors.some(e=>e.code==='cover_too_large')?413:400,'invalid_cover',{errors:result.errors});
  return result.cover!;
}
function isMarkdownStorage(value: unknown): value is Draft | Snapshot { return !!value && typeof value==='object' && (value as Draft).storageSchemaVersion===3; }
async function loadReport(manifest: Manifest): Promise<MarkdownReport> {
  if(!manifest || !Array.isArray(manifest.pages) || !manifest.pages.length || manifest.pages.length>Math.ceil(sourceLimit/PAGE_CHARS) || manifest.sourceBytes>sourceLimit) fail('完整來源頁目錄無效。',503,'source_integrity');
  const pages=await db.get<{id:string;content:string;hash:string;ownerKey:string}>(PAGES,manifest.pages.map(p=>p.id),{consistent:true});
  let raw='';
  for(const [i,p] of pages.entries()) {
    if(!p||p.ownerKey!==OWNER||p.hash!==manifest.pages[i].hash||await markdownHash(p.content)!==p.hash) fail('來源頁未完整取得，請重新載入。',503,'source_integrity');
    raw+=p!.content;
  }
  if(await markdownHash(raw)!==manifest.sourceHash || new TextEncoder().encode(raw).byteLength!==manifest.sourceBytes) fail('來源完整性檢查失敗。',503,'source_integrity');
  const checked=await parseSource(raw);
  if(!checked.report) fail('來源重新驗證失敗。',503,'source_integrity',{errors:checked.errors});
  if(checked.report!.parserVersion!==manifest.parserVersion) fail('此來源的解析版本尚未載入，不能默默改用新版解析器。',503,'parser_version_unavailable');
  if (options.requireTemplate && !manifest.template) fail('缺少同版HTML來源。',503,'source_integrity');
  if (manifest.template) {
    if (await markdownHash(manifest.template.content) !== manifest.template.hash) fail('HTML來源完整性檢查失敗。',503,'source_integrity');
    checked.report!.companionHtml = manifest.template.content;
  }
  return checked.report!;
}
async function entry(record: Draft): Promise<MarkdownEntry> { return {id:record.id,archived:record.archived===true,draft:await loadReport(record.manifest),cover:await etfCoverDescriptor(record.cover),revision:record.revision,updatedAt:record.updatedAt,publishedVersion:record.publishedVersion,publishedAt:record.publishedAt,hasUnpublishedChanges:record.revision!==record.publishedDraftRevision,reviewedRevision:record.reviewedRevision,reviewHash:record.reviewHash}; }
async function authorDraft(id: string): Promise<Draft> {
  const current=await read<Draft>(DRAFTS,id);
  if(!current||!isMarkdownStorage(current)||current.ownerKey!==OWNER) fail('找不到研究草稿。',404,'not_found');
  return current!;
}
async function receipt(id: string, expected?: string): Promise<Receipt|null> {
  const found=await read<Receipt>(RECEIPTS,id);
  if(found && (found.ownerKey!==OWNER||!found.action.startsWith('markdown_')||expected!==undefined&&found.fingerprint!==expected)) fail('請求識別碼已用於另一筆操作。',409,'request_id_conflict');
  return found;
}
async function receiptEntry(saved: Receipt): Promise<MarkdownEntry> {
  const current=await authorDraft(saved.reportId);
  if(current.revision<saved.revision||current.publishedVersion<saved.publishedVersion) fail('操作結果尚未確認，請重新查詢。',503,'outcome_unresolved',{requestId:saved.requestId,state:'unresolved'});
  return entry(current);
}
async function checkedReport(raw: unknown): Promise<MarkdownReport> {
  const checked=await parseSource(raw);
  if(!checked.report) fail('Markdown 驗證未通過。',checked.errors.some(e=>e.code==='source_too_large'||e.code==='expanded_too_large')?413:400,'invalid_markdown',{errors:checked.errors,warnings:checked.warnings});
  return checked.report!;
}
async function commit(saved: Receipt, operations: Parameters<typeof db.transact>[0]): Promise<MarkdownEntry> {
  try { await db.transact([...operations,db.tx.add(RECEIPTS,[{id:saved.requestId,...saved}])]); }
  catch(caught) {
    if(!isAppDatabaseError(caught)) throw caught;
    const found=await receipt(saved.requestId,saved.fingerprint); if(found) return receiptEntry(found);
    if(['AppDatabaseUnknownOutcome','AppDatabaseGatewayUnavailable','AppDatabaseDuplicateId'].includes(caught.code)) fail('操作結果尚未確認，請保留請求識別碼並先查狀態。',503,'outcome_unresolved',{requestId:saved.requestId,state:'unresolved'});
    if(['AppDatabaseConflict','AppDatabaseConditionFailed'].includes(caught.code)) fail('版本已由其他視窗變更，請重新載入再審閱。',409,'revision_conflict',{requestId:saved.requestId,state:'known_failed'});
    throw caught;
  }
  return receiptEntry(saved);
}
const timestamp = (previous?:string|null) => new Date(Math.max(Date.now(),previous?Date.parse(previous)+1:0)).toISOString();
async function checkedTemplate(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value).byteLength > 64 * 1024 || !/fetch\(\s*['"](?:\.\/)?data\.json['"]/.test(value)) fail('請提供讀取同目錄 data.json 的 report.html（最多64 KiB）。',400,'invalid_template');
  return { content: value as string, hash: await markdownHash(value as string) };
}
async function save(input: Record<string,any>): Promise<MarkdownEntry> {
  const base=revision(input.baseRevision),rid=requestId(input.requestId),report=await checkedReport(input.rawSource ?? input.rawMarkdown);
  const template = options.requireTemplate ? await checkedTemplate(input.reportHtml) : undefined;
  if (options.requireTemplate && !input.cover) fail('請同時提供 cover.jpg。',400,'missing_cover');
  const supplied=Object.hasOwn(input,'cover'),validated=supplied&&input.cover!==null?await checkedCover(input.cover):null;
  const coverIntent = !supplied ? undefined : input.cover===null ? { mode:'remove' } : { mode:'replace',sha256:validated!.sha256 };
  // Keep the original fingerprint for old clients that omit the optional companion.
  const fp=await markdownHash(JSON.stringify({action:'markdown_save',sourceHash:report.sourceHash,base,...(template?{templateHash:template.hash}:{}),...(coverIntent?{cover:coverIntent}:{})}));
  const prior=await receipt(rid,fp); if(prior) return receiptEntry(prior);
  const current=await read<Draft>(DRAFTS,report.id);
  if(current && (!isMarkdownStorage(current)||current.ownerKey!==OWNER)) fail('此報告 ID 已屬其他格式或沒有權限，請保留原篇並確認 ID。',409,'format_conflict');
  if((current?.revision??0)!==base) fail('草稿版本已變更，請重新載入。',409,'revision_conflict');
  const cover=supplied?(validated?coverRef(validated):null):current?.cover??null;
  if(current && current.manifest.sourceHash===report.sourceHash && (current.manifest.template?.hash??null)===(template?.hash??null) && (current.cover?.sha256??null)===(cover?.sha256??null)) {
    // This CAS fence records the no-op receipt without overwriting concurrent review or publication fields.
    return commit({ownerKey:OWNER,requestId:rid,action:'markdown_save',fingerprint:fp,reportId:report.id,revision:base,publishedVersion:current.publishedVersion},[
      db.tx.update(DRAFTS,[{id:report.id,if:{revision:base,publishedVersion:current.publishedVersion},record:{id:report.id}}],{patch:true}),
    ]);
  }
  if(validated) {
    // Content-addressed writes are identical on retry. Never delete after an ambiguous DB outcome.
    const [written]=await storage.write([{path:cover!.storagePath,content:validated.contentBase64,contentType:'image/jpeg'}]);
    if(!written) fail('封面儲存尚未確認，請保留原檔並查詢操作狀態。',503,'cover_unavailable');
  }
  const operations: any[]=[]; const refs: PageRef[]=[];
  for(let i=0;i<researchSource(report).length;i+=PAGE_CHARS) {
    // Slice by UTF-16 boundaries and rejoin before parsing; source hash preserves exact input.
    const content=researchSource(report).slice(i,i+PAGE_CHARS),hash=await markdownHash(content),id='md-'+report.sourceHash+'-'+refs.length;
    refs.push({id,hash}); const old=await read<{content:string;hash:string;ownerKey:string}>(PAGES,id);
    if(old) { if(old.hash!==hash||old.content!==content||old.ownerKey!==OWNER) fail('不可變來源頁衝突。',409,'source_integrity'); }
    else if (options.prefix) {
      // Stage immutable source pages before the small CAS transaction. Unreferenced pages stay private.
      try { await db.transact([db.tx.add(PAGES,[{id,content,hash,ownerKey:OWNER}])]); }
      catch (caught) {
        const raced = await read<{content:string;hash:string;ownerKey:string}>(PAGES,id);
        if (!raced || raced.content !== content || raced.hash !== hash || raced.ownerKey !== OWNER) throw caught;
      }
    } else operations.push(db.tx.add(PAGES,[{id,content,hash,ownerKey:OWNER}]));
  }
  const manifest:Manifest={sourceHash:report.sourceHash,sourceBytes:report.sourceBytes,parserVersion:report.parserVersion,pages:refs,...(template?{template}:{})};
  const next:Draft={...summary(report),archived:current?.archived===true,storageSchemaVersion:3,ownerKey:OWNER,manifest,cover,revision:base+1,updatedAt:timestamp(current?.updatedAt),publishedVersion:current?.publishedVersion??0,publishedAt:current?.publishedAt??null,publishedDraftRevision:current?.publishedDraftRevision??0,reviewedRevision:null,reviewHash:null,dataStatus:report.frontmatter.data_status};
  operations.push(current?db.tx.update(DRAFTS,[{id:report.id,record:next,if:{revision:base,publishedVersion:current.publishedVersion,updatedAt:current.updatedAt}}]):db.tx.add(DRAFTS,[next]));
  return commit({ownerKey:OWNER,requestId:rid,action:'markdown_save',fingerprint:fp,reportId:report.id,revision:next.revision,publishedVersion:next.publishedVersion},operations);
}
async function review(input: Record<string,any>): Promise<MarkdownEntry> {
  const id=reportId(input.id),base=revision(input.baseRevision),rid=requestId(input.requestId);
  if(typeof input.sourceHash!=='string') fail('需要來源雜湊。');
  const fp=await markdownHash(JSON.stringify({action:'markdown_review',id,base,sourceHash:input.sourceHash}));
  const prior=await receipt(rid,fp); if(prior) return receiptEntry(prior);
  const current=await authorDraft(id);
  if(current.revision!==base||current.manifest.sourceHash!==input.sourceHash) fail('來源或版本已變更，請重新預覽。',409,'revision_conflict');
  await loadReport(current.manifest);
  const reviewHash=await markdownHash(JSON.stringify({id,revision:base,sourceHash:current.manifest.sourceHash,parserVersion:current.manifest.parserVersion,...(current.manifest.template?{templateHash:current.manifest.template.hash}:{}),...(current.cover?{coverSha256:current.cover.sha256}:{})}));
  return commit({ownerKey:OWNER,requestId:rid,action:'markdown_review',fingerprint:fp,reportId:id,revision:base,publishedVersion:current.publishedVersion},[db.tx.update(DRAFTS,[{id,if:{revision:base,publishedVersion:current.publishedVersion},record:{reviewedRevision:base,reviewHash}}],{patch:true})]);
}
async function publish(input: Record<string,any>): Promise<MarkdownEntry> {
  const id=reportId(input.id),base=revision(input.baseRevision),expected=revision(input.expectedPublishedVersion),rid=requestId(input.requestId);
  if(input.reviewed!==true||typeof input.reviewHash!=='string') fail('請明確確認目前文章、圖表、來源與資料缺口後發布。');
  const fp=await markdownHash(JSON.stringify({action:'markdown_publish',id,base,expected,reviewHash:input.reviewHash}));
  const prior=await receipt(rid,fp);if(prior) return receiptEntry(prior);
  const current=await authorDraft(id);
  if(current.revision!==base||current.publishedVersion!==expected) fail('草稿或公開版本已變更，請重新載入。',409,'revision_conflict');
  if(current.reviewedRevision!==base||current.reviewHash!==input.reviewHash) fail('目前修訂尚未審閱，請預覽並重新確認。',409,'review_required');
  if(current.publishedDraftRevision===base) fail('此草稿已發布。',409,'already_published');
  const report=await loadReport(current.manifest),version=expected+1,publishedAt=timestamp(current.publishedAt),snapshotId=id+'.v'+version;
  const snap:Snapshot={storageSchemaVersion:3,reportId:id,manifest:current.manifest,cover:current.cover??null,version,publishedAt};
  const publicRecord={...summary(report),version,publishedAt,snapshotId,cover:current.cover??null};
  return commit({ownerKey:OWNER,requestId:rid,action:'markdown_publish',fingerprint:fp,reportId:id,revision:base,publishedVersion:version},[
    db.tx.update(DRAFTS,[{id,if:{revision:base,publishedVersion:expected,reviewHash:input.reviewHash,reviewedRevision:base},record:{archived:false,publishedVersion:version,publishedAt,publishedDraftRevision:base}}],{patch:true}),
    expected?db.tx.update(PUBLIC,[{id,record:publicRecord,if:{version:expected}}]):db.tx.add(PUBLIC,[publicRecord]),
    db.tx.add(SNAPSHOTS,[{id:snapshotId,...snap}]),
  ]);
}
async function visibility(input: Record<string, any>): Promise<MarkdownEntry> {
  const id = reportId(input.id), base = revision(input.baseRevision);
  const expected = revision(input.expectedPublishedVersion), rid = requestId(input.requestId);
  if (typeof input.archived !== 'boolean' || typeof input.expectedUpdatedAt !== 'string') {
    fail('需要目前公開狀態與更新時間。');
  }
  const fp = await markdownHash(JSON.stringify({
    action: 'markdown_visibility', id, base, expected,
    archived: input.archived, expectedUpdatedAt: input.expectedUpdatedAt,
  }));
  const prior = await receipt(rid, fp);
  if (prior) return receiptEntry(prior);
  const current = await authorDraft(id);
  if (current.revision !== base || current.publishedVersion !== expected ||
      current.updatedAt !== input.expectedUpdatedAt) {
    fail('研究或公開狀態已變更，請重新載入。', 409, 'revision_conflict');
  }
  if (!expected) fail('這篇研究尚無可管理的公開版本。', 409, 'not_published');
  const published = await read<{version: number; snapshotId: string}>(PUBLIC, id);
  const snapshot = await read<Snapshot>(SNAPSHOTS, id + '.v' + expected);
  if (!published || published.version !== expected || published.snapshotId !== id + '.v' + expected ||
      !isMarkdownStorage(snapshot) || snapshot.reportId !== id || snapshot.version !== expected) {
    fail('公開版本尚無法確認，請重新載入。', 503, 'source_integrity');
  }
  // Only visibility metadata changes; source pages, cover and immutable snapshots stay intact.
  return commit({
    ownerKey: OWNER, requestId: rid, action: 'markdown_visibility',
    fingerprint: fp, reportId: id, revision: base, publishedVersion: expected,
  }, [
    db.tx.update(DRAFTS, [{
      id, record: { archived: input.archived, updatedAt: timestamp(current.updatedAt) },
      if: { revision: base, publishedVersion: expected, updatedAt: current.updatedAt },
    }], { patch: true }),
    db.tx.update(PUBLIC, [{
      id, record: { archived: input.archived },
      if: { version: expected, snapshotId: published!.snapshotId },
    }], { patch: true }),
  ]);
}
// Return null only for another report format. Visibility is always resolved through the shared public pointer.
async function readPublishedMarkdown(id:string,versionInput?:string):Promise<RouterResponse|null> {
  if(!isReportId(id)) return null;
  const published=await read<{version:number;snapshotId:string;archived?:boolean}>(PUBLIC,id); if(!published||published.archived) return null;
  const version=versionInput===undefined||versionInput===''?published.version:Number(versionInput);
  if(!Number.isSafeInteger(version)||version<1||version>published.version||versionInput&&!/^[1-9]\d*$/.test(versionInput)) return error('找不到指定已發布版本。',404);
  const snapshot=await read<Snapshot>(SNAPSHOTS,id+'.v'+version);
  if(!isMarkdownStorage(snapshot)) return null;
  try {
    if(!snapshot||snapshot.reportId!==id||snapshot.version!==version) fail('已發布來源版本不符。',503,'source_integrity');
    const report=await loadReport(snapshot.manifest);
    if(report.id!==id) fail('來源篇別不符。',503,'source_integrity');
    return json({report,cover:await etfCoverDescriptor(snapshot.cover),version,publishedAt:snapshot.publishedAt,snapshotId:id+'.v'+version,storageSchemaVersion:3});
  } catch(caught) { return respond(caught); }
}
async function readPublishedEtfCover(id: string, versionInput?: string, hashInput?: string): Promise<RouterResponse> {
  try {
    if(!isReportId(id)) return error('找不到已發布封面。',404);
    const published=await read<{version:number;archived?:boolean}>(PUBLIC,id);
    if(!published || published.archived) return error('找不到已發布封面。',404);
    const version=versionInput===undefined?published.version:Number(versionInput);
    if(!Number.isSafeInteger(version)||version<1||version>published.version||versionInput!==undefined&&!/^[1-9]\d*$/.test(versionInput)) return error('找不到指定封面版本。',404);
    if(hashInput!==undefined&&!/^[a-f0-9]{64}$/.test(hashInput)) return error('封面識別碼格式錯誤。',400);
    const snapshot=await read<Snapshot>(SNAPSHOTS,id+'.v'+version);
    if(!isMarkdownStorage(snapshot)||snapshot.reportId!==id||snapshot.version!==version) return error('找不到已發布封面。',404);
    if(hashInput!==undefined&&snapshot.cover?.sha256!==hashInput) return error('找不到指定封面。',404);
    return json({cover:await etfCoverDescriptor(snapshot.cover)});
  }catch(caught){return respond(caught);}
}
function makeEtfMarkdownRoutes(helpers:Helpers):RouterRoutes {
  const privateRoute=(action:(input:Record<string,any>)=>Promise<RouterResponse>)=>[async(ctx:RouterContext)=> {
    try {
      if(!helpers.isSameOriginMutation(ctx.event)) return error('此請求來源不受允許。',403);
      if(!await helpers.requireAdmin(ctx.event,ctx.body)) return error('請重新登入作者工作台。',401);
      const input=object(ctx.body);
      // JSON quoting and UTF-8 can expand the source; use the source byte limit as the actual author-facing limit.
      if(typeof input.cover?.contentBase64==='string'&&input.cover.contentBase64.length>MAX_ETF_COVER_BASE64_CHARS) fail('封面不得超過 1 MiB。',413,'invalid_cover',{errors:[{path:'cover',code:'cover_too_large',message:'封面不得超過 1 MiB。'}]});
      if(new TextEncoder().encode(JSON.stringify(input)).byteLength>2*sourceLimit+MAX_ETF_COVER_BASE64_CHARS+8192) return error('請求內容超過上限。',413);
      return await action(input);
    }catch(caught){return respond(caught);}
  }];
  const routes: RouterRoutes = {
    'POST /api/admin/etf-markdown/validate':privateRoute(async input=>{
      const result=await parseSource(input.rawSource ?? input.rawMarkdown);
      if (options.requireTemplate) { await checkedTemplate(input.reportHtml); if (!input.cover) fail('請同時提供 cover.jpg。',400,'missing_cover'); }
      const checked=Object.hasOwn(input,'cover')&&input.cover!==null?await validateEtfCover(input.cover):{cover:null,errors:[]};
      const cover=checked.cover?coverRef(checked.cover):null;
      const metadata=cover?{sha256:cover.sha256,bytes:cover.bytes,width:cover.width,height:cover.height,contentType:cover.contentType}:null;
      const errors=[...result.errors,...checked.errors];
      return json({...result,errors,cover:metadata,coverErrors:checked.errors},errors.some(e=>['source_too_large','expanded_too_large','cover_too_large'].includes(e.code))?413:200);
    }),
    'POST /api/admin/etf-markdown/save':privateRoute(async input=>json({entry:await save(input)})),
    'POST /api/admin/etf-markdown/get':privateRoute(async input=>json({entry:await entry(await authorDraft(reportId(input.id)))})),
    'POST /api/admin/etf-markdown/list':privateRoute(async input=>{
      if(input.nextToken!==undefined&&input.nextToken!==null&&(typeof input.nextToken!=='string'||input.nextToken.length>4096)) fail('分頁游標格式錯誤。');
      const page=await db.list<Draft>(DRAFTS,{limit:20,nextToken:input.nextToken||undefined});
      const items:MarkdownListItem[]=await Promise.all(page.items.filter(r=>isMarkdownStorage(r)&&r.ownerKey===OWNER).map(async r=>({id:r.id,archived:r.archived===true,title:r.title,sourceHash:r.manifest.sourceHash,cover:await etfCoverDescriptor(r.cover),researchDate:r.period.end,dataStatus:r.dataStatus,revision:r.revision,updatedAt:r.updatedAt,publishedVersion:r.publishedVersion,publishedAt:r.publishedAt,hasUnpublishedChanges:r.revision!==r.publishedDraftRevision,reviewedRevision:r.reviewedRevision,reviewHash:r.reviewHash})));
      return json({items,nextToken:page.nextToken??null});
    }),
    'POST /api/admin/etf-markdown/review':privateRoute(async input=>json({entry:await review(input)})),
    'POST /api/admin/etf-markdown/publish':privateRoute(async input=>json({entry:await publish(input)})),
    'POST /api/admin/etf-markdown/visibility':privateRoute(async input=>json({entry:await visibility(input)})),
    'POST /api/admin/etf-markdown/status':privateRoute(async input=>{const id=requestId(input.requestId),saved=await receipt(id);return json({requestId:id,state:saved?'applied':'unresolved',...(saved?{entry:await receiptEntry(saved)}:{})});}),
    'GET /api/etf/reports/:id/cover':[async ctx=>readPublishedEtfCover(ctx.params.id,ctx.query.version,ctx.query.sha256)],
  };
  if (options.prefix) {
    const isolated: RouterRoutes = {};
    for (const [key, handler] of Object.entries(routes)) if (key.includes('/etf-markdown/')) isolated[key.replace('/etf-markdown/','/institutional-research/')] = handler;
    isolated['GET /api/institutional/reports'] = [async ctx => {
      try {
        const cursor = ctx.query.nextToken;
        if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 4096)) return error('分頁游標格式錯誤。',400);
        const page = await db.list<Summary & {version:number;publishedAt:string;archived?:boolean;cover?:StoredCover}>(PUBLIC,{limit:50,nextToken:cursor});
        const items = await Promise.all(page.items.filter(r => !r.archived && r.version > 0).map(async r => ({id:r.id,title:r.title,excerpt:r.excerpt,period:r.period,evidenceDate:r.evidenceDate,version:r.version,publishedAt:r.publishedAt,cover:await etfCoverDescriptor(r.cover)})));
        return json({items,nextToken:page.nextToken??null});
      } catch(caught) { return respond(caught); }
    }];
    isolated['GET /api/institutional/reports/:id/cover'] = [async ctx=>readPublishedEtfCover(ctx.params.id,ctx.query.version,ctx.query.sha256)];
    isolated['GET /api/institutional/reports/:id'] = [async ctx => (await readPublishedMarkdown(ctx.params.id,ctx.query.version)) || error('找不到已發布法人研究。',404)];
    return isolated;
  }
  for (const [key, handler] of Object.entries(routes)) if(key.includes('/etf-markdown/')) routes[key.replace('/etf-markdown/', '/etf-research/')] = handler;
  return routes;
}

return { makeEtfMarkdownRoutes, readPublishedMarkdown, readPublishedEtfCover, etfCoverDescriptor, isMarkdownStorage };
}
export const { makeEtfMarkdownRoutes, readPublishedMarkdown, readPublishedEtfCover, etfCoverDescriptor, isMarkdownStorage } = createResearchWorkflow();
