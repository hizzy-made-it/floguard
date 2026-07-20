/**
 * Minimal local dev server emulating the Vercel routing for this project:
 *   /crm/api/:fn and /api/:fn  → api/:fn.js serverless handlers (req.body pre-buffered like Vercel)
 *   /crm/*                     → static from public/crm/
 *   /  and /crm                → redirect to /crm/
 *
 * Run: npm run dev   (loads floguard-crm/.env into process.env first)
 */
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let p = url.pathname;

  const apiMatch = p.match(/^\/(?:crm\/)?api\/([\w-]+)$/);
  if (apiMatch) {
    const file = path.join(root, 'api', `${apiMatch[1]}.js`);
    if (!fs.existsSync(file)) {
      res.statusCode = 404;
      return res.end('No such function');
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    req.body = Buffer.concat(chunks).toString('utf8');
    try {
      const mod = await import(pathToFileURL(file).href);
      return await mod.default(req, res);
    } catch (e) {
      console.error('handler error', apiMatch[1], e);
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: String(e?.message || e) }));
    }
  }

  if (p === '/' || p === '/crm') {
    res.statusCode = 302;
    res.setHeader('Location', '/crm/');
    return res.end();
  }
  if (p === '/crm/') p = '/crm/index.html';

  const file = path.join(root, 'public', decodeURIComponent(p));
  if (!file.startsWith(path.join(root, 'public'))) {
    res.statusCode = 403;
    return res.end();
  }
  if (fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    return fs.createReadStream(file).pipe(res);
  }
  res.statusCode = 404;
  res.end('Not found');
});

const PORT = Number(process.env.PORT || 3300);
server.listen(PORT, () => console.log(`FloGuard CRM dev server → http://localhost:${PORT}/crm/`));
