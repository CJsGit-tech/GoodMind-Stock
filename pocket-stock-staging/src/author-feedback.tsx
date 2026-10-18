import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import './author-feedback.css';

export type FeedbackKind = 'all' | 'suggestions' | 'research-interest';
type Submission = {
  id: string;
  kind: 'suggestions' | 'research-interest';
  createdAt: string;
  userId: string;
  body?: string;
  stocks?: string[];
  nickname?: string;
  email?: string;
  consent?: boolean;
};
export type FeedbackPage = { items: Submission[]; nextToken?: string };
type Props = {
  sessionToken: string;
  requestPage: (
    kind: FeedbackKind,
    nextToken?: string
  ) => Promise<FeedbackPage>;
};

function kindLabel(kind: string) {
  return kind === 'suggestions' ? '意見箱' : '研究需求';
}

function submissionTitle(item: Submission) {
  return item.kind === 'suggestions'
    ? item.body || '未提供建議內容'
    : item.stocks?.join(' / ') || '未提供研究標的';
}

function submissionTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '日期未提供'
    : new Intl.DateTimeFormat('zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(date);
}

export function AuthorFeedbackView({ sessionToken, requestPage }: Props) {
  const [kind, setKind] = useState<FeedbackKind>('all');
  const [page, setPage] = useState(0);
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [data, setData] = useState<FeedbackPage>({ items: [] });
  const [selectedId, setSelectedId] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const requestRef = useRef(requestPage);
  const version = useRef(0);
  requestRef.current = requestPage;
  const cursor = cursors[page];

  useEffect(() => {
    const current = ++version.current;
    setStatus('loading');
    setData({ items: [] });
    setSelectedId('');
    setMessage('');
    requestRef
      .current(kind, cursor)
      .then(result => {
        if (version.current !== current) return;
        if (
          !Array.isArray(result.items) ||
          result.items.some(
            item =>
              !item ||
              typeof item.id !== 'string' ||
              typeof item.userId !== 'string' ||
              typeof item.createdAt !== 'string' ||
              !['suggestions', 'research-interest'].includes(item.kind) ||
              (kind !== 'all' && item.kind !== kind)
          )
        )
          throw new Error('Invalid feedback page');
        setData(result);
        setSelectedId(result.items[0]?.id || '');
        setStatus('ready');
      })
      .catch((caught: unknown) => {
        if (version.current !== current) return;
        const error = caught as {
          status?: number;
          statusCode?: number;
          response?: { status?: number };
        };
        const code =
          error?.status || error?.statusCode || error?.response?.status;
        setMessage(
          code === 429
            ? '目前讀取次數較多，請稍後再試。'
            : '目前無法載入讀者回饋，請稍後重試。'
        );
        setStatus('error');
      });
    return () => {
      version.current += 1;
    };
  }, [kind, cursor, page, retry, sessionToken]);

  function changeKind(next: FeedbackKind) {
    if (next === kind) return;
    version.current += 1;
    setData({ items: [] });
    setSelectedId('');
    setStatus('loading');
    setKind(next);
    setPage(0);
    setCursors([undefined]);
  }

  function changePage(next: number) {
    if (status === 'loading') return;
    version.current += 1;
    setSelectedId('');
    setData({ items: [] });
    setStatus('loading');
    if (next > page)
      setCursors(history => [...history.slice(0, page + 1), data.nextToken]);
    setPage(next);
  }

  const selected =
    status === 'ready'
      ? data.items.find(item => item.id === selectedId)
      : undefined;
  const hasMore = Boolean(data.nextToken);
  return (
    <main
      className="author-feedback-main"
      aria-labelledby="author-feedback-title"
    >
      <h1 id="author-feedback-title">讀者回饋</h1>
      <div
        className="author-feedback-filters"
        role="group"
        aria-label="回饋類型"
      >
        {(['all', 'suggestions', 'research-interest'] as const).map(value => (
          <button
            type="button"
            key={value}
            aria-pressed={kind === value}
            onClick={() => changeKind(value)}
          >
            {value === 'all' ? '全部' : kindLabel(value)}
          </button>
        ))}
      </div>
      <div className="author-feedback-split">
        <section
          className="author-feedback-list-panel"
          aria-label="讀者回饋清單"
          aria-busy={status === 'loading'}
        >
          <div className="author-feedback-list-scroll">
            {status === 'loading' ? (
              <p className="author-feedback-state" role="status">
                正在載入讀者回饋…
              </p>
            ) : status === 'error' ? (
              <div className="author-feedback-state" role="alert">
                <p>{message}</p>
                <button
                  type="button"
                  onClick={() => setRetry(value => value + 1)}
                >
                  重試
                </button>
              </div>
            ) : data.items.length === 0 ? (
              <div className="author-feedback-state" role="status">
                <h2>
                  {hasMore || page > 0
                    ? '這一頁沒有符合的回饋'
                    : '尚無' + (kind === 'all' ? '讀者回饋' : kindLabel(kind))}
                </h2>
                <p>
                  {hasMore
                    ? '還有其他資料頁，可繼續查看下一頁。'
                    : page > 0
                      ? '可返回上一頁查看其他回饋。'
                      : '收到讀者提交的內容後，會顯示在這裡。'}
                </p>
              </div>
            ) : (
              <ul className="author-feedback-list">
                {data.items.map(item => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-pressed={selectedId === item.id}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <span className="author-feedback-row-meta">
                        <span>{kindLabel(item.kind)}</span>
                        <time dateTime={item.createdAt}>
                          {submissionTime(item.createdAt)}
                        </time>
                        <span className="author-feedback-reader">
                          {item.kind === 'research-interest' && item.nickname
                            ? item.nickname
                            : item.userId}
                        </span>
                      </span>
                      <strong>{submissionTitle(item)}</strong>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <nav className="author-feedback-pagination" aria-label="讀者回饋分頁">
            <button
              type="button"
              disabled={page === 0 || status === 'loading'}
              onClick={() => changePage(page - 1)}
            >
              <ChevronLeft size={16} /> 上一頁
            </button>
            <span role="status" aria-live="polite">
              第 {page + 1} 頁
            </span>
            <button
              type="button"
              disabled={!hasMore || status !== 'ready'}
              onClick={() => changePage(page + 1)}
            >
              下一頁 <ChevronRight size={16} />
            </button>
          </nav>
        </section>
        <section
          className="author-feedback-detail"
          aria-label="回饋內容"
          aria-live="polite"
        >
          {selected ? (
            <>
              <h2>
                {selected.kind === 'suggestions'
                  ? '研究建議'
                  : submissionTitle(selected)}
              </h2>
              <p className="author-feedback-detail-meta">
                {kindLabel(selected.kind)} <span aria-hidden="true">｜</span>{' '}
                <time dateTime={selected.createdAt}>
                  {submissionTime(selected.createdAt)}
                </time>
              </p>
              {selected.kind === 'suggestions' && (
                <p className="author-feedback-body">{selected.body}</p>
              )}
              <dl>
                {selected.kind === 'research-interest' && (
                  <>
                    <dt>讀者暱稱</dt>
                    <dd>{selected.nickname || '未提供'}</dd>
                  </>
                )}
                <dt>讀者 ID</dt>
                <dd>{selected.userId}</dd>
                {selected.kind === 'research-interest' && (
                  <>
                    <dt>聯絡 Email</dt>
                    <dd>{selected.email || '未提供'}</dd>
                    <dt>聯絡同意</dt>
                    <dd>
                      {selected.consent === true
                        ? '已同意本次需求聯絡'
                        : '未記錄聯絡同意'}
                    </dd>
                  </>
                )}
              </dl>
            </>
          ) : (
            <p className="author-feedback-detail-placeholder">
              {status === 'ready' && data.items.length
                ? '選擇一則回饋查看內容。'
                : '回饋內容會顯示在這裡。'}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
