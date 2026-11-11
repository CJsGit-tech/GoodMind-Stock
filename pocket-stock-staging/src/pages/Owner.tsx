import React, { useEffect, useState } from 'react';
import type { Decision, Detection, DraftSummary, DraftView } from '../../shared/graph';
import { decidedCount } from '../../shared/graph';
import { LocalGraph } from '../Canvas';
import { ApiError, post, useLoad, useStore } from '../store';
import { Disclosure, Failed, Loading, NavLink, useMedia } from '../ui';

export function OwnerPage({ subject }: { subject: string }) {
  const s = useStore();
  const [id, mode] = subject.split('~');
  return (
    <div className="wrap owner">
      {!s.owner ? <SignIn /> : !id ? <DraftList /> : <DraftReview id={id} text={mode === 'text'} />}
    </div>
  );
}

/** Shown to anyone who is not the signed-in owner. No approved visual exists for this form; it uses the existing styles. */
function SignIn() {
  const s = useStore();
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [state, setState] = useState<{ busy?: boolean; error?: string }>({});
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setState({ busy: true });
    try { await post('/api/owner/login', { user, password }); setPassword(''); await s.refreshSession(); setState({}); }
    catch (err) { setState({ error: (err as ApiError).status === 401 ? 'That name or password is not right.' : 'Sign-in did not work. Try again.' }); }
  };
  return (
    <>
      <p className="label warn">OWNER WORKSPACE</p>
      <h1 tabIndex={-1} className="page-h">This workspace is for the owner</h1>
      <p className="muted lead">Drafts stay private until the owner approves them. Readers and the agent key cannot open them.</p>
      <form className="login" onSubmit={submit}>
        <label htmlFor="o-user">Owner name</label>
        <input id="o-user" className="field" value={user} onChange={e => setUser(e.target.value)} autoComplete="username" required />
        <label htmlFor="o-pass">Password</label>
        <input id="o-pass" className="field" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        {state.error ? <p className="warn" role="alert">{state.error}</p> : null}
        <div className="actions"><button type="submit" className="btn primary" disabled={state.busy}>Sign in</button><NavLink screen="graph" className="btn-text muted-c pad">Back to the graph</NavLink></div>
      </form>
    </>
  );
}

function DraftList() {
  const s = useStore();
  const load = useLoad<{ waiting: DraftSummary[]; last: DraftSummary | null }>('/api/owner/drafts', s.dataTick);
  const signOut = async () => { await post('/api/owner/logout').catch(() => {}); await s.refreshSession(); };
  return (
    <>
      <p className="label warn">OWNER · PRIVATE</p>
      <h1 tabIndex={-1} className="page-h">Drafts</h1>
      <p className="muted">Uploaded by the agent. Nothing here is public until you approve it.</p>
      {!load.data ? (load.error ? <Failed error={load.error} retry={load.reload} what="Drafts: " /> : <Loading label="Loading" />) : load.data.waiting.length ? (
        <ul className="plain">{load.data.waiting.map(d => (
          <li key={d.id}><NavLink screen="review" subject={d.id} className="draft-row" label={`Open draft ${d.number}: ${d.title}`}>
            <span><b>{d.title}</b><small>Draft #{d.number} · {d.decided} of {d.total} decided</small></span><span className="warn strong">Waiting for you</span>
          </NavLink></li>))}</ul>
      ) : (
        <div className="empty">
          <h2 className="h2">No drafts waiting for review</h2>
          <p className="muted">{load.data.last ? `Draft #${load.data.last.number} was ${load.data.last.status}. ` : ''}New drafts appear here when the agent uploads a package.</p>
          {load.data.last?.status === 'published' && load.data.last.bookId ? <p><NavLink screen="article" subject={load.data.last.bookId} className="btn-text">Open the published book</NavLink></p> : null}
        </div>)}
      <p className="small"><button type="button" className="btn-text muted-c" onClick={signOut}>Sign out</button></p>
    </>
  );
}

const proposalText = (d: Detection) => d.proposal === 'existing' ? 'Existing node' : d.proposal === 'alias' ? `Alias of ${d.targetName}` : d.proposal === 'close' ? `Close match: ${d.targetName}` : `New node (${d.nodeType})`;
function decisionText(d: Detection, all: Detection[]) {
  switch (d.decision) {
    case 'confirmed': return 'Confirmed';
    case 'new': return 'New node · no link';
    case 'same': return 'Same node · alias saved';
    case 'rejected': return 'Rejected';
    case 'demoted': { const to = all.find(x => x.id === d.demoteHint?.to); return `Attribute of ${to?.rename || to?.term}${d.proposal === 'existing' ? ' · becomes a link' : ''}`; }
    default: return '';
  }
}
type Outcome = { kind: 'recheck'; conflicts: { detectionId: string; name: string }[] } | { kind: 'failed'; message: string } | { kind: 'published'; bookId: string; newNodes: number } | null;

