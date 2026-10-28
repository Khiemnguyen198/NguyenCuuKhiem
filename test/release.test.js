import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, fetchLatestRelease, pickAsset, readRelease } from '../electron/release.js';

const assets = [
  { name: 'Inkava-Planner-Setup-0.0.2.exe', browser_download_url: 'https://x/setup.exe', size: 10 },
  { name: 'Inkava-Planner-0.0.2-arm64.dmg', browser_download_url: 'https://x/arm.dmg', size: 20 },
  { name: 'Inkava-Planner-0.0.2-x64.dmg', browser_download_url: 'https://x/intel.dmg', size: 30 },
  { name: 'latest.yml', browser_download_url: 'https://x/latest.yml', size: 1 }
];

test('compareVersions orders by number, not text', () => {
  assert.ok(compareVersions('0.0.10', '0.0.9') > 0);
  assert.ok(compareVersions('v0.1.0', '0.0.9') > 0);
  assert.equal(compareVersions('v0.0.1', '0.0.1'), 0);
  assert.ok(compareVersions('0.0.1', '0.0.2') < 0);
});

test('pickAsset chooses the installer for this platform and chip', () => {
  assert.equal(pickAsset(assets, 'win32', 'x64').name, 'Inkava-Planner-Setup-0.0.2.exe');
  assert.equal(pickAsset(assets, 'darwin', 'arm64').name, 'Inkava-Planner-0.0.2-arm64.dmg');
  assert.equal(pickAsset(assets, 'darwin', 'x64').name, 'Inkava-Planner-0.0.2-x64.dmg');
  assert.equal(pickAsset(assets, 'linux', 'x64'), undefined);
});

test('readRelease flags a newer tag only', () => {
  const newer = readRelease({ tag_name: 'v0.0.2', assets, body: 'Sửa lỗi' }, '0.0.1', 'darwin', 'arm64');
  assert.equal(newer.available, true);
  assert.equal(newer.latest, '0.0.2');
  assert.equal(newer.asset.url, 'https://x/arm.dmg');
  assert.equal(readRelease({ tag_name: 'v0.0.1', assets }, '0.0.1').available, false);
});

test('fetchLatestRelease treats "no release yet" as up to date', async () => {
  const info = await fetchLatestRelease('0.0.1', async () => ({ status: 404, ok: false }));
  assert.equal(info.available, false);
  assert.equal(info.latest, '0.0.1');
});
