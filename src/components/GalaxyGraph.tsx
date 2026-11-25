// 3D "galaxy" knowledge graph: react-force-graph-3d (three.js) + UnrealBloomPass glow,
// a procedural starfield and nebula sprites, glowing node "stars" and particle flows on active links.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { anchors, escapeHtml, idOf, toLinks } from './graphShared';
import type { GLink, GNode, GraphProps } from './graphShared';
import i18n from '../i18n';
import { CLUSTER_COLORS, colorOf, LINK_TONES, linkTone, relName, statusLabel, typeName } from '../lib/theme';


// One soft radial texture shared by every halo / nebula sprite.
let glowTex: THREE.Texture | null = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!, grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.2, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.12)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c); return glowTex;
}

function buildCosmos() {
  const group = new THREE.Group();
  for (const [count, size, rMin, rMax, tint] of [[2600, 1.0, 900, 2400, 0xdfe6ff], [500, 1.8, 800, 2000, 0x9ecbff]] as const) {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = rMin + Math.random() * (rMax - rMin), t = Math.random() * Math.PI * 2, p = Math.acos(2 * Math.random() - 1);
      pos.set([r * Math.sin(p) * Math.cos(t), r * Math.sin(p) * Math.sin(t) * 0.6, r * Math.cos(p)], i * 3);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    group.add(new THREE.Points(geo, new THREE.PointsMaterial({ size, color: tint, transparent: true, opacity: 0.32, depthWrite: false, sizeAttenuation: true })));
  }
  for (const [color, x, y, z, s] of [[0x3b3f8f, -600, 200, -900, 1500], [0x0e5a70, 700, -250, -1100, 1700], [0x1d3f8a, -300, -400, 900, 1400]] as const) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.set(x, y, z); m.scale.set(s, s, 1); group.add(m);
  }
  return group;
}

