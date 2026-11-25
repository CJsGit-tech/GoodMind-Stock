import { useRef, useState } from 'react';
import { Globe, Upload } from 'lucide-react';
import { useI18n } from './i18n';

export function PublishControls({ draftVersion, publishedVersion, onPublish }: {
  draftVersion: number; publishedVersion: number; onPublish: () => Promise<void>;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = draftVersion > publishedVersion;
  async function confirm() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await onPublish();
      setNotice('已發布，所有訪客都能看到這次更新。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '發布未完成，請重試。');
    } finally {
      setBusy(false);
      dialog.current?.close();
    }
  }
  return <section className="publication-bar" aria-label={t('公開發布')}>
    <div><Globe size={18} /><span><strong>{t('管理草稿')}</strong><small>{t(draftVersion === 0 ? '儲存草稿後，即可發布至公開圖譜。' : pending ? '有尚未公開的變更。儲存不會自動發布。' : '公開圖譜已是最新儲存版本。')}</small></span></div>
    <button className="primary" disabled={!pending || busy} onClick={() => { setError(''); dialog.current?.showModal(); }}><Upload size={16} />{t('發布至公開圖譜')}</button>
    {error && <p role="alert" className="publication-message">{t(error)}</p>}
    {notice && <p role="status" className="publication-message">{t(notice)}</p>}
    <dialog ref={dialog} className="publish-dialog" aria-labelledby="publish-confirm-title" onCancel={event => { if (busy) event.preventDefault(); }}>
      <h2 id="publish-confirm-title">{t('確認公開這份圖譜？')}</h2>
      <p>{t('這會將目前已儲存的管理草稿完整發布給所有訪客，包括其中的名稱、關係、備註與來源。請先確認沒有私人或敏感資料。')}</p>
      <p>{t('尚未儲存的編輯不會發布。舊有個人工作區資料不會自動搬移或公開。')}</p>
      <div className="modal-actions"><button className="outline" disabled={busy} onClick={() => dialog.current?.close()}>{t('取消')}</button><button className="primary" disabled={busy} onClick={() => void confirm()}>{t(busy ? '發布中…' : '確認發布')}</button></div>
    </dialog>
  </section>;
}
