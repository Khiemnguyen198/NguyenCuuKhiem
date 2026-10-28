import { app, BrowserWindow, dialog, shell } from 'electron';
import { join } from 'node:path';
import { createAppServer } from '../server/standalone.js';

// Desktop shell: runs the planner's server (SQLite, link downloads) inside the app and shows
// the built pages in a window. Data lives in the user's app-data folder, not next to the app.
const APP_TITLE = 'Kế hoạch sản xuất';

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    title: APP_TITLE,
    backgroundColor: '#f7fafc',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  // Links to other sites open in the normal browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}/`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });
  // Exported workbooks: ask where to save, starting in Downloads.
  mainWindow.webContents.session.on('will-download', (event, item) => {
    item.setSaveDialogOptions({ defaultPath: join(app.getPath('downloads'), item.getFilename()) });
  });
}

app.whenReady().then(async () => {
  try {
    const { port } = await createAppServer({
      staticDir: join(app.getAppPath(), 'dist-desktop'),
      dataDirectory: join(app.getPath('userData'), 'data'),
      // A fixed port only when asked (e.g. for testing); otherwise any free one.
      port: Number(process.env.PLANNER_PORT) || 0
    });
    createWindow(port);
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow(port);
    });
  } catch (error) {
    dialog.showErrorBox(APP_TITLE, `Không khởi động được ứng dụng:\n${error.message}`);
    app.quit();
  }
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => app.quit());
