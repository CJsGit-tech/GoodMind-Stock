import { ShimmerImage } from './loading';
import { useState } from 'react';
import type { MarkdownReport } from '../shared/etf-markdown';
import './research-article-heading.css';

/** Shared publication identity for research readers and Author previews. */
export function ResearchArticleHeading({ report, label, coverUrl, publishedAt, preview = false }: {
  report: MarkdownReport; label: string; coverUrl?: string; publishedAt?: string | null; preview?: boolean;
}) {
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const showCover = !!coverUrl && failedCover !== coverUrl;
  return <header className={'research-article-heading' + (showCover ? ' has-cover' : '')}>
    <div>
      <p className='etf-note'>{label} · {report.period.end}{preview && ' · 私有預覽'}</p>
      <h1>{report.title}</h1>
      {report.excerpt && <p className='research-article-excerpt'>{report.excerpt}</p>}
      <p className='research-article-meta'>
        {report.period.start !== report.period.end && <>比較日 {report.period.start} → {report.period.end} · </>}
        資料查核 {report.evidenceDate}{preview && <> · {report.frontmatter.data_status === 'complete' ? '資料完整' : report.frontmatter.data_status === 'unavailable' ? '資料未取得' : '資料部分覆蓋'}</>}
        {publishedAt && <> · 發布 {new Date(publishedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false })}</>}
      </p>
    </div>
    {showCover && <ShimmerImage frameClassName='research-heading-cover' src={coverUrl} width='240' height='180' alt={'《' + report.title + '》封面'} onError={() => setFailedCover(coverUrl!)} />}
  </header>;
}
