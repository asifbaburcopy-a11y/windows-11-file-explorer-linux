/*
 * preload.js — context bridge between the renderer and the main process.
 * Exposes a single `wx` object; every channel goes through wrap() so
 * main-process errors surface as normal renderer exceptions.
 */
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set([
  'wx:dirChanged', 'wx:progress', 'wx:settings', 'wx:theme', 'wx:demo', 'wx:openPaths'
]);

async function invoke(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (r && typeof r === 'object' && '__error' in r) {
    const err = new Error(r.__error);
    err.code = r.__code;
    throw err;
  }
  return r;
}

contextBridge.exposeInMainWorld('wx', {
  /* filesystem */
  list: (dir) => invoke('wx:list', dir),
  watch: (dir) => invoke('wx:watch', dir),
  unwatch: (dir) => invoke('wx:unwatch', dir),
  search: (root, q, opts) => invoke('wx:search', root, q, opts),
  gallery: () => invoke('wx:gallery'),
  freeSpace: (p) => invoke('wx:freespace', p),
  stat: (p) => invoke('wx:stat', p),
  countItems: (p) => invoke('wx:count', p),
  readText: (p, maxBytes) => invoke('wx:readText', p, maxBytes),

  /* operations */
  mkdir: (parent, name) => invoke('wx:mkdir', parent, name),
  createFile: (parent, name, content) => invoke('wx:createFile', parent, name, content),
  rename: (from, to) => invoke('wx:rename', from, to),
  setPerms: (p, opts) => invoke('wx:perms', p, opts),
  remove: (paths) => invoke('wx:remove', paths),
  trash: (paths) => invoke('wx:trash', paths),
  restore: (ids) => invoke('wx:restore', ids),
  deleteForever: (ids) => invoke('wx:deleteForever', ids),
  trashList: () => invoke('wx:trashList'),
  planConflicts: (sources, dest) => invoke('wx:planConflicts', sources, dest),
  transfer: (params) => invoke('wx:transfer', params),
  cancelOp: (id) => invoke('wx:cancelOp', id),

  /* drives / network */
  drives: () => invoke('wx:drives'),
  unmount: (mount) => invoke('wx:unmount', mount),
  mountDevice: (device) => invoke('wx:mount', device),
  network: () => invoke('wx:network'),

  /* desktop integration */
  open: (p) => invoke('wx:open', p),
  showInFolder: (p) => invoke('wx:showInFolder', p),
  listApps: (force) => invoke('wx:apps', force),
  launchApp: (appId, target) => invoke('wx:launchApp', appId, target),
  openTerminal: (cwd) => invoke('wx:terminal', cwd),
  queryDefault: () => invoke('wx:queryDefault'),
  setDefault: () => invoke('wx:setDefault'),
  askState: () => invoke('wx:askState'),

  /* settings / app */
  getSettings: () => invoke('wx:settings:get'),
  setSettings: (patch) => invoke('wx:settings:set', patch),
  appInfo: () => invoke('wx:appInfo'),
  pickFolder: (title) => invoke('wx:pickFolder', title),
  pickFile: (title) => invoke('wx:pickFile', title),

  /* window + drag */
  window: (action) => ipcRenderer.send('wx:window', action),
  newWindow: (p) => ipcRenderer.send('wx:newWindow', p),
  windowState: () => invoke('wx:windowState'),
  startDrag: (paths) => ipcRenderer.send('wx:dragStart', { paths }),
  pathOf: (file) => {
    try { return webUtils.getPathForFile(file); } catch (e) { return (file && file.path) || ''; }
  },

  /* events */
  on: (channel, cb) => {
    if (!EVENTS.has(channel)) return () => { };
    const listener = (e, ...args) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
