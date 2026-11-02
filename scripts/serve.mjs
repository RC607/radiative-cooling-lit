/* 本地预览：静态托管 dist/，模拟 Cloudflare Pages 的目录索引、404 与 _headers 安全头。
 * 用法：node scripts/serve.mjs [port]   （默认 4321）
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.argv[2] || process.env.PORT || 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.bib': 'text/plain; charset=utf-8',
  '.ris': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function parseHeaders() {
  const file = path.join(ROOT, '_headers');
  if (!fs.existsSync(file)) return [];
  const rules = [];
  let current = null;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (/^\s/.test(raw) && current) {
      const idx = raw.indexOf(':');
      if (idx > 0) current.headers[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
      continue;
    }
    current = { pattern: raw.trim(), headers: {} };
    rules.push(current);
  }
  return rules;
}

const HEADER_RULES = parseHeaders();

function matches(pattern, pathname) {
  if (pattern === '/*') return true;
  if (pattern.endsWith('*')) return pathname.startsWith(pattern.slice(0, -1));
  if (pattern.startsWith('/*.')) return pathname.endsWith(pattern.slice(1));
  return pathname === pattern;
}

function headersFor(pathname) {
  const out = {};
  for (const rule of HEADER_RULES) {
    if (matches(rule.pattern, pathname)) Object.assign(out, rule.headers);
  }
  return out;
}

const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.xml', '.txt', '.bib', '.ris']);

function compress(body, ext, req) {
  if (!COMPRESSIBLE.has(ext)) return [body, null];
  const accept = String(req.headers['accept-encoding'] || '');
  if (/\bbr\b/.test(accept)) return [zlib.brotliCompressSync(body), 'br'];
  if (/\bgzip\b/.test(accept)) return [zlib.gzipSync(body), 'gzip'];
  return [body, null];
}

function send(res, status, body, type = 'text/plain; charset=utf-8', pathname = '/', encoding = null) {
  const headers = {
    'Content-Type': type,
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Accept-Encoding',
    ...headersFor(pathname),
    'Cache-Control': 'no-store',
  };
  if (encoding) headers['Content-Encoding'] = encoding;
  res.writeHead(status, headers);
  res.end(body);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch (e) {
    send(res, 400, 'Bad Request');
    return;
  }

  let target = path.join(ROOT, pathname);
  if (!target.startsWith(ROOT)) {
    send(res, 403, 'Forbidden', 'text/plain; charset=utf-8', pathname);
    return;
  }

  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, 'index.html');
  } else if (!path.extname(target) && fs.existsSync(`${target}.html`)) {
    target = `${target}.html`;
  }

  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    const ext = path.extname(target).toLowerCase();
    const [body, encoding] = compress(fs.readFileSync(target), ext, req);
    send(res, 200, body, MIME[ext] || 'application/octet-stream', pathname, encoding);
    return;
  }

  const notFound = path.join(ROOT, '404.html');
  if (fs.existsSync(notFound)) {
    const [body, encoding] = compress(fs.readFileSync(notFound), '.html', req);
    send(res, 404, body, MIME['.html'], pathname, encoding);
  } else {
    send(res, 404, 'Not Found', 'text/plain; charset=utf-8', pathname);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[preview] http://127.0.0.1:${PORT}/  (${ROOT})`);
});
