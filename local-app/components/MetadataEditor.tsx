import { useI18n } from './i18n';
import { Graph, statusLabels } from './types';
import { metadataLabel, readableText, visibleMetadata } from './presentation';

type Fields = Record<string, unknown>;
export function MetadataEditor({ value, onChange, graph, mode, entityType }: {
  value: Fields; onChange: (next: Fields) => void; graph: Graph; mode: 'nodes' | 'edges'; entityType?: string;
}) {
  const { locale, t, name, propertyLabel, statusLabel } = useI18n();
  const set = (key: string, next: unknown) => onChange({ ...value, [key]: next });
  const names = value.localized_names && typeof value.localized_names === 'object'
    ? value.localized_names as Fields : {};
  const evidence = Array.isArray(value.evidence_ids) ? value.evidence_ids.map(String) : [];
  const known = new Set(['ticker', 'verification_status', 'valid_from', 'valid_to', 'source_published_at', 'last_verified_at', 'url', 'website', 'competition_type', 'basis', 'notes', 'commercial_competition_verified', 'reverified_for_package']);
  return <fieldset className="structured-metadata">
    <legend>{t('詳細設定')}</legend>
    {mode === 'nodes' && <div className="two-fields">
      <label className="field-label">{t('繁體中文名稱')}
        <input value={String(names['zh-TW'] ?? value.name_zh_TW ?? '')} onChange={event => set('localized_names', { ...names, 'zh-TW': event.target.value })} />
      </label>
      <label className="field-label">{t('英文名稱')}
        <input value={String(names.en ?? value.name_en ?? '')} onChange={event => set('localized_names', { ...names, en: event.target.value })} />
      </label>
    </div>}
    <div className="two-fields">
      {mode === 'nodes' && <label className="field-label">{propertyLabel('ticker')}
        <input value={String(value.ticker ?? '')} onChange={event => set('ticker', event.target.value)} />
      </label>}
      <label className="field-label">{t('驗證狀態')}
        <select value={String(value.verification_status ?? '')} onChange={event => set('verification_status', event.target.value)}>
          <option value="">{t('未標記')}</option>
          {Object.keys(statusLabels).map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}
        </select>
      </label>
    </div>
    <details className="metadata-disclosure">
      <summary>{t('來源與有效日期')}</summary>
      <div className="two-fields">
        {['url', 'website'].map(key => <label key={key} className="field-label">{metadataLabel(key, locale, propertyLabel)}
          <input type="url" value={String(value[key] ?? '')} onChange={event => set(key, event.target.value)} placeholder="https://" />
        </label>)}
        {['valid_from', 'valid_to', 'source_published_at', 'last_verified_at'].map(key => <label key={key} className="field-label">{metadataLabel(key, locale, propertyLabel)}
          <input type="date" value={String(value[key] ?? '').slice(0, 10)} onChange={event => set(key, event.target.value)} />
        </label>)}
      </div>
      <fieldset className="evidence-choices">
        <legend>{t('來源證據')}</legend>
        {graph.nodes.filter(node => node.type === 'Evidence').map(source => <label key={source.id}>
          <input type="checkbox" checked={evidence.includes(source.id)} onChange={event => set('evidence_ids', event.target.checked ? [...evidence, source.id] : evidence.filter(id => id !== source.id))} />
          <span>{name(source)}</span>
        </label>)}
      </fieldset>
    </details>
    {(entityType === 'CompetitionAssessment' || 'competition_type' in value || 'basis' in value) && <details className="metadata-disclosure" open>
      <summary>{t('競爭評估設定')}</summary>
      <label className="field-label">{propertyLabel('competition_type')}
        <select value={String(value.competition_type ?? '')} onChange={event => set('competition_type', event.target.value)}>
          <option value="">{t('未指定')}</option>
          <option value="DIRECT">{readableText('DIRECT', locale)}</option>
          <option value="INDIRECT">{readableText('INDIRECT', locale)}</option>
        </select>
      </label>
      <label className="field-label">{t('判斷依據，每行一項')}
        <textarea rows={4} value={Array.isArray(value.basis) ? value.basis.join('\n') : ''} onChange={event => set('basis', event.target.value.split('\n').filter(line => line.trim()))} />
      </label>
    </details>}
    {['commercial_competition_verified', 'reverified_for_package'].filter(key => typeof value[key] === 'boolean').map(key =>
      <label className="boolean-field" key={key}><input type="checkbox" checked={value[key] === true} onChange={event => set(key, event.target.checked)} />{propertyLabel(key)}</label>)}
    <label className="field-label">{t('備註')}
      <textarea rows={3} value={String(value.notes ?? '')} onChange={event => set('notes', event.target.value)} />
    </label>
    {visibleMetadata(value).some(([key]) => !known.has(key)) && <details className="metadata-disclosure">
      <summary>{t('其他資料')}</summary>
      <dl>{visibleMetadata(value).filter(([key]) => !known.has(key)).map(([key, entry]) =>
        <div className="property-row" key={key}><dt>{metadataLabel(key, locale, propertyLabel)}</dt><dd>{readableText(entry, locale, t)}</dd></div>)}</dl>
    </details>}
  </fieldset>;
}
