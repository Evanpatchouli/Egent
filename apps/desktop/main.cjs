const {
  app,
  BrowserWindow,
  utilityProcess,
  dialog,
  Tray,
  Menu,
  ipcMain,
  net,
  shell,
  Notification,
} = require('electron');
const path = require('node:path');
const { URL } = require('node:url');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
let backend;
let quitting = false;
let window;
let tray;
let systemNotifications = true;
let updateController;
const notifications = new Set();
function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
app.setName('Egent');
app.setAppUserModelId('local.egent.desktop');
app.setPath('userData', process.env.EGENT_DATA_DIR || path.join(app.getPath('appData'), 'Egent'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app
    .whenReady()
    .then(async () => {
      const root = fs.existsSync(path.join(__dirname, 'server.mjs'))
        ? __dirname
        : path.join(__dirname, 'build', 'app');
      const data = process.env.EGENT_DATA_DIR || app.getPath('userData');
      fs.mkdirSync(data, { recursive: true });
      // Portable extraction paths change. Keep the client-facing launcher at a stable path.
      const quotePath = (p) => '"' + p.replaceAll('%', '%%') + '"';
      fs.writeFileSync(
        path.join(data, 'egent-mcp.cmd'),
        [
          '@echo off',
          'setlocal DisableDelayedExpansion',
          'chcp 65001 >nul',
          'set "ELECTRON_RUN_AS_NODE=1"',
          'set "EGENT_DATA_DIR=%~dp0."',
          quotePath(process.execPath) + ' ' + quotePath(path.join(root, 'mcp.cjs')),
          '',
        ].join('\r\n'),
      );
      const token = randomBytes(32).toString('hex');
      tray = new Tray(path.join(root, 'icon.ico'));
      tray.setToolTip('Egent · 关闭窗口后仍在后台运行');
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: '打开 Egent', click: showWindow },
          { type: 'separator' },
          { label: '退出', click: () => app.quit() },
        ]),
      );
      tray.on('double-click', showWindow);
      let runtimeUrl = null;
      const launcher =
        app.isPackaged && process.platform === 'win32' && process.env.PORTABLE_EXECUTABLE_FILE;
      Menu.setApplicationMenu(null);
      window = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 720,
        minHeight: 580,
        title: 'Egent',
        backgroundColor: '#ffffff',
        icon: path.join(root, 'icon.ico'),
        titleBarStyle: 'hidden',
        titleBarOverlay: { color: '#ffffff', symbolColor: '#2b2b28', height: 48 },
        webPreferences: {
          ...(launcher && { preload: path.join(root, 'update-preload.cjs') }),
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false,
        },
      });
      if (launcher) {
        const { installPortable } = require(path.join(root, 'portable-update.cjs'));
        function isUpdateSender(event) {
          return (
            runtimeUrl &&
            event.sender === window?.webContents &&
            event.senderFrame === window.webContents.mainFrame &&
            event.senderFrame?.url.startsWith(runtimeUrl + '/')
          );
        }
        ipcMain.on('egent:cancel-update', (event) => {
          if (isUpdateSender(event)) updateController?.abort();
        });
        ipcMain.handle('egent:install-update', async (event, requested) => {
          if (!isUpdateSender(event) || typeof requested !== 'string')
            throw new Error('无效的更新请求。');
          if (quitting || updateController) throw new Error('更新正在进行中。');
          updateController = new AbortController();
          try {
            await installPortable({
              root,
              data,
              launcher,
              current: app.getVersion(),
              requested,
              fetch: (url, options) => net.fetch(url, options),
              signal: updateController.signal,
              progress: (status) => window?.webContents.send('egent:update-progress', status),
            });
            app.quit();
            return { ok: true };
          } catch (error) {
            return {
              ok: false,
              message: updateController.signal.aborted
                ? '更新已取消。'
                : error.code === 'EACCES' || error.code === 'EPERM'
                  ? '启动器目录没有写入权限，请将便携版移到可写目录后重试。'
                  : error.message,
            };
          } finally {
            updateController = undefined;
          }
        });
      }
      window.webContents.setWindowOpenHandler(({ url }) => {
        let webLink = false;
        try {
          const parsed = new URL(url);
          webLink = parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          // Invalid URLs are denied along with non-web protocols.
        }
        if (
          webLink &&
          (runtimeUrl || url === 'https://github.com/Evanpatchouli/Egent/releases/latest')
        ) {
          void shell
            .openExternal(url)
            .catch(() => dialog.showErrorBox('打开失败', '无法打开系统浏览器。'));
        }
        return { action: 'deny' };
      });
      window.webContents.on('will-navigate', (event, url) => {
        if (!runtimeUrl || !url.startsWith(runtimeUrl + '/')) event.preventDefault();
      });
      window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );

      window.on('close', (event) => {
        if (quitting) return;
        event.preventDefault();
        window.hide();
      });
      window.on('closed', () => {
        window = null;
        app.quit();
      });
      await window.loadFile(path.join(root, 'splash.html'));
      if (quitting) return;
      backend = utilityProcess.fork(path.join(root, 'server.mjs'), [], {
        env: {
          ...process.env,
          EGENT_DATA_DIR: data,
          EGENT_LOCAL_TOKEN: token,
          EGENT_SQLITE_SCHEMA: path.join(root, 'schema.sql'),
          EGENT_WEB_ROOT: path.join(root, 'web'),
          SERVER_PORT: process.env.SERVER_PORT || '43127',
          SERVER_HOST: '0.0.0.0',
        },
        stdio: 'pipe',
        serviceName: 'Egent Backend',
      });
      backend.on('message', (message) => {
        if (!message || typeof message !== 'object') return;
        if (message.type === 'notification-settings' && typeof message.enabled === 'boolean')
          systemNotifications = message.enabled;
        if (
          message.type === 'mention-count' &&
          Number.isInteger(message.count) &&
          message.count >= 0
        ) {
          tray?.setImage(path.join(root, message.count ? 'tray-mention.png' : 'icon.ico'));
          tray?.setToolTip(
            message.count
              ? `Egent · ${message.count} 条未读 @ 提醒`
              : 'Egent · 关闭窗口后仍在后台运行',
          );
        }
        if (
          message.type === 'mention' &&
          systemNotifications &&
          typeof message.senderName === 'string'
        ) {
          if (Notification.isSupported()) {
            const notification = new Notification({
              title: 'Egent',
              body: `${message.senderName} @ 了你`,
              icon: path.join(root, 'icon.png'),
            });
            notifications.add(notification);
            notification.once('close', () => notifications.delete(notification));
            notification.on('click', showWindow);
            notification.show();
          }
        }
        if (
          message.type === 'notification-received' &&
          systemNotifications &&
          typeof message.title === 'string' &&
          (message.senderName === null || typeof message.senderName === 'string') &&
          Notification.isSupported()
        ) {
          const notification = new Notification({
            title: 'Egent',
            body: message.senderName ? `${message.senderName}：${message.title}` : message.title,
            icon: path.join(root, 'icon.png'),
          });
          notifications.add(notification);
          notification.once('close', () => notifications.delete(notification));
          notification.on('click', showWindow);
          notification.show();
        }
      });
      let output = '';
      const readyTimer = setTimeout(() => {
        dialog.showErrorBox('Egent 启动失败', '本机服务未能就绪，请检查端口 43127 是否被占用。');
        app.quit();
      }, 30000);
      backend.stderr.on('data', (chunk) =>
        fs.appendFileSync(path.join(data, 'server.log'), chunk, 'utf8'),
      );
      backend.stdout.on('data', (chunk) => {
        if (runtimeUrl || quitting) return;
        output = (output + chunk.toString()).slice(-16000);
        const match = output.match(/EGENT_READY (\{[^\n]+\})/);
        if (!match || runtimeUrl) return;
        clearTimeout(readyTimer);
        const runtime = JSON.parse(match[1]);
        runtimeUrl = runtime.url;
        void window.loadURL(runtime.url + '/#token=' + token).catch((error) => {
          if (quitting) return;
          dialog.showErrorBox('Egent 启动失败', error.message);
          app.quit();
        });
      });
      backend.on('exit', (code) => {
        clearTimeout(readyTimer);
        if (quitting) app.exit(0);
        else {
          dialog.showErrorBox(
            'Egent 服务已停止',
            '后端退出码：' + code + '。请检查应用数据目录中的 server.log。',
          );
          app.exit(1);
        }
      });
    })
    .catch((error) => {
      dialog.showErrorBox('Egent 启动失败', error.message);
      app.exit(1);
    });
  app.on('before-quit', (event) => {
    updateController?.abort();
    if (!backend) {
      quitting = true;
      return;
    }
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    tray?.destroy();
    backend.postMessage('shutdown');
    setTimeout(() => {
      backend.kill();
      app.exit(0);
    }, 12000).unref();
  });
}
