// Public data guide: schema, relations, search structure and methodology. Read-only; no maintenance tools.
import { useTranslation } from 'react-i18next';
import TopBar from '../components/TopBar';
import Docs from '../components/Docs';
import { useGraph } from '../lib/api';

export default function DocsPage() {
  const { t } = useTranslation();
  const { data } = useGraph();
  if (!data) return <div className="fullscreen-msg"><div className="orb" /><p>{t('載入中…')}</p></div>;
  return (
    <div className="page-ws">
      <TopBar />
      <main className="ws ws-docs"><Docs data={data} version={String(data.meta.ontology_version ?? '')} /></main>
    </div>);
}
