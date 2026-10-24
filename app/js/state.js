/*
 * state.js — central renderer state: tabs, navigation history, selection,
 * clipboard, undo/redo, and the location loading pipeline.
 */
'use strict';

const S = {
  settings: {},
  appInfo: null,
  theme: 'light',
  tabs: [],
  activeId: 0,
  nextId: 1,
  clipboard: null,        // {mode:'copy'|'cut', paths:[…], dir}
  undo: [],
  redo: [],
  navCollapsed: new Set(),
  demo: null,
  booted: false,
  openPathsQueue: []
};

const VIEW_MODES = [
  { id: 'xl', label: 'Extra large icons', icon: 'vXL', num: '1' },
  { id: 'lg', label: 'Large icons', icon: 'vLG', num: '2' },
  { id: 'md', label: 'Medium icons', icon: 'vMD', num: '3' },
  { id: 'sm', label: 'Small icons', icon: 'vSM', num: '4' },
  { id: 'list', label: 'List', icon: 'vList', num: '5' },
  { id: 'details', label: 'Details', icon: 'vDetails', num: '6' },
  { id: 'tiles', label: 'Tiles', icon: 'vTiles', num: '7' },
  { id: 'content', label: 'Content', icon: 'vContent', num: '8' }
];

const SORT_KEYS = [
  { id: 'name', label: 'Name' },
  { id: 'date', label: 'Date modified' },
  { id: 'type', label: 'Type' },
  { id: 'size', label: 'Size' }
];

const GROUP_KEYS = [
  { id: 'none', label: '(None)' },
  { id: 'name', label: 'Name' },
  { id: 'date', label: 'Date modified' },
  { id: 'type', label: 'Type' },
  { id: 'size', label: 'Size' }
];

/* --------------------------------------------------------- locations */

function fsLoc(path) { return { kind: 'fs', path }; }
function homeLoc() { return { kind: 'home' }; }
function thisPcLoc() { return { kind: 'thispc' }; }
function binLoc() { return { kind: 'bin' }; }
function networkLoc() { return { kind: 'network' }; }
function galleryLoc() { return { kind: 'gallery' }; }
function resultsLoc(path, query) { return { kind: 'results', path, query }; }

function locKey(loc) {
  if (!loc) return '';
  if (loc.kind === 'results') return 'results:' + loc.path + ':' + loc.query;
  if (loc.kind === 'fs') return 'fs:' + loc.path;
  return loc.kind;
}

function pathOf(loc) {
  if (!loc) return null;
  if (loc.kind === 'fs') return loc.path;
  if (loc.kind === 'results') return loc.path;
  return null;
}

function locTitle(loc) {
  if (!loc) return '';
  switch (loc.kind) {
    case 'fs':
      if (loc.path === '/') return 'Computer';
      return WXCore.basename(loc.path) || loc.path;
    case 'home': return 'Home';
    case 'thispc': return 'This PC';
    case 'bin': return 'Recycle Bin';
    case 'network': return 'Network';
    case 'gallery': return 'Gallery';
    case 'results': return 'Search: ' + loc.query;
  }
  return '';
}

function locIconName(loc) {
  switch (loc && loc.kind) {
    case 'home': return 'home';
    case 'thispc': return 'thispc';
    case 'bin': return 'trash';
    case 'network': return 'network';
    case 'gallery': return 'gallery';
    case 'results': return 'search';
    default: return 'folder';
  }
}

function locIsSpecial(loc) { return loc && loc.kind !== 'fs'; }

function curTab() { return S.tabs.find((t) => t.id === S.activeId) || null; }
function tabById(id) { return S.tabs.find((t) => t.id === id) || null; }

/* -------------------------------------------------------------- tabs */