function DraftReview({ id, text }: { id: string; text: boolean }) {
  const s = useStore();
  const load = useLoad<DraftView>(`/api/owner/drafts/${id}`);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [discarding, setDiscarding] = useState(false);
  const side = useMedia('(min-width: 1100px)'); // with room to spare, the graph preview sits beside the list instead of behind a disclosure
  useEffect(() => { if (load.data) setDraft(load.data); }, [load.data]);
  useEffect(() => { setDraft(null); setOutcome(null); setNotice(''); setOpen(null); setDiscarding(false); setMore(false); }, [id]);
  useEffect(() => { // Escape closes the open row, unless a field inside it is being edited (the field's own Cancel handles that)
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) setOpen(null); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open]);

  /** Runs one owner action. A stale or closed draft is reloaded and explained; a lost session returns to sign-in. */
  async function act<R>(fn: () => Promise<R>, then: (r: R) => void) {
    setBusy(true); setNotice('');
    try { then(await fn()); }
    catch (e) {
      const err = e as ApiError;
      if (err.status === 401) await s.refreshSession();
      else if (err.data?.code === 'publish-failed') setOutcome({ kind: 'failed', message: err.message });
      else { setNotice(err.message); if (err.status === 409) load.reload(); }
    } finally { setBusy(false); }
  }
  if (!draft) return load.error ? (load.error.status === 404 ? <><h1 tabIndex={-1} className="page-h">Draft not found</h1><p><NavLink screen="review" className="btn-text">Back to drafts</NavLink></p></> : <Failed error={load.error} retry={load.reload} what="Draft: " />) : <Loading label="Loading" />;
  const done = decidedCount(draft), total = draft.detections.length, allDecided = done === total;
  const save = (detectionId: string, change: { decision?: Decision | null; rename?: string }, after?: () => void) =>
    act(() => post<DraftView>(`/api/owner/drafts/${id}/decisions`, { version: draft.version, detectionId, ...change }), d => { setDraft(d); after && after(); });
  const approve = (useExisting?: Record<string, boolean>) => act(
    () => post<any>(`/api/owner/drafts/${id}/approve`, { version: draft.version, useExisting }),
    r => { if (r.status === 'recheck') setOutcome({ kind: 'recheck', conflicts: r.conflicts }); else { setOutcome({ kind: 'published', bookId: r.bookId, newNodes: r.newNodes }); setDraft({ ...draft, status: 'published', bookId: r.bookId }); s.reloadGraph(); } });
  const label = <p className="label warn">OWNER · PRIVATE · DRAFT #{draft.number}</p>;

  if (draft.status === 'discarded') return (
    <>
      <h1 tabIndex={-1} className="page-h">Draft discarded</h1>
      <p className="muted lead">Nothing from it was added to the graph. If the agent uploads the same package again with a new request, it becomes a new draft.</p>
      <p className="actions"><NavLink screen="review" className="btn">Back to drafts</NavLink></p>
    </>);
  if (text) return (
    <>
      {label}
      <h1 tabIndex={-1} className="page-h">Draft text</h1>
      <p><NavLink screen="review" subject={id} className="btn-text">← Back to the review</NavLink></p>
      <p className="muted small0">Underline: <span className="warn">waiting for you</span> · <span className="ok">decided</span></p>
      {draft.paragraphs.map((p, i) => <p key={i} className="draft-p">{p.map((g, j) => g.d ? <span key={j} className={`hl ${draft.detections.find(x => x.id === g.d)?.decision ? 'done' : 'wait'}`}>{g.t}</span> : <span key={j}>{g.t}</span>)}</p>)}
    </>);
  const published = draft.status === 'published';
  const preview = <LocalGraph own data={{ center: draft.preview.nodes[0]?.id, nodes: draft.preview.nodes, links: draft.preview.links }} label="What this draft would add to the graph" />;
  const previewNote = <p className="muted small0">Dashed amber nodes and links are not public yet. They follow your choices in the list.</p>;
  const aside = side && !published;
  return (
    <div className={aside ? 'review wide' : 'review'}>
      <div className="review-main">
      {label}
      <h1 tabIndex={-1} className="page-h">{draft.title}</h1>
      <p className="progress" aria-live="polite"><b className={allDecided ? 'ok' : 'warn'}>{done} of {total} decided</b></p>
      {notice ? <p className="warn notice" role="alert"><span>{notice}</span><button type="button" className="x" aria-label="Dismiss this message" onClick={() => setNotice('')}>×</button></p> : null}
      {outcome?.kind === 'recheck' ? (
        <div role="alert" className="callout">
          <p className="label warn">CHECKED AGAIN AT APPROVAL</p>
          <p>{outcome.conflicts.map(c => `「${c.name}」`).join('、')} now exist{outcome.conflicts.length === 1 ? 's' : ''} in the graph. {outcome.conflicts.length === 1 ? 'It was' : 'They were'} added after the agent’s lookup. Nothing is published until you decide.</p>
          <p className="muted small0">An official name belongs to one node. To keep a separate node, give it a different official name.</p>
          <div className="actions">
            <button type="button" className="btn-text" disabled={busy} onClick={() => approve(Object.fromEntries(outcome.conflicts.map(c => [c.detectionId, true])))}>Use the existing node</button>
            <button type="button" className="btn-text plain-c" disabled={busy} onClick={() => { const first = outcome.conflicts[0].detectionId; setOutcome(null); save(first, { decision: null }, () => setOpen(first)); }}>Rename it instead</button>
          </div>
        </div>) : null}
      {outcome?.kind === 'failed' ? (
        <div role="alert" className="callout">
          <p className="label warn">PUBLISH FAILED</p>
          <p>Publishing did not finish, so nothing was added to the graph and the book stays private. Your decisions are kept.</p>
          <div className="actions"><button type="button" className="btn-text" disabled={busy} onClick={() => { setOutcome(null); approve(); }}>Retry publishing</button><button type="button" className="btn-text muted-c" onClick={() => setOutcome(null)}>Not now</button></div>
        </div>) : null}
      {published ? (
        <div className="callout ok-c" role="status">
          <p className="ok strong">✓ Published{outcome?.kind === 'published' ? ` · ${outcome.newNodes} new node${outcome.newNodes === 1 ? '' : 's'}` : ''} · graph updated</p>
          <div className="actions">{draft.bookId ? <NavLink screen="article" subject={draft.bookId} className="btn-text">Open the book</NavLink> : null}<NavLink screen="graph" className="btn-text">See it in the graph</NavLink></div>
        </div>) : null}
      {!published && !aside ? <Disclosure title="Preview in the graph">{preview}{previewNote}</Disclosure> : null}
      <ul className="plain rows">{draft.detections.map(d => <li key={d.id}><Row d={d} all={draft.detections} attrs={draft.targetAttrs[d.id]} open={open === d.id} setOpen={v => setOpen(cur => (v ? d.id : cur === d.id ? null : cur))} locked={published || busy} published={published} save={save} /></li>)}</ul>
      {!published ? (
        <div className="foot-bar">
          <div className="foot-main">
            <span className="muted" aria-live="polite">{allDecided ? 'Every proposal is decided.' : `${total - done} still waiting for you`}</span>
            <button type="button" className="btn primary" disabled={!allDecided || busy} aria-describedby={allDecided ? undefined : 'why-not'} onClick={() => approve()}>Approve &amp; publish</button>
            {!allDecided ? <span id="why-not" className="sr-only">Unavailable until every proposal is decided.</span> : null}
          </div>
          <button type="button" className="btn-text plain-c" aria-expanded={more} aria-controls="more-actions" onClick={() => { setMore(m => !m); setDiscarding(false); }}>More</button>
          {more && !discarding ? (
            <div id="more-actions" className="more">
              <NavLink screen="review" subject={`${id}~text`} className="btn-text plain-c">Read the full draft text</NavLink>
              <button type="button" className="btn-text warn-c" disabled={busy} onClick={() => setDiscarding(true)}>Discard draft</button>
            </div>) : null}
          {more && discarding ? (
            <div id="more-actions" className="more confirm" role="group" aria-label="Discard this draft">
              <span>Discard this draft? Your {done} decision{done === 1 ? '' : 's'} will be lost and this cannot be undone.</span>
              <button type="button" className="btn-text warn-c" disabled={busy} onClick={() => act(() => post<DraftView>(`/api/owner/drafts/${id}/discard`, { version: draft.version }), d => { setDraft(d); s.reloadGraph(); })}>Yes, discard</button>
              <button type="button" className="btn-text plain-c" autoFocus onClick={() => setDiscarding(false)}>Keep draft</button>
            </div>) : null}
        </div>) : null}
      </div>
      {aside ? <aside className="review-side" aria-label="Preview in the graph"><p className="label">PREVIEW IN THE GRAPH</p>{preview}{previewNote}</aside> : null}
    </div>
  );
}

