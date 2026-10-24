/*
 * ops.js — user-level file operations: clipboard (cut/copy/paste with
 * conflict dialog + progress + undo), delete/trash, New items, send-to,
 * pin/unpin, eject/mount, shortcuts, terminal, default-manager set.
 */
'use strict';

const Ops = (() => {

  function makeId() { return 'op_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }
  function fsDirOf(tab) { return tab && tab.loc.kind === 'fs' ? tab.loc.path : null; }

  function showErrors(errors) {
    const lines = errors.slice(0, 5).map((e) => '• ' + WXCore.basename(e.path || e.id || '') + ' — ' + e.message);
    if (errors.length > 5) lines.push('…and ' + (errors.length - 5) + ' more.');
    Dlgs.error('Some items could not be processed:\n\n' + lines.join('\n'));
  }

  /* ======================================================== clipboard = */

  function setClipboard(mode, ctx) {
    const paths = ctx.selPaths.filter(Boolean);
    if (!paths.length) return;
    S.clipboard = { mode, paths, dir: (ctx.tab && pathOf(ctx.tab.loc)) || '' };
    refreshUI();
  }

  function cut(ctx) { setClipboard('cut', ctx); }
  function copy(ctx) { setClipboard('copy', ctx); }

  /* ======================================================== transfer == */

  async function doTransfer({ sources, dest, mode, conflict, label }) {
    const id = makeId();
    App.showProgress(id, label || (mode === 'move' ? 'Moving…' : 'Copying…'));
    try {
      return await wx.transfer({ id, sources, dest, mode, conflict });
    } finally {
      App.hideProgress(id);
    }
  }

  /* Mirror fsops.transfer naming so undo knows the final target paths. */
  function plannedTargets(sources, dest, conflict, conflicts) {
    const taken = new Set(conflicts || []);
    const out = [];
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      const name = WXCore.basename(src);
      let t = name;
      if (taken.has(name)) {
        if (conflict === 'skip') continue;
        if (conflict === 'rename') t = WXCore.collisionName(name, taken);
      }
      taken.add(t);
      out.push({ src, target: WXCore.join(dest, t) });
    }
    return out;
  }

  async function paste(ctx) {
    const tab = ctx.tab || curTab();
    if (!tab || tab.loc.kind !== 'fs' || !S.clipboard || !S.clipboard.paths.length) return;
    const dest = tab.loc.path;
    const sources = S.clipboard.paths.filter((p) =>
      !WXCore.isSubPath(p, dest) && p !== dest && WXCore.dirname(p) !== dest ? true : false);
    const real = sources.length ? sources : [];
    if (!real.length) {
      // Same-folder paste: copy with new names.
      if (S.clipboard.mode === 'copy') {
        const conflicts = await wx.planConflicts(S.clipboard.paths, dest);
        return finishPaste(S.clipboard.paths, dest, 'copy', 'rename', conflicts);
      }
      Dlgs.error('These items cannot be pasted into the same folder they were cut from.');
      return;
    }
    const conflicts = (await wx.planConflicts(real, dest)) || [];
    let conflict = 'rename';
    if (conflicts.length) {
      const choice = await Dlgs.conflictDialog(conflicts);
      if (!choice) return;
      conflict = choice;
    }
    return finishPaste(real, dest, S.clipboard.mode === 'cut' ? 'move' : 'copy', conflict, conflicts);
  }

  async function finishPaste(sources, dest, mode, conflict, conflicts) {
    const plan = plannedTargets(sources, dest, conflict, conflicts);
    const res = await doTransfer({
      sources, dest, mode, conflict,
      label: (mode === 'move' ? 'Moving ' : 'Copying ') + sources.length + ' item' + (sources.length === 1 ? '' : 's') + '…'
    });
    if (!res || res.canceled) return res;
    if (res.errors && res.errors.length) showErrors(res.errors);

    if (mode === 'move' && res.moved) {
      if (conflict !== 'skip') S.clipboard = null;
      pushUndo({
        label: 'Move',
        undo: async () => {
          for (const { src, target } of plan) {
            await wx.transfer({ id: makeId(), sources: [target], dest: WXCore.dirname(src), mode: 'move', conflict: 'rename' });
          }
        },
        redo: () => doTransfer({ sources, dest, mode, conflict })
      });
    } else if (mode === 'copy' && res.copied) {
      pushUndo({
        label: 'Copy',
        undo: () => wx.remove(plan.map((p) => p.target)),
        redo: () => doTransfer({ sources, dest, mode, conflict })
      });
    }
    refreshUI();
    await reloadForFsChanges();
    return res;
  }

  /* ========================================================== delete == */

  async function del(ctx) {
    const tab = ctx.tab || curTab();
    if (!tab) return;
    if (tab.loc.kind === 'bin') return binDelete(ctx);
    const paths = ctx.selPaths;
    if (!paths.length) return;
    const res = await wx.trash(paths);
    if (res.errors && res.errors.length) showErrors(res.errors);
    if (res.done && res.done.length) {
      pushUndo({
        label: 'Delete',
        undo: () => wx.restore(res.done.map((d) => d.trashName)),
        redo: () => wx.trash(res.done.map((d) => d.origPath))
      });
    }
    clearSelection(tab);
    await reloadForFsChanges();
  }

  async function delPermanent(ctx) {
    const paths = ctx.selPaths;
    if (!paths.length) return;
    const ok = await Dlgs.confirm(
      paths.length === 1
        ? 'Are you sure you want to permanently delete “' + WXCore.basename(paths[0]) + '”?'
        : 'Are you sure you want to permanently delete these ' + paths.length + ' items?',
      'Delete Permanently', { okLabel: 'Yes', danger: true });
    if (!ok) return;
    const res = await wx.remove(paths);
    if (res.errors && res.errors.length) showErrors(res.errors);
    clearSelection(ctx.tab || curTab());
    await reloadForFsChanges();
  }

  /* ====================================================== recycle bin = */

  async function binRestore(ctx) {
    const ids = ctx.sel.map((e) => e.id).filter(Boolean);
    if (!ids.length) return;
    const res = await wx.restore(ids);
    if (res.errors && res.errors.length) showErrors(res.errors);
    App.toast(pluralize(res.done.length, 'item') + ' restored');
    await reloadForFsChanges();
  }

  async function binDelete(ctx) {
    const ids = ctx.sel.map((e) => e.id).filter(Boolean);
    if (!ids.length) return;
    const ok = await Dlgs.confirm(
      ids.length === 1
        ? 'Are you sure you want to permanently delete “' + (ctx.sel[0].name || '') + '”?'
        : 'Are you sure you want to permanently delete these ' + ids.length + ' items?',
      'Delete', { okLabel: 'Yes', danger: true });
    if (!ok) return;
    await wx.deleteForever(ids);
    await reloadForFsChanges();
  }

  async function binEmpty(ctx) {
    const tab = ctx.tab || curTab();
    const count = tab && tab.data && tab.data.items ? tab.data.items.length : 0;
    if (!count) return;
    const ok = await Dlgs.confirm(
      'Are you sure you want to permanently delete these ' + count + ' items?',
      'Empty Recycle Bin', { okLabel: 'Yes', danger: true });
    if (!ok) return;
    await wx.deleteForever('all');
    await reloadForFsChanges();
  }

  /* ======================================================== new items = */

  async function newItem(ctx, baseName, contentOrNull, undoLabel) {
    const tab = ctx && ctx.tab ? ctx.tab : curTab();
    const dir = fsDirOf(tab);
    if (!dir) return;
    const taken = new Set((tab.entries || []).map((e) => e.name));
    const name = WXCore.collisionName(baseName, taken);
    let p;
    if (contentOrNull === null) p = await wx.mkdir(dir, name);
    else p = await wx.createFile(dir, name, contentOrNull);
    pushUndo({
      label: undoLabel || 'New item',
      undo: () => wx.remove([p]),
      redo: () => (contentOrNull === null ? wx.mkdir(dir, name) : wx.createFile(dir, name, contentOrNull))
    });
    await loadTab(tab, { quiet: true });
    View.selectPath(tab, p);
    setTimeout(() => { View.beginRename(tab); }, 40);
    return p;
  }

  function newFolder(ctx) { return newItem(ctx, 'New folder', null, 'New folder'); }
  function newTextFile(ctx) { return newItem(ctx, 'New Text Document.txt', '', 'New text document'); }

  /* ======================================================== shortcuts = */

  function shortcutContent(target) {
    const name = WXCore.basename(target) || target;
    return '[Desktop Entry]\nType=Link\nName=' + name + ' - Shortcut\nURL=' +
      (target.startsWith('/') ? 'file://' + target : target) + '\nIcon=folder\n';
  }

  async function createShortcutTo(target, dir) {
    const base = (WXCore.basename(target) || 'item').replace(/\.desktop$/, '');
    const name = base + ' - Shortcut.desktop';
    const p = await wx.createFile(dir, name, shortcutContent(target));
    try { await wx.setPerms(p, { mode: 0o755 }); } catch (e) { /* best effort */ }
    pushUndo({ label: 'Shortcut', undo: () => wx.remove([p]), redo: () => wx.createFile(dir, name, shortcutContent(target)) });
    await reloadForFsChanges();
    App.toast('Shortcut created');
    return p;
  }

  async function createShortcutFor(entry) {
    return createShortcutTo(entry.path, WXCore.dirname(entry.path));
  }

  async function newShortcut(ctx) {
    const tab = ctx && ctx.tab ? ctx.tab : curTab();
    const dir = fsDirOf(tab);
    if (!dir) return;
    const target = await Dlgs.prompt('Create Shortcut', 'Type the location of the item:', '', 'Create Shortcut');
    if (!target) return;
    let p = target.trim();
    if (p.startsWith('~')) p = ((S.appInfo && S.appInfo.home) || '') + p.slice(1);
    if (!p.startsWith('/')) p = WXCore.join(dir, p);
    try {
      await wx.stat(p);
    } catch (e) {
      Dlgs.error('The system cannot find the path specified:\n' + p);
      return;
    }
    return createShortcutTo(p, dir);
  }

  /* ============================================================ open == */

  async function openEntries(entries, opts = {}) {
    const tab = opts.tab || curTab();
    let firstDir = true;
    let opened = 0;
    for (const e of entries.slice(0, 40)) {
      if (!e || !e.path) continue;
      if (e.isDir) {
        if (opts.newTab) newTab(fsLoc(e.path));
        else if (firstDir) navigate(fsLoc(e.path));
        else newTab(fsLoc(e.path));
        firstDir = false;
      } else {
        if (opened++ >= 12) break;
        const res = await wx.open(e.path);
        if (res && res.ok === false) {
          /* Windows: when no association works, ask the user which app to use. */
          if (typeof Dlgs !== 'undefined' && Dlgs.openWith) Dlgs.openWith(e.path).catch(() => { });
          else if (typeof App !== 'undefined' && App.toast) App.toast('Could not open “' + e.name + '”');
          break;
        }
      }
    }
  }

  function openInNewWindow(ctx) {
    const paths = ctx.selPaths;
    if (!paths.length) return;
    wx.newWindow(paths[0]);
  }

  function terminalCwdFor(tab, sel) {
    if (sel && sel.length === 1 && sel[0].isDir) return sel[0].path;
    if (sel && sel.length > 0) return WXCore.dirname(sel[0].path);
    return pathOf(tab.loc) || ((S.appInfo && S.appInfo.home) || '~');
  }

  function openTerminalHere(ctx) {
    const tab = ctx.tab || curTab();
    return terminalAt(terminalCwdFor(tab, ctx.sel));
  }

  function terminalAt(cwd) {
    return wx.openTerminal(cwd).then((r) => {
      if (!r || !r.ok) Dlgs.error((r && r.error) || 'Could not open a terminal here.');
    });
  }

  /* ========================================================= send to == */

  async function sendTo(dir, entries) {
    const sources = entries.map((e) => e.path).filter(Boolean);
    if (!sources.length) return;
    const conflicts = (await wx.planConflicts(sources, dir)) || [];
    const res = await finishPaste(sources, dir, 'copy', conflicts.length ? 'rename' : 'rename', conflicts);
    if (res && res.ok !== false) App.toast(pluralize(sources.length, 'item') + ' sent to ' + WXCore.basename(dir));
    return res;
  }

  async function sendToPick(entries) {
    const dir = await wx.pickFolder('Select a destination');
    if (!dir) return;
    return sendTo(dir, entries);
  }

  /* ============================================================== pin = */

  function togglePin(path) {
    const pinned = (S.settings.pinned || []).slice();
    const i = pinned.indexOf(path);
    if (i >= 0) { pinned.splice(i, 1); App.toast('Unpinned from Home'); }
    else { pinned.push(path); App.toast('Pinned to Home'); }
    S.settings.pinned = pinned;
    wx.setSettings({ pinned });
    Nav.render();
  }

  /* =========================================================== drives = */

  async function ejectDrive(drive) {
    const ok = await Dlgs.confirm(
      'Are you sure you want to eject “' + (drive.name || drive.device) + '”?\n\n' +
      'Open files will become unavailable until the device is reconnected.',
      'Eject ' + (drive.name || 'device'), { okLabel: 'Eject' });
    if (!ok) return;
    const r = await wx.unmount(drive.mount);
    if (r && r.ok) {
      App.toast((drive.name || 'Device') + ' can be safely removed');
    } else {
      Dlgs.error('Could not eject the device:\n' + ((r && r.error) || 'Unknown error'));
    }
    await Nav.refreshData();
    await reloadForFsChanges();
  }

  async function mountDrive(drive) {
    const r = await wx.mountDevice(drive.device);
    if (r && r.ok) {
      await Nav.refreshData();
      if (r.mount) navigate(fsLoc(r.mount));
      App.toast((drive.name || 'Device') + ' mounted');
    } else {
      Dlgs.error('Could not mount the device:\n' + ((r && r.error) || 'Unknown error'));
    }
  }

  /* ======================================================== defaults == */

  async function setAsDefault() {
    const r = await wx.setDefault();
    if (r && r.ok) {
      S.settings.askedDefault = true;
      wx.setSettings({ askedDefault: true });
      Dlgs.info('Explorer is now your default file manager.\n\nFolders you open from the desktop, the file manager switcher and other apps will open here.');
    } else {
      Dlgs.error('Could not set Explorer as the default file manager.\n\n' +
        ((r && r.current) ? 'Current default: ' + r.current : ''));
    }
    return r;
  }

  return {
    cut, copy, paste, del, delPermanent,
    binRestore, binDelete, binEmpty,
    newFolder, newTextFile, newShortcut, createShortcutFor,
    openEntries, openInNewWindow, openTerminalHere, terminalAt,
    sendTo, sendToPick, togglePin,
    ejectDrive, mountDrive, setAsDefault,
    finishPaste, doTransfer
  };
})();
