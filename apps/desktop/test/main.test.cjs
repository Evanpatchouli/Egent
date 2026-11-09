const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const path = require('node:path');

test('window close keeps backend alive; tray restores window and Exit shuts down once', async () => {
  const windows = [],
    trays = [],
    messages = [],
    notifications = [];
  const app = new EventEmitter();
  let exited = false;
  Object.assign(app, {
    setName() {},
    setAppUserModelId() {},
    setPath() {},
    getPath: () => 'C:/test',
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    quit() {
      this.emit('before-quit', { preventDefault() {} });
    },
    exit() {
      exited = true;
    },
  });
  const backend = new EventEmitter();
  Object.assign(backend, {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    postMessage: (m) => messages.push(m),
    kill() {},
  });
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.urls = [];
      this.visible = true;
      this.minimized = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (handler) => {
        this.openWindow = handler;
      };
      this.webContents.session = { setPermissionRequestHandler() {} };
      windows.push(this);
    }
    isDestroyed() {
      return false;
    }
    isMinimized() {
      return this.minimized;
    }
    restore() {
      this.minimized = false;
    }
    show() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
    }
    focus() {}
    async loadFile(file) {
      this.file = file;
    }
    async loadURL(url) {
      this.urls.push(url);
    }
  }
  class Tray extends EventEmitter {
    constructor() {
      super();
      trays.push(this);
    }
    setToolTip(value) {
      this.tooltip = value;
    }
    setImage(value) {
      this.image = value;
    }
    setContextMenu(menu) {
      this.menu = menu;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  class Notification extends EventEmitter {
    static isSupported() {
      return true;
    }
    constructor(options) {
      super();
      this.options = options;
      notifications.push(this);
    }
    show() {
      this.shown = true;
    }
  }
  const electron = {
    app,
    BrowserWindow: Window,
    Tray,
    Notification,
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    shell: { openExternal: async (url) => openedUrls.push(url) },
    utilityProcess: { fork: () => backend },
    dialog: { showErrorBox: () => assert.fail('unexpected startup error') },
  };
  const openedUrls = [];
  runInNewContext(readFileSync(path.join(__dirname, '../main.cjs'), 'utf8'), {
    require: (name) =>
      name === 'electron'
        ? electron
        : name === 'node:fs'
          ? {
              existsSync: () => true,
              mkdirSync() {},
              appendFileSync() {},
              copyFileSync() {},
              writeFileSync() {},
            }
          : require(name),
    process: { env: {}, execPath: 'C:/test/Egent.exe' },
    __dirname: path.join(__dirname, '..'),
    setTimeout: () => ({ unref() {} }),
    clearTimeout() {},
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(windows.length, 1, 'startup window exists before the backend is ready');
  assert.equal(windows[0].options.backgroundColor, '#ffffff');
  const releasePage = 'https://github.com/Evanpatchouli/Egent/releases/latest';
  for (const url of [releasePage + '/other', releasePage]) {
    assert.equal(windows[0].openWindow({ url }).action, 'deny');
  }
  assert.deepEqual(openedUrls, [releasePage]);
  assert.equal(path.basename(windows[0].file), 'splash.html');
  assert.equal(windows[0].urls.length, 0);
  windows[0].emit('close', { preventDefault() {} });
  assert.equal(windows[0].visible, false, 'splash can be hidden to the tray');
  backend.stdout.emit('data', Buffer.from('EGENT_READY {"url":"http://127.0.0.1:43127"}\n'));
  assert.equal(windows.length, 1, 'reuse the splash window for the application');
  assert.equal(windows[0].visible, false, 'backend readiness must not reopen a hidden window');
  assert.match(windows[0].urls[0], /^http:\/\/127\.0\.0\.1:43127\/#token=/);
  backend.stdout.emit('data', Buffer.from('EGENT_READY {"url":"http://127.0.0.1:43127"}\n'));
  assert.equal(windows[0].urls.length, 1, 'load the application only once');
  const window = windows[0],
    tray = trays[0];
  backend.emit('message', { type: 'mention-count', count: 2 });
  assert.match(tray.image, /tray-mention\.png$/);
  assert.match(tray.tooltip, /2 条未读/);
  backend.emit('message', { type: 'mention', senderName: '小王' });
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].options.body, '小王 @ 了你');
  assert.equal(notifications[0].shown, true);
  window.hide();
  notifications[0].emit('click');
  assert.equal(window.visible, true);
  backend.emit('message', { type: 'notification-settings', enabled: false });
  backend.emit('message', { type: 'mention', senderName: '小李' });
  assert.equal(notifications.length, 1, 'disabled system notifications do not show a popup');
  backend.emit('message', { type: 'mention-count', count: 0 });
  assert.match(tray.image, /icon\.ico$/);
  let prevented = false;
  window.emit('close', {
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(window.visible, false);
  assert.equal(messages.length, 0);
  assert.equal(exited, false);
  window.minimized = true;
  tray.menu.find((item) => item.label === '打开 Egent').click();
  assert.equal(window.visible, true);
  assert.equal(window.minimized, false);
  window.hide();
  tray.emit('double-click');
  assert.equal(window.visible, true);
  window.hide();
  app.emit('second-instance');
  assert.equal(window.visible, true);
  tray.menu.find((item) => item.label === '退出').click();
  app.quit();
  assert.deepEqual(messages, ['shutdown']);
  assert.equal(tray.destroyed, true);
  backend.emit('exit', 0);
  assert.equal(exited, true);
});