/** A row shows only the term, the proposal and its state. Evidence and actions open on demand. */
function Row({ d, all, attrs, open, setOpen, locked, published, save }: { d: Detection; all: Detection[]; attrs?: { name: string; value: string }[]; open: boolean; setOpen: (v: boolean) => void; locked: boolean; published: boolean; save: (id: string, change: { decision?: Decision | null; rename?: string }, after?: () => void) => void }) {
  const [panel, setPanel] = useState<'' | 'match' | 'demote' | 'rename'>('');
  const term = d.rename || d.term;
  const [name, setName] = useState(term);
  const decide = (decision: Decision) => save(d.id, { decision }, () => { setOpen(false); setPanel(''); });
  const canRename = (d.proposal === 'new' || d.proposal === 'close') && !d.decision;
  const hintTarget = all.find(x => x.id === d.demoteHint?.to);
  return (
    <div className="row">
      <button type="button" className="row-head" aria-expanded={open} onClick={() => { setOpen(!open); setPanel(''); }}>
        <span><b className="term">{term}</b>{d.rename ? <small className="muted"> (renamed from {d.term})</small> : null}<span className={d.proposal === 'close' ? 'warn' : 'muted'}>{proposalText(d)}</span></span>
        <span className={d.decision === 'rejected' ? 'muted strong' : d.decision ? 'ok strong' : 'warn strong'}>{d.decision ? `${d.decision === 'rejected' ? '✕' : '✓'} ${decisionText(d, all)}` : published ? '' : 'Waiting'}</span>
      </button>
      {open ? (
        <div className="row-open">
          {d.sentence ? <p className="muted"><span className="label">SOURCE</span> 「{d.sentence}」</p> : null}
          {d.note ? <p className="muted">{d.note}</p> : null}
          {d.decision && !published ? <div className="actions"><button type="button" className="btn-text plain-c" disabled={locked} aria-label={`Undo the decision for ${term}`} onClick={() => save(d.id, { decision: null })}>Undo decision</button></div> : null}
          {d.decision || published ? null : (
            <div className="actions">
              {canRename ? <button type="button" className="btn-text plain-c" aria-label={`Rename ${term}`} onClick={() => { setName(term); setPanel(panel === 'rename' ? '' : 'rename'); }}>Rename</button> : null}
              {d.proposal === 'close'
                ? <button type="button" className="btn-text warn-c" aria-label={`Review close match for ${term}`} onClick={() => setPanel(panel === 'match' ? '' : 'match')}>Review match</button>
                : <button type="button" className="btn-text" disabled={locked} aria-label={`Confirm ${term}`} onClick={() => decide('confirmed')}>Confirm</button>}
              {d.demoteHint && d.proposal !== 'alias' && d.proposal !== 'close' ? <button type="button" className="btn-text plain-c" onClick={() => setPanel(panel === 'demote' ? '' : 'demote')}>Demote to attribute</button> : null}
              <button type="button" className="btn-text muted-c" disabled={locked} aria-label={`Reject ${term}`} onClick={() => decide('rejected')}>Reject</button>
            </div>)}
          {panel === 'rename' && !d.decision ? (
            <form className="inline-panel" onSubmit={e => { e.preventDefault(); const v = name.trim(); if (v) save(d.id, { rename: v }, () => setPanel('')); }}>
              <label htmlFor={`rn-${d.id}`}>Official name for the new node</label>
              <input id={`rn-${d.id}`} className="field" value={name} onChange={e => setName(e.target.value)} maxLength={80} autoFocus onKeyDown={e => { if (e.key === 'Escape') setPanel(''); }} />
              <div className="actions"><button type="submit" className="btn-text" disabled={locked || !name.trim()}>Save name</button><button type="button" className="btn-text plain-c" onClick={() => setPanel('')}>Cancel</button></div>
            </form>) : null}
          {panel === 'match' && !d.decision ? (
            <div role="group" aria-label="Close match" className="inline-panel warn-b">
              <p className="label">EXISTING NODE</p>
              <p><b>{d.targetName}</b>{attrs?.length ? <span className="muted">　{attrs.map(a => `${a.name} ${a.value}`).join(' · ')}</span> : <span className="muted">　No attributes yet</span>}</p>
              <p>Nothing links automatically. Is it the same idea as the existing node?</p>
              <div className="actions">
                <button type="button" className="btn-text plain-c" disabled={locked} onClick={() => decide('same')}>Same node (add alias)</button>
                <button type="button" className="btn-text" disabled={locked} onClick={() => decide('new')}>New node</button>
                <button type="button" className="btn-text muted-c" onClick={() => setPanel('')}>Cancel</button>
              </div>
            </div>) : null}
          {panel === 'demote' && !d.decision && d.demoteHint ? (
            <div role="group" aria-label="Demote to attribute" className="inline-panel">
              <p>Make {term} an attribute of {hintTarget?.rename || hintTarget?.term} ({d.demoteHint.name} = {d.targetName || term}). {d.proposal === 'existing' ? 'Its value equals an existing node’s official name, so it is saved as a link.' : 'No node has this official name, so it is saved as text.'}</p>
              <div className="actions"><button type="button" className="btn-text" disabled={locked} onClick={() => decide('demoted')}>Demote to attribute</button><button type="button" className="btn-text muted-c" onClick={() => setPanel('')}>Cancel</button></div>
            </div>) : null}
        </div>) : null}
    </div>
  );
}
