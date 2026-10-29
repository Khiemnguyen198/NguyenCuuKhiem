import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { registerApi } from './sqlite-api.js';

// The desktop app's server: the built pages from `staticDir` plus the same /api routes the
// Vite dev server offers, on 127.0.0.1 only.
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf'
};

export function createAppServer({ staticDir, dataDirectory, port = 0 }) {
  const routes = [];
  const closeDatabase = registerApi((prefix, handler) => routes.push([prefix, handler]), { dataDirectory });

  const serveFile = async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://local').pathname);
    const file = normalize(join(staticDir, path === '/' ? 'index.html' : path));
    // Refuse paths that climb out of the built app (../).
    if (!file.startsWith(normalize(staticDir) + sep)) {
      response.statusCode = 403;
      return response.end();
    }
    try {
      const body = await readFile(file);
      response.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
      return response.end(body);
    } catch {
      response.statusCode = 404;
      return response.end('Not found');
    }
  };

  const server = createServer((request, response) => {
    // Like connect: the handler sees the URL without its route prefix.
    const route = routes.find(([prefix]) => request.url === prefix || request.url.startsWith(`${prefix}/`) || request.url.startsWith(`${prefix}?`));
    if (!route) return serveFile(request, response);
    request.url = request.url.slice(route[0].length) || '/';
    if (!request.url.startsWith('/')) request.url = `/${request.url}`;
    return Promise.resolve(route[1](request, response)).catch((error) => {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: error.message }));
    });
  });

  server.once('close', closeDatabase);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}
