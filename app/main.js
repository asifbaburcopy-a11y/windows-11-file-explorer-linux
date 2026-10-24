/*
 * main.js — Electron main process for WinExplorer.
 * Window management, IPC surface, theme, watchers, CLI flags.
 */
'use strict';
const { app, BrowserWindow, ipcMain, dialog, nativeTheme, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { SettingsStore } = require('./services/settings');
const listing = require('./services/listing');
const fsops = require('./services/fsops');
const trash = require('./services/trash');
const drivesSvc = require('./services/drives');
const system = require('./services/system');
const core = require('./shared/core');

app.setName('winexplorer');

/* --------------------------------------------------------------- CLI */

const CLI = { screenshot: null, demo: null, verbose: false, open: [] };
{
  const raw = process.argv.slice(1);
  const appDir = path.resolve(__dirname);
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith('--screenshot=')) { CLI.screenshot = a.slice('--screenshot='.length); continue; }
    if (a === '--screenshot') { CLI.screenshot = raw[++i] || '/tmp/winexplorer-shot.png'; continue; }
    if (a.startsWith('--demo=')) { CLI.demo = a.slice('--demo='.length); continue; }
    if (a === '--demo') { CLI.demo = raw[++i] || 'none'; continue; }
    if (a === '--verbose') { CLI.verbose = true; continue; }
    if (a.startsWith('--')) continue;
    // user-supplied path / file:// URL
    let p = a;
    if (a.startsWith('file://')) p = decodeURIComponent(a.replace(/^file:\/\//, ''));
    if (path.resolve(p) === appDir || path.resolve(p) === path.dirname(appDir)) continue;
    if (a === '.' || a.includes('resources/app')) continue;
    CLI.open.push(p);
  }
}

let settings;
let mainWindow = null;
const windows = new Set();
let appQuitting = false;

/* ------------------------------------------------------------ helpers */

function wrap(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      return { __error: fsops.friendlyError(e), __code: e.code || 'EUNKNOWN' };
    }
  };
}

function broadcast(channel, ...args) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args);
  }
}

function settingsSnapshot() {
  return settings.get();
}

/* ------------------------------------------------------------ IPC:fs */

