import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, type AuthUser } from '@appdeploy/client';
import {
  ArrowLeft,
  Check,
  LockKeyhole,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import './reader-forms.css';

export type ReaderFormKind = 'suggestions' | 'research-interest';
type Receipt = { id: string; createdAt: string };
type Props = {
  kind: ReaderFormKind;
  user: AuthUser | null;
  hydrating: boolean;
  resetKey: number;
  onSignIn: (trigger: HTMLElement) => void;
  onExpired: () => void;
  onBack: () => void;
};

function statusOf(value: unknown) {
  const e = value as {
    status?: number;
    response?: { status?: number; data?: { statusCode?: number } };
    data?: { statusCode?: number };
  } | null;
  return (
    e?.status ??
    e?.response?.status ??
    e?.data?.statusCode ??
    e?.response?.data?.statusCode
  );
}

export function ReaderFormView({
  kind,
  user,
  hydrating,
  resetKey,
  onSignIn,
  onExpired,
  onBack,
}: Props) {
  const suggestion = kind === 'suggestions';
  const [body, setBody] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [stocks, setStocks] = useState(['']);
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [pending, setPending] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [receiptCheck, setReceiptCheck] = useState('');
  const owner = useRef<string | null>(null);
  const currentUser = useRef(user?.userId ?? null);
  currentUser.current = user?.userId ?? null;
  const preserveExpiredDraft = useRef(false);
  const pendingRef = useRef(false);
  const requestVersion = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const receiptRef = useRef<HTMLHeadingElement>(null);
  const initialResetKey = useRef(resetKey);

  function clearDraft(nextUser: AuthUser | null) {
    setBody('');
    setNickname(nextUser?.name?.slice(0, 50) ?? '');
    setEmail(nextUser?.email ?? '');
    setStocks(['']);
    setConsent(false);
    setErrors({});
    setFeedback('');
    setReceipt(null);
    setReceiptCheck('');
    setPending(false);
    pendingRef.current = false;
    requestVersion.current += 1;
  }

  useEffect(() => {
    if (initialResetKey.current !== resetKey) {
      initialResetKey.current = resetKey;
      preserveExpiredDraft.current = false;
      owner.current = null;
      clearDraft(null);
    }
  }, [resetKey]);

  useEffect(() => {
    if (hydrating) return;
    if (user) {
      if (owner.current !== user.userId) clearDraft(user);
      owner.current = user.userId;
      preserveExpiredDraft.current = false;
    } else if (owner.current) {
      preserveExpiredDraft.current = true;
      requestVersion.current += 1;
      pendingRef.current = false;
      setPending(false);
      setReceipt(null);
    } else {
      clearDraft(null);
    }
  }, [user?.userId, hydrating]);

  useEffect(
    () => () => {
      requestVersion.current += 1;
    },
    []
  );
  useEffect(() => {
    if (receipt) receiptRef.current?.focus();
  }, [receipt]);

  function expireSession() {
    preserveExpiredDraft.current = true;
    setFeedback('讀者登入已失效，請重新登入後再送出。');
    setReceipt(null);
    onExpired();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || pendingRef.current) return;
    const nextErrors: Record<string, string> = {};
    const normalizedBody = body.trim();
    const normalizedStocks = stocks.map(stock => stock.trim());
    if (suggestion) {
      const count = Array.from(normalizedBody).length;
      if (count < 10 || count > 2000)
        nextErrors.body = '請輸入 10–2000 字的建議。';
    } else {
      if (Array.from(nickname.trim()).length > 50)
        nextErrors.nickname = '暱稱請勿超過 50 字。';
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
        email.trim().length > 254
      )
        nextErrors.email = '請輸入有效的聯絡 Email。';
      normalizedStocks.forEach((stock, i) => {
        if (!stock || Array.from(stock).length > 100)
          nextErrors['stock-' + i] =
            '請輸入股票代號或公司名稱（最多 100 字）。';
      });
      if (new Set(normalizedStocks).size !== normalizedStocks.length)
        nextErrors['stock-' + (normalizedStocks.length - 1)] =
          '請勿重複填寫同一個標的。';
      if (!consent) nextErrors.consent = '請確認同意就本次需求聯絡你。';
    }
    setErrors(nextErrors);
    setFeedback('');
    if (Object.keys(nextErrors).length) {
      formRef.current
        ?.querySelector<HTMLElement>(
          '[name="' + Object.keys(nextErrors)[0] + '"]'
        )
        ?.focus();
      return;
    }
    pendingRef.current = true;
    setPending(true);
    const expectedUser = user.userId;
    const version = ++requestVersion.current;
    try {
      const response = await api.post(
        '/api/reader/forms/' + kind,
        suggestion
          ? { body: normalizedBody }
          : {
              nickname: nickname.trim(),
              email: email.trim(),
              stocks: normalizedStocks,
              consent: true,
            }
      );
      if (
        requestVersion.current !== version ||
        currentUser.current !== expectedUser
      )
        return;
      const saved = response.data?.submission;
      if (
        !saved ||
        typeof saved.id !== 'string' ||
        typeof saved.createdAt !== 'string'
      )
        throw new Error('Invalid receipt');
      setReceipt({ id: saved.id, createdAt: saved.createdAt });
      setBody('');
      setStocks(['']);
      setConsent(false);
    } catch (caught) {
      if (
        requestVersion.current !== version ||
        currentUser.current !== expectedUser
      )
        return;
      if (statusOf(caught) === 401) expireSession();
      else
        setFeedback(
          statusOf(caught) === 429
            ? '目前送出次數較多，請稍後再試。你的內容仍保留在此頁。'
            : '尚未確認送出成功。你的內容仍保留，請稍後重試。'
        );
    } finally {
      if (requestVersion.current === version) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }

  async function confirmReceipt() {
    if (!user || !receipt || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    const version = ++requestVersion.current;
    const expectedUser = user.userId;
    try {
      const response = await api.get(
        '/api/reader/forms/' + kind + '/' + encodeURIComponent(receipt.id)
      );
      if (
        requestVersion.current !== version ||
        currentUser.current !== expectedUser
      )
        return;
      if (response.data?.submission?.id !== receipt.id)
        throw new Error('Invalid receipt');
      setReceiptCheck('已確認這筆資料保存在你的讀者帳號。');
    } catch (caught) {
      if (
        requestVersion.current !== version ||
        currentUser.current !== expectedUser
      )
        return;
      if (statusOf(caught) === 401) expireSession();
      else setReceiptCheck('暫時無法確認收件紀錄，請稍後再試。');
    } finally {
      if (requestVersion.current === version) {
        pendingRef.current = false;
        setPending(false);
      }
    }
  }

  const fieldError = (name: string) =>
    errors[name] ? (
      <span id={name + '-error'} className="reader-form-error">
        {errors[name]}
      </span>
    ) : null;

  return (
    <section
      className={`reader-form-page ${suggestion ? 'reader-form-suggestion' : 'reader-form-interest'}`}
      aria-labelledby="reader-form-title"
    >
      <button className="reader-form-back" onClick={onBack}>
        <ArrowLeft size={16} /> 返回研究書庫
      </button>
      <div className="reader-form-layout">
        <header className="reader-form-intro">
          <h1 id="reader-form-title">{suggestion ? '意見箱' : '研究需求'}</h1>
          <p>
            {suggestion
              ? '你希望研究再多看哪個面向？'
              : '告訴我們，你想深入了解哪些台股公司。'}
          </p>
        </header>
        <div className="reader-form-workspace">
          {hydrating ? (
            <div role="status" aria-busy="true">
              正在確認讀者登入…
            </div>
          ) : !user ? (
            <div className="reader-form-gate">
              <LockKeyhole size={28} aria-hidden="true" />
              <h2>請先登入讀者帳號</h2>
              <p>登入後即可填寫{suggestion ? '意見箱' : '研究需求'}。</p>
              {feedback && <p role="alert">{feedback}</p>}
              <button
                className="reader-form-primary"
                onClick={e => onSignIn(e.currentTarget)}
              >
                登入或註冊讀者帳號
              </button>
            </div>
          ) : receipt ? (
            <div className="reader-form-success">
              <Check size={28} aria-hidden="true" />
              <h2 ref={receiptRef} tabIndex={-1}>
                {suggestion
                  ? '建議已送出，謝謝你的分享。'
                  : '研究需求已收到，謝謝你的分享。'}
              </h2>
              <p>
                內容不會公開顯示。
                {!suggestion && '這是需求收件確認，並非訂閱或研究完成通知。'}
              </p>
              <dl>
                <dt>收件時間</dt>
                <dd>{new Date(receipt.createdAt).toLocaleString('zh-TW')}</dd>
                <dt>收件編號</dt>
                <dd>{receipt.id}</dd>
              </dl>
              <div className="reader-form-actions">
                <button
                  type="button"
                  disabled={pending}
                  onClick={confirmReceipt}
                >
                  確認收件紀錄
                </button>
                <button
                  type="button"
                  className="reader-form-primary"
                  disabled={pending}
                  onClick={() => {
                    setReceipt(null);
                    setReceiptCheck('');
                    setFeedback('');
                  }}
                >
                  {suggestion ? '再寫一則建議' : '填寫另一筆需求'}
                </button>
              </div>
              {receiptCheck && <p role="status">{receiptCheck}</p>}
            </div>
          ) : (
            <form
              ref={formRef}
              onSubmit={submit}
              noValidate
              aria-busy={pending}
            >
              <p className="reader-form-private">
                <LockKeyhole size={14} aria-hidden="true" />{' '}
                使用讀者帳號提交，內容不會公開顯示。
              </p>
              {suggestion ? (
                <div className="reader-form-field">
                  <label htmlFor="suggestion-body">
                    你的建議 <span>必填</span>
                  </label>
                  <textarea
                    id="suggestion-body"
                    name="body"
                    required
                    rows={8}
                    value={body}
                    disabled={pending}
                    aria-invalid={Boolean(errors.body)}
                    aria-describedby={
                      'suggestion-help' + (errors.body ? ' body-error' : '')
                    }
                    onChange={e => setBody(e.target.value)}
                    placeholder="我認為增加＿＿分析會有幫助，因為……"
                  />
                  <div id="suggestion-help" className="reader-form-help">
                    10–2000 字・例如：同業比較、供應鏈變化{' '}
                    <span>{Array.from(body.trim()).length} / 2000</span>
                  </div>
                  {fieldError('body')}
                </div>
              ) : (
                <>
                  <div className="reader-form-contact">
                    <div className="reader-form-field">
                      <label htmlFor="request-nickname">
                        暱稱 <span>選填</span>
                      </label>
                      <input
                        id="request-nickname"
                        name="nickname"
                        autoComplete="nickname"
                        value={nickname}
                        disabled={pending}
                        aria-invalid={Boolean(errors.nickname)}
                        aria-describedby={
                          errors.nickname ? 'nickname-error' : undefined
                        }
                        onChange={e => setNickname(e.target.value)}
                      />
                      {fieldError('nickname')}
                    </div>
                    <div className="reader-form-field">
                      <label htmlFor="request-email">
                        聯絡 Email <span>必填</span>
                      </label>
                      <input
                        id="request-email"
                        name="email"
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        disabled={pending}
                        aria-invalid={Boolean(errors.email)}
                        aria-describedby={
                          'request-contact-help' +
                          (errors.email ? ' email-error' : '')
                        }
                        onChange={e => setEmail(e.target.value)}
                      />
                      {fieldError('email')}
                    </div>
                  </div>
                  <p id="request-contact-help" className="reader-form-help">
                    從讀者帳號帶入的聯絡資料可以修改。
                  </p>
                  <fieldset className="reader-form-stocks" disabled={pending}>
                    <legend>
                      想了解的股票或公司 <span>必填・最多 3 個</span>
                    </legend>
                    {stocks.map((stock, i) => (
                      <div className="reader-form-field" key={i}>
                        <label htmlFor={'request-stock-' + i}>
                          標的 {i + 1}
                        </label>
                        <div className="reader-form-stock-row">
                          <input
                            id={'request-stock-' + i}
                            name={'stock-' + i}
                            required
                            value={stock}
                            placeholder="例如：2330 台積電"
                            aria-invalid={Boolean(errors['stock-' + i])}
                            aria-describedby={
                              errors['stock-' + i]
                                ? 'stock-' + i + '-error'
                                : undefined
                            }
                            onChange={e =>
                              setStocks(
                                stocks.map((v, index) =>
                                  index === i ? e.target.value : v
                                )
                              )
                            }
                          />
                          {stocks.length > 1 && (
                            <button
                              type="button"
                              aria-label={'移除標的 ' + (i + 1)}
                              onClick={() => {
                                setStocks(
                                  stocks.filter((_, index) => index !== i)
                                );
                                setErrors({});
                              }}
                            >
                              <Trash2 size={17} />
                            </button>
                          )}
                        </div>
                        {fieldError('stock-' + i)}
                      </div>
                    ))}
                    {stocks.length < 3 && (
                      <button
                        className="reader-form-add"
                        type="button"
                        onClick={() => {
                          const i = stocks.length;
                          setStocks([...stocks, '']);
                          requestAnimationFrame(() =>
                            document
                              .getElementById('request-stock-' + i)
                              ?.focus()
                          );
                        }}
                      >
                        <Plus size={16} /> 新增標的
                      </button>
                    )}
                  </fieldset>
                  <div className="reader-form-consent">
                    <label>
                      <input
                        name="consent"
                        type="checkbox"
                        checked={consent}
                        required
                        disabled={pending}
                        aria-invalid={Boolean(errors.consent)}
                        aria-describedby={
                          errors.consent ? 'consent-error' : undefined
                        }
                        onChange={e => setConsent(e.target.checked)}
                      />{' '}
                      我同意就本次研究需求透過上述 Email 聯絡我。
                    </label>
                    {fieldError('consent')}
                  </div>
                </>
              )}
              {feedback && (
                <p className="reader-form-error" role="alert">
                  {feedback}
                </p>
              )}
              <div className="reader-form-actions">
                <button
                  type="submit"
                  className="reader-form-primary"
                  disabled={pending}
                >
                  <Send size={16} />{' '}
                  {pending ? '正在送出…' : suggestion ? '送出建議' : '送出需求'}
                </button>
              </div>
              {!suggestion && (
                <p className="reader-form-footnote">
                  需求將作為研究選題參考，不保證安排研究或寄送更新。
                </p>
              )}
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
