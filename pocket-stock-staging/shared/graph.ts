// Types shared by the backend and the frontend. No runtime dependencies.

export type NodeType = 'company' | 'etf' | 'inst' | 'concept';
export type LinkKind = 'mention' | 'attr';

/** A published concept or name. Identified by its official name; aliases are attributes of it. */
export interface GraphNode { id: string; name: string; type: NodeType; aliases: string[] }
/** from → to. A mention goes from a book to a node. An attribute link goes from a node to a node and keeps its attribute name. */
export interface GraphLink { from: string; to: string; kind: LinkKind; name?: string; sentence?: string }
/** An attribute whose value is not (yet) a node. */
export interface TextAttr { nodeId: string; name: string; value: string }
export interface Seg { t: string; d?: string; n?: string }
export interface Book { id: string; title: string; industry: string; date: string; pages: number; excerpt: string; sample?: boolean; publishedAt: number }

/** Everything readers can see, built once per publish and served from a versioned path. */
export interface Snapshot { version: number; nodes: GraphNode[]; books: Book[]; links: GraphLink[]; attrs: TextAttr[] }

export type ProposalKind = 'existing' | 'alias' | 'new' | 'close';
export type Decision = 'confirmed' | 'new' | 'same' | 'demoted' | 'rejected';
export interface Detection {
  id: string; term: string; sentence: string; nodeType: NodeType; note: string;
  /** Set by the backend from the live graph when the draft is uploaded. */
  proposal: ProposalKind; targetId?: string; targetName?: string;
  /** Attributes the agent proposes for a new node. */
  attributes?: { name: string; value: string }[];
  /** The agent's suggestion that this detection is better kept as an attribute of another detection. */
  demoteHint?: { to: string; name: string };
  decision?: Decision; rename?: string;
}
export type DraftStatus = 'draft' | 'published' | 'discarded';
export interface Draft {
  id: string; number: number; requestId: string; status: DraftStatus; version: number; uploadedAt: number; bookId?: string;
  title: string; industry: string; date: string; pages: number; excerpt: string;
  paragraphs: Seg[][]; detections: Detection[];
}
/** What the agent uploads. The backend adds proposals; the agent can never publish. */
export interface DraftPackage {
  requestId: string; title: string; industry: string; date: string; pages: number; excerpt: string;
  paragraphs: Seg[][];
  detections: Pick<Detection, 'id' | 'term' | 'sentence' | 'nodeType' | 'note' | 'attributes' | 'demoteHint'>[];
}

export interface LookupResult { name: string; match: 'exact' | 'alias' | 'none'; node?: GraphNode; close: GraphNode[] }
export interface PreviewGraph { nodes: (GraphNode & { ghost?: boolean; book?: boolean })[]; links: (GraphLink & { ghost?: boolean })[] }
export interface DraftView extends Draft {
  preview: PreviewGraph;
  /** For close matches: the existing node's attributes, so the owner can compare. */
  targetAttrs: Record<string, { name: string; value: string }[]>;
  newNodeCount: number;
}
export interface DraftSummary { id: string; number: number; title: string; status: DraftStatus; decided: number; total: number; bookId?: string }

export interface NodePage {
  node: GraphNode;
  attrs: { name: string; value: string; valueId?: string }[];
  books: { id: string; title: string; industry: string; date: string }[];
  backlinks: { id: string; title: string; context: string; book: boolean }[];
}
export interface BookPage {
  book: Book; tags: { id: string; name: string }[];
  related: { id: string; title: string; shared: string[] }[];
  paragraphs: Seg[][];
}
export interface LibraryItem extends Book { tags: { id: string; name: string }[] }
export interface LocalGraph { center: string; nodes: (GraphNode & { book?: boolean })[]; links: GraphLink[]; capped: boolean }
export interface SearchEntry { kind: 'node' | 'book'; id: string; label: string; sub: string; aliases: string[]; text: string }

export const AI_NOTICE = '研究內容由 AI 協助整理，可能包含錯誤，重要資訊請連回來源。';
export const TYPE_LABEL: Record<NodeType | 'book', string> = { company: '公司', etf: 'ETF', inst: '機構', concept: '概念', book: '研究書' };
export const decidedCount = (d: { detections: Detection[] }) => d.detections.filter(x => x.decision).length;
