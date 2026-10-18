import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function CatalogPagination({
  page,
  count,
  total,
  size,
  label,
  onChange,
  noun = '本',
  collection = '書目',
}: {
  page: number;
  count: number;
  total: number;
  size: number;
  label: string;
  noun?: string;
  collection?: string;
  onChange: (page: number) => void;
}) {
  return (
    <nav className="catalog-pagination" aria-label={label}>
      <span role="status" aria-live="polite">
        第 {page * size + 1}–{Math.min((page + 1) * size, total)} {noun}，共 {total} {noun}
      </span>
      <div>
        <button
          type="button"
          disabled={page === 0}
          aria-label={`上一頁${collection}`}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={15} />
        </button>
        {Array.from({ length: count }, (_, index) => index)
          .filter(
            index =>
              index === 0 || index === count - 1 || Math.abs(index - page) <= 1
          )
          .map((index, position, numbers) => (
            <span key={index}>
              {position > 0 && index - numbers[position - 1] > 1 && (
                <span className="pagination-gap" aria-hidden="true">
                  …
                </span>
              )}
              <button
                type="button"
                aria-label={`第 ${index + 1} 頁${collection}`}
                aria-current={index === page ? 'page' : undefined}
                onClick={() => onChange(index)}
              >
                {index + 1}
              </button>
            </span>
          ))}
        <button
          type="button"
          disabled={page === count - 1}
          aria-label={`下一頁${collection}`}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </nav>
  );
}

export function ResearchHero({
  title = '投資前先看看書',
  deck = <>產業脈絡 × 供應鏈變化 × 長期競爭力<br />用研究，理解台灣股票與產業的真實輪廓。</>,
  aphorism = <>閱讀<br />使投資<br />看得更遠</>,
  titleId = 'featured-book-title',
}: {
  title?: string; deck?: ReactNode;
  aphorism?: ReactNode; titleId?: string;
} = {}) {
  return (
    <section
      className="featured-book library-featured-composition"
      aria-labelledby={titleId}
    >
      <div className="featured-book-layout">
        <div className="featured-book-premise">
          <h1 id={titleId} tabIndex={-1}>
            {title}
          </h1>
          <p className="featured-book-deck">
            {deck}
          </p>
        </div>
        <p className="featured-book-aphorism" aria-hidden="true">
          {aphorism}
        </p>
      </div>
    </section>
  );
}

