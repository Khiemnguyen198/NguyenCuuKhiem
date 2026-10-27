import assert from 'node:assert/strict';
import test from 'node:test';
import { directDownloadUrl, fetchWithCookies } from '../server/sqlite-api.js';

test('turns share links into direct downloads', () => {
  assert.equal(directDownloadUrl('https://acme.sharepoint.com/:x:/s/SITE/ABC?rtime=1'), 'https://acme.sharepoint.com/:x:/s/SITE/ABC?rtime=1&download=1');
  assert.equal(directDownloadUrl('https://docs.google.com/spreadsheets/d/XYZ/edit#gid=0'), 'https://docs.google.com/spreadsheets/d/XYZ/export?format=xlsx');
  assert.throws(() => directDownloadUrl('http://acme.sharepoint.com/x'), /https/);
});

test('sends the guest cookie back while following SharePoint redirects', async () => {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push([url, options.headers.Cookie || null]);
    if (url.includes(':x:')) {
      return new Response(null, { status: 302, headers: [['Location', '/sites/S/Shared%20Documents/file.xlsx'], ['Set-Cookie', 'FedAuth=guest; path=/; secure'], ['Set-Cookie', 'rtFa=abc; path=/']] });
    }
    return options.headers.Cookie === 'FedAuth=guest; rtFa=abc'
      ? new Response('xlsx-bytes', { status: 200 })
      : new Response('Forbidden', { status: 403 });
  };
  try {
    const response = await fetchWithCookies('https://acme.sharepoint.com/:x:/s/S/ID?download=1');
    assert.equal(response.status, 200);
    assert.deepEqual(calls.map(([, cookie]) => cookie), [null, 'FedAuth=guest; rtFa=abc']);
    assert.equal(calls[1][0], 'https://acme.sharepoint.com/sites/S/Shared%20Documents/file.xlsx');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('refuses redirects to private addresses', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: 'http://192.168.1.10/secret' } });
  try {
    await assert.rejects(fetchWithCookies('https://example.com/file.xlsx'), /nội bộ/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