function makeTabState(loc, opts = {}) {
  const st = S.settings;
  return {
    id: S.nextId++,
    hist: [loc],
    hi: 0,
    loc,
    entries: null,
    data: null,
    results: null,
    loading: false,
    error: null,
    selection: new Set(),
    anchor: null,
    filter: '',
    view: opts.view || st.viewMode || 'details',
    sortBy: opts.sortBy || st.sortBy || 'name',
    sortAsc: opts.sortAsc !== undefined ? opts.sortAsc : st.sortAsc !== false,
    groupBy: opts.groupBy || st.groupBy || 'none',
    scrollY: 0,
    visible: [],
    focusKey: null,              // keyboard focus ring (Ctrl+Arrow)
    collapsedGroups: new Set(),
    viewAppliedFor: null,        // folder whose remembered view was applied
    renamePending: null
  };
}

function newTab(loc, activate = true) {
  const tab = makeTabState(loc);
  S.tabs.push(tab);
  if (activate) S.activeId = tab.id;
  tab.loadPromise = loadTab(tab);
  if (typeof Bar !== 'undefined') Bar.renderTabs();
  return tab;
}

function closeTab(id) {
  const idx = S.tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const wasActive = S.activeId === id;
  S.tabs.splice(idx, 1);
  if (!S.tabs.length) {
    // Windows closes the window with its last tab.
    window.__wxCloseWindow = true;
    wx.window('close');
    return;
  }
  if (wasActive) {
    const next = S.tabs[Math.min(idx, S.tabs.length - 1)];
    S.activeId = next.id;
    loadTab(next);
  }
  if (typeof Bar !== 'undefined') Bar.renderTabs();
  if (typeof App !== 'undefined') App.afterTabChange();
}

function activateTab(id) {
  if (S.activeId === id) return;
  const t = tabById(id);
  if (!t) return;
  S.activeId = id;
  if (typeof Bar !== 'undefined') Bar.renderTabs();
  if (typeof App !== 'undefined') App.afterTabChange();
  if (!t.entries && !t.data && !t.results && !t.error) loadTab(t);
  else refreshUI();
}

function cycleTab(delta) {
  if (S.tabs.length < 2) return;
  const i = S.tabs.findIndex((t) => t.id === S.activeId);
  const n = (i + delta + S.tabs.length) % S.tabs.length;
  activateTab(S.tabs[n].id);
}

function gotoTabNumber(n) {
  if (n >= 1 && n <= S.tabs.length) activateTab(S.tabs[n - 1].id);
}

/* ------------------------------------------------------- navigation */

function navigate(loc, opts = {}) {
  const tab = opts.tab || curTab();
  if (!tab) return;
  const same = locKey(tab.loc) === locKey(loc);
  if (!same) tab.scrollY = 0;
  if (!same || opts.force) {
    if (opts.push !== false) {
      tab.hist = tab.hist.slice(0, tab.hi + 1);
      if (!same) tab.hist.push(loc);
      else tab.hist[tab.hi] = loc;
      tab.hi = tab.hist.length - 1;
    } else {
      tab.hist[tab.hi] = loc;
    }
  }
  tab.loc = loc;
  tab.selection.clear();
  tab.anchor = null;
  tab.focusKey = null;
  tab.filter = '';
  tab.error = null;
  if (!opts.keepData) { tab.data = null; tab.results = null; if (loc.kind !== 'fs') tab.entries = null; }
  if (opts.reload !== false) tab.loadPromise = loadTab(tab);
  refreshUI();
}

function goBack() {
  const tab = curTab();
  if (!tab || tab.hi === 0) return;
  tab.hi--;
  tab.loc = tab.hist[tab.hi];
  resetForNav(tab);
  loadTab(tab);
  refreshUI();
}

function goForward() {
  const tab = curTab();
  if (!tab || tab.hi >= tab.hist.length - 1) return;
  tab.hi++;
  tab.loc = tab.hist[tab.hi];
  resetForNav(tab);
  loadTab(tab);
  refreshUI();
}

function goUp() {
  const tab = curTab();
  if (!tab) return;
  if (tab.loc.kind === 'results') { navigate(fsLoc(tab.loc.path)); return; }
  if (tab.loc.kind !== 'fs') return;
  const p = tab.loc.path;
  if (p === '/') return;
  const parent = WXCore.dirname(p);
  if (parent === p) return;
  navigate(fsLoc(parent));
}

