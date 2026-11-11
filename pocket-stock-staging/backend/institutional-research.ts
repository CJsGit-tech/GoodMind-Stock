import { createResearchWorkflow } from './etf-markdown.ts';
import { parseInstitutionalSource, INSTITUTIONAL_SOURCE_LIMIT } from '../shared/institutional-research.ts';
const workflow = createResearchWorkflow({ prefix: 'institutional', parse: parseInstitutionalSource, maxSourceBytes: INSTITUTIONAL_SOURCE_LIMIT, requireTemplate: true });
export const makeInstitutionalRoutes = workflow.makeEtfMarkdownRoutes;
