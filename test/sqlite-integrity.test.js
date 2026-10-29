import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { registerApi, sqliteApi } from '../server/sqlite-api.js';

const row = { ref: 'MÃ-A', color: 'RED', lineQuantity: 10, printCount: 2, contractQuantity: 100, allocations: { 0: 5, 1: 'XN' } };

async function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'planner-integrity-'));
  const routes = [];
  const closeDatabase = registerApi((prefix, handler) => routes.push([prefix, handler]), { dataDirectory: directory, ...options });
  const server = http.createServer((request, response) => {
    const route = routes.find(([prefix]) => request.url === prefix || request.url.startsWith(`${prefix}?`));
    if (!route) return response.writeHead(404).end();
    request.url = request.url.slice(route[0].length) || '/';
    return route[1](request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    closeDatabase();
    rmSync(directory, { recursive: true, force: true });
  });
  async function post(payload, headers = {}) {
    return fetch(`${base}/api/imports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload)
    });
  }
  async function get(path) {
    const response = await fetch(`${base}${path}`);
    return { status: response.status, data: await response.json() };
  }
  return { base, post, get, directory };
}

test('empty SQLite has zero totals and an unknown import does not show demo data', async (t) => {
  const { get } = await fixture(t);
  const { status, data } = await get('/api/dashboard');
  assert.equal(status, 200);
  assert.equal(data.source, 'empty');
  assert.equal(data.importId, null);
  assert.equal(data.rowCount, 0);
  assert.equal(data.totalQuantity, 0);
  assert.equal((await get('/api/dashboard?id=1234')).status, 404);
});

test('booking import preserves missing identifiers, contracts, allocations and existing endpoints', async (t) => {
  const { post, get } = await fixture(t);
  const response = await post({ filename: 'booking.xlsx', rows: [row], days: [{ date: '2026-10-29' }, { date: '2026-10-30' }] });
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(data.totalQuantity, 10);
  assert.equal(data.totalImpressions, 20);
  const detail = await get(`/api/booking-rows?id=${data.importId}`);
  assert.equal(detail.data.rows[0].contractQuantity, 100);
  assert.deepEqual(detail.data.rows[0].allocations, { 0: 5, 1: 'XN' });
  assert.equal(detail.data.days.length, 2);
  assert.equal((await get(`/api/ai-check?id=${data.importId}`)).status, 200);
  const files = await get('/api/files');
  assert.equal(files.data.files.length, 1);
  assert.equal(files.data.files[0].category, 'original');
  const second = await post({ filename: 'changed.xlsx', rows: [{ ...row, lineQuantity: 12 }] });
  assert.equal(second.status, 201);
  assert.equal((await get('/api/changes')).data.changes.length, 1);
  const old = await get(`/api/dashboard?id=${data.importId}`);
  assert.equal(old.data.totalQuantity, 10);
});

test('UTF-8 text remains intact when HTTP chunks split a Vietnamese character', async (t) => {
  const { base } = await fixture(t);
  const bytes = Buffer.from(JSON.stringify({ filename: 'Việt.xlsx', rows: [{ ...row, customer: 'Việt Nam' }] }));
  const index = bytes.indexOf(Buffer.from('ệ')) + 1;
  const result = await new Promise((resolve, reject) => {
    const request = http.request(`${base}/api/imports`, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(Buffer.concat(chunks)) }));
    });
    request.on('error', reject);
    request.write(bytes.subarray(0, index));
    setTimeout(() => request.end(bytes.subarray(index)), 20);
  });
  assert.equal(result.status, 201);
  assert.equal(result.data.filename, 'Việt.xlsx');
});

test('invalid quantities and malformed JSON return 400 before changing booking history', async (t) => {
  const { post, get } = await fixture(t);
  const saved = await (await post({ filename: 'saved.xlsx', rows: [row] })).json();
  const badPayloads = [
    null, '{broken', { filename: 'empty.xlsx', rows: [] },
    { filename: 'bad.xlsx', rows: [null] },
    { filename: 'bad.xlsx', rows: [row, { ...row, lineQuantity: -1 }] },
    { filename: 'bad.xlsx', rows: [{ ...row, lineQuantity: '1e309' }] },
    { filename: 'bad.xlsx', rows: [{ ...row, printCount: 'oops' }] },
    { filename: 'bad.xlsx', rows: [{ ...row, printCount: -2 }] },
    { filename: 'bad.xlsx', rows: [{ ...row, contractQuantity: -10 }] },
    { filename: 'bad.xlsx', rows: [{ ...row, allocations: { 0: -1 } }] },
    { filename: 'bad.xlsx', rows: [{ ...row, lineQuantity: Number.MAX_SAFE_INTEGER, printCount: 2 }] }
  ];
  for (const payload of badPayloads) {
    const response = await post(payload);
    assert.equal(response.status, 400, JSON.stringify(payload));
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal((await get('/api/dashboard')).data.importId, saved.importId);
  assert.equal((await get('/api/files')).data.files.length, 1);
  assert.deepEqual((await get('/api/changes')).data.changes, []);
});

test('a failure writing the AI check rolls back booking rows, file history and changes', async (t) => {
  const { post, get, directory } = await fixture(t);
  const saved = await (await post({ filename: 'saved.xlsx', rows: [row] })).json();
  const db = new DatabaseSync(join(directory, 'planner.db'));
  db.exec("CREATE TRIGGER fail_check BEFORE INSERT ON ai_checks BEGIN SELECT RAISE(ABORT, 'private SQL constraint'); END;");
  const response = await post({ filename: 'failed.xlsx', rows: [{ ...row, lineQuantity: 12 }] });
  assert.equal(response.status, 500);
  assert.doesNotMatch((await response.json()).error, /private|SQL/);
  assert.equal((await get('/api/dashboard')).data.importId, saved.importId);
  assert.equal((await get('/api/files')).data.files.length, 1);
  assert.deepEqual((await get('/api/changes')).data.changes, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM booking_rows').get().count, 1);
  db.close();
});

test('body limits count bytes for fixed and chunked bodies and retain HTTP 413', async (t) => {
  const { base, post } = await fixture(t, { maxBodyBytes: 200 });
  const response = await post({ filename: `${'ệ'.repeat(70)}.xlsx`, rows: [row] });
  assert.equal(response.status, 413);
  const status = await new Promise((resolve, reject) => {
    const request = http.request(`${base}/api/imports`, { method: 'POST' }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.write(Buffer.from('ệ'.repeat(40)));
    request.end(Buffer.from('ệ'.repeat(40)));
  });
  assert.equal(status, 413);
});

test('cross-origin browser writes are rejected while existing headerless CLI clients work', async (t) => {
  const { base, post, get } = await fixture(t);
  const payload = { filename: 'blocked.xlsx', rows: [row] };
  assert.equal((await post(payload, { Origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await post(payload, { Origin: 'null' })).status, 403);
  assert.equal((await post(payload, { Origin: 'http://127.0.0.1:1' })).status, 403);
  assert.equal((await post(payload, { Origin: base, 'Content-Type': 'text/plain' })).status, 400);
  assert.equal((await post(payload, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await post(payload, { Origin: base })).status, 201);
  assert.equal((await get('/api/files')).data.files.length, 1);
  const cli = await fetch(`${base}/api/sources?kind=receipts`, {
    method: 'POST', body: JSON.stringify({ filename: 'nhận.xlsx', lines: [{ product: 'A', received: 2 }] })
  });
  assert.equal(cli.status, 201);
});

test('two API registrations retain separate SQLite databases', async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  assert.equal((await first.post({ filename: 'first.xlsx', rows: [row] })).status, 201);
  assert.equal((await second.post({ filename: 'second.xlsx', rows: [{ ...row, lineQuantity: 20 }] })).status, 201);
  assert.equal((await first.get('/api/dashboard')).data.filename, 'first.xlsx');
  assert.equal((await second.get('/api/dashboard')).data.totalQuantity, 20);
});

test('a non-root Vite base supports existing root API calls and prefixed calls', async (t) => {
  const { createServer } = await import('vite');
  const directory = mkdtempSync(join(tmpdir(), 'planner-vite-integrity-'));
  const server = await createServer({
    configFile: false, root: directory, base: '/custom/', logLevel: 'silent',
    plugins: [sqliteApi({ dataDirectory: directory })],
    server: { host: '127.0.0.1', port: 0, hmr: false }
  });
  t.after(async () => {
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const response = await fetch(`${origin}/api/imports`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({ filename: 'base.xlsx', rows: [row] })
  });
  assert.equal(response.status, 201);
  for (const path of ['/api/dashboard', '/custom/api/dashboard']) {
    const dashboard = await fetch(`${origin}${path}`);
    assert.equal(dashboard.status, 200);
    assert.equal((await dashboard.json()).filename, 'base.xlsx');
  }
});
