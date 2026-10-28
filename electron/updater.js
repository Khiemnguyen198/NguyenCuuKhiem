import { app, ipcMain, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { access, chmod, constants, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { fetchLatestRelease } from './release.js';

// The update button: finds a newer release on GitHub, downloads this machine's installer and
// replaces the installed app with it, then starts the new version.
const run = promisify(execFile);
// PLANNER_RELEASES_URL points the check at a test server instead of GitHub.
const latestRelease = () => fetchLatestRelease(app.getVersion(), fetch, process.env.PLANNER_RELEASES_URL || undefined);
const workDir = () => join(app.getPath('temp'), 'inkava-planner-update');

async function download(asset, onProgress) {
  await rm(workDir(), { recursive: true, force: true });
  await mkdir(workDir(), { recursive: true });
  const file = join(workDir(), asset.name);
  const response = await fetch(asset.url, { headers: { 'User-Agent': 'Inkava-Planner' } });
  if (!response.ok || !response.body) throw new Error(`Không tải được bản cập nhật (lỗi ${response.status}).`);
  const total = Number(response.headers.get('content-length')) || asset.size || 0;
  let received = 0;
  const counter = new Transform({
    transform(chunk, encoding, callback) {
      received += chunk.length;
      onProgress({ received, total });
      callback(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(file));
  if (total && received !== total) throw new Error('Bản cập nhật tải về không đầy đủ, hãy thử lại.');
  return file;
}

// Windows: the NSIS installer runs silently into the same folder (it remembers it), closes
// the old app if needed and starts the new one (--force-run).
function installWindows(installer) {
  spawn(installer, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}

// The .app bundle this process runs from: …/Inkava Planner.app/Contents/MacOS/Inkava Planner.
const currentBundle = () => resolve(dirname(app.getPath('exe')), '..', '..');

const MAC_SCRIPT = `#!/bin/bash
# Waits for the old app to quit, swaps in the new bundle (restoring the old one on failure),
# then opens the new version.
PID="$1"; MOUNT="$2"; NEW_APP="$3"; TARGET="$4"
while kill -0 "$PID" 2>/dev/null; do sleep 0.5; done
rm -rf "$TARGET.old"
# Only touch the installed app once it has been moved aside; if that fails, leave it as is.
if mv "$TARGET" "$TARGET.old"; then
  if ditto "$NEW_APP" "$TARGET"; then
    rm -rf "$TARGET.old"
  else
    rm -rf "$TARGET"; mv "$TARGET.old" "$TARGET"
  fi
fi
hdiutil detach "$MOUNT" -quiet -force
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
open "$TARGET"
`;

async function installMac(dmg) {
  const target = currentBundle();
  // Running straight from the disk image or a quarantined copy: macOS will not let the app
  // replace itself there, so open the new disk image for a manual drag into Applications.
  const writable = await access(dirname(target), constants.W_OK).then(() => true, () => false);
  if (!target.endsWith('.app') || !writable || target.startsWith('/Volumes/') || target.includes('/AppTranslocation/')) {
    await shell.openPath(dmg);
    return { manual: true };
  }
  const mount = join(workDir(), 'mount');
  await mkdir(mount, { recursive: true });
  await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, dmg]);
  const bundle = (await readdir(mount)).find((name) => name.endsWith('.app'));
  if (!bundle) {
    await run('hdiutil', ['detach', mount, '-quiet', '-force']).catch(() => {});
    throw new Error('Bản cập nhật không chứa ứng dụng.');
  }
  const script = join(workDir(), 'install.sh');
  await writeFile(script, MAC_SCRIPT);
  await chmod(script, 0o755);
  spawn('/bin/bash', [script, String(process.pid), mount, join(mount, bundle), target], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
  return { manual: false };
}

export function registerUpdater() {
  ipcMain.handle('planner:version', () => app.getVersion());
  ipcMain.handle('update:check', () => latestRelease());
  ipcMain.handle('update:install', async (event) => {
    const info = await latestRelease();
    if (!info.available) return { installed: false, info };
    // Running from source (npm run desktop): there is no installed app to replace.
    if (!app.isPackaged || !info.asset) {
      if (info.page) shell.openExternal(info.page);
      return { installed: false, opened: true, info };
    }
    const file = await download(info.asset, (progress) => {
      if (!event.sender.isDestroyed()) event.sender.send('update:progress', progress);
    });
    if (process.platform === 'win32') {
      installWindows(file);
      return { installed: true, info };
    }
    const { manual } = await installMac(file);
    return { installed: !manual, manual, info };
  });
}
