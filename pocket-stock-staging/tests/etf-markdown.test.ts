import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEtfMarkdown, MAX_MARKDOWN_SOURCE_BYTES } from '../shared/etf-markdown.ts';
import { fixtureMarkdown, markdownFixtureParts } from './fixtures/etf-markdown-fixture.ts';

const raw=fixtureMarkdown();
test('self-contained source roundtrip, contexts and null/zero preserved, bilingual headings',async()=>{
 const result=await parseEtfMarkdown(raw);assert.deepEqual(result.errors,[]);const r=result.report!;
 assert.equal(r.rawMarkdown,raw);assert.equal(r.visualizations.length,3);assert.equal(r.visualizations[1].records[0].unit_adjusted_change_pct,null);assert.equal(r.visualizations[1].records[0].baseline_shares,0);assert.equal(r.shared.weekly_fund_context[0].baseline_units,100);assert.equal(r.frontmatter.etf_codes[0],'QA001A');assert.ok(result.warnings.some(w=>w.code==='partial_coverage'));assert.equal(r.id,'qa-markdown-report');
 const en=raw.replace('## 重點分析','## Summary Analysis').replace('## 配置圖表','## Dashboard').replace('### 共用資料','### Shared Data').replaceAll('### 圖表 ','### Visualization ').replaceAll('#### 用途','#### Purpose').replaceAll('#### 建議圖形','#### Suggested Chart').replaceAll('#### 資料結構','#### Data Shape').replaceAll('#### 實際資料','#### Data').replaceAll('#### 資料來源','#### Sources');assert.deepEqual((await parseEtfMarkdown(en)).report!.visualizations,r.visualizations);
});
test('blocking contract/security errors are localized and never coerce missing values',async()=>{
 const bad: Array<[string,string]>=[['duplicate JSON',raw.replace('"schema_version":"4.0.0"','"schema_version":"4.0.0","schema_version":"4.0.0"')],['duplicate YAML',raw.replace('timezone: Asia/Taipei','timezone: Asia/Taipei\ntimezone: Asia/Taipei')],['unsafe key',raw.replace('"metadata":{','"__proto__":{},"metadata":{')],['HTML',raw.replace('僅測試資料','<script>alert(1)</script>僅測試資料')],['unsafe URL',raw.replaceAll('https://example.invalid/source','javascript:alert')],['unknown version',raw.replace('schema_version: 4.0.0','schema_version: 9.0.0')],['NaN',raw.replace('"net_value_estimate_twd":100','"net_value_estimate_twd":NaN')],['unbounded integer',raw.replace('"net_value_estimate_twd":100','"net_value_estimate_twd":1e100')],['source oversize',raw+' '.repeat(MAX_MARKDOWN_SOURCE_BYTES)],['YAML alias',raw.replace('timezone: Asia/Taipei','timezone: &x Asia/Taipei\nother: *x')]];
 for(const [name,value] of bad){const r=await parseEtfMarkdown(value);assert.equal(r.report,null,name);assert.ok(r.errors[0].path,name);}
 const mutate=(f:(p:ReturnType<typeof markdownFixtureParts>)=>void)=>{const p=markdownFixtureParts();f(p);return fixtureMarkdown(p);};
 const cases=[mutate(p=>p.visuals[0].rows[0].push(1)),mutate(p=>p.visuals[0].rows[0][0]=10),mutate(p=>p.visuals[0].shape.metadata.record_count=2),mutate(p=>{p.visuals[0].rows.push([0]);p.visuals[0].shape.metadata.record_count=2;p.visuals[0].shape.metadata.expected_record_count=2;}),mutate(p=>p.visuals[0].sources.source_ids=[]),mutate(p=>p.shared.weekly_periods[0].observed_trading_dates=[]),mutate(p=>p.visuals[1].shape.constants.holding_state='not_held'),mutate(p=>p.visuals[1].shape.constants.delta_shares=101),mutate(p=>p.visuals[0].shape.constants.net_value_estimate_twd=200),mutate(p=>p.visuals[0].shape.constants.baseline_date='2026-02-30'),mutate(p=>p.shared.weekly_fund_context[0].baseline_units='100'),mutate(p=>delete p.shared.weekly_fund_context[0].units_change_pct),mutate(p=>p.shared.weekly_periods[0].period_id='2026-W99'),mutate(p=>p.shared.weekly_periods[0].week_start='2026-10-06'),mutate(p=>p.shared.weekly_periods[0].observation_end='2026-10-16'),mutate(p=>p.shared.weekly_periods[0].expected_trading_dates=['2026-10-20']),mutate(p=>p.visuals[1].shape.constants.holding_state='held'),mutate(p=>{p.visuals[0].shape.metadata.data_status='complete';p.visuals[0].shape.metadata.expected_record_count=2;})];
 for(const value of cases)assert.equal((await parseEtfMarkdown(value)).report,null);
 assert.equal((await parseEtfMarkdown(raw.replaceAll('2026-10-14','2026-10-16'))).report,null);
 const bomb=markdownFixtureParts();bomb.visuals[0].shape.constants.context='x'.repeat(50000);delete bomb.visuals[0].shape.constants.industry_code;bomb.visuals[0].shape.columns.push(['industry_code','string']);bomb.visuals[0].rows=Array.from({length:100},(_,i)=>[0,String(i)]) as any;bomb.visuals[0].shape.metadata.record_count=100;bomb.visuals[0].shape.metadata.expected_record_count=100;assert.equal((await parseEtfMarkdown(fixtureMarkdown(bomb))).errors[0].code,'expanded_too_large');
 const p=markdownFixtureParts();Object.assign(p.visuals[1].shape.constants,{baseline_shares:null,current_shares:null,delta_shares:null,baseline_weight_pct:null,current_weight_pct:null,delta_weight_pp:null,close_price_twd:null,delta_value_estimate_twd:null,holding_state:'unknown',data_status:'partial',missing_reason:'缺少端點'});assert.deepEqual((await parseEtfMarkdown(fixtureMarkdown(p))).errors,[]);
});
test('per-chart estimate basis is explicit; provider series remain separate and mixed rows cannot aggregate',async()=>{
 const p=markdownFixtureParts();
 Object.assign(p.visuals[0].shape.metadata,{amount_basis:'provider_estimate',amount_formula:'provider_published_estimate'});
 p.visuals[0].shape.constants.method='provider_estimate';
 const valid=await parseEtfMarkdown(fixtureMarkdown(p));assert.deepEqual(valid.errors,[]);
 assert.equal(valid.report!.visualizations[0].metadata.amount_basis,'provider_estimate');assert.equal(valid.report!.visualizations[1].metadata.amount_basis,'research_estimate');assert.equal(valid.report!.visualizations[0].records[0].net_value_estimate_twd,100);
 delete p.visuals[0].shape.metadata.amount_formula;assert.equal((await parseEtfMarkdown(fixtureMarkdown(p))).errors[0].code,'mixed_amount_basis');p.visuals[0].shape.metadata.amount_formula='provider_published_estimate';
 p.visuals[0].shape.constants.amount_basis='research_estimate';
 assert.equal((await parseEtfMarkdown(fixtureMarkdown(p))).errors[0].code,'mixed_amount_basis');
 delete p.visuals[0].shape.constants.amount_basis;p.visuals[0].shape.constants.method='actual_transaction_cashflow';
 assert.equal((await parseEtfMarkdown(fixtureMarkdown(p))).errors[0].code,'mixed_amount_basis');
 const rows=markdownFixtureParts();delete rows.visuals[0].shape.constants.method;delete rows.visuals[0].shape.constants.industry_code;rows.visuals[0].shape.columns.push(['method','string'],['industry_code','string']);rows.visuals[0].rows=[[0,'share_delta_times_close','01'],[0,'different_estimate_method','02']] as any;rows.visuals[0].shape.metadata.record_count=2;rows.visuals[0].shape.metadata.expected_record_count=2;
 assert.equal((await parseEtfMarkdown(fixtureMarkdown(rows))).errors[0].code,'mixed_amount_basis');
 const absent=markdownFixtureParts();delete absent.shared.metadata.amount_basis;assert.equal((await parseEtfMarkdown(fixtureMarkdown(absent))).errors[0].code,'mixed_amount_basis');
 const provider=markdownFixtureParts();provider.shared.metadata.amount_basis='provider_estimate';provider.shared.metadata.amount_formula='provider_published_estimate';provider.visuals[0].shape.constants.method='provider_estimate';assert.deepEqual((await parseEtfMarkdown(fixtureMarkdown(provider))).errors,[]);
});
test('optional real report full codec equality includes every context/row/source',{skip:!process.env.ACTIVEETF_REPORT},async()=>{
 const source=readFileSync(process.env.ACTIVEETF_REPORT!,'utf8');const actual=(await parseEtfMarkdown(source)).report!;assert.ok(actual);
 const py=spawnSync('python3',['-c',`import sys,json;sys.path.insert(0,'/Users/chuang/.codex/skills/tw-active-etf/scripts');import dashboard_codec as c;s,d,p=c.parse_markdown(open(sys.argv[1]).read());print(json.dumps({'shared':s,'decoded':d},ensure_ascii=False))`,process.env.ACTIVEETF_REPORT!],{encoding:'utf8',maxBuffer:8*1024*1024});assert.equal(py.status,0,py.stderr);const expected=JSON.parse(py.stdout);assert.deepEqual(actual.shared,expected.shared);
 for(const v of actual.visualizations){assert.deepEqual(v.records,expected.decoded[v.id].records);assert.deepEqual(v.metadata,expected.decoded[v.id].metadata);}
 assert.deepEqual(actual.visualizations.map(v=>v.records.length),[90,150,500]);assert.equal(Object.keys(actual.shared.source_registry).length,71);assert.equal(actual.shared.weekly_periods.length,5);assert.equal(actual.rawMarkdown,source);
});
test('real SQLite backend auth, immutable snapshots, review invalidation, CAS, receipt and unknown recovery',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'etf-md-tests-'));process.env.POCKETSTOCKS_DATA_DIR=dir;process.env.ADMIN_MASTER_SECRET='disposable-test-only';process.env.POCKETSTOCKS_LOCAL_ORIGIN='http://localhost:5173';
 const {db}=await import('../local/sdk.ts');const {LocalDatabaseError}=await import('../local/database.ts');const {makeEtfMarkdownRoutes,readPublishedMarkdown}=await import('../backend/etf-markdown.ts');
 const routes=makeEtfMarkdownRoutes({requireAdmin:async(event:any)=>event.author?{id:'fixture'}:null,isSameOriginMutation:(event:any)=>event.trusted});
 async function call(action:string,input:any={},author=true,trusted=true){const result=await routes['POST /api/admin/etf-markdown/'+action][0]({body:input,event:{author,trusted},params:{},query:{}});assert.ok(result);return {status:result!.statusCode,data:JSON.parse(result!.body)};}
 try {
 assert.equal((await call('list',{},false)).status,401);assert.equal((await call('save',{rawMarkdown:raw,baseRevision:0,requestId:'fixture-save-001'},true,false)).status,403);
 const saved=await call('save',{rawMarkdown:raw,baseRevision:0,requestId:'fixture-save-001'});assert.equal(saved.status,200);assert.equal(saved.data.entry.revision,1);assert.equal(await readPublishedMarkdown('qa-markdown-report'),null);assert.equal((await call('get',{id:'qa-markdown-report'})).data.entry.draft.rawMarkdown,raw);
 assert.equal((await call('list')).data.items.length,1);assert.equal((await call('list')).data.items[0].draft,undefined);
 assert.equal((await call('save',{rawMarkdown:raw,baseRevision:0,requestId:'fixture-save-001'})).data.entry.revision,1);
 assert.equal((await call('save',{rawMarkdown:raw+'\n',baseRevision:0,requestId:'fixture-save-001'})).status,409);
 assert.equal((await call('publish',{id:'qa-markdown-report',baseRevision:1,expectedPublishedVersion:0,reviewed:true,reviewHash:'fake',requestId:'fixture-publish-001'})).status,409);
 const reviewed=(await call('review',{id:'qa-markdown-report',baseRevision:1,sourceHash:saved.data.entry.draft.sourceHash,requestId:'fixture-review-001'})).data.entry;
 const publish={id:reviewed.id,baseRevision:1,expectedPublishedVersion:0,reviewed:true,reviewHash:reviewed.reviewHash,requestId:'fixture-publish-002'};
 const published=await call('publish',publish);assert.equal(published.status,200);assert.equal(published.data.entry.publishedVersion,1);assert.equal((await call('publish',publish)).data.entry.publishedVersion,1);
 const v1=JSON.parse((await readPublishedMarkdown(reviewed.id,'1'))!.body);assert.equal(v1.report.rawMarkdown,raw);
 const revised=await call('save',{rawMarkdown:raw.replace('沒有推薦。','仍未推薦。'),baseRevision:1,requestId:'fixture-save-002'});assert.equal(revised.data.entry.reviewHash,null);assert.equal((await call('publish',{...publish,baseRevision:2,expectedPublishedVersion:1,requestId:'fixture-publish-003'})).status,409);assert.equal(JSON.parse((await readPublishedMarkdown(reviewed.id))!.body).report.rawMarkdown,raw);
 const race=await Promise.all([call('save',{rawMarkdown:raw+'\n',baseRevision:2,requestId:'fixture-race-001'}),call('save',{rawMarkdown:raw+'\n\n',baseRevision:2,requestId:'fixture-race-002'})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 const original=db.transact;db.transact=(async(ops:any)=>{await original(ops);throw new LocalDatabaseError('AppDatabaseUnknownOutcome');}) as any;
 const recovered=await call('save',{rawMarkdown:raw,baseRevision:3,requestId:'fixture-unknown-001'});assert.equal(recovered.status,200);assert.equal((await call('status',{requestId:'fixture-unknown-001'})).data.state,'applied');
 db.transact=(async()=>{throw new LocalDatabaseError('AppDatabaseUnknownOutcome');}) as any;
 const unresolved=await call('save',{rawMarkdown:raw+'\n',baseRevision:4,requestId:'fixture-unknown-002'});assert.equal(unresolved.status,503);assert.equal((await call('status',{requestId:'fixture-unknown-002'})).data.state,'unresolved');db.transact=original;
 assert.equal(JSON.parse((await readPublishedMarkdown(reviewed.id,'1'))!.body).report.rawMarkdown,raw);
 await db.tx.add('etf_reports_v1',[{id:'qa-legacy-id',ownerKey:'staging-master-secret-author',revision:1,publishedVersion:0}]);const legacyRaw=fixtureMarkdown(markdownFixtureParts('qa-legacy-id'));assert.equal((await call('save',{rawMarkdown:legacyRaw,baseRevision:1,requestId:'fixture-legacy-001'})).status,409);
 const large=fixtureMarkdown(markdownFixtureParts('qa-large-source')).replace('沒有推薦。','x'.repeat(210*1024));const largeSaved=await call('save',{rawMarkdown:large,baseRevision:0,requestId:'fixture-large-001'});assert.equal(largeSaved.status,200);assert.equal(largeSaved.data.entry.draft.rawMarkdown,large);assert.ok(largeSaved.data.entry.draft.sourceBytes>180*1024);
 const {makeEtfRoutes}=await import('../backend/etf-reports.ts');const old=makeEtfRoutes({requireAdmin:async()=>({id:'fixture'}),isSameOriginMutation:()=>true});const get=await old['POST /api/admin/etf-reports/get'][0]({body:{id:reviewed.id},event:{},params:{},query:{}});assert.equal(get!.statusCode,404);
 const {seedReport}=await import('../shared/etf-seed.ts');const legacySave=await old['POST /api/admin/etf-reports/save'][0]({body:{report:{...seedReport,id:reviewed.id},baseRevision:4,requestId:'fixture-oldwrite-001'},event:{},params:{},query:{}});assert.equal(legacySave!.statusCode,409);
 const legacyPublish=await old['POST /api/admin/etf-reports/publish'][0]({body:{id:reviewed.id,baseRevision:4,reviewed:true,requestId:'fixture-oldpub-001'},event:{},params:{},query:{}});assert.equal(legacyPublish!.statusCode,409);
 const {makeEtfSnapshotRoutes}=await import('../backend/etf-data-snapshots.ts');const snapshots=makeEtfSnapshotRoutes({requireAdmin:async()=>({id:'fixture'}),isSameOriginMutation:()=>true});const collision=await snapshots['POST /api/admin/etf-reports/bodies'][0]({body:{reportId:reviewed.id,requestId:'fixture-bodywrite-001',manifest:{}},event:{},params:{},query:{}});assert.equal(collision!.statusCode,409);
 const [draft]=await db.get<any>('etf_reports_v1',[reviewed.id]);const page=draft.manifest.pages[0];await db.tx.update('etf_markdown_pages_v3',[{id:page.id,record:{content:'tampered'},if:{hash:page.hash}}],{patch:true});assert.equal((await readPublishedMarkdown(reviewed.id,'1'))!.statusCode,503);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
