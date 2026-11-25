import type { NextApiRequest, NextApiResponse } from 'next';
import { dispatch } from '../../backend/localApi';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const route = '/api/' + ([] as string[]).concat(req.query.path ?? []).join('/');
  try {
    const r = await dispatch(req.method || 'GET', route, req.body);
    res.setHeader('Cache-Control', 'no-store');
    res.status(r.status).json(r.body);
  } catch {
    res.status(503).json({ error: 'Local service error. Please retry.' });
  }
}
