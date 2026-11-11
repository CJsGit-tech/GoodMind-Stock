import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createServer as createViteServer, loadEnv } from 'vite';

// Resolve from this file so startup also works outside the checkout directory.
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const env = loadEnv('development', root, '');
const port = Number(process.env.PORT || env.PORT || 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('PORT must be an integer between 1024 and 65535.');
process.env.POCKETSTOCKS_LOCAL_ORIGIN = `http://localhost:${port}`;
// A parent shell may carry a cloud credential. Only accept the local file or a
// deliberately namespaced override, never an inherited ADMIN_MASTER_SECRET.
process.env.ADMIN_MASTER_SECRET = process.env.POCKETSTOCKS_LOCAL_ADMIN_SECRET || env.ADMIN_MASTER_SECRET || '';
// Local stand-ins for the AppDeploy secrets. Values are random, stay in the ignored .env file and are never logged.
const envFile = resolve(root, '.env');
const wanted: Record<string, () => string> = {
  ADMIN_MASTER_SECRET: () => randomBytes(32).toString('base64url'), MASTER_USER: () => 'owner',
  MASTER_PASSWORD: () => randomBytes(18).toString('base64url'), AGENT_KEY: () => randomBytes(32).toString('base64url'),
};
// Read the file itself: loadEnv also returns the parent shell's variables, which may be real cloud credentials.
const fileEnv: Record<string, string> = Object.fromEntries((existsSync(envFile) ? readFileSync(envFile, 'utf8') : '').split('\n').map(line => line.match(/^([A-Z_]+)=(.*)$/)).filter(Boolean).map(m => [m![1], m![2]]));
let added = '';
for (const [name, make] of Object.entries(wanted)) {
  const value = name === 'ADMIN_MASTER_SECRET' ? process.env.ADMIN_MASTER_SECRET : fileEnv[name];
  if (value?.trim()) { process.env[name] = value; continue; }
  process.env[name] = make(); added += `${name}=${process.env[name]}\n`;
}
if (added) {
  if (existsSync(envFile)) appendFileSync(envFile, (readFileSync(envFile, 'utf8').endsWith('\n') ? '' : '\n') + added);
  else writeFileSync(envFile, `PORT=${port}\n${added}`, { mode: 0o600 });
}
process.env.POCKETSTOCKS_DATA_DIR ||= env.POCKETSTOCKS_DATA_DIR || resolve(root, '.local');
mkdirSync(process.env.POCKETSTOCKS_DATA_DIR, { recursive: true });
const { readSignedAsset, error, db } = await import('./sdk.ts');
const { handler } = await import('../backend/index.ts');
const { simulate } = await import('./simulate.ts');
const origin = process.env.POCKETSTOCKS_LOCAL_ORIGIN;
const server = createServer();
const vite = await createViteServer({ root, server: { middlewareMode: true, hmr: { server }, fs: { deny: ['.env', '.env.*', '**/.git/**', '**/.local/**'] } } });
server.on('request', async (req, res) => {
  const send = (response: { statusCode: number; headers: Record<string, string>; body: string }) => {
    // Secure cookies require HTTPS on AppDeploy; this server binds only to loopback HTTP.
    const headers = { ...response.headers };
    if (headers['Set-Cookie']) headers['Set-Cookie'] = headers['Set-Cookie'].replace(/; Secure/g, '');
    res.writeHead(response.statusCode, headers); res.end(response.body);
  };
  try {
    if (req.headers.host !== `localhost:${port}`) return send(error(`Open ${origin} to use local staging.`, 403));
    const url = new URL(req.url || '/', origin);
    const segments = decodeURIComponent(url.pathname).split('/');
    if (segments.some(part => part === '.local' || part === '.git' || part === '.env' || part.startsWith('.env.'))) return send(error('Private local files are not served.', 403));
    if (url.pathname === '/__local/storage') {
      if (req.method !== 'GET') return send(error('Method not allowed.', 405));
      const asset = readSignedAsset(url);
      if (!asset) return send(error('Asset not found or expired.', 404));
      res.writeHead(200, { 'Content-Type': asset.contentType, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' });
      return res.end(asset.bytes);
    }
    if (!url.pathname.startsWith('/api/') && url.pathname !== '/__local/simulate') return vite.middlewares(req, res);
    if (!['GET', 'HEAD'].includes(req.method || '') && req.headers.origin !== origin) return send(error('Cross-site request rejected.', 403));
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 18 * 1024 * 1024) return send(error('Request body is too large.', 413));
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf8');
    const event = { headers: req.headers, rawPath: url.pathname, rawQueryString: url.search.slice(1), body, isBase64Encoded: false, requestContext: { http: { method: req.method, sourceIp: req.socket.remoteAddress } } };
    if (url.pathname === '/__local/simulate') {
      if (req.method !== 'POST') return send(error('Method not allowed.', 405));
      let input; try { input = body ? JSON.parse(body) : {}; } catch { return send(error('Invalid JSON body.', 400)); }
      return send(await simulate(event, input));
    }
    send(await handler(event));
  } catch (caught) {
    console.error('Local request failed:', caught instanceof Error ? caught.message : 'Unknown error');
    if (!res.headersSent) send(error('Local request failed. Check the server terminal.', 500)); else res.end();
  }
});
server.on('error', async caught => { console.error(caught.message); await vite.close(); db.close(); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`PocketStocksV2 local staging: ${origin}\nOwner and agent secrets: local .env file (values are not logged). Data: .local/`));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, async () => { await vite.close(); server.closeAllConnections(); server.close(() => { db.close(); process.exit(0); }); });
