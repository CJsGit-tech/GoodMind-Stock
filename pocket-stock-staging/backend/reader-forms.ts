import { db } from '@appdeploy/sdk';

export const READER_FORMS_TABLE = 'reader-form-submissions';
export type ReaderFormRecord = {
  kind: 'suggestions' | 'research-interest';
  userId: string;
  createdAt: string;
  body?: string;
  nickname?: string;
  email?: string;
  stocks?: string[];
  consent?: true;
  consentVersion?: string;
};

function textField(value: unknown, max: number, min = 0) {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\r\n?/g, '\n');
  const length = Array.from(text).length;
  if (
    length < min ||
    length > max ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)
  )
    return null;
  return text;
}

export function parseReaderForm(
  kind: string,
  body: unknown
): Omit<ReaderFormRecord, 'userId' | 'createdAt'> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  if (kind === 'suggestions') {
    const suggestion = textField(input.body, 2000, 10);
    return suggestion ? { kind, body: suggestion } : null;
  }
  if (kind !== 'research-interest') return null;
  const nickname = textField(input.nickname ?? '', 50);
  const email = textField(input.email, 254, 3);
  if (
    nickname === null ||
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    input.consent !== true
  )
    return null;
  if (
    !Array.isArray(input.stocks) ||
    input.stocks.length < 1 ||
    input.stocks.length > 3
  )
    return null;
  const stocks = input.stocks.map(stock => textField(stock, 100, 1));
  if (
    stocks.some(stock => stock === null) ||
    new Set(stocks).size !== stocks.length
  )
    return null;
  return {
    kind,
    nickname,
    email,
    stocks: stocks as string[],
    consent: true,
    consentVersion: 'request-contact-v1',
  };
}

export async function saveReaderForm(record: ReaderFormRecord) {
  const [id] = await db.add(READER_FORMS_TABLE, [{ ...record }]);
  if (!id) throw new Error('Form save failed');
  return { id, kind: record.kind, createdAt: record.createdAt };
}

export async function readReaderForm(userId: string, kind: string, id: string) {
  if (!/^[a-zA-Z0-9-]{1,200}$/.test(id)) return null;
  const [record] = await db.get<ReaderFormRecord>(READER_FORMS_TABLE, [id]);
  if (!record || record.userId !== userId || record.kind !== kind) return null;
  return { id, kind: record.kind, createdAt: record.createdAt };
}

export async function listAuthorReaderForms(
  nextToken?: string,
  kind?: ReaderFormRecord['kind']
) {
  if (nextToken && nextToken.length > 4096)
    throw new Error('Invalid page token');
  return db.list<ReaderFormRecord>(READER_FORMS_TABLE, {
    limit: 20,
    ...(nextToken ? { nextToken } : {}),
    ...(kind ? { filter: { kind } } : {}),
  });
}
