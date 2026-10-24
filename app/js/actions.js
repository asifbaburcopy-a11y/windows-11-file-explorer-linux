/*
 * actions.js — single command registry. The command bar, context menus,
 * dropdowns and keyboard shortcuts all dispatch through here, so every
 * command is implemented exactly once.
 */
'use strict';

const Actions = (() => {
  const map = new Map();

  function register(id, def) { map.set(id, Object.assign({ id }, def)); }
  function get(id) { return map.get(id); }
  function all() { return [...map.values()]; }

  /*
   * exec(id, extra) → runs def.run(ctx) with
   *   ctx = {tab, sel, selPaths, arg, ...extra}
   * Skips silently when the `when` predicate fails.
   */
  async function exec(id, extra) {
    const def = map.get(id);
    if (!def) { console.warn('unknown action', id); return; }
    const tab = (extra && extra.tab) || curTab();
    const ctx = Object.assign({
      tab,
      sel: tab ? selectedEntries(tab) : [],
      selPaths: tab ? selectedPaths(tab) : []
    }, extra || {});
    if (def.when && !def.when(ctx)) return;
    try {
      return await def.run(ctx);
    } catch (e) {
      console.error('[action ' + id + ']', e);
      if (typeof Dlgs !== 'undefined' && e && e.message) Dlgs.error(e.message);
    }
  }

  const hasSelection = (c) => c && c.sel && c.sel.length > 0;
  const isFs = (c) => c && c.tab && c.tab.loc.kind === 'fs';
  const isBin = (c) => c && c.tab && c.tab.loc.kind === 'bin';
  const single = (c) => c && c.sel && c.sel.length === 1;

  /* ------------------------------------------------------------ nav */

  register('nav.back', { title: 'Back', icon: 'back', run: () => goBack() });
  register('nav.forward', { title: 'Forward', icon: 'forward', run: () => goForward() });
  register('nav.up', {
    title: 'Up', icon: 'up',
    /* when() receives the action context {tab, sel, selPaths} like every
       other action — receiving the raw tab left this button dead. */
    when: (c) => {
      const t = c && c.tab;
      return !!(t && (t.loc.kind === 'results' || (t.loc.kind === 'fs' && t.loc.path !== '/')));
    },
    run: () => goUp()
  });
  register('nav.refresh', { title: 'Refresh', icon: 'refresh', run: (c) => refreshTab(c.tab) });
  register('nav.address', { title: 'Address bar', run: () => Bar.focusAddress() });
  register('nav.search', { title: 'Search', run: () => Bar.focusSearch() });
  register('nav.home', { title: 'Home', icon: 'home', run: () => navigate(homeLoc()) });

  /* ------------------------------------------------------------- tab */

  register('tab.new', { title: 'New tab', run: () => { newTab(homeLoc()); } });
  register('tab.close', { title: 'Close tab', run: () => closeTab(S.activeId) });
  register('tab.next', { title: 'Next tab', run: () => cycleTab(1) });
  register('tab.prev', { title: 'Previous tab', run: () => cycleTab(-1) });
  register('tab.reopen', {
    title: 'Reopen closed tab',
    run: () => {
      const loc = S.closedTabs && S.closedTabs.pop();
      if (loc) newTab(loc);
    }
  });

  register('window.new', { title: 'New window', run: () => { App.openNewWindow(); } });

  /* ------------------------------------------------------------- edit */

  register('edit.cut', {
    title: 'Cut', icon: 'cut', hint: 'Ctrl+X',
    when: (c) => hasSelection(c) && isFs(c),
    run: (c) => Ops.cut(c)
  });
  register('edit.copy', {
    title: 'Copy', icon: 'copy', hint: 'Ctrl+C',
    when: (c) => hasSelection(c) && isFs(c),
    run: (c) => Ops.copy(c)
  });
  register('edit.paste', {
    title: 'Paste', icon: 'paste', hint: 'Ctrl+V',
    when: (c) => S.clipboard && S.clipboard.paths.length && isFs(c),
    run: (c) => Ops.paste(c)
  });
  register('edit.rename', {
    title: 'Rename', icon: 'rename', hint: 'F2',
    when: (c) => single(c) && isFs(c),
    run: (c) => View.beginRename(c.tab)
  });
  register('edit.delete', {
    title: 'Delete', icon: 'trash', hint: 'Delete',
    when: (c) => hasSelection(c) && (isFs(c) || isBin(c)),
    run: (c) => (isBin(c.tab) ? Ops.binDelete(c) : Ops.del(c))
  });
  register('edit.deletePermanent', {
    title: 'Delete permanently', hint: 'Shift+Delete',
    when: (c) => hasSelection(c) && isFs(c),
    run: (c) => Ops.delPermanent(c)
  });
  register('edit.selectAll', {
    title: 'Select all', hint: 'Ctrl+A',
    run: (c) => { selectAll(c.tab); View.renderActive(); App.renderStatus(); }
  });
  register('edit.undo', {
    title: 'Undo', icon: 'undo', hint: 'Ctrl+Z',
    when: () => S.undo.length > 0,
    run: () => doUndo()
  });
  register('edit.redo', {
    title: 'Redo', icon: 'redo', hint: 'Ctrl+Y',
    when: () => S.redo.length > 0,
    run: () => doRedo()
  });

  /* -------------------------------------------------------------- new */

  register('file.newFolder', {
    title: 'Folder', icon: 'newFolder', hint: 'Ctrl+Shift+N',
    when: isFs,
    run: (c) => Ops.newFolder(c)
  });
  register('file.newText', {
    title: 'Text Document',
    when: isFs,
    run: (c) => Ops.newTextFile(c)
  });
  register('file.newShortcut', {
    title: 'Shortcut',
    when: isFs,
    run: (c) => Ops.newShortcut(c)
  });

  /* ------------------------------------------------------------- open */

  register('file.open', {
    title: 'Open', icon: 'openWith',
    when: (c) => hasSelection(c),
    run: (c) => Ops.openSelection(c)
  });
  register('file.openNewTab', {
    title: 'Open in new tab', icon: 'tabIcon',
    when: (c) => c.sel.length === 1 && c.sel[0].isDir,
    run: (c) => { newTab(fsLoc(c.sel[0].path)); }
  });
  register('file.openNewWindow', {
    title: 'Open in new window', icon: 'windowIcon',
    when: (c) => c.sel.length >= 1,
    run: (c) => Ops.openInNewWindow(c)
  });
  register('file.openWith', {
    title: 'Open with…',
    when: (c) => c.sel.length === 1 && !c.sel[0].isDir,
    run: (c) => Dlgs.openWith(c.sel[0].path)
  });
  register('file.terminal', {
    title: 'Open in Terminal', icon: 'terminal',
    when: (c) => isFs(c),
    run: (c) => Ops.openTerminalHere(c)
  });
  register('file.properties', {
    title: 'Properties', icon: 'info', hint: 'Alt+Enter',
    when: (c) => hasSelection(c) || isFs(c) || c.tab.loc.kind === 'thispc',
    run: (c) => Dlgs.properties(c)
  });
  register('file.showInFolder', {
    title: 'Show in folder',
    when: (c) => c.sel.length === 1,
    run: (c) => wx.showInFolder(c.sel[0].path)
  });

  /* -------------------------------------------------------------- view */

  function setView(mode) {
    const tab = curTab();
    if (!tab) return;
    tab.view = mode;
    S.settings.viewMode = mode;
    wx.setSettings({ viewMode: mode });
    refreshUI();
  }

  VIEW_MODES.forEach((m) => {
    register('view.mode.' + m.id, {
      title: m.label, icon: m.icon,
      when: null,
      run: () => setView(m.id)
    });
  });

  SORT_KEYS.forEach((k) => {
    register('view.sort.' + k.id, {
      title: 'Sort by ' + k.label,
      run: (c) => {
        const tab = c.tab;
        if (tab.sortBy === k.id) tab.sortAsc = !tab.sortAsc;
        else { tab.sortBy = k.id; tab.sortAsc = true; }
        wx.setSettings({ sortBy: tab.sortBy, sortAsc: tab.sortAsc });
        refreshUI();
      }
    });
  });

  register('view.sortDir', {
    title: 'Toggle sort direction',
    run: (c) => { c.tab.sortAsc = !c.tab.sortAsc; wx.setSettings({ sortAsc: c.tab.sortAsc }); refreshUI(); }
  });

  GROUP_KEYS.forEach((k) => {
    register('view.group.' + k.id, {
      title: 'Group by ' + k.label,
      run: (c) => { c.tab.groupBy = k.id; wx.setSettings({ groupBy: k.id }); refreshUI(); }
    });
  });

  register('view.toggleHidden', {
    title: 'Hidden items',
    checked: () => !!S.settings.showHidden,
    run: () => {
      const v = !S.settings.showHidden;
      wx.setSettings({ showHidden: v });
      S.settings.showHidden = v;
      reloadForFsChanges();
    }
  });
  register('view.toggleExtensions', {
    title: 'File name extensions',
    checked: () => !!S.settings.showExtensions,
    run: () => {
      const v = !S.settings.showExtensions;
      wx.setSettings({ showExtensions: v });
      S.settings.showExtensions = v;
      refreshUI();
    }
  });
  register('view.toggleDetailsPane', {
    title: 'Details pane', hint: 'Alt+Shift+P',
    checked: () => !!S.settings.detailsPane,
    run: () => {
      const v = !S.settings.detailsPane;
      const patch = { detailsPane: v };
      if (v && S.settings.previewPane) { patch.previewPane = false; S.settings.previewPane = false; }
      wx.setSettings(patch);
      S.settings.detailsPane = v;
      App.applyPanes();
      refreshUI();
    }
  });

  register('view.togglePreviewPane', {
    title: 'Preview pane', hint: 'Alt+P',
    run: () => {
      const v = !S.settings.previewPane;
      const patch = { previewPane: v };
      if (v && S.settings.detailsPane) { patch.detailsPane = false; S.settings.detailsPane = false; }
      wx.setSettings(patch);
      S.settings.previewPane = v;
      App.applyPanes();
      refreshUI();
    }
  });

  register('edit.selectNone', {
    title: 'Select none', hint: 'Esc',
    run: (c) => { clearSelection(c.tab); View.renderActive(); App.renderStatus(); }
  });

  register('edit.invertSelection', {
    title: 'Invert selection',
    run: (c) => {
      const tab = c.tab;
      const pool = View.lastVisible || [];
      const sel = new Set();
      for (const e of pool) if (!tab.selection.has(keyOf(e))) sel.add(keyOf(e));
      tab.selection = sel;
      View.renderActive();
      App.renderStatus();
    }
  });

  /* ----------------------------------------------------------- recycle */

  register('bin.restore', {
    title: 'Restore the selected items', icon: 'restore',
    when: (c) => isBin(c) && hasSelection(c),
    run: (c) => Ops.binRestore(c)
  });
  register('bin.empty', {
    title: 'Empty the Recycle Bin', icon: 'trash',
    when: (c) => isBin(c) && c.tab.data && c.tab.data.items && c.tab.data.items.length > 0,
    run: (c) => Ops.binEmpty(c)
  });

  /* --------------------------------------------------------------- app */

  register('app.options', { title: 'Options', icon: 'settings', run: () => Dlgs.options() });
  register('app.setDefault', {
    title: 'Set as default file manager',
    run: () => Ops.setAsDefault()
  });
  register('app.about', { title: 'About Explorer', icon: 'info', run: () => Dlgs.about() });

  return { register, get, all, exec };
})();