function resetForNav(tab) {
  tab.selection.clear();
  tab.anchor = null;
  tab.focusKey = null;
  tab.filter = '';
  tab.error = null;
  tab.data = null;
  tab.results = null;
}

function refreshTab(tab, opts = {}) {
  if (!opts.keepSelection) { /* refresh keeps selection by default */ }
  loadTab(tab, { quiet: true });
}

function refreshUI() {
  if (typeof View !== 'undefined') View.renderActive();
  if (typeof Bar !== 'undefined') Bar.renderAll();
  if (typeof Nav !== 'undefined') Nav.render();
  if (typeof App !== 'undefined') App.renderStatus();
}

/* --------------------------------------------------------- loading */

const watched = new Set();

async function loadTab(tab, opts = {}) {
  if (!tab) return;
  tab.loading = true;
  tab.error = null;
  if (!opts.quiet) tab.data = null;
  if (typeof View !== 'undefined') View.renderActive();
  try {
    const loc = tab.loc;
    if (loc.kind === 'fs') {
      const entries = await wx.list(loc.path);
      // ignore stale results
      if (tab.loc !== loc) return;
      tab.entries = entries;
      tab.data = null;
      applyFolderView(tab, loc.path);
      wx.watch(loc.path);
      watched.add(loc.path);
      pruneWatches();
    } else if (loc.kind === 'results') {
      const res = await wx.search(loc.path, loc.query, { showHidden: !!S.settings.showHidden });
      if (tab.loc !== loc) return;
      tab.results = res;
      tab.entries = null;
    } else if (typeof Special !== 'undefined') {
      const data = await Special.load(loc);
      if (tab.loc !== loc) return;
      tab.data = data;
      tab.entries = null;
    }
    tab.loading = false;
  } catch (e) {
    tab.loading = false;
    let message = (e && e.message) || String(e);
    /* The context bridge drops Error.code — recover it from the code
       prop when present, else from the "(CODE)" suffix friendlyError adds. */
    let code = (e && (e.code || e.__code)) || null;
    if (!code) {
      const m = /\(([A-Z0-9]+)\)\s*$/.exec(message);
      if (m) code = m[1];
    }
    /* Explorer never shows raw ENOENT strings — explain what happened. */
    if (code === 'ENOENT') {
      const p = tab.loc && tab.loc.kind === 'fs' ? tab.loc.path : '';
      message = p
        ? "Windows can't find '" + p + "'. It may have been moved, renamed, or deleted."
        : "This folder can't be found. It may have been moved, renamed, or deleted.";
    }
    tab.error = { message, code };
    tab.entries = null;
  }
  if (typeof View !== 'undefined') View.renderActive();
  if (typeof Bar !== 'undefined') { Bar.renderAddress(); Bar.renderCommand(); }
  if (typeof App !== 'undefined') App.renderStatus();
}

function pruneWatches() {
  const live = new Set();
  for (const t of S.tabs) if (t.loc.kind === 'fs') live.add(t.loc.path);
  for (const p of [...watched]) {
    if (!live.has(p)) {
      watched.delete(p);
      wx.unwatch(p);
    }
  }
}

/* --------------------------------------- per-folder view memory ----- */

/* Windows Explorer remembers view/sort/group per folder; we store ours in
   settings.folderViews keyed by absolute path (bounded map). */
function applyFolderView(tab, path) {
  if (tab.viewAppliedFor === path) return;
  tab.viewAppliedFor = path;
  const fv = (S.settings.folderViews || {})[path];
  if (!fv) return;
  if (fv.view) tab.view = fv.view;
  if (fv.sortBy) tab.sortBy = fv.sortBy;
  if (fv.sortAsc !== undefined) tab.sortAsc = fv.sortAsc;
  if (fv.groupBy) tab.groupBy = fv.groupBy;
}