function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, wrap(fn));

  h('wx:list', (e, dir) => listing.listDir(dir));
  h('wx:watch', (e, dir) => { listing.watch(dir, () => { }); return true; });
  h('wx:unwatch', (e, dir) => { listing.unwatch(dir); return true; });
  h('wx:search', (e, root, q, opts) => listing.search(root, q, opts));
  h('wx:gallery', () => listing.gallery(settings.get().galleryDirs));
  h('wx:freespace', (e, p) => listing.freeSpace(p));
  h('wx:stat', (e, p) => fsops.statPath(p));
  h('wx:count', (e, p) => fsops.countItems(p));
  /* Bounded text read for the preview pane: never loads huge files fully. */
  h('wx:readText', async (e, p, maxBytes = 200 * 1024) => {
    const st = await fs.promises.stat(p);
    if (st.size > 100 * 1024 * 1024) {
      const err = new Error('File is too large to preview.');
      err.code = 'ETOOLARGE';
      throw err;
    }
    const fd = await fs.promises.open(p, 'r');
    try {
      const buf = Buffer.alloc(Math.min(st.size, maxBytes));
      const { bytesRead } = await fd.read(buf, 0, buf.length, 0);
      let text = buf.slice(0, bytesRead).toString('utf8');
      // Trim a possible partial multi-byte sequence at the cut point.
      text = text.replace(/\uFFFD$/, '');
      return { text, truncated: st.size > bytesRead, size: st.size };
    } finally {
      await fd.close();
    }
  });

  h('wx:mkdir', (e, parent, name) => fsops.mkdir(parent, name));
  h('wx:createFile', (e, parent, name, content) => fsops.createFile(parent, name, content));
  h('wx:rename', (e, from, to) => fsops.rename(from, to));
  h('wx:perms', (e, p, opts) => fsops.setPermissions(p, opts));
  h('wx:remove', (e, paths) => fsops.remove(paths));

  h('wx:trash', (e, paths) => trash.trashPaths(paths));
  h('wx:restore', (e, ids) => trash.restoreIds(ids));
  h('wx:deleteForever', (e, ids) => trash.deleteForever(ids));
  h('wx:trashList', () => trash.listTrash());

  h('wx:planConflicts', (e, sources, dest) => fsops.planConflicts(sources, dest));

  h('wx:transfer', async (e, params) => {
    // Route progress to the calling window.
    const sender = e.sender;
    const prevSink = currentProgressSink;
    progressTargets.set(params.id, sender);
    try {
      return await fsops.transfer(params);
    } finally {
      progressTargets.delete(params.id);
      if (currentProgressSink === prevSink) { /* keep global sink */ }
    }
  });
  h('wx:cancelOp', (e, id) => fsops.cancelOp(id));

  h('wx:drives', () => drivesSvc.listDrives());
  h('wx:unmount', (e, mount) => drivesSvc.unmount(mount));
  h('wx:mount', (e, device) => drivesSvc.mountDevice(device));
  h('wx:network', () => drivesSvc.listNetwork());

  h('wx:open', (e, p) => system.openPath(p));
  h('wx:showInFolder', (e, p) => system.showInFolder(p));
  h('wx:apps', (e, force) => system.listApps(!!force));
  h('wx:launchApp', (e, appId, target) => system.listApps().then((list) => {
    const appd = list.find((x) => x.id === appId);
    if (!appd) return { ok: false, error: 'Application not found: ' + appId };
    return system.launchApp(appd, target);
  }));
  h('wx:terminal', (e, cwd) => system.openTerminal(cwd));

  h('wx:queryDefault', () => system.isDefaultFileManager());
  h('wx:setDefault', () => system.setDefaultFileManager());
  h('wx:askState', () => system.defaultAskState());

  h('wx:settings:get', () => settingsSnapshot());
  h('wx:settings:set', (e, patch) => {
    const data = settings.set(patch || {});
    broadcast('wx:settings', data);
    applyTheme();
    return data;
  });

  h('wx:appInfo', () => ({
    version: app.getVersion(),
    home: os.homedir(),
    user: os.userInfo().username,
    hostname: os.hostname(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    productName: 'Explorer'
  }));

  h('wx:pickFolder', async (e, title) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, {
      title: title || 'Select a folder',
      properties: ['openDirectory', 'createDirectory']
    });
    return r.canceled ? null : r.filePaths[0];
  });

  h('wx:pickFile', async (e, title) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showOpenDialog(win, { title: title || 'Select a file', properties: ['openFile'] });
    return r.canceled ? null : r.filePaths[0];
  });

  /* new window with an initial path */
  ipcMain.on('wx:newWindow', (e, p) => {
    createWindow(p ? [p] : []);
  });

  /* window controls */
  ipcMain.on('wx:window', (e, action) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (action === 'min') win.minimize();
    else if (action === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.close();
    else if (action === 'fullscreen') win.setFullScreen(!win.isFullScreen());
    else if (action === 'isMax') e.returnValue = win.isMaximized();
  });
  ipcMain.handle('wx:windowState', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return win ? { maximized: win.isMaximized(), fullscreen: win.isFullScreen() } : null;
  });

  /* native drag-out */
  ipcMain.on('wx:dragStart', (e, payload) => {
    const { paths, icon } = payload || {};
    if (!paths || !paths.length) return;
    try {
      const opts = {
        file: paths[0],
        files: paths.length > 1 ? paths : undefined,
        icon: icon || path.join(__dirname, 'assets', 'icon-64.png')
      };
      e.sender.startDrag(opts);
    } catch (err) {
      console.error('[drag] startDrag failed:', err.message);
    }
  });
}

/* progress routing */
const progressTargets = new Map();
let currentProgressSink = null;
currentProgressSink = (id, payload) => {
  const wc = progressTargets.get(id);
  if (wc && !wc.isDestroyed()) wc.send('wx:progress', Object.assign({ id }, payload));
};

/* ------------------------------------------------------------ theming */

