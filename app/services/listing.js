/*
 * listing.js — directory listing, directory watchers, bounded recursive
 * search, and Gallery image discovery.
 */
'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const core = require('../shared/core');

const watchers = new Map();       // path -> FSWatcher
const watchSubs = new Map();      // path -> Set<callback>
let notify = () => { };           // injected by main (broadcast dirChanged)

const STAT_CONCURRENCY = 64;

async function listDir(dir) {
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch (e) {
    const err = new Error(e.message);
    err.code = e.code || 'EREAD';
    throw err;
  }
  const entries = new Array(names.length);
  let idx = 0;

  async function worker() {
    while (idx < names.length) {
      const i = idx++;
      const name = names[i];
      const full = path.join(dir, name);
      try {
        const lst = await fsp.lstat(full);
        let isDir = lst.isDirectory();
        let isLink = lst.isSymbolicLink();
        if (isLink) {
          try {
            const rst = await fsp.stat(full);
            isDir = rst.isDirectory();
          } catch (e) { /* broken symlink: keep lstat facts */ }
        }
        entries[i] = {
          name,
          path: full,
          isDir,
          isLink,
          isFile: lst.isFile(),
          size: isDir ? 0 : lst.size,
          mtime: lst.mtimeMs,
          ctime: lst.ctimeMs,
          atime: lst.atimeMs,
          mode: lst.mode & 0o777,
          executable: !isDir && (lst.mode & 0o111) !== 0
        };
      } catch (e) {
        entries[i] = {
          name, path: full, isDir: false, isLink: false, isFile: false,
          size: 0, mtime: 0, ctime: 0, atime: 0, mode: 0, executable: false, broken: true
        };
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(STAT_CONCURRENCY, Math.max(names.length, 1)); i++) workers.push(worker());
  await Promise.all(workers);
  return entries.filter(Boolean);
}

/* ---------------------------------------------------------------- watch */

function watch(dir, onDirty) {
  if (watchers.has(dir)) {
    watchSubs.get(dir).add(onDirty);
    return;
  }
  let w;
  try {
    w = fs.watch(dir, { persistent: false }, () => {
      const subs = watchSubs.get(dir);
      if (subs) for (const cb of subs) cb(dir);
      notify(dir);
    });
  } catch (e) {
    return; // unreadable/network dirs: no watch, manual refresh still works
  }
  w.on('error', () => { unwatchAll(dir); });
  watchers.set(dir, w);
  watchSubs.set(dir, new Set([onDirty]));
}

function unwatch(dir, cb) {
  const subs = watchSubs.get(dir);
  if (!subs) return;
  if (cb) subs.delete(cb);
  if (subs.size === 0) {
    try { watchers.get(dir).close(); } catch (e) { }
    watchers.delete(dir);
    watchSubs.delete(dir);
  }
}

function unwatchAll(dir) {
  const w = watchers.get(dir);
  if (w) { try { w.close(); } catch (e) { } }
  watchers.delete(dir);
  watchSubs.delete(dir);
}

function pruneWatchers(validPaths) {
  for (const dir of [...watchers.keys()]) {
    if (!validPaths.has(dir)) unwatchAll(dir);
  }
}

/* --------------------------------------------------------------- search */

const SEARCH_MAX_RESULTS = 2000;
const SEARCH_MAX_VISITS = 150000;
const SEARCH_TIME_BUDGET_MS = 8000;

async function search(root, query, opts = {}) {
  const q = String(query || '').toLowerCase();
  const results = [];
  if (!q) return results;
  const showHidden = !!opts.showHidden;
  const started = Date.now();
  let visited = 0;
  const queue = [{ dir: root, depth: 0 }];

  while (queue.length && results.length < SEARCH_MAX_RESULTS &&
         visited < SEARCH_MAX_VISITS && Date.now() - started < SEARCH_TIME_BUDGET_MS) {
    const { dir, depth } = queue.shift();
    let names;
    try { names = await fsp.readdir(dir); } catch (e) { continue; }
    for (const name of names) {
      if (!showHidden && name.startsWith('.')) continue;
      visited++;
      const full = path.join(dir, name);
      let lst;
      try { lst = await fsp.lstat(full); } catch (e) { continue; }
      let isDir = lst.isDirectory();
      if (lst.isSymbolicLink()) {
        try { isDir = (await fsp.stat(full)).isDirectory(); } catch (e) { isDir = false; }
      }
      const hit = name.toLowerCase().includes(q);
      if (hit) {
        results.push({
          name, path: full, isDir, isLink: lst.isSymbolicLink(),
          size: isDir ? 0 : lst.size, mtime: lst.mtimeMs, mode: lst.mode & 0o777,
          executable: !isDir && (lst.mode & 0o111) !== 0,
          folder: dir
        });
        if (results.length >= SEARCH_MAX_RESULTS) break;
      }
      if (isDir && depth < 12 && name !== '.git') {
        queue.push({ dir: full, depth: depth + 1 });
      }
    }
  }
  results.sort((a, b) => {
    const ah = a.isDir ? 0 : 1, bh = b.isDir ? 0 : 1;
    if (ah !== bh) return ah - bh;
    const ai = a.name.toLowerCase().indexOf(q);
    const bi = b.name.toLowerCase().indexOf(q);
    if (ai !== bi) return ai - bi;
    return core.compareEntries(a, b, 'name', true);
  });
  return { results, truncated: results.length >= SEARCH_MAX_RESULTS, visited, tookMs: Date.now() - started };
}

/* -------------------------------------------------------------- gallery */

const GALLERY_EXTS = core.IMAGE_EXTS;
const GALLERY_MAX = 4000;

async function gallery(extraDirs) {
  const roots = [path.join(os.homedir(), 'Pictures'), ...(extraDirs || [])]
    .filter((p, i, arr) => p && arr.indexOf(p) === i);
  const out = [];
  const queue = roots.map((d) => ({ dir: d, depth: 0 }));
  while (queue.length && out.length < GALLERY_MAX) {
    const { dir, depth } = queue.shift();
    let names;
    try { names = await fsp.readdir(dir); } catch (e) { continue; }
    for (const name of names) {
      if (name.startsWith('.')) continue;
      if (out.length >= GALLERY_MAX) break;
      const full = path.join(dir, name);
      let lst;
      try { lst = await fsp.lstat(full); } catch (e) { continue; }
      if (lst.isDirectory()) {
        if (depth < 6 && !lst.isSymbolicLink()) queue.push({ dir: full, depth: depth + 1 });
      } else if (lst.isFile() && GALLERY_EXTS.has(core.extname(name))) {
        out.push({ path: full, name, mtime: lst.mtimeMs, size: lst.size });
      }
    }
  }
  out.sort((a, b) => b.mtime - a.mtime);
  return out;
}

/* --------------------------------------------------- free space on path */

async function freeSpace(p) {
  try {
    const st = await fsp.statfs(p);
    const blockSize = st.bsize || 4096;
    return {
      size: st.blocks * blockSize,
      free: st.bavail * blockSize,
      freeUser: st.bfree * blockSize
    };
  } catch (e) {
    return null;
  }
}

module.exports = { listDir, watch, unwatch, unwatchAll, pruneWatchers, search, gallery, freeSpace, setNotify(fn) { notify = fn; } };
