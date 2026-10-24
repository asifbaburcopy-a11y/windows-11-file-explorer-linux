/*
 * fsops.js — file operations with progress reporting and cancellation.
 * Copy / move / mkdir / create / rename / permanent delete.
 * Trash operations live in trash.js.
 */
'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const core = require('../shared/core');

const activeOps = new Map();   // id -> AbortController
let progressSink = () => { };   // injected by main: (id, payload) => void

function makeOpId() {
  return 'op_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function registerOp(id, controller) { activeOps.set(id, controller); }
function finishOp(id) { activeOps.delete(id); }
function cancelOp(id) {
  const c = activeOps.get(id);
  if (c) { c.abort(); return true; }
  return false;
}
function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    const e = new Error('The operation was canceled.');
    e.code = 'ECANCELED';
    throw e;
  }
}

/* ------------------------------------------------------------- helpers */

async function exists(p) {
  try { await fsp.lstat(p); return true; } catch (e) { return false; }
}

async function listNames(dir) {
  try { return new Set(await fsp.readdir(dir)); } catch (e) { return new Set(); }
}

/* How many top-level entries in `sources` collide in `dest`. */
async function planConflicts(sources, dest) {
  const taken = await listNames(dest);
  const conflicts = [];
  for (const src of sources) {
    const name = core.basename(src);
    if (taken.has(name)) conflicts.push(name);
  }
  return conflicts;
}

/* Count files under paths (bounded) for progress totals. */
async function countFiles(paths, cap = 100000) {
  let total = 0;
  let capped = false;
  async function walk(p) {
    if (total >= cap) { capped = true; return; }
    let st;
    try { st = await fsp.lstat(p); } catch (e) { return; }
    if (!st.isDirectory()) { total++; return; }
    total++; // count the directory itself as one unit too
    let names;
    try { names = await fsp.readdir(p); } catch (e) { return; }
    for (const n of names) await walk(path.join(p, n));
  }
  for (const p of paths) await walk(p);
  return { total: capped ? null : total, capped };
}

/* Copy one file preserving mode + mtime. */
async function copyFilePreserve(src, dst, signal) {
  throwIfAborted(signal);
  await fsp.copyFile(src, dst);
  try {
    const st = await fsp.stat(src);
    await fsp.chmod(dst, st.mode & 0o7777);
    await fsp.utimes(dst, st.atime, st.mtime);
  } catch (e) { /* best effort */ }
}

/* Recursive copy with per-file progress. */
async function copyTree(src, dst, state, signal) {
  throwIfAborted(signal);
  const st = await fsp.lstat(src);
  if (st.isSymbolicLink()) {
    let link;
    try { link = await fsp.readlink(src); } catch (e) { return; }
    try { await fsp.symlink(link, dst); } catch (e) { await fsp.rm(dst, { force: true }); await fsp.symlink(link, dst); }
    return;
  }
  if (!st.isDirectory()) {
    await copyFilePreserve(src, dst, signal);
    state.done++;
    report(state);
    return;
  }
  await fsp.mkdir(dst, { recursive: true });
  const names = await fsp.readdir(src);
  for (const n of names) {
    throwIfAborted(signal);
    await copyTree(path.join(src, n), path.join(dst, n), state, signal);
  }
}

async function removeTree(p, state, signal) {
  throwIfAborted(signal);
  const st = await fsp.lstat(p);
  if (st.isDirectory() && !st.isSymbolicLink()) {
    const names = await fsp.readdir(p);
    for (const n of names) await removeTree(path.join(p, n), state, signal);
  }
  await fsp.rm(p, { force: true });
  state.done++;
  report(state);
}

let lastReport = 0;
function report(state) {
  const now = Date.now();
  if (now - lastReport < 80 && state.total) return;
  lastReport = now;
  progressSink(state.id, {
    done: state.done,
    total: state.total,
    current: state.current || '',
    phase: state.phase || 'working'
  });
}

/* ---------------------------------------------------------- transfer */

/*
 * transfer({id, sources, dest, mode, conflict})
 *   mode: 'copy' | 'move' | 'auto' (auto: move within same device, else copy)
 *   conflict: 'replace' | 'skip' | 'rename' | 'abort'
 * Returns {ok, moved, copied, skipped, errors:[{path,message}], mode}
 */
