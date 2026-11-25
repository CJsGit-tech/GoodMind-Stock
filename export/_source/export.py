import json,csv,os,sys,collections
root=sys.argv[1]
src=sys.argv[2] if len(sys.argv)>2 else f'{root}/local-app/shared/seed.json'
raw=json.load(open(src)); seed=raw['graph'] if 'graph' in raw else raw
meta={k:v for k,v in seed.items() if not isinstance(v,list) and k not in ('rules','competencyQuestions')}
nodes,edges,ets,pts=seed['nodes'],seed['edges'],seed['entityTypes'],seed['edgeTypes']
def wj(p,o):
    os.makedirs(os.path.dirname(p),exist_ok=True)
    json.dump(o,open(p,'w'),ensure_ascii=False,indent=2)
def wc(p,rows,cols):
    os.makedirs(os.path.dirname(p),exist_ok=True)
    with open(p,'w',newline='',encoding='utf-8-sig') as f:
        w=csv.writer(f);w.writerow(cols)
        for r in rows:w.writerow([json.dumps(r.get(c),ensure_ascii=False) if isinstance(r.get(c),(list,dict)) else ('' if r.get(c) is None else r.get(c)) for c in cols])
ncount=collections.Counter(n['type'] for n in nodes)
O=f'{root}/export/ontology'
wj(f'{O}/_meta.json',meta)
wj(f'{O}/entity_types.json',[{**t,'node_count':ncount[t['name']]} for t in ets])
wc(f'{O}/entity_types.csv',[{**t,'node_count':ncount[t['name']]} for t in ets],['name','parent','abstract','definition','node_count'])
for t in ets:
    ns=[n for n in nodes if n['type']==t['name']]
    if ns: wj(f"{O}/nodes_by_type/{t['name']}.json",ns)
wj(f'{O}/nodes_all.json',nodes)
cols=['id','type','name']+sorted({k for n in nodes for k in n}-{'id','type','name'})
wc(f'{O}/nodes_all.csv',nodes,cols)
ecount=collections.Counter(e['predicate'] for e in edges)
R=f'{root}/export/relations'
wj(f'{R}/_meta.json',meta)
pr=[{**p,'edge_count':ecount[p['predicate']]} for p in pts]
wj(f'{R}/predicates.json',pr)
wc(f'{R}/predicates.csv',pr,['group','predicate','from','to','storage','meaning','edge_count'])
for g in sorted({p['group'] for p in pts}):
    wj(f'{R}/predicates_by_group/{g}.json',[p for p in pr if p['group']==g])
name={n['id']:n['name'] for n in nodes}
for p in pts:
    es=[e for e in edges if e['predicate']==p['predicate']]
    if es: wj(f"{R}/edges_by_predicate/{p['predicate']}.json",es)
wj(f'{R}/edges_all.json',edges)
ee=[{**e,'from_name':name.get(e['from']),'to_name':name.get(e['to'])} for e in edges]
wc(f'{R}/edges_all.csv',ee,['id','predicate','from','from_name','to','to_name','verification_status','evidence_ids'])
print(len(nodes),len(edges),len(ets),len(pts))

# ---- v1.1: declared properties, relation traits, rules, competency questions ----
props=[{'class':t['name'],**p,'values':'|'.join(p.get('values',[]))} for t in ets for p in t.get('properties',[])]
if props:
    wj(f'{O}/properties.json',[{'class':t['name'],'properties':t.get('properties',[])} for t in ets])
    wc(f'{O}/properties.csv',props,['class','name','datatype','required','values','description'])
traits=[{'predicate':p['predicate'],'symmetric':p.get('symmetric',''),'inverse':p.get('inverse',''),'derivedBy':p.get('derivedBy',''),
         'edge_properties':'|'.join(f"{x['name']}:{x['datatype']}" for x in p.get('properties',[]))} for p in pts]
wc(f'{R}/predicate_traits.csv',traits,['predicate','symmetric','inverse','derivedBy','edge_properties'])
if seed.get('rules'):
    wj(f'{O}/rules.json',seed['rules']); wj(f'{R}/rules.json',[r for r in seed['rules'] if r['kind'] in ('cardinality','distinct_targets','derivation','coverage','suggestion')])
if seed.get('competencyQuestions'): wj(f'{O}/competency_questions.json',seed['competencyQuestions'])
print('v1.1 extras:',len(props),'properties,',len(seed.get('rules',[])),'rules')