function applyTheme() {
  const t = (settings.get().theme || 'system');
  nativeTheme.themeSource = t === 'light' || t === 'dark' ? t : 'system';
  broadcast('wx:theme', nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
}

/* ------------------------------------------------------------- windows */

function createWindow(initialPaths) {
  const bounds = settings.get().windowBounds || {};
  const win = new BrowserWindow({
    x: bounds.x !== undefined ? bounds.x : undefined,
    y: bounds.y !== undefined ? bounds.y : undefined,
    width: bounds.width || 1280,
    height: bounds.height || 820,
    minWidth: 760,
    minHeight: 470,
    show: false,
    frame: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3',
    icon: path.join(__dirname, 'assets', 'icon-128.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      devTools: true
    }
  });
  windows.add(win);
  win.on('closed', () => {
    windows.delete(win);
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.on('console-message', (e, level, message, line, sourceId) => {
    if (CLI.verbose) console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('render-process-gone', (e, details) => {
    console.error('[crash]', details.reason, details.exitCode);
  });

  if (bounds.maximized) win.maximize();

  win.loadFile(path.join(__dirname, 'index.html'), {
    query: { open: (initialPaths || []).join('|'), demo: CLI.demo || '' }
  });

  win.once('ready-to-show', () => {
    if (!CLI.screenshot) win.show();
    else win.showInactive();
  });

  const saveBounds = () => {
    if (win.isFullScreen()) return;
    const b = win.getNormalBounds();
    settings.set({ windowBounds: { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() } });
  };
  win.on('resize', debounce(saveBounds, 500));
  win.on('move', debounce(saveBounds, 500));
  win.on('maximize', saveBounds);
  win.on('unmaximize', saveBounds);

  return win;
}

function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* --------------------------------------------------------- screenshot */

function installScreenshot(win) {
  if (!CLI.screenshot) return;
  // Generous delay so post-boot UI (first-run prompt, async listings) settles.
  const delay = CLI.demo && CLI.demo !== 'none' ? 2600 : 4600;
  setTimeout(async () => {
    try {
      const image = await win.webContents.capturePage();
      fs.writeFileSync(CLI.screenshot, image.toPNG());
      console.log('[screenshot] saved to ' + CLI.screenshot);
    } catch (e) {
      console.error('[screenshot] failed:', e.message);
    }
    app.exit(0);
  }, delay);
}

/* --------------------------------------------------------------- boot */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  /* GPU resilience: if the GPU process dies at startup, relaunch once with
     software rendering instead of crashing (the flag stops any loop). */
  if (process.argv.includes('--wx-gpu-retry')) process.env.WX_GPU_RETRY = '1';
  if (!process.env.WX_GPU_RETRY) {
    app.on('child-process-gone', (e) => {
      if (e && e.type === 'GPU' && e.reason !== 'clean-exit' && !appQuitting) {
        const args = process.argv.slice(1)
          .filter((a) => a !== '--wx-gpu-retry' && a !== '--disable-gpu');
        args.push('--wx-gpu-retry', '--disable-gpu');
        app.relaunch({ args });
        app.exit(0);
      }
    });
  }
  app.on('second-instance', (e, argv, cwd) => {
    const paths = parseOpenArgs(argv);
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (paths.length) mainWindow.webContents.send('wx:openPaths', paths);
    } else {
      createWindow(paths);
    }
  });

  app.whenReady().then(() => {
    settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'));
    registerIpc();
    fsops.setProgressSink(currentProgressSink);
    listing.setNotify((dir) => broadcast('wx:dirChanged', dir));
    nativeTheme.on('updated', () => applyTheme());
    applyTheme();

    mainWindow = createWindow(CLI.open);
    installScreenshot(mainWindow);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow([]);
    });
  });

  app.on('window-all-closed', () => {
    try { settings && settings.saveNow(); } catch (e) { }
    app.quit();
  });

  app.on('before-quit', () => {
    appQuitting = true;
    try { settings && settings.saveNow(); } catch (e) { }
  });
}

function parseOpenArgs(argv) {
  const out = [];
  const appDir = path.resolve(__dirname);
  for (const a of argv) {
    if (a.startsWith('--')) continue;
    if (path.resolve(a) === appDir || path.resolve(a) === path.dirname(appDir)) continue;
    if (a.includes('resources/app') || a === '.' || a.endsWith('electron')) continue;
    let p = a;
    if (a.startsWith('file://')) p = decodeURIComponent(a.replace(/^file:\/\//, ''));
    out.push(p);
  }
  return out;
}
