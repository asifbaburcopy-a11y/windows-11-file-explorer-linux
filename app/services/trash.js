/*
 * trash.js — FreeDesktop.org trash specification implementation.
 * Deterministic names (unlike `gio trash`), which lets us restore exactly
 * and power the Recycle Bin view + Undo (Ctrl+Z).
 */
'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const core = require('../shared/core');

const HOME_TRASH = path.join(os.homedir(), '.local', 'share', 'Trash');
const FILES = path.join(HOME_TRASH, 'files');
const INFO = path.join(HOME_TRASH, 'info');

function ensureHomeTrash() {
  fs.mkdirSync(FILES, { recursive: true });
  fs.mkdirSync(INFO, { recursive: true });
}

function trashNameFor(name, taken) {
  return core.collisionName(name, taken);
}

function listTaken() {
  try { return new Set(fs.readdirSync(FILES)); } catch (e) { return new Set(); }
}

/* Move one path into the home trash. Returns {trashName, origPath}. */
async function trashOne(src) {
  ensureHomeTrash();
  const abs = path.resolve(src);
  const st = await fsp.lstat(abs);
  const base = core.basename(abs) || 'item';
  const taken = listTaken();
  const targetName = trashNameFor(base, taken);
  const targetFile = path.join(FILES, targetName);
  const infoFile = path.join(INFO, targetName + '.trashinfo');
  const info = core.serializeTrashInfo(abs, Date.now());

  // Trash-info must be written before the file move (spec).
  await fsp.mkdir(INFO, { recursive: true });
  await fsp.writeFile(infoFile, info);

  try {
    await fsp.rename(abs, targetFile);
  } catch (e) {
    if (e.code === 'EXDEV') {
      // Fallback per spec: copy then delete.
      await fsp.cp(abs, targetFile, { recursive: true, force: true });
      await fsp.rm(abs, { recursive: true, force: true });
    } else {
      await fsp.rm(infoFile, { force: true });
      throw e;
    }
  }
  return { trashName: targetName, origPath: abs, size: st.isDirectory() ? 0 : st.size, isDir: st.isDirectory() };
}

/* Trash many paths; returns results, collects per-item errors. */
async function trashPaths(paths) {
  const done = [];
  const errors = [];
  for (const p of paths) {
    try {
      // Never "trash" something already inside the trash.
      if (core.isSubPath(FILES, p) || core.isSubPath(INFO, p)) {
        errors.push({ path: p, message: 'Item is already in the Recycle Bin' });
        continue;
      }
      done.push(await trashOne(p));
    } catch (e) {
      errors.push({ path: p, message: e.message || String(e) });
    }
  }
  return { done, errors };
}

/* List trash contents: [{id, name, origPath, deletedAt, isDir, size}] */
function listTrash() {
  let names;
  try { names = fs.readdirSync(FILES); } catch (e) { return []; }
  const out = [];
  for (const name of names) {
    const filePath = path.join(FILES, name);
    const infoPath = path.join(INFO, name + '.trashinfo');
    let info = { path: null, deletionDate: null };
    try { info = core.parseTrashInfo(fs.readFileSync(infoPath, 'utf8')); } catch (e) { /* keep defaults */ }
    let st = null;
    try { st = fs.lstatSync(filePath); } catch (e) { continue; }
    out.push({
      id: name,
      name,
      origPath: info.path || '',
      deletedAt: core.parseIsoLocal(info.deletionDate) || st.mtimeMs,
      deletedSort: core.parseIsoLocal(info.deletionDate) || st.mtimeMs,
      isDir: st.isDirectory(),
      size: st.isDirectory() ? dirSize(filePath) : st.size
    });
  }
  out.sort((a, b) => b.deletedSort - a.deletedSort);
  return out;
}

function dirSize(dir) {
  let total = 0;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return 0; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    try {
      const st = fs.lstatSync(p);
      if (st.isDirectory()) total += dirSize(p);
      else total += st.size;
    } catch (err) { /* skip unreadable */ }
  }
  return total;
}

/* Restore trashed ids back to their original locations (collision-safe). */
async function restoreIds(ids) {
  ensureHomeTrash();
  const done = [];
  const errors = [];
  for (const id of ids) {
    try {
      const filePath = path.join(FILES, id);
      const infoPath = path.join(INFO, id + '.trashinfo');
      let info = { path: null };
      try { info = core.parseTrashInfo(await fsp.readFile(infoPath, 'utf8')); } catch (e) { }
      const dest = info.path || path.join(os.homedir(), id);
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      let finalDest = dest;
      if (await exists(finalDest)) {
        const taken = await dirNames(path.dirname(dest));
        finalDest = path.join(path.dirname(dest), core.collisionName(core.basename(dest), taken));
      }
      try {
        await fsp.rename(filePath, finalDest);
      } catch (e) {
        if (e.code === 'EXDEV') {
          await fsp.cp(filePath, finalDest, { recursive: true, force: true });
          await fsp.rm(filePath, { recursive: true, force: true });
        } else throw e;
      }
      await fsp.rm(infoPath, { force: true });
      done.push({ id, restoredTo: finalDest });
    } catch (e) {
      errors.push({ id, message: e.message || String(e) });
    }
  }
  return { done, errors };
}

/* Permanently delete trashed ids (or everything when ids === 'all'). */
async function deleteForever(ids) {
  ensureHomeTrash();
  const all = ids === 'all';
  const errors = [];
  if (all) {
    await fsp.rm(FILES, { recursive: true, force: true });
    await fsp.rm(INFO, { recursive: true, force: true });
    ensureHomeTrash();
    return { done: ['all'], errors };
  }
  for (const id of ids) {
    try {
      await fsp.rm(path.join(FILES, id), { recursive: true, force: true });
      await fsp.rm(path.join(INFO, id + '.trashinfo'), { force: true });
    } catch (e) { errors.push({ id, message: e.message }); }
  }
  return { done: ids, errors };
}

async function exists(p) {
  try { await fsp.lstat(p); return true; } catch (e) { return false; }
}

async function dirNames(dir) {
  try { return new Set(await fsp.readdir(dir)); } catch (e) { return new Set(); }
}

function trashStats() {
  const items = listTrash();
  let size = 0;
  for (const it of items) size += it.size || 0;
  return { count: items.length, size };
}

module.exports = {
  HOME_TRASH, FILES, INFO,
  trashPaths, listTrash, restoreIds, deleteForever, trashStats, ensureHomeTrash
};
