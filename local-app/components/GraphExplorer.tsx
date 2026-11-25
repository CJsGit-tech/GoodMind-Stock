import { QuestionResearch } from './QuestionResearch';
import { searchEntities } from './questionQuery';
import { relationshipStatusMatches } from './relationshipProof';
import { ResearchControls } from './ResearchControls';
import { computeResearch, type ResearchResult } from './researchScope';
import { visibleMetadata, readableText, metadataLabel } from './presentation';
import { useI18n } from './i18n';
import { searchableNames } from './locale-core';
import { computeExploration } from './graphExploration';
import { withCompetitionProjections } from './competitionProjections';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Building2,
  ChevronRight,
  ExternalLink,
  Filter,
  Focus,
  Info,
  Minus,
  Network,
  Plus,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import {
  displayValue,
  EdgeRecord,
  Graph,
  groupLabels,
  NodeRecord,
  statusLabels,
  typeColor,
  typeLabels,
} from './types';

import { graphFilterOptions } from './graphFilters';

type Point = { x: number; y: number };
function layout(
  nodes: NodeRecord[],
  edges: EdgeRecord[]
): Record<string, Point> {
  const ordered = [...nodes].sort(
    (a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id)
  );
  const points: Record<string, Point> = {};
  ordered.forEach((n, i) => {
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const radius = 65 + Math.sqrt(i / Math.max(1, ordered.length)) * 350;
    points[n.id] = {
      x: 600 + Math.cos(angle) * radius,
      y: 480 + Math.sin(angle) * radius,
    };
  });
  for (let step = 0; step < 160; step++) {
    const forces: Record<string, Point> = Object.fromEntries(
      ordered.map(n => [n.id, { x: 0, y: 0 }])
    );
    for (let i = 0; i < ordered.length; i++) {
      const a = points[ordered[i].id];
      for (let j = i + 1; j < ordered.length; j++) {
        const b = points[ordered[j].id];
        const dx = a.x - b.x || 0.1;
        const dy = a.y - b.y || 0.1;
        const dist = Math.max(30, Math.hypot(dx, dy));
        const strength = 24000 / (dist * dist);
        forces[ordered[i].id].x += (dx / dist) * strength;
        forces[ordered[i].id].y += (dy / dist) * strength;
        forces[ordered[j].id].x -= (dx / dist) * strength;
        forces[ordered[j].id].y -= (dy / dist) * strength;
      }
    }
    for (const e of edges) {
      const a = points[e.from];
      const b = points[e.to];
      if (!a || !b) continue;
      const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const force = (dist - 190) * 0.009;
      forces[e.from].x += ((b.x - a.x) / dist) * force;
      forces[e.from].y += ((b.y - a.y) / dist) * force;
      forces[e.to].x -= ((b.x - a.x) / dist) * force;
      forces[e.to].y -= ((b.y - a.y) / dist) * force;
    }
    for (const n of ordered) {
      const p = points[n.id];
      p.x = Math.max(
        85,
        Math.min(1115, p.x + forces[n.id].x + (600 - p.x) * 0.003)
      );
      p.y = Math.max(
        70,
        Math.min(880, p.y + forces[n.id].y + (480 - p.y) * 0.003)
      );
    }
  }
  // Project the force layout into non-overlapping label-aware slots.
  // Keeping each node close to its force position preserves related clusters.
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length * 0.8)));
  const rows = Math.max(1, Math.ceil(nodes.length / columns));
  const cellWidth = 1200 / columns;
  const cellHeight = 850 / rows;
  const slots: Point[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      slots.push({
        x: cellWidth * (column + 0.5),
        y: 40 + row * cellHeight,
      });
    }
  }
  const available = [...slots];
  // Start with connected hubs, leaving peripheral nodes around them.
  const byDegree = [...ordered].sort((a, b) =>
    edges.filter(e => e.from === b.id || e.to === b.id).length -
    edges.filter(e => e.from === a.id || e.to === a.id).length
  );
  for (const node of byDegree) {
    const point = points[node.id];
    let best = 0;
    for (let i = 1; i < available.length; i++) {
      if (Math.hypot(available[i].x - point.x, available[i].y - point.y) <
          Math.hypot(available[best].x - point.x, available[best].y - point.y)) best = i;
    }
    points[node.id] = available.splice(best, 1)[0];
  }
  return points;
}
function nodeNameLines(node: NodeRecord, labelWidth: number): string[] {
  const widthOf = (value: string) => [...value].reduce((sum, char) =>
    sum + (/[\u3400-\u9fff]/.test(char) ? 23 : /\s/.test(char) ? 7 : 13), 0);
  const maxWidth = labelWidth - 24;
  const tokens = node.name.match(/[\u3400-\u9fff]|[^\s\u3400-\u9fff]+|\s+/g) || [];
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    if (widthOf(token) <= maxWidth) {
      if (line.trim() && widthOf(line + token) > maxWidth) {
        lines.push(line.trim());
        line = token.trimStart();
      } else {
        line += token;
      }
    } else {
      if (line.trim()) lines.push(line.trim());
      line = '';
      for (const char of token) {
        if (widthOf(line + char) > maxWidth && line) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
  }
  if (line.trim()) lines.push(line.trim());
  if (node.type !== 'Company' && lines.length > 2) {
    lines.splice(2);
    lines[1] = lines[1].replace(/\s+$/, '') + '…';
    while (widthOf(lines[1]) > maxWidth) lines[1] = lines[1].slice(0, -2) + '…';
  }
  return lines;
}
function neighborhoodLayout(nodes: NodeRecord[], edges: EdgeRecord[], root: string): Record<string, Point> {
  const points: Record<string, Point> = { [root]: { x: 600, y: 430 } };
  const depth = new Map<string, number>([[root, 0]]);
  let frontier = [root];
  for (let level = 1; frontier.length && level <= 3; level++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const edge of edges) {
        const other = edge.from === id ? edge.to : edge.to === id ? edge.from : '';
        if (other && !depth.has(other)) next.add(other);
      }
    }
    frontier = [...next].sort();
    frontier.forEach(id => depth.set(id, level));
  }
  const maxDepth = Math.max(1, ...depth.values());
  for (let level = 1; level <= maxDepth; level++) {
    const ring = nodes.filter(node => depth.get(node.id) === level).sort((a, b) => a.id.localeCompare(b.id));
    const radius = maxDepth === 1 ? (nodes.length <= 4 ? 190 : 275) : 150 + (level - 1) * 110;
    ring.forEach((node, index) => {
      const angle = ring.length === 1 ? 0 : -Math.PI / 2 + (index / Math.max(1, ring.length)) * Math.PI * 2 + (level % 2 ? 0.28 : -0.2);
      points[node.id] = {
        x: 600 + Math.cos(angle) * radius * 1.24,
        y: 430 + Math.sin(angle) * radius,
      };
    });
  }
  if (nodes.length <= 4) {
    const neighbors = nodes.filter(node => node.id !== root);
    neighbors.forEach((node, index) => {
      const angle = index / neighbors.length * Math.PI * 2;
      points[node.id] = {
        x: 600 + Math.cos(angle) * 240,
        y: 430 + Math.sin(angle) * 195,
      };
    });
  }
  // Place complete node + label rectangles, not point centers. Root stays fixed.
  // Greedy nearest-free placement cannot reintroduce collisions through clamping.
  const placed = [root];
  const byId = Object.fromEntries(nodes.map(node => [node.id, node]));
  const bounds = (id: string, point: Point) => ({
    left: point.x - 124,
    right: point.x + 124,
    top: point.y - 35,
    bottom: point.y + 45 + nodeNameLines(byId[id], 224).length * 24,
  });
  const collides = (id: string, point: Point) => {
    const a = bounds(id, point);
    return placed.some(other => {
      const b = bounds(other, points[other]);
      return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    });
  };
  const ordered = nodes.filter(node => node.id !== root).sort((a, b) =>
    (depth.get(a.id) || 0) - (depth.get(b.id) || 0) || a.id.localeCompare(b.id)
  );
  for (const node of ordered) {
    const desired = points[node.id] || { x: 600, y: 430 };
    const safe = {
      x: Math.max(130, Math.min(1070, desired.x)),
      y: Math.max(55, Math.min(810, desired.y)),
    };
    if (!collides(node.id, safe)) {
      points[node.id] = safe;
      placed.push(node.id);
      continue;
    }
    let best: Point | undefined;
    let bestDistance = Infinity;
    // Dense candidate sampling retains organic positions rather than snapping
    // every node to a regular grid.
    for (let y = 55; y <= 810; y += 10) {
      for (let x = 130; x <= 1070; x += 10) {
        const candidate = { x, y };
        const distance = Math.hypot(x - desired.x, y - desired.y);
        if (distance >= bestDistance || collides(node.id, candidate)) continue;
        best = candidate;
        bestDistance = distance;
      }
    }
    // Extremely dense user graphs may need additional space; never overlap.
    if (!best) {
      let y = 950;
      while (collides(node.id, { x: 600, y })) y += 150;
      best = { x: 600, y };
    }
    points[node.id] = best;
    placed.push(node.id);
  }
  return points;
}
function sourceIds(record: NodeRecord | EdgeRecord): string[] {
  return Array.isArray(record.evidence_ids)
    ? record.evidence_ids.map(String)
    : [];
}
export function GraphExplorer({
  graph: sourceGraph,
  privateGraph,
  publishedGraph = false,
}: {
  graph: Graph;
  privateGraph: boolean;
  publishedGraph?: boolean;
}) {
  const { locale, t, name, nameLanguage, typeLabel, groupLabel, statusLabel, propertyLabel } = useI18n();
  // A presentation-only copy. Saved records and identity stay untouched.
  const graph = useMemo<Graph>(() => ({
    ...withCompetitionProjections(sourceGraph),
    nodes: sourceGraph.nodes.map(node => ({
      ...node,
      name: name(node),
      aliases: [...(Array.isArray(node.aliases) ? node.aliases : []), ...searchableNames(node)],
    })),
  }), [sourceGraph, name]);
  const [query, setQuery] = useState('');
  const [entry, setEntry] = useState<'question'|'browse'|'entity'>('question');
  const [type, setType] = useState('');
  const [group, setGroup] = useState('');
  const [status, setStatus] = useState('');
  const [limit, setLimit] = useState(50);
  const [evidence, setEvidence] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [edgeId, setEdgeId] = useState('');
  const [research, setResearch] = useState<ResearchResult | null>(null);
  const [researchFocus, setResearchFocus] = useState('');
  const [researchPriority, setResearchPriority] = useState('');
  const [researchVisible, setResearchVisible] = useState(false);
  const [researchRevision, setResearchRevision] = useState(0);
  const researchStage = useRef<HTMLElement>(null);
  const clearResearch = () => {
    if (research) setResearchRevision(value => value + 1);
    setResearch(null); setResearchFocus(''); setResearchPriority(''); setResearchVisible(false);
  };
  const applyResearch = (result: ResearchResult | null) => {
    if (!result && !research) return;
    if (result && research && JSON.stringify(research.query) === JSON.stringify(result.query)) {
      setResearch(result);
      return;
    }
    setResearch(result); setResearchFocus(result?.rootId || ''); setResearchPriority(''); setResearchVisible(false);
    setSelectedId(''); setEdgeId(''); setHops(0); setOverview(false);
    setDetailsOpen(false); setAssessmentReturn(null);
    setManualPositions({}); setPan({ x: 0, y: 0 }); setZoom(1);
  };
  const showResearch = (id: string, rowId = '') => {
    setResearchPriority(rowId); setResearchFocus(id); setResearchVisible(true); setDetailsOpen(false);
    setSelectedId(id); setEdgeId('');
    setManualPositions({}); setPan({ x: 0, y: 0 }); setZoom(1);
    requestAnimationFrame(() => researchStage.current?.scrollIntoView({ block: 'nearest' }));
  };
  const inspectResearch = (id: string) => {
    const relation = graph.edges.find(e => e.id === id);
    if (!relation) return;
    setResearchPriority(id); setResearchFocus(relation.from); setResearchVisible(true);
    setSelectedId(relation.from); setEdgeId(id); setDetailsOpen(true);
    requestAnimationFrame(() => researchStage.current?.scrollIntoView({ block: 'nearest' }));
  };
  const [assessmentReturn, setAssessmentReturn] = useState<{
    rootId: string; edgeId: string; hops: number; overview: boolean; researchFocus: string;
  } | null>(null);

  const [hops, setHops] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [overview, setOverview] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const filterDialog = useRef<HTMLDialogElement>(null);
  const detailDialog = useRef<HTMLDialogElement>(null);
  const [draftFilters, setDraftFilters] = useState({ type: '', group: '', status: '', limit: 50, evidence: false });
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const dialog = filterDialog.current;
    if (!dialog || !filtersOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [filtersOpen]);
  useEffect(() => {
    const dialog = detailDialog.current;
    if (!dialog || !detailsOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    if (mobile) dialog.showModal(); else dialog.show();
    return () => {
      dialog.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [detailsOpen, mobile]);
  const openFilters = () => {
    setDraftFilters({ type, group, status, limit, evidence });
    setFiltersOpen(true);
  };
  const applyFilters = () => {
    clearResearch();
    setType(draftFilters.type); setGroup(draftFilters.group);
    setStatus(draftFilters.status); setLimit(draftFilters.limit);
    setEvidence(draftFilters.evidence); setFiltersOpen(false);
    if (!selectedId) setOverview(true);
  };
  const selectEntity = (id: string, preserveResearch = false) => {
    if (!preserveResearch) clearResearch();
    else setResearchFocus(id);
    setAssessmentReturn(null);
    setSelectedId(id);
    setEdgeId('');
    setHops(1);
    setDetailsOpen(!mobile);
    setOverview(false);
    setSuggestionsOpen(false);
    setQuery('');
  };
  const suggestions = useMemo(() => searchEntities(graph, query, { limit: 8 }).entities, [graph, query]);
  function switchEntry(next: typeof entry) {
    if (next === entry) return;
    setEntry(next); clearResearch();
    setSelectedId(''); setEdgeId(''); setHops(0); setOverview(false);
    setQuery(''); setSuggestionsOpen(false); setDetailsOpen(false); setAssessmentReturn(null);
    setFiltersOpen(false);
    setManualPositions({}); setPan({ x: 0, y: 0 }); setZoom(1);
  }
  const enterOverview = () => {
    clearResearch();
    setAssessmentReturn(null);
    setOverview(true); setSelectedId(''); setEdgeId(''); setHops(0);
    setDetailsOpen(false); setSuggestionsOpen(false); setQuery('');
  };
  const graphVisible = research ? researchVisible && research.rows.length > 0 : overview || !!selectedId;
  useEffect(() => {
    if (!detailsOpen || mobile) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !filterDialog.current?.open) {
        event.preventDefault(); setDetailsOpen(false);
      }
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [detailsOpen, mobile]);
  const activeFilterCount = Number(!!type) + Number(!!group) + Number(!!status) + Number(evidence) + Number(limit !== 50);

  const svgRef = useRef<SVGSVGElement>(null);
  const draggedNode = useRef(false);
  const [manualPositions, setManualPositions] = useState<Record<string, Point>>({});
  const drag = useRef<{ start: Point; origin: Point; nodeId?: string } | null>(null);
  const view = useRef({ zoom, pan });
  view.current = { zoom, pan };
  const svgPoint = (clientX: number, clientY: number): Point => {
    const svg = svgRef.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    return point.matrixTransform(matrix.inverse());
  };
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = svgPoint(event.clientX, event.clientY);
      const { zoom: oldZoom, pan: oldPan } = view.current;
      const nextZoom = Math.min(3, Math.max(0.45, oldZoom * Math.exp(-event.deltaY * 0.0015)));
      const ratio = nextZoom / oldZoom;
      const nextPan = {
        x: point.x - 600 - (point.x - 600 - oldPan.x) * ratio,
        y: point.y - 480 - (point.y - 480 - oldPan.y) * ratio,
      };
      view.current = { zoom: nextZoom, pan: nextPan };
      setZoom(nextZoom);
      setPan(nextPan);
    };
    svg.addEventListener('wheel', wheel, { passive: false });
    return () => svg.removeEventListener('wheel', wheel);
  });
  const byId = useMemo(
    () => Object.fromEntries(graph.nodes.map(n => [n.id, n])),
    [graph]
  );
  const typesByPredicate = useMemo(
    () => Object.fromEntries(graph.edgeTypes.map(e => [e.predicate, e])),
    [graph]
  );
  // Options come from the full authorized snapshot, before search, toggles or node cap.
  const filterOptions = useMemo(() => graphFilterOptions(graph), [graph]);
  useEffect(() => {
    if (type && !filterOptions.types.includes(type)) setType('');
    if (group && !filterOptions.groups.includes(group)) setGroup('');
    if (status && !filterOptions.statuses.includes(status)) setStatus('');
  }, [filterOptions, type, group, status]);
  const scoped = useMemo(() => research ? computeResearch(graph, research.query, researchFocus, researchPriority) : null, [graph, research, researchFocus, researchPriority]);
  const legacy = useMemo(() => computeExploration(graph, {
    query: '', type, group, status, limit, evidence, selectedId, focusOnly: false, hops,
  }), [graph, type, group, status, limit, evidence, selectedId, hops]);
  const filtered = scoped ? {
    nodes: scoped.nodes, edges: scoped.edges, total: scoped.nodes.length,
    added: 0, hiddenByType: 0, hiddenByCap: 0, outsideBase: false,
  } : legacy;
  const layoutRoot = scoped ? scoped.nodes.find(node => node.id === researchFocus)?.id || '' : hops > 0 ? selectedId : '';
  const autoPositions = useMemo(
    () => layoutRoot
      ? neighborhoodLayout(filtered.nodes, filtered.edges, layoutRoot)
      : layout(filtered.nodes, filtered.edges),
    [scoped, legacy, layoutRoot]
  );
  const positions = { ...autoPositions, ...manualPositions };
  const focusHeight = Math.max(960, ...Object.values(autoPositions).map(point => point.y + 140));
  const selected = byId[selectedId];
  useEffect(() => {
    if (hops > 0) {
      setManualPositions({});
      setPan({ x: 0, y: 0 });
      setZoom(1);
    }
  }, [hops, selectedId]);
  useEffect(() => {
    if (!byId[selectedId]) { setHops(0); setDetailsOpen(false); }
  }, [byId, selectedId]);
  const selectedEdge = graph.edges.find(e => e.id === edgeId && (scoped ? scoped.edges.some(edge => edge.id === e.id) : relationshipStatusMatches(e, status)));
  const relationList = (scoped && !assessmentReturn ? scoped.edges : graph.edges).filter(
    e => (e.from === selectedId || e.to === selectedId) && (scoped ? !assessmentReturn || scoped.query.proof !== 'official' || relationshipStatusMatches(e, 'officially_disclosed') : relationshipStatusMatches(e, status))
  );
  const sources = [
    ...new Set([
      ...(selectedEdge
        ? [...sourceIds(selectedEdge), ...(scoped?.rows.find(row => row.id === selectedEdge.id)?.sources.map(node => node.id) || [])]
        : [...(selected ? sourceIds(selected) : []), ...relationList.flatMap(sourceIds)]),
    ]),
  ]
    .map(id => byId[id])
    .filter(Boolean);
  const reset = () => {
    clearResearch();
    setAssessmentReturn(null);
    setQuery('');
    setType('');
    setGroup('');
    setStatus('');
    setLimit(50);
    setEvidence(false);

    setHops(0);
    setSelectedId('');
    setOverview(true);
    setEdgeId('');
    setDetailsOpen(false);
    setSuggestionsOpen(false);
    setPan({ x: 0, y: 0 });
    setZoom(1);
    setManualPositions({});
  };
  return (
    <>
      <nav className="question-entry-nav" aria-label={locale === 'en' ? 'Research entry points' : '研究入口'}>
        <button type="button" aria-pressed={entry === 'question'} onClick={() => switchEntry('question')}>{locale === 'en' ? 'Ask a question' : '提問查關係'}</button>
        <button type="button" aria-pressed={entry === 'browse'} onClick={() => switchEntry('browse')}>{locale === 'en' ? 'Browse industries' : '依產業瀏覽'}</button>
        <button type="button" aria-pressed={entry === 'entity'} onClick={() => switchEntry('entity')}>{locale === 'en' ? 'Entity graph' : '實體圖譜'}</button>
      </nav>
      {entry === 'question' && <QuestionResearch graph={graph} onApply={applyResearch} onGraph={showResearch} published={publishedGraph} />}
      {entry === 'entity' && <div className="graph-search-toolbar">
        <div className="entity-picker" onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSuggestionsOpen(false);
        }}>
          <label className="entity-search-input">
            <Search size={19} />
            <input
              ref={searchRef}
              role="combobox"
              aria-label={t('搜尋並選取實體')}
              aria-autocomplete="list"
              aria-controls="entity-suggestions"
              aria-expanded={suggestionsOpen}
              aria-activedescendant={suggestionsOpen && suggestions.length ? `entity-option-${Math.min(suggestionIndex, suggestions.length - 1)}` : undefined}
              placeholder={t('搜尋公司、產品或技術…')}
              value={query}
              onFocus={() => { if (query.trim()) setSuggestionsOpen(true); }}
              onClick={() => setSuggestionsOpen(true)}
              onChange={event => { setQuery(event.target.value); setSuggestionIndex(0); setSuggestionsOpen(true); }}
              onKeyDown={event => {
                if (event.key === 'ArrowDown') { event.preventDefault(); setSuggestionsOpen(true); setSuggestionIndex(index => Math.min(suggestions.length - 1, index + 1)); }
                if (event.key === 'ArrowUp') { event.preventDefault(); setSuggestionIndex(index => Math.max(0, index - 1)); }
                if (event.key === 'Enter' && suggestionsOpen && suggestions.length) {
                  event.preventDefault(); selectEntity(suggestions[Math.max(0, Math.min(suggestionIndex, suggestions.length - 1))].id);
                }
                if (event.key === 'Escape') { event.preventDefault(); setSuggestionsOpen(false); }
              }}
            />
            {query && <button type="button" aria-label={t('清除搜尋')} onClick={() => { setQuery(''); setSuggestionIndex(0); searchRef.current?.focus(); }}><X size={15} /></button>}
          </label>
          {suggestionsOpen && (
            <div className="entity-suggestions">
              <div className="suggestions-caption">{query ? t('搜尋結果') : t('選取公司，探索真實連結')}</div>
              <ul id="entity-suggestions" role="listbox" aria-label={t('實體搜尋結果')}>
                {suggestions.map((node, index) => (
                  <li id={`entity-option-${index}`} key={node.id} role="option"
                    aria-selected={index === suggestionIndex}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => selectEntity(node.id)}>
                    <i style={{ background: typeColor(node.type) }} />
                    <span lang={nameLanguage(sourceGraph.nodes.find(record => record.id === node.id))}>{node.name}</span>
                    <small>{typeLabel(node.type)}</small><ChevronRight size={14} />
                  </li>
                ))}
              </ul>
              {!suggestions.length && <p className="suggestion-empty">{t('找不到實體，試試其他名稱或代號。')}</p>}
            </div>
          )}
        </div>
        <button className="overview-button" onClick={enterOverview} aria-pressed={overview && !selectedId}>
          <Network size={16} />{t('完整圖譜')}
        </button>
        <button className="advanced-filter-button" onClick={openFilters}>
          <Filter size={16} />{t('進階篩選')}{activeFilterCount > 0 && <b>{activeFilterCount}</b>}
        </button>
      </div>}
      {entry === 'browse' && <ResearchControls key={researchRevision} graph={graph} onApply={applyResearch} onFocus={showResearch} onInspect={inspectResearch} />}
      <div className="graph-context-strip" hidden={!graphVisible} style={!graphVisible ? { display: 'none' } : undefined}>
        <span className="graph-dataset">{privateGraph ? t('私人研究圖譜') : t(publishedGraph ? '公開圖譜' : '公開示範圖譜')}</span>
        {!scoped && type && <button className="filter-chip" onClick={() => setType('')}>{typeLabel(type)}<X size={11} /><span className="sr-only">{t('移除篩選')}</span></button>}
        {!scoped && group && <button className="filter-chip" onClick={() => setGroup('')}>{groupLabel(group)}<X size={11} /><span className="sr-only">{t('移除篩選')}</span></button>}
        {!scoped && status && <button className="filter-chip" onClick={() => setStatus('')}>{statusLabel(status)}<X size={11} /><span className="sr-only">{t('移除篩選')}</span></button>}
        {!scoped && evidence && <button className="filter-chip" onClick={() => setEvidence(false)}>{t('來源與主張')}<X size={11} /><span className="sr-only">{t('移除篩選')}</span></button>}
        {!scoped && <button className="node-cap-control" onClick={openFilters}>{t('最多 {count} 節點', { count: limit })}</button>}
      </div>
      <div className={`explorer graph-stage ${graphVisible ? '' : 'research-stage-idle'} ${detailsOpen && selected ? 'with-details' : ''}`}>
        <dialog ref={filterDialog} className="filter-dialog"
          aria-labelledby="advanced-filter-title"
          onCancel={event => { event.preventDefault(); setFiltersOpen(false); }}
          onClick={event => {
            if (event.target !== event.currentTarget) return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setFiltersOpen(false);
          }}>
          <div className="panel-heading">
            <h2 id="advanced-filter-title">{t('進階篩選')}</h2>
            <button aria-label={t('關閉篩選')} onClick={() => setFiltersOpen(false)}><X size={18} /></button>
          </div>
          <div className="filter-content">
            <label className="field-label">
              {t('實體類型')}<select
                value={draftFilters.type}
                onChange={e => setDraftFilters(value => ({ ...value, type: e.target.value }))}
                aria-label={t('實體類型篩選')}
              >
                <option value="">{t('全部類型')}</option>
                {filterOptions.types.map(t => (
                  <option key={t} value={t}>
                    {typeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <div className="legend">
              {['Company', 'Product', 'Technology', 'MarketSegment'].map(t => (
                <span key={t}>
                  <i style={{ background: typeColor(t) }} />
                  {typeLabel(t)}
                </span>
              ))}
            </div>
            <label className="field-label">
              {t('關係類別')}<select
                aria-label={t('關係類別篩選')}
                value={draftFilters.group}
                onChange={e => setDraftFilters(value => ({ ...value, group: e.target.value }))}
              >
                <option value="">{t('全部關係')}</option>
                {filterOptions.groups.map(g => (
                  <option key={g} value={g}>
                    {groupLabel(g)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              {t('驗證狀態')}<select
                aria-label={t('驗證狀態篩選')}
                value={draftFilters.status}
                onChange={e => setDraftFilters(value => ({ ...value, status: e.target.value }))}
              >
                <option value="">{t('全部狀態')}</option>
                {filterOptions.statuses.map(key => (
                  <option key={key} value={key}>
                    {statusLabel(key)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-label">
              {t('最大節點數')}<span className="field-caption">{t('預設 50')}</span>
              <div className="range-row">
                <input
                  type="range"
                  min="1"
                  max="200"
                  step="1"
                  aria-label={t('最大節點數滑桿')}
                  value={draftFilters.limit}
                  onChange={e => setDraftFilters(value => ({ ...value, limit: Number(e.target.value) }))}
                />
                <input
                  className="number"
                  type="number"
                  min="1"
                  max="200"
                  aria-label={t('最大節點數')}
                  value={draftFilters.limit}
                  onChange={e =>
                    setDraftFilters(value => ({ ...value, limit: Math.min(200, Math.max(1, Number(e.target.value) || 1)) }))
                  }
                />
              </div>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={draftFilters.evidence}
                onChange={e => setDraftFilters(value => ({ ...value, evidence: e.target.checked }))}
              />
              {t('顯示來源與主張節點')}</label>
            <div className="dataset-note">
              <span>
                {privateGraph ? t('我的研究副本') : t(publishedGraph ? '管理者發布的圖譜' : '台灣 Physical Edge AI')}
              </span>
              <small>
                {t('{types} 種實體 · {relations} 種關係定義', { types: graph.entityTypes.length, relations: graph.edgeTypes.length })}</small>
            </div>
          </div>

          <div className="filter-dialog-actions">
            <button onClick={() => setDraftFilters({ type: '', group: '', status: '', limit: 50, evidence: false })}>{t('重設')}</button>
            <button className="primary" onClick={applyFilters}>{t('套用篩選')}</button>
          </div>
        </dialog>
        <section ref={researchStage} className="graph-panel panel" hidden={!graphVisible} style={!graphVisible ? { display: 'none' } : undefined}>
          <div className="panel-heading graph-toolbar">
<div className="focus-toolbar">
            <span className="focus-label" title={selected?.name}>
              <span className={hops > 0 ? 'focus-dot active' : 'focus-dot'} />
              <span lang={hops > 0 ? nameLanguage(sourceGraph.nodes.find(node => node.id === selectedId)) : undefined}>{scoped ? (locale === 'en' ? 'Research graph' : '研究圖譜') : hops > 0 ? selected?.name : overview ? t('篩選總覽') : t('開始探索')}</span>
            </span>
            {!scoped && <div className="depth-segments" role="group" aria-label={t('關係探索深度')}>
              {[0, 1, 2, 3].map(depth => (
                <button
                  key={depth}
                  aria-pressed={depth === 0 ? overview : hops === depth}
                  aria-label={depth === 0 ? t('0 層：篩選總覽') : t('{depth} 層：聚焦相鄰關係', { depth })}
                  disabled={depth > 0 && !selected}
                  onClick={() => { if (depth === 0) enterOverview(); else setHops(depth); }}
                  className={(depth === 0 ? overview : hops === depth) ? 'active' : ''}
                >{depth === 0 ? t('總覽') : t('{depth} 層', { depth })}</button>
              ))}
            </div>}
            {!scoped && <span
              className="focus-help"
              tabIndex={0}
              title={t('總覽遵守所有篩選。1–3 層僅顯示所選起點及其真實相鄰節點，跨越類型與搜尋，但保留關係類別、驗證狀態與來源設定。沿雙向連結探索，箭頭仍保留原始方向。')}
              aria-label={t('探索說明：1至3層只顯示所選起點的真實鄰近節點，跨類型與搜尋，仍遵守關係類別、驗證狀態與來源設定。')}
            ><Info size={14} /></span>}
          </div>
            {selected && !detailsOpen && <button className="reopen-details" onClick={() => setDetailsOpen(true)}><Info size={15} />{t('實體詳情')}</button>}
            <span className="graph-count" aria-live="polite">
              {graphVisible ? t('{nodes} 節點 · {edges} 關係', { nodes: filtered.nodes.length, edges: filtered.edges.length }) : t('{count} 個可探索實體', { count: graph.nodes.length })}</span>
            <div className="zoom-buttons">
              <button
                aria-label={t('縮小')}
                onClick={() => setZoom(z => Math.max(0.45, z - 0.2))}
              >
                <Minus size={15} />
              </button>
              <button
                aria-label={t('放大')}
                onClick={() => setZoom(z => Math.min(3, z + 0.2))}
              >
                <Plus size={15} />
              </button>
              <button
                aria-label={t('適合畫面')}
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
              >
                <Focus size={16} />
              </button>
              <button
                aria-label={t('重設節點排列')}
                title={t('重設節點排列')}
                onClick={() => setManualPositions({})}
              >
                <RotateCcw size={15} />
              </button>
            </div>
          </div>
          <div className="graph-canvas">
            {graphVisible && <div className="focus-canvas-hint" aria-live="polite">
              {scoped ? (locale === 'en' ? 'Relationships matching this research' : '符合本次研究的關係') : hops > 0
                ? filtered.nodes.length === 1
                  ? t('目前條件下沒有相鄰節點')
                  : t('聚焦 {hops} 層 · {count} 個相鄰節點', { hops, count: filtered.nodes.length - 1 })
                : filtered.hiddenByType > 0
                  ? t('選取公司即可探索產品與關係')
                  : t('點選實體，聚焦真實連結')}
            </div>}
            {graphVisible && filtered.nodes.length > 0 && filtered.edges.length === 0 && (
              <div className="zero-relations-message" role="status">
                <Info size={15} />
                <span>{filtered.hiddenByCap > 0
                  ? t('節點上限隱藏了相鄰節點與關係。')
                  : selected && hops > 0
                    ? relationList.length > 0 ? t('目前篩選隱藏了相連關係。調整篩選以查看。') : t('此實體尚無已記錄的關係。')
                    : t('目前節點間沒有直接連結；選取實體可探索跨類型關係。')}</span>
                {(filtered.hiddenByCap > 0 || group || status || type) && <button onClick={openFilters}>{filtered.hiddenByCap > 0 ? t('提高上限') : t('調整篩選')}</button>}
              </div>
            )}
            {graphVisible && ( !filtered.nodes.length ? (
              <div className="canvas-empty">
                <Search size={30} />
                <h3>{t('沒有符合條件的節點')}</h3>
                <p>{t('試著移除篩選，或在 Workspace 新增資料。')}</p>
                <button className="outline" onClick={reset}>
                  {t('重設篩選')}</button>
              </div>
            ) : (
              <svg
                viewBox={layoutRoot && filtered.nodes.length <= 4 ? '210 105 780 650' : `0 0 1200 ${layoutRoot ? focusHeight : 960}`}
                role="img"
                aria-label={t('互動公司產品知識圖譜')}
                ref={svgRef}
                onPointerDown={e => {
                  if (e.button !== 0 || (e.target as Element).closest('.graph-node, .graph-edge')) return;
                  drag.current = { start: svgPoint(e.clientX, e.clientY), origin: pan };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={e => {
                  const current = drag.current;
                  if (!current) return;
                  const point = svgPoint(e.clientX, e.clientY);
                  const dx = point.x - current.start.x;
                  const dy = point.y - current.start.y;
                  if (current.nodeId) {
                    if (Math.hypot(dx, dy) > 3) draggedNode.current = true;
                    setManualPositions(previous => ({
                      ...previous,
                      [current.nodeId!]: {
                        x: current.origin.x + dx / zoom,
                        y: current.origin.y + dy / zoom,
                      },
                    }));
                  } else {
                    setPan({ x: current.origin.x + dx, y: current.origin.y + dy });
                  }
                }}
                onPointerUp={e => {
                  if (drag.current?.nodeId && !draggedNode.current) {
                    selectEntity(drag.current.nodeId);
                  }
                  drag.current = null;
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                }}
                onPointerCancel={() => { drag.current = null; }}
              >
                <defs>
                  <marker
                    id="arrow"
                    viewBox="0 0 10 10"
                    refX="9"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" fill="#63a9bd" />
                  </marker>
                </defs>
                <rect width="1200" height="960" fill="transparent" />
                <g
                  transform={`translate(${pan.x + 600 * (1 - zoom)} ${pan.y + 480 * (1 - zoom)}) scale(${zoom})`}
                >
                  {filtered.edges.map(e => {
                    const a = positions[e.from];
                    const b = positions[e.to];
                    const distance = Math.max(
                      1,
                      Math.hypot(b.x - a.x, b.y - a.y)
                    );
                    const dx = (b.x - a.x) / distance;
                    const dy = (b.y - a.y) / distance;
                    const highlighted =
                      e.id === edgeId ||
                      e.from === selectedId ||
                      e.to === selectedId;
                    return (
                      <g
                        key={e.id}
                        className="graph-edge"
                        role="button"
                        tabIndex={0}
                        aria-label={`${byId[e.from]?.name} · ${propertyLabel(e.predicate)} · ${byId[e.to]?.name}${e.derived === true ? ' · ' + t('衍生分析摘要，非官方競爭確認') : ''}`}
                        onClick={() => {
                          setEdgeId(e.id);
                          setSelectedId(e.from);
                          setDetailsOpen(true);
                        }}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setEdgeId(e.id);
                            setSelectedId(e.from);
                            setDetailsOpen(true);
                          }
                        }}
                      >
                        <line
                          x1={a.x + dx * 30}
                          y1={a.y + dy * 30}
                          x2={b.x - dx * 32}
                          y2={b.y - dy * 32}
                          stroke={highlighted ? '#48dbea' : '#365770'}
                          strokeWidth={highlighted ? '3' : '1.8'}
                          strokeDasharray={
                            e.derived === true ||
                            e.verification_status === 'analyst_inferred' ||
                            e.verification_status === 'hypothesis'
                              ? '5 5'
                              : undefined
                          }
                          markerEnd={e.symmetric ? undefined : 'url(#arrow)'}
                        />
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          stroke="transparent"
                          strokeWidth="15"
                        />
                        <title>
                          {propertyLabel(e.predicate)} ·{' '}
                          {e.derived === true && <>{t('衍生分析摘要，非官方競爭確認')} · </>}
                          {(e.verification_status ? statusLabel(String(e.verification_status)) : '') ||
                            t('未標記驗證狀態')}
                        </title>
                      </g>
                    );
                  })}
                  {filtered.nodes.map(n => {
                    const p = positions[n.id];
                    const active = n.id === selectedId;
                    const columns = Math.max(1, Math.ceil(Math.sqrt(filtered.nodes.length * 0.8)));
                    const labelWidth = layoutRoot ? 224 : Math.min(260, 1200 / columns - 24);
                    const lines = nodeNameLines(n, labelWidth);
                    return (
                      <g
                        key={n.id}
                        className={`graph-node ${layoutRoot === n.id ? 'focus-root' : ''}`}
                        transform={`translate(${p.x},${p.y})`}
                        role="button"
                        tabIndex={0}
                        aria-label={t('選取 {name}', { name: n.name })}
                        onPointerDown={e => {
                          if (e.button !== 0) return;
                          e.stopPropagation();
                          draggedNode.current = false;
                          drag.current = { start: svgPoint(e.clientX, e.clientY), origin: p, nodeId: n.id };
                          svgRef.current?.setPointerCapture(e.pointerId);
                        }}
                        onClick={() => {
                          if (draggedNode.current) { draggedNode.current = false; return; }
                          selectEntity(n.id, Boolean(scoped));
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            selectEntity(n.id, Boolean(scoped));
                          }
                        }}
                      >
                        {layoutRoot === n.id && (
                          <circle r="35" fill="#43d9ed0c" stroke="#62ddea" strokeOpacity=".25" strokeWidth="1" />
                        )}
                        <circle r={active ? '18' : '14'} fill="#091b30" stroke={active ? '#67edff' : typeColor(n.type)} strokeWidth={active ? '4' : '3'} />
                        <circle r="6" fill={active ? '#67edff' : typeColor(n.type)} />
                        <rect
                          className="node-label-background"
                          x={-labelWidth / 2}
                          y="23"
                          width={labelWidth}
                          height={lines.length * 24 + 12}
                          rx="9"
                          fill={active ? '#123c53' : '#0c2037'}
                          stroke={active ? '#67edff' : '#38536e'}
                          strokeWidth="1.5"
                        />
                        <text
                          className="node-name"
                          lang={nameLanguage(sourceGraph.nodes.find(node => node.id === n.id))}
                          textAnchor="middle"
                          y="48"
                          fontSize="23"
                          fontWeight={active ? '750' : '600'}
                          fill="#f1fbff"
                        >
                          {lines.map((line, i) => (
                            <tspan key={i} x="0" dy={i ? '24' : '0'}>
                              {line}
                            </tspan>
                          ))}
                        </text>
                        <title>
                          {n.name} · {n.type}
                        </title>
                      </g>
                    );
                  })}
                </g>
              </svg>
            ))}
            {graphVisible && <div className="canvas-caption">
              <span>{t('拖曳節點排列 · 空白處平移 · 滾輪縮放 · 點選查看證據')}</span>
              <span>{Math.round(zoom * 100)}%</span>
            </div>}
            {graphVisible && filtered.total > limit && (
              <div className="cap-notice">
                {t('符合 {total} 個節點 · 上限 {limit} · 隱藏 {edges} 條關係', { total: filtered.total, limit, edges: filtered.hiddenByCap })}</div>
            )}
          </div>
        </section>
        <dialog ref={detailDialog} className="detail-panel panel detail-drawer"
          aria-labelledby="entity-detail-title" aria-modal={mobile && detailsOpen ? true : undefined}
          onCancel={event => { event.preventDefault(); setDetailsOpen(false); }}
          onClick={event => {
            if (!mobile || event.target !== event.currentTarget) return;
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setDetailsOpen(false);
          }}>

          <div className="panel-heading">
            <strong>
              <Info size={17} />
              <span id="entity-detail-title">{t('實體詳情')}</span></strong>
            {selected && (
              <button
                className="quiet"
                aria-label={t('關閉詳情')}
                onClick={() => {
                  setDetailsOpen(false);
                }}
              >
                <X size={15} />
              </button>
            )}
          </div>
          {selected ? (
            <div className="detail-content">
              <div className="entity-title">
                <span
                  className="entity-symbol"
                  style={{ background: typeColor(selected.type) }}
                >
                  <Building2 size={25} />
                </span>
                <div>
                  <h2 lang={nameLanguage(sourceGraph.nodes.find(node => node.id === selectedId))}>{selected.name}</h2>
                  <span className="type-pill">
                    {typeLabel(selected.type)}
                    {selected.ticker ? ` · ${selected.ticker}` : ''}
                  </span>
                </div>
              </div>
              {assessmentReturn && (
                <button className="outline" onClick={() => {
                  setSelectedId(assessmentReturn.rootId);
                  setEdgeId(assessmentReturn.edgeId);
                  setHops(assessmentReturn.hops);
                  setOverview(assessmentReturn.overview);
                  setResearchFocus(assessmentReturn.researchFocus);
                  setDetailsOpen(true);
                  setAssessmentReturn(null);
                }}>
                  <ChevronRight size={14} style={{ transform: 'rotate(180deg)' }} />{t('返回競爭摘要')}
                </button>
              )}
              {selectedEdge && (
                <section className="selected-edge">
                  <h3>{t('所選關係')}</h3>
                  <strong>{propertyLabel(selectedEdge.predicate)}</strong>
                  {selectedEdge.derived === true && (
                    <div className="derived-context">
                      <p className="status-label inferred" style={{ display: 'block', lineHeight: 1.65, padding: '.625rem' }}>
                        <Info size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '.375rem' }} />
                        {t('衍生分析摘要，非官方競爭確認')}
                      </p>
                      <p>{t('此連結由具體產品與市場區隔的競爭評估推導，不代表整間公司或所有產品均有競爭關係。')}</p>
                      <dl>
                        <dt>{t('市場情境')}</dt>
                        <dd>
                          <span lang={nameLanguage(sourceGraph.nodes.find(node => node.id === selectedEdge.market_segment_id))}>
                            {byId[String(selectedEdge.market_segment_id)]?.name || t('未指定')}
                          </span>
                        </dd>
                        <dt>{t('比較產品')}</dt>
                        <dd>
                          {Array.isArray(selectedEdge.product_ids) && selectedEdge.product_ids.map((id, index) => (
                            <span key={String(id)} lang={nameLanguage(sourceGraph.nodes.find(node => node.id === id))}>
                              {index > 0 ? ' / ' : ''}{byId[String(id)]?.name || t('未指定')}
                            </span>
                          ))}
                        </dd>
                        {selectedEdge.basis !== undefined && <>
                          <dt>{propertyLabel('basis')}</dt><dd>{readableText(selectedEdge.basis, locale, t)}</dd>
                        </>}
                      </dl>
                      {typeof selectedEdge.assessment_id === 'string' && byId[selectedEdge.assessment_id] && (
                        <button className="outline" onClick={() => {
                          const previous = { rootId: selectedId, edgeId: selectedEdge.id, hops, overview, researchFocus };
                          selectEntity(String(selectedEdge.assessment_id), Boolean(scoped));
                          setAssessmentReturn(previous);
                          setDetailsOpen(true);
                        }}>
                          {t('開啟原始競爭評估')}<ChevronRight size={14} />
                        </button>
                      )}
                    </div>
                  )}
                  <p>
                    <span lang={nameLanguage(sourceGraph.nodes.find(node => node.id === selectedEdge.from))}>{byId[selectedEdge.from]?.name}</span> {selectedEdge.symmetric ? '↔' : '→'}{' '}
                    <span lang={nameLanguage(sourceGraph.nodes.find(node => node.id === selectedEdge.to))}>{byId[selectedEdge.to]?.name}</span>
                  </p>
                  <span className="status-label">
                    {(selectedEdge.verification_status ? statusLabel(String(selectedEdge.verification_status)) : '') ||
                      t('未標記驗證狀態')}
                  </span>
                  <p className="small-copy">
                    {t(typesByPredicate[selectedEdge.predicate]?.meaning || '')}
                  </p>
                  <details key={selectedEdge.id}>
                    <summary style={{ cursor: 'pointer', fontSize: '.75rem', paddingBlock: '.5rem' }}>{t('基本屬性')}</summary>
                  <dl>
                    {visibleMetadata(selectedEdge)
                      .map(([key, value]) => (
                        <div className="property-row" key={key}>
                          <dt>{metadataLabel(key, locale, propertyLabel)}</dt>
                          <dd>{key === 'verification_status' ? statusLabel(String(value)) : readableText(value, locale, t)}</dd>
                        </div>
                      ))}
                  </dl>
                  </details>
                </section>
              )}
              <section>
                <h3>
                  {t('關係')}<span>{relationList.length}</span>
                </h3>
                {relationList.length ? (
                  relationList.map(e => {
                    const other = byId[e.from === selectedId ? e.to : e.from];
                    return (
                      <button
                        className="relationship-row"
                        key={e.id}
                        onClick={() => setEdgeId(e.id)}
                      >
                        <i
                          style={{ background: typeColor(other?.type || '') }}
                        />
                        <span>
                          <small>
                            {e.symmetric ? '↔' : e.from === selectedId ? '→' : '←'} {propertyLabel(e.predicate)}
                            {e.derived === true && <> · {t('衍生推論')}</>}
                          </small>
                          <span lang={nameLanguage(sourceGraph.nodes.find(node => node.id === other?.id))}>{other?.name || t('未指定')}</span>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    );
                  })
                ) : (
                  <p className="muted">{t('尚無關係紀錄。')}</p>
                )}
              </section>
              <section>
                <h3>
                  {selectedEdge ? t('此關係的來源與佐證') : t('來源與佐證')}<span>{sources.length}</span>
                </h3>
                {!selectedEdge && typeof selected.url === 'string' &&
                  /^https?:\/\//.test(selected.url) && (
                    <a
                      className="source-link"
                      href={selected.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('開啟來源')}<ExternalLink size={13} />
                    </a>
                  )}
                {sources.length ? (
                  sources.map(s => (
                    <a
                      className="source-row"
                      href={
                        typeof s.url === 'string' && /^https?:\/\//.test(s.url)
                          ? s.url
                          : undefined
                      }
                      target="_blank"
                      rel="noreferrer"
                      key={s.id}
                    >
                      <span>
                        <strong lang={nameLanguage(sourceGraph.nodes.find(node => node.id === s.id))}>{s.name}</strong>
                        <small>
                          {s.reverified_for_package === false
                            ? t('繼承來源 · 尚未重新查證')
                            : s.last_verified_at
                              ? t('查核日期：{date}', { date: String(s.last_verified_at) })
                              : t('來源已記錄 · 查核日期未填')}
                        </small>
                      </span>
                      <ExternalLink size={14} />
                    </a>
                  ))
                ) : (
                  <p className="muted">
                    {t(selectedEdge ? '此關係未附可解析的來源。請勿視為已證實。' : '此實體未附可解析的來源。請勿視為已證實。')}</p>
                )}
              </section>
              <section>
                <details key={selectedId}>
                  <summary style={{ cursor: 'pointer', fontSize: '.75rem', fontWeight: 600, paddingBlock: '.25rem' }}>{t('基本屬性')}</summary>
                <dl>
                  <dt>{t('實體類型')}</dt>
                  <dd>{typeLabel(selected.type)}</dd>
                  {visibleMetadata(sourceGraph.nodes.find(node => node.id === selectedId) || selected)
                    .map(([key, value]) => (
                      <div className="property-row" key={key}>
                        <dt>{metadataLabel(key, locale, propertyLabel)}</dt>
                        <dd>{key === 'verification_status' ? statusLabel(String(value)) : readableText(value, locale, t)}</dd>
                      </div>
                    ))}
                </dl>
                </details>
              </section>
            </div>
          ) : (
            <div className="empty-detail">
              <Network size={36} />
              <h3>{t('跟隨一條脈絡')}</h3>
              <p>{t('點選圖譜中的實體，查看屬性、關係與來源。')}</p>
            </div>
          )}
        </dialog>
      </div>
    </>
  );
}
