// Finding a newer version on GitHub Releases. Kept free of Electron so it can be tested
// with plain Node.
export const RELEASES_URL = 'https://api.github.com/repos/Khiemnguyen198/NguyenCuuKhiem/releases/latest';

const parts = (version) => String(version).trim().replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);

// > 0 when `a` is newer than `b`.
export function compareVersions(a, b) {
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

// The installer for this machine, named like electron-builder's artifactName in package.json:
// Inkava-Planner-Setup-0.0.2.exe, Inkava-Planner-0.0.2-arm64.dmg, Inkava-Planner-0.0.2-x64.dmg.
export function pickAsset(assets = [], platform = process.platform, arch = process.arch) {
  const named = (test) => assets.find((asset) => test(asset.name.toLowerCase()));
  if (platform === 'win32') return named((name) => name.endsWith('.exe'));
  if (platform === 'darwin') return named((name) => name.endsWith(`-${arch}.dmg`)) || named((name) => name.endsWith('.dmg') && !/-(arm64|x64)\.dmg$/.test(name));
  return undefined;
}

// What the update button needs to know about the latest release.
export function readRelease(release, currentVersion, platform = process.platform, arch = process.arch) {
  const latest = String(release?.tag_name || '').replace(/^v/i, '');
  const asset = pickAsset(release?.assets, platform, arch);
  return {
    current: currentVersion,
    latest: latest || currentVersion,
    available: Boolean(latest) && compareVersions(latest, currentVersion) > 0,
    notes: String(release?.body || '').trim(),
    page: release?.html_url || '',
    asset: asset ? { name: asset.name, url: asset.browser_download_url, size: asset.size } : null
  };
}

export async function fetchLatestRelease(currentVersion, fetchImpl = fetch, url = RELEASES_URL) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Inkava-Planner' } });
  // No release published yet: nothing to update to.
  if (response.status === 404) return readRelease(null, currentVersion);
  if (!response.ok) throw new Error(`GitHub trả về lỗi ${response.status}.`);
  return readRelease(await response.json(), currentVersion);
}
