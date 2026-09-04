// Minimal zero-dependency static file server for local development.
//
// It serves the site with the SAME flat URLs as production (Cloudflare Pages):
//   /            → web/index.html
//   /app.js      → web/app.js
//   /styles.css  → web/styles.css
//   /quote.wasm  → build/quote.wasm   (falls through to build/ when not in web/)
//
// This lets you edit web/* and rebuild only the wasm during development, while
// the deployed `dist/` (assembled by scripts/build-site.mjs) uses the identical
// paths. Sets the correct `application/wasm` MIME type. Not for production.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;

// Directories searched in order for each request (mirrors the flat dist/).
const SEARCH_DIRS = ['web', 'build'].map((d) => join(ROOT, d));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.wat': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
};

async function resolve(relPath) {
  for (const base of SEARCH_DIRS) {
    const candidate = normalize(join(base, relPath));
    // Guard against path traversal outside the search dir.
    if (candidate !== base && !candidate.startsWith(base + sep)) continue;
    try {
      const data = await readFile(candidate);
      return { data, ext: extname(candidate).toLowerCase() };
    } catch {
      /* try next dir */
    }
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/' || pathname.endsWith('/')) pathname += 'index.html';
    const relPath = pathname.replace(/^\/+/, ''); // strip leading slashes

    const hit = await resolve(relPath);
    if (!hit) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const type = MIME[hit.ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(hit.data);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Server error');
  }
});

server.listen(PORT, () => {
  console.log(`Quote machine → http://localhost:${PORT}/`);
  console.log('(Ctrl+C to stop)');
});