async function transfer(params, signal) {
  const { id, sources, dest, mode = 'auto', conflict = 'rename' } = params;
  const controller = new AbortController();
  registerOp(id, controller);
  const onAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  const sig = controller.signal;

  const res = { ok: true, moved: 0, copied: 0, skipped: 0, errors: [], mode };
  try {
    await fsp.mkdir(dest, { recursive: true });
    const destStat = await fsp.stat(dest);

    // Decide concrete mode for 'auto' from the first source's device.
    let concrete = mode;
    if (mode === 'auto') {
      concrete = 'copy';
      try {
        const sst = await fsp.stat(sources[0]);
        concrete = sst.dev === destStat.dev ? 'move' : 'copy';
      } catch (e) { }
    }
    res.mode = concrete;

    const { total } = await countFiles(sources);
    const state = { id, done: 0, total, current: '', phase: concrete === 'move' ? 'Moving' : 'Copying' };
    report(state);

    const taken = await listNames(dest);
    const replaceSet = new Set();
    const skipSet = new Set();
    const renameSet = new Set();

    for (const src of sources) {
      throwIfAborted(sig);
      const name = core.basename(src);
      let targetName = name;
      if (taken.has(name)) {
        if (conflict === 'abort') {
          const e = new Error(`The destination already has a file named "${name}".`);
          e.code = 'ECONFLICT'; throw e;
        }
        if (conflict === 'skip') { res.skipped++; continue; }
        if (conflict === 'replace') replaceSet.add(name);
        if (conflict === 'rename') {
          targetName = core.collisionName(name, taken);
          renameSet.add(targetName);
        }
      }
      const target = path.join(dest, targetName);
      state.current = src;
      try {
        if (concrete === 'move') {
          try {
            if (conflict === 'replace' && (await exists(target))) await fsp.rm(target, { recursive: true, force: true });
            await fsp.rename(src, target);
            res.moved++;
          } catch (e) {
            if (e.code === 'EXDEV') {
              await copyTree(src, target, state, sig);
              await removeTree(src, state, sig);
              res.copied++; // moved cross-device; report as moved
              res.moved++; res.copied--;
            } else throw e;
          }
        } else {
          if (conflict === 'replace' && (await exists(target))) await fsp.rm(target, { recursive: true, force: true });
          await copyTree(src, target, state, sig);
          res.copied++;
        }
        taken.add(targetName);
      } catch (e) {
        if (e.code === 'ECANCELED') throw e;
        res.errors.push({ path: src, message: friendlyError(e) });
        res.ok = res.errors.length === 0;
      }
    }
    state.phase = 'done';
    report(state);
    return res;
  } catch (e) {
    if (e.code === 'ECANCELED') {
      res.ok = false; res.canceled = true;
      return res;
    }
    res.ok = false;
    res.errors.push({ path: dest, message: friendlyError(e) });
    return res;
  } finally {
    finishOp(id);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/* ------------------------------------------------- single file operations */

async function mkdir(parent, name) {
  const target = path.join(parent, name);
  await fsp.mkdir(target);
  return target;
}

const NEW_FILE_TEMPLATES = {
  'text': 'New Text Document.txt'
};

async function createFile(parent, name, content = '') {
  const target = path.join(parent, name);
  const fh = await fsp.open(target, 'wx');
  try { await fh.writeFile(content, 'utf8'); } finally { await fh.close(); }
  return target;
}

async function rename(from, to) {
  if (from === to) return to;
  await fsp.rename(from, to);
  return to;
}

async function remove(paths, signal) {
  const id = makeOpId();
  const state = { id, done: 0, total: paths.length, phase: 'Deleting' };
  const errors = [];
  for (const p of paths) {
    if (signal && signal.aborted) break;
    try {
      await fsp.rm(p, { recursive: true, force: true });
      state.done++;
      report(state);
    } catch (e) { errors.push({ path: p, message: friendlyError(e) }); }
  }
  return { ok: errors.length === 0, errors };
}

async function setPermissions(p, { readOnly, mode }) {
  const st = await fsp.stat(p);
  let m = st.mode & 0o7777;
  if (readOnly === true) m = m & ~0o222;
  if (readOnly === false) m = m | 0o222;
  if (mode !== undefined && mode !== null) m = mode;
  await fsp.chmod(p, m);
  return m;
}

async function statPath(p) {
  const st = await fsp.lstat(p);
  return {
    path: p,
    name: path.basename(p),
    isDir: st.isDirectory(),
    isLink: st.isSymbolicLink(),
    size: st.size,
    mtime: st.mtimeMs,
    ctime: st.ctimeMs,
    atime: st.atimeMs,
    mode: st.mode & 0o7777,
    uid: st.uid,
    gid: st.gid,
    nlink: st.nlink,
    dev: st.dev
  };
}

/* Count items inside a directory (bounded, for Properties dialog). */
async function countItems(p, cap = 50000) {
  let files = 0, dirs = 0, bytes = 0, capped = false;
  async function walk(d, depth) {
    if (files + dirs >= cap) { capped = true; return; }
    let names;
    try { names = await fsp.readdir(d); } catch (e) { return; }
    for (const n of names) {
      if (files + dirs >= cap) { capped = true; return; }
      const full = path.join(d, n);
      let st;
      try { st = await fsp.lstat(full); } catch (e) { continue; }
      if (st.isDirectory()) {
        dirs++;
        if (!st.isSymbolicLink() && depth < 40) await walk(full, depth + 1);
      } else {
        files++;
        bytes += st.size;
      }
    }
  }
  const st = await fsp.lstat(p);
  if (st.isDirectory()) await walk(p, 0);
  else bytes = st.size;
  return { files, dirs, bytes, capped };
}

function friendlyError(e) {
  const map = {
    EACCES: 'Access is denied. (EACCES)',
    EPERM: 'Access is denied. (EPERM)',
    EEXIST: 'A file with the same name already exists. (EEXIST)',
    ENOTEMPTY: 'The destination folder is not empty. (ENOTEMPTY)',
    ENOSPC: 'There is not enough space on the disk. (ENOSPC)',
    ENOENT: 'The system cannot find the path specified. (ENOENT)',
    EROFS: 'The disk is write-protected. (EROFS)',
    EBUSY: 'The resource is in use. (EBUSY)'
  };
  return map[e.code] || (e.message || String(e));
}

module.exports = {
  makeOpId, registerOp, finishOp, cancelOp, transfer, planConflicts, countFiles,
  mkdir, createFile, rename, remove, setPermissions, statPath, countItems, friendlyError,
  setProgressSink(fn) { progressSink = fn; }
};