export default function GalaxyGraph({ nodes, edges, types, edgeTypes = [], selectedId, selectedEdgeId, highlight, highlightEdges, onSelect, onSelectEdge, showLabels, fitKey, offsetX = 0, clusters = null, clusterNames = null }: GraphProps) {
  const fg = useRef<any>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, GNode>());
  const fitPending = useRef(true);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const bloomRef = useRef<UnrealBloomPass | null>(null);

  useEffect(() => {
    const el = wrap.current!; const ro = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height); if (w > 0 && h > 0) setSize(s => (s && s.w === w && s.h === h ? s : { w, h })); });
    ro.observe(el); return () => ro.disconnect();
  }, []);

  // Stable node objects keep their simulated positions across filter changes.
  const data = useMemo(() => {
    const deg = new Map<string, number>(); edges.forEach(e => { deg.set(e.from, (deg.get(e.from) ?? 0) + 1); deg.set(e.to, (deg.get(e.to) ?? 0) + 1); });
    const at = clusters ? anchors([...new Set(clusters.values())]) : null;
    const ns = nodes.map(n => {
      let g = cache.current.get(n.id);
      if (!g) {   // a new star starts near its cluster's area, so the layout settles in place instead of flying across the screen
        const p = at?.get(clusters!.get(n.id) ?? '');
        g = p ? { id: n.id, name: n.name, type: n.type, degree: 0, x: p.x + (Math.random() - 0.5) * 60, y: p.y + (Math.random() - 0.5) * 60, z: (Math.random() - 0.5) * 60 } : { id: n.id, name: n.name, type: n.type, degree: 0 };
      }
      g.name = n.name; g.type = n.type; g.degree = deg.get(n.id) ?? 0; cache.current.set(n.id, g); return g;
    });
    return { nodes: ns, links: toLinks(edges) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);
  // Camera moves never overlap: the library cancels a running camera animation by calling into its tween
  // dependency, and some installed versions of that dependency throw there. An error inside the render
  // loop stops all drawing (the graph looks frozen), so every move is queued until the previous one has
  // finished, runs outside the render loop, and is guarded.
  const camBusyUntil = useRef(0);
  const camTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveCamera = useCallback((run: (g: any) => void, duration: number) => {
    if (camTimer.current) clearTimeout(camTimer.current);                 // only the latest request matters
    const wait = Math.max(0, camBusyUntil.current - Date.now()) + 20;
    camTimer.current = setTimeout(() => {
      camTimer.current = null;
      const g = fg.current; if (!g) return;
      camBusyUntil.current = Date.now() + duration + 80;
      try { run(g); } catch (e) { console.warn('camera move skipped', e); }
    }, wait);
  }, []);
  useEffect(() => () => { if (camTimer.current) clearTimeout(camTimer.current); }, []);

  useEffect(() => {
    fitPending.current = true;
    // Fallback in case the engine was already cool: fit once the layout has had time to settle.
    const t = setTimeout(() => { if (fitPending.current) moveCamera(g => g.zoomToFit(900, 70), 900); }, 1400);   // first fit; the engine-stop fit below runs once the layout has settled
    return () => clearTimeout(t);
  }, [fitKey, moveCamera]);

  // One-time scene setup: cosmos, bloom, forces. Retries each animation frame until the
  // force-graph instance has attached its handle, so setup never silently skips.
  const ready = !!size;
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    const setup = () => {
      const g = fg.current;
      if (!g) { raf = requestAnimationFrame(setup); return; }
      if (bloomRef.current || !size) return;
      g.scene().add(buildCosmos());
      const bloom = new UnrealBloomPass(new THREE.Vector2(size.w, size.h), 0.32, 0.4, 0.72)   // gentle glow: nodes stay crisp, labels stay readable;
      g.postProcessingComposer().addPass(bloom); bloomRef.current = bloom;
      g.d3Force('charge')?.strength(-70);
      g.d3Force('link')?.distance(42);
      const c = g.controls(); if (c) { c.autoRotate = false; c.enableDamping = true; }   // never spins by itself: the user drags to rotate
    };
    setup();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  // Cluster force: pull each tagged node toward its cluster's anchor. Links between clusters stay, drawn as bridges.
  const defaultLinkStrength = useRef<unknown>(null);
  const clusterKey = clusters ? [...new Set(clusters.values())].join('|') : '';
  useEffect(() => {
    let raf = 0;
    const apply = () => {
      const g = fg.current; if (!g) { raf = requestAnimationFrame(apply); return; }
      const link = g.d3Force('link');
      if (link && !defaultLinkStrength.current) defaultLinkStrength.current = link.strength();   // the library's own accessor, restored when clusters go away
      if (!clusters || !clusterKey) { g.d3Force('cluster', null); if (link && defaultLinkStrength.current) link.strength(defaultLinkStrength.current); return; }
      const at = anchors(clusterKey.split('|'));
      let ns: GNode[] = [];
      const force = (alpha: number) => {
        for (const n of ns as (GNode & { vx?: number; vy?: number; vz?: number })[]) {
          const c = clusters.get(n.id), p = c ? at.get(c) : null; if (!p || n.x === undefined) continue;
          const k = (n.id === c ? 0.5 : 0.14) * alpha;               // the industry node itself sits at the centre of its cluster
          n.vx = (n.vx ?? 0) + (p.x - n.x!) * k; n.vy = (n.vy ?? 0) + (p.y - n.y!) * k; n.vz = (n.vz ?? 0) + (p.z - n.z!) * k;
        }
      };
      force.initialize = (x: GNode[]) => { ns = x; };
      g.d3Force('cluster', force);
      // Bridges between clusters are long and weak, so they do not drag the clusters together.
      link?.strength((l: GLink) => { const a = clusters.get(idOf(l.source)), b = clusters.get(idOf(l.target)); return a && b && a !== b ? 0.015 : 0.5; });
      g.d3ReheatSimulation();
    };
    apply(); return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterKey, clusters, data]);
  // Cluster labels: small HTML text above each cluster, kept in place every frame by projecting its members to the screen.
  const labelEls = useRef(new Map<string, HTMLDivElement>());
  const clusterList = useMemo(() => {
    if (!clusters) return [];
    const byKey = new Map<string, string[]>();
    for (const n of nodes) { const k = clusters.get(n.id); if (k) (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(n.id); }
    const order = [...new Set(clusters.values())];
    return [...byKey].sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0])).map(([key, ids]) => ({ key, ids, name: clusterNames?.get(key) ?? nodes.find(n => n.id === key)?.name ?? '', companies: nodes.filter(n => ids.includes(n.id) && n.type === 'Company').length, color: CLUSTER_COLORS[order.indexOf(key) % CLUSTER_COLORS.length] }));
  }, [clusters, clusterNames, nodes, types]);
  useEffect(() => {
    if (!clusterList.length) return;
    let raf = 0; const v = new THREE.Vector3();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const cam = fg.current?.camera?.(); if (!cam || !size) return;
      for (const c of clusterList) {
        const el = labelEls.current.get(c.key); if (!el) continue;
        let sx = 0, top = Infinity, n = 0;
        for (const id of c.ids) {
          const g = cache.current.get(id); if (!g || g.x === undefined) continue;
          v.set(g.x!, g.y!, g.z!).project(cam); if (v.z > 1) continue;
          sx += (v.x + 1) / 2 * size.w; top = Math.min(top, (1 - v.y) / 2 * size.h); n++;
        }
        if (!n) { el.style.opacity = '0'; continue; }
        el.style.opacity = ''; el.style.transform = `translate(${Math.round(sx / n)}px, ${Math.round(top - 30)}px) translateX(-50%)`;
      }
    };
    tick(); return () => cancelAnimationFrame(raf);
  }, [clusterList, size]);
  // Keep the post-processing buffers in sync with the canvas size.
  useEffect(() => { if (size && fg.current) { fg.current.postProcessingComposer().setSize(size.w, size.h); bloomRef.current?.setSize(size.w, size.h); } }, [size]);
  useEffect(() => {
    let raf = 0;
    const apply = () => { const cam = fg.current?.camera?.(); if (!cam || !size) { raf = requestAnimationFrame(apply); return; } cam.setViewOffset(size.w, size.h, -offsetX, 0, size.w, size.h); cam.updateProjectionMatrix(); };
    apply(); return () => cancelAnimationFrame(raf);
  }, [size, offsetX]);

  // What is "in focus": a selected relation > a selected star's neighbourhood > a highlighted subset.
  const selEdge = useMemo(() => (selectedEdgeId ? edges.find(e => e.id === selectedEdgeId) ?? null : null), [selectedEdgeId, edges]);
  const neighbors = useMemo(() => {
    if (selEdge) return new Set([selEdge.from, selEdge.to]);
    if (!selectedId) return null;
    const s = new Set([selectedId]); edges.forEach(e => { if (e.from === selectedId) s.add(e.to); if (e.to === selectedId) s.add(e.from); }); return s;
  }, [selectedId, selEdge, edges]);
  const lit = (id: string) => (neighbors ? neighbors.has(id) : highlight ? highlight.has(id) : true);
  const focused = !!(neighbors || highlight || highlightEdges);

  // Fly the camera to the selected star or relation.
  useEffect(() => {
    const g = fg.current;
    if (g && selEdge) {   // fly to the middle of the selected relation
      const a = cache.current.get(selEdge.from), b = cache.current.get(selEdge.to);
      if (a?.x !== undefined && b?.x !== undefined) {
        const m = { x: (a.x! + b.x!) / 2, y: (a.y! + b.y!) / 2, z: (a.z! + b.z!) / 2 };
        const d = 260 + Math.hypot(a.x! - b.x!, a.y! - b.y!, a.z! - b.z!), r = 1 + d / Math.max(1, Math.hypot(m.x, m.y, m.z));
        moveCamera(c => c.cameraPosition({ x: m.x * r, y: m.y * r, z: m.z * r }, m, 1300), 1300);
      }
      return;
    }
    if (!g || !selectedId) return;
    const n = cache.current.get(selectedId); if (!n || n.x === undefined) return;
    const d = 430, r = 1 + d / Math.max(1, Math.hypot(n.x!, n.y!, n.z!));   // far enough to keep the neighbours in view
    const to = { x: n.x! * r, y: n.y! * r, z: n.z! * r }, at = { x: n.x!, y: n.y!, z: n.z! };
    moveCamera(c => c.cameraPosition(to, at, 1300), 1300);
  }, [selectedId, selEdge, moveCamera]);

  const nodeObject = useCallback((n: GNode) => {
    const color = new THREE.Color(colorOf(types, n.type)), on = lit(n.id), sel = n.id === selectedId;
    const r = (n.type === 'Evidence' ? 1.5 : 2.4) + Math.sqrt(n.degree) * 1.25;
    const group = new THREE.Group();
    const isEvent = n.type === 'CompetitionAssessment' || n.type === 'Collaboration' || n.type === 'SupplyRelationship' || n.type === 'CustomerOpportunity';
    const geo = isEvent ? new THREE.OctahedronGeometry(r * 0.95) : new THREE.SphereGeometry(r, 24, 16);
    group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: on ? color : color.clone().multiplyScalar(0.12), transparent: true, opacity: on ? 1 : 0.18 })));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: on ? (sel ? 0.45 : 0.14) : 0.01, blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.set(r * (sel ? 4.6 : 2.8), r * (sel ? 4.6 : 2.8), 1); group.add(halo);
    if (sel) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * 2.1, r * 2.5, 48), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
      group.add(ring);
    }
    // Labels: always for the selection and its neighbours; otherwise only for well-connected nodes, so text never piles up.
    const few = nodes.length <= 40;
    const isClusterHead = !!clusters && clusters.get(n.id) === n.id;   // its name is shown by the cluster label instead
    if (showLabels && on && !(isClusterHead && !sel) && (sel || neighbors || few || n.degree >= (nodes.length > 140 ? 6 : 3))) {
      const label = new SpriteText(n.name.length > 18 ? n.name.slice(0, 17) + '…' : n.name, sel ? 4.4 : neighbors || few ? 3.4 : 3, sel ? '#ffffff' : '#dbe4ff');
      label.backgroundColor = sel ? 'rgba(10,16,40,0.92)' : 'rgba(6,10,28,0.78)'; label.padding = [2.6, 1.6]; label.borderRadius = 3;
      label.fontFace = 'Inter, Noto Sans TC, sans-serif'; label.fontWeight = sel ? '700' : '500';
      label.position.set(0, r + (sel ? 9 : 6), 0); (label.material as THREE.SpriteMaterial).depthWrite = false; group.add(label);
    }
    return group;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types, selectedId, highlight, neighbors, showLabels, nodes.length, focused, clusters]);

  const linkActive = (l: GLink) => {
    const a = idOf(l.source), b = idOf(l.target);
    if (selEdge) return l.id === selEdge.id;
    if (selectedId) return a === selectedId || b === selectedId;
    if (highlightEdges) return highlightEdges.has(l.id);
    return highlight ? highlight.has(a) && highlight.has(b) : false;
  };
  const rgb = (l: GLink) => LINK_TONES[linkTone(l.status, l.derived, l.suggested)].color;

  return (
    <div ref={wrap} className="galaxy">
      {clusterList.length > 0 && <div className="cluster-labels" aria-hidden>{clusterList.map(c => (
        <div key={c.key} ref={el => { if (el) labelEls.current.set(c.key, el); else labelEls.current.delete(c.key); }} className={`cluster-label ${focused && !lit(c.key) ? 'dim' : ''}`}>
          <i style={{ background: c.color }} />{c.name}<small>{i18n.t('{{n}} 家', { n: c.companies })}</small></div>))}</div>}
      {size && <ForceGraph3D
        ref={fg}
        width={size.w} height={size.h}
        graphData={data}
        backgroundColor="#03050d"
        controlType="orbit"
        showNavInfo={false}
        nodeId="id"
        nodeThreeObject={nodeObject as any}
        nodeLabel={(n: any) => `<div class="tip"><b>${escapeHtml(n.name)}</b><span>${escapeHtml(typeName(types, n.type))} · ${i18n.t('{{n}} 條關係', { n: n.degree })}</span></div>`}
        linkLabel={(l: any) => `<div class="tip"><b>${escapeHtml(relName(edgeTypes, l.predicate))}</b><span>${l.suggested ? `${i18n.t('AI 建議')} · ${Math.round(l.strength * 100)}%` : `${statusLabel(l.status)}${l.derived ? ` · ${i18n.t('系統算出')}` : ''}`}</span></div>`}
        // Selection contrast: lit relations are fully opaque and thick; everything else nearly disappears.
        linkColor={(l: any) => `rgba(${rgb(l)},${linkActive(l) ? (l.suggested && l.id !== selectedEdgeId ? 0.45 : 1) : l.suggested ? (focused ? 0.02 : 0.1) : focused ? 0.04 : 0.3})`}
        linkWidth={(l: any) => (linkActive(l) ? (l.id === selectedEdgeId ? 2.4 : l.suggested ? 0 : 1.5) : l.suggested ? 0 : focused ? 0.1 : l.derived ? 0.35 : 0.25)}
        linkOpacity={1}
        linkDirectionalArrowLength={(l: any) => (linkActive(l) ? 4.2 : 0)}
        linkDirectionalArrowRelPos={0.92}
        linkDirectionalArrowColor={(l: any) => `rgb(${rgb(l)})`}
        linkDirectionalParticles={(l: any) => (l.suggested ? (focused && !linkActive(l) ? 0 : 5) : l.id === selectedEdgeId ? 2 : 0)}   // suggested links are drawn as slow dots (a dotted line); only the selected relation animates
        linkDirectionalParticleWidth={(l: any) => (l.suggested ? (linkActive(l) ? 1.6 : 0.9) : 2)}
        linkDirectionalParticleSpeed={(l: any) => (l.suggested ? 0.0006 : 0.004)}
        linkDirectionalParticleColor={(l: any) => `rgb(${rgb(l)})`}
        onNodeClick={(n: any) => onSelect(n.id)}
        onLinkClick={(l: any) => onSelectEdge(l.id)}
        onBackgroundClick={() => onSelect(null)}
        onEngineStop={() => { if (fitPending.current) { fitPending.current = false; moveCamera(g => g.zoomToFit(900, 80), 900); } }}
        cooldownTicks={120}
        warmupTicks={40}
      />}
    </div>
  );
}

