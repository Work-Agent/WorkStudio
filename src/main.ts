import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { TITLEBAR_HEIGHT, TITLEBAR_OVERLAY_COLORS } from './shared/titlebar';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// live-dev（.pi/extensions/dev-mode）：WA_DEBUG_PORT 时开放 CDP，供 e2e/调试 attach
if (process.env.WA_DEBUG_PORT && /^\d+$/.test(process.env.WA_DEBUG_PORT)) {
  app.commandLine.appendSwitch(
    'remote-debugging-port',
    process.env.WA_DEBUG_PORT,
  );
  console.log(
    `[live-dev] CDP listening on 127.0.0.1:${process.env.WA_DEBUG_PORT}`,
  );
}

const createWindow = () => {
  const isMac = process.platform === 'darwin';

  // 集成式标题栏（ui-design.md §三）：隐藏系统标题栏，应用自绘 TitleBar；
  // macOS 保留左侧红绿灯（hiddenInset），Windows/Linux 用原生三键覆盖层。
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#1a1c1d',
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? {}
      : {
          titleBarOverlay: {
            ...TITLEBAR_OVERLAY_COLORS.dark,
            height: TITLEBAR_HEIGHT,
          },
        }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // DevTools 默认不打开（live-dev 的 CDP 9222 已足够调试/截图）；
  // 需要时用 WA_DEVTOOLS=1 pnpm start 手动开启。
  if (process.env.WA_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools();
  }
};

// shell 能力（preload electronAPI.openPath）
ipcMain.handle('shell:openPath', (_event, pathToOpen: string) =>
  shell.openPath(pathToOpen),
);

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