function rememberFolderView(tab) {
  if (!tab || tab.loc.kind !== 'fs') return;
  const map = Object.assign({}, S.settings.folderViews || {});
  const val = { view: tab.view, sortBy: tab.sortBy, sortAsc: tab.sortAsc, groupBy: tab.groupBy };
  const cur = map[tab.loc.path];
  if (cur && cur.view === val.view && cur.sortBy === val.sortBy &&
      cur.sortAsc === val.sortAsc && cur.groupBy === val.groupBy) return;
  map[tab.loc.path] = val;
  const keys = Object.keys(map);
  if (keys.length > 400) delete map[keys[0]]; // simple bounded eviction
  S.settings.folderViews = map;
  wx.setSettings({ folderViews: map });
}

/* --------------------------------------------------------- selection */

function keyOf(e) { return e.key !== undefined ? e.key : e.name; }

function isSelected(tab, e) { return tab.selection.has(keyOf(e)); }

function selectOnly(tab, e) {
  tab.selection.clear();
  if (e) { tab.selection.add(keyOf(e)); tab.anchor = keyOf(e); }
}

function toggleSelect(tab, e) {
  const k = keyOf(e);
  if (tab.selection.has(k)) tab.selection.delete(k);
  else { tab.selection.add(k); tab.anchor = k; }
}

function rangeSelect(tab, e, visible) {
  const k = keyOf(e);
  const a = tab.anchor !== null && tab.anchor !== undefined ? tab.anchor : k;
  const ia = visible.findIndex((x) => keyOf(x) === a);
  const ib = visible.findIndex((x) => x === e);
  if (ia === -1 || ib === -1) { selectOnly(tab, e); return; }
  const [lo, hi2] = ia <= ib ? [ia, ib] : [ib, ia];
  tab.selection.clear();
  for (let i = lo; i <= hi2; i++) tab.selection.add(keyOf(visible[i]));
}

function selectAll(tab) {
  const vis = (typeof View !== 'undefined' && View.lastVisible) || tab.entries || [];
  for (const e of vis) tab.selection.add(keyOf(e));
}

function clearSelection(tab) { tab.selection.clear(); tab.anchor = null; }

function selectedEntries(tab) {
  const pool = (typeof View !== 'undefined' && View.lastVisible) || tab.entries || [];
  return pool.filter((e) => tab.selection.has(keyOf(e)));
}

function selectedPaths(tab) {
  return selectedEntries(tab).map((e) => e.path).filter(Boolean);
}

/* ------------------------------------------------------- undo / redo */

function pushUndo(entry) {
  S.undo.push(entry);
  if (S.undo.length > 64) S.undo.shift();
  S.redo.length = 0;
  if (typeof App !== 'undefined') App.renderStatus();
}

async function doUndo() {
  const entry = S.undo.pop();
  if (!entry) return;
  try { await entry.undo(); } catch (e) { console.error('undo failed', e); }
  S.redo.push(entry);
  await reloadForFsChanges();
}

async function doRedo() {
  const entry = S.redo.pop();
  if (!entry) return;
  try { await entry.redo(); } catch (e) { console.error('redo failed', e); }
  S.undo.push(entry);
  await reloadForFsChanges();
}

async function reloadForFsChanges() {
  for (const t of S.tabs) {
    if (t.loc.kind === 'fs' || t.loc.kind === 'results' ||
        t.loc.kind === 'bin' || t.loc.kind === 'home' || t.loc.kind === 'thispc' ||
        t.loc.kind === 'network' || t.loc.kind === 'gallery') {
      await loadTab(t, { quiet: true });
    }
  }
  refreshUI();
}

/* Live filesystem change broadcast from main. */
async function onDirChanged(dir) {
  for (const t of S.tabs) {
    if (t.loc.kind === 'fs' && t.loc.path === dir) {
      const sel = new Set(t.selection);
      await loadTab(t, { quiet: true });
      t.selection = sel;
      if (typeof View !== 'undefined') View.renderActive();
    }
  }
  // changes may affect special pages too (e.g. bin after external trash)
  for (const t of S.tabs) {
    if (t.loc.kind === 'bin') await loadTab(t, { quiet: true });
  }
}
