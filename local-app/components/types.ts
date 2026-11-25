export interface NodeRecord {
  id: string;
  type: string;
  name: string;
  [key: string]: unknown;
}
export interface EdgeRecord {
  id: string;
  predicate: string;
  from: string;
  to: string;
  [key: string]: unknown;
}
export interface EntityType {
  name: string;
  definition: string;
}
export interface EdgeType {
  predicate: string;
  from: string;
  to: string;
  group: string;
  storage: string;
  meaning: string;
}
export interface Graph {
  nodes: NodeRecord[];
  edges: EdgeRecord[];
  entityTypes: EntityType[];
  edgeTypes: EdgeType[];
  [key: string]: unknown;
}
export const typeLabels: Record<string, string> = {
  Company: '公司',
  CorporateGroup: '企業集團',
  OrganizationUnit: '組織單位',
  Product: '產品',
  ProductFamily: '產品系列',
  ProductCategory: '產品分類',
  Technology: '技術',
  Application: '應用',
  Industry: '產業',
  MarketSegment: '市場區隔',
  SupplyRelationship: '供應紀錄',
  CustomerOpportunity: '潛在客戶',
  Collaboration: '合作紀錄',
  CompetitionAssessment: '競爭評估',
  Evidence: '來源證據',
  Claim: '主張',
};
export const groupLabels: Record<string, string> = {
  corporate: '企業結構',
  products: '產品與技術',
  industry: '產業與市場',
  supply: '供應鏈',
  opportunities: '潛在客戶',
  collaboration: '合作關係',
  competition: '競爭評估',
  evidence: '來源與主張',
};
export const statusLabels: Record<string, string> = {
  officially_disclosed: '官方揭露（原資料標記）',
  corroborated: '交叉佐證',
  reported: '媒體報導',
  analyst_inferred: '分析推論',
  hypothesis: '待驗證假設',
  disputed: '存在爭議',
  rejected: '已否定',
};
export function typeColor(type: string): string {
  if (['Company', 'CorporateGroup', 'OrganizationUnit'].includes(type))
    return '#1763ed';
  if (['Product', 'ProductFamily', 'ProductCategory'].includes(type))
    return '#08aebc';
  if (type === 'Technology') return '#8d52dd';
  if (['Application', 'Industry', 'MarketSegment'].includes(type))
    return '#e5a01b';
  if (['Evidence', 'Claim'].includes(type)) return '#8392a7';
  if (type === 'CompetitionAssessment') return '#dd647d';
  return '#37a38a';
}
export function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}
