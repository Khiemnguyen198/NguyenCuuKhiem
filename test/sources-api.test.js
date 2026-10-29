import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppServer } from '../server/standalone.js';

async function withServer(run) {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'planner-api-'));
  const { server, port } = await createAppServer({ staticDir: dataDirectory, dataDirectory });
  const api = (path, options = {}) => fetch(`http://127.0.0.1:${port}${path}`, options).then((response) => response.json());
  try {
    await run(api);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

test('refreshing a source keeps only the newest few snapshots', () => withServer(async (api) => {
  for (let index = 1; index <= 6; index += 1) {
    await api('/api/sources?kind=receipts', { method: 'POST', body: JSON.stringify({ filename: `nhan-${index}.xlsx`, lines: [{ product: 'A', received: index }] }) });
  }
  const latest = await api('/api/sources?kind=receipts');
  assert.equal(latest.filename, 'nhan-6.xlsx');
  // Deleting removes them all, so the card really empties.
  const cleared = await api('/api/sources?kind=receipts', { method: 'DELETE' });
  assert.equal(cleared.filename, null);
}));

test('origins keep the content fingerprint used to skip unchanged refreshes', () => withServer(async (api) => {
  await api('/api/origins', { method: 'POST', body: JSON.stringify({ kind: 'deliveries', origin: '/Volumes/kho/a.xlsm', mtime: 'm1', hash: 'abc', checkedAt: '2026-10-28T00:00:00Z' }) });
  const { deliveries } = await api('/api/origins');
  assert.deepEqual(deliveries, { origin: '/Volumes/kho/a.xlsm', mtime: 'm1', hash: 'abc', checkedAt: '2026-10-28T00:00:00Z' });
  const cleared = await api('/api/origins', { method: 'POST', body: JSON.stringify({ kind: 'deliveries', origin: null }) });
  assert.equal(cleared.deliveries, null);
}));

test('deleting the newest booking brings back the previous one', () => withServer(async (api) => {
  const row = { lineQuantity: 10, ref: 'A', color: '1234567 X', po: 'P1', printCount: 1 };
  for (const filename of ['b1.xlsx', 'b2.xlsx']) await api('/api/imports', { method: 'POST', body: JSON.stringify({ filename, rows: [row] }) });
  const latest = await api('/api/dashboard');
  assert.equal(latest.filename, 'b2.xlsx');
  const after = await api(`/api/imports?id=${latest.importId}`, { method: 'DELETE' });
  assert.equal(after.filename, 'b1.xlsx');
}));
