/*
 * menus.js — Windows 11 style popup menus: icon row, submenus, keyboard
 * navigation, viewport clamping. Plus builders for the item / background /
 * nav-pane / tab / drive context menus.
 */
'use strict';

const Menus = (() => {
  let layerEl = null;
  const openStack = [];   // DOM elements, root first
  let keyHandler = null;

  function layer() {
    if (!layerEl) {
      layerEl = h('div', { id: 'menuLayer' });
      document.body.appendChild(layerEl);
    }
    return layerEl;
  }

  function closeAll() {
    for (const m of openStack.splice(0)) m.remove();
    if (keyHandler) { document.removeEventListener('keydown', keyHandler, true); keyHandler = null; }
  }

  function closeDeeperThan(level) {
    while (openStack.length > level + 1) openStack.pop().remove();
  }

  function installKeys() {
    if (keyHandler) return;
    keyHandler = (ev) => {
      if (!openStack.length) return;
      const menu = openStack[openStack.length - 1];
      const items = () => $$('.menu-item:not(.disabled)', menu);
      const current = () => items().findIndex((i) => i.classList.contains('hover'));
      const setHover = (idx) => {
        const list = items();
        if (!list.length) return;
        const n = ((idx % list.length) + list.length) % list.length;
        list.forEach((i, j) => i.classList.toggle('hover', j === n));
        list[n].scrollIntoView({ block: 'nearest' });
      };
      const k = ev.key;
      if (k === 'Escape') { ev.preventDefault(); ev.stopPropagation(); if (openStack.length > 1) closeDeeperThan(openStack.length - 2); else closeAll(); return; }
      if (k === 'ArrowDown') { ev.preventDefault(); ev.stopPropagation(); setHover(current() + 1); return; }
      if (k === 'ArrowUp') { ev.preventDefault(); ev.stopPropagation(); setHover(current() - 1); return; }
      if (k === 'Home') { ev.preventDefault(); setHover(0); return; }
      if (k === 'End') { ev.preventDefault(); setHover(items().length - 1); return; }
      if (k === 'ArrowRight') {
        const el = items()[current()];
        if (el && el._def && el._def.submenu) { ev.preventDefault(); openSub(el, el._def.submenu, openStack.length); }
        return;
      }
      if (k === 'ArrowLeft') {
        if (openStack.length > 1) { ev.preventDefault(); closeDeeperThan(openStack.length - 2); }
        return;
      }
      if (k === 'Enter' || k === ' ') {
        const el = items()[current()];
        if (el) { ev.preventDefault(); el.click(); }
        return;
      }
      ev.stopPropagation();
    };
    document.addEventListener('keydown', keyHandler, true);
  }

  function clampPos(el, x, y, align) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const r = el.getBoundingClientRect();
    let left = x, top = y;
    if (left + r.width > vw - 6) left = Math.max(6, align === 'right' ? x - r.width : vw - 6 - r.width);
    if (top + r.height > vh - 6) top = Math.max(6, y - r.height);
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }

  function buildMenu(defs, level) {
    const menu = h('div', { class: 'menu', role: 'menu' });
    if (defs.iconRow && defs.iconRow.length) {
      const row = h('div', { class: 'menu-iconrow' });
      for (const r of defs.iconRow) {
        const b = h('button', {
          class: 'menu-iconbtn' + (r.disabled ? ' disabled' : ''),
          title: r.title || r.label || '',
          html: I(r.icon, '', 17),
          onclick: (ev) => { ev.stopPropagation(); if (r.disabled) return; closeAll(); dispatch(r); }
        });
        row.appendChild(b);
      }
      menu.appendChild(row);
      menu.appendChild(h('div', { class: 'menu-sep' }));
    }
    const items = defs.items || defs;
    for (const d of items) {
      if (!d) continue;
      if (d.sep) { menu.appendChild(h('div', { class: 'menu-sep' })); continue; }
      const item = h('div', {
        class: 'menu-item' + (d.disabled ? ' disabled' : '') + (d.danger ? ' danger' : ''),
        role: 'menuitem',
        dataset: d.label ? { label: d.label } : {}
      });
      item._def = d;
      const chk = typeof d.checked === 'function' ? d.checked() : d.checked;
      const iconHtml = d.icon ? (typeof d.icon === 'string' ? I(d.icon, '', 16) : d.icon)
        : '<span class="menu-check">' + (chk ? I('check', '', 13) : '') + '</span>';
      item.appendChild(h('span', { class: 'menu-ico', html: iconHtml }));
      item.appendChild(h('span', { class: 'menu-label', text: d.label || '' }));
      if (d.hint) item.appendChild(h('span', { class: 'menu-hint', text: d.hint }));
      if (d.submenu) item.appendChild(h('span', { class: 'menu-arrow', html: I('chevronR', '', 13) }));

      item.addEventListener('mouseenter', () => {
        $$('.menu-item.hover', menu).forEach((i) => i.classList.remove('hover'));
        item.classList.add('hover');
        closeDeeperThan(level);
        if (d.submenu && !d.disabled) {
          setTimeout(() => {
            if (item.classList.contains('hover') && openStack.length === level + 1) openSub(item, d.submenu, level + 1);
          }, 160);
        }
      });
      item.addEventListener('mouseleave', () => item.classList.remove('hover'));
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (d.disabled) return;
        if (d.submenu) { openSub(item, d.submenu, level + 1); return; }
        closeAll();
        dispatch(d);
      });
      menu.appendChild(item);
    }
    return menu;
  }

  function openSub(itemEl, defs, level) {
    if (openStack.length > level) closeDeeperThan(level - 1);
    const sub = buildMenu(defs, level);
    layer().appendChild(sub);
    openStack.push(sub);
    const r = itemEl.getBoundingClientRect();
    const sr = sub.getBoundingClientRect();
    let x = r.right - 4, y = r.top - 6;
    if (x + sr.width > window.innerWidth - 6) x = Math.max(6, r.left - sr.width + 4);
    if (y + sr.height > window.innerHeight - 6) y = Math.max(6, window.innerHeight - 6 - sr.height);
    sub.style.left = Math.round(x) + 'px';
    sub.style.top = Math.round(y) + 'px';
    const first = sub.querySelector('.menu-item:not(.disabled)');
    if (first) first.classList.add('hover');
  }

  function dispatch(d) {
    if (d.run) { Promise.resolve(d.run(d)); return; }
    if (d.act) Actions.exec(d.act, d.arg !== undefined ? { arg: d.arg } : undefined);
  }

  /* Open a menu at viewport coords.
     opts: {items:[…], iconRow:[…], x, y, anchor (DOMRect), align} */
  function open(opts) {
    closeAll();
    const menu = buildMenu({ items: opts.items, iconRow: opts.iconRow }, 0);
    menu.classList.add('root');
    layer().appendChild(menu);
    openStack.push(menu);
    let x = opts.x, y = opts.y;
    if (opts.anchor) {
      x = opts.align === 'right' ? opts.anchor.right : opts.anchor.left;
      y = opts.anchor.bottom + 4;
      if (opts.anchor.bottom === 0) { x = opts.anchor.left; y = opts.anchor.top + 4; }
    }
    clampPos(menu, x, y, opts.align);
    installKeys();
    const first = menu.querySelector('.menu-item:not(.disabled)');
    if (first && opts.prehover !== false) first.classList.add('hover');
    return menu;
  }

  /* ---------------------------------------------------- outside close */

  document.addEventListener('mousedown', (ev) => {
    if (!openStack.length) return;
    if (ev.target.closest && (ev.target.closest('.menu') || ev.target.closest('#menuLayer'))) return;
    closeAll();
  }, true);
  window.addEventListener('blur', () => closeAll());
  window.addEventListener('resize', () => closeAll());

  return { open, closeAll, buildMenu };
})();

/* ================================================================ */
/* Builders                                                          */
/* ================================================================ */

Menus.viewItems = function () {
  const tab = curTab();
  return VIEW_MODES.map((m) => ({
    label: m.label,
    checked: tab ? tab.view === m.id : false,
    act: 'view.mode.' + m.id
  }));
};

Menus.sortItems = function () {
  const tab = curTab();
  const items = SORT_KEYS.map((k) => ({
    label: k.label,
    checked: tab ? tab.sortBy === k.id : false,
    act: 'view.sort.' + k.id
  }));
  items.push({ sep: true });
  items.push({ label: 'Ascending', checked: () => { const t = curTab(); return t ? t.sortAsc : true; }, run: () => { const t = curTab(); if (t && !t.sortAsc) { t.sortAsc = true; wx.setSettings({ sortAsc: true }); refreshUI(); } } });
  items.push({ label: 'Descending', checked: () => { const t = curTab(); return t ? !t.sortAsc : false; }, run: () => { const t = curTab(); if (t && t.sortAsc) { t.sortAsc = false; wx.setSettings({ sortAsc: false }); refreshUI(); } } });
  items.push({ sep: true });
  items.push({
    label: 'Group by',
    submenu: GROUP_KEYS.map((g) => ({
      label: g.label,
      checked: tab ? tab.groupBy === g.id : false,
      act: 'view.group.' + g.id
    }))
  });
  return items;
};

Menus.showItems = function () {
  return [
    { label: 'Hidden items', checked: () => !!S.settings.showHidden, run: () => Actions.exec('view.toggleHidden') },
    { label: 'File name extensions', checked: () => !!S.settings.showExtensions, run: () => Actions.exec('view.toggleExtensions') },
    { sep: true },
    { label: 'Preview pane', hint: 'Alt+P', checked: () => !!S.settings.previewPane, run: () => Actions.exec('view.togglePreviewPane') },
    { label: 'Details pane', hint: 'Alt+Shift+P', checked: () => !!S.settings.detailsPane, run: () => Actions.exec('view.toggleDetailsPane') }
  ];
};

Menus.newItems = function () {
  return [
    { label: 'Folder', icon: 'newFolder', act: 'file.newFolder' },
    { label: 'Text Document', run: () => Actions.exec('file.newText') },
    { label: 'Shortcut', run: () => Actions.exec('file.newShortcut') }
  ];
};

/* Context menu for selected file-system items. */
Menus.itemMenu = function (x, y, entries, opts = {}) {
  const tab = opts.tab || curTab();
  if (!tab) return;
  const n = entries.length;
  const one = n === 1 ? entries[0] : null;
  const inBin = tab.loc.kind === 'bin';

  if (inBin) {
    Menus.open({
      x, y, items: [
        { label: 'Restore the selected items', icon: 'restore', act: 'bin.restore' },
        { label: 'Delete', icon: 'trash', act: 'edit.delete', hint: 'Delete' },
        { sep: true },
        { label: 'Properties', icon: 'info', run: () => Dlgs.properties({ tab, sel: entries }) }
      ],
      iconRow: [
        { icon: 'restore', title: 'Restore', act: 'bin.restore' },
        { icon: 'trash', title: 'Delete', act: 'edit.delete' },
        { icon: 'info', title: 'Properties', run: () => Dlgs.properties({ tab, sel: entries }) }
      ]
    });
    return;
  }

  const iconRow = [
    { icon: 'cut', title: 'Cut', act: 'edit.cut', disabled: !isFsLoc(tab) },
    { icon: 'copy', title: 'Copy', act: 'edit.copy', disabled: !isFsLoc(tab) },
    { icon: 'rename', title: 'Rename', act: 'edit.rename', disabled: !(one && isFsLoc(tab)) },
    { icon: 'trash', title: 'Delete', act: 'edit.delete' },
    { icon: 'info', title: 'Properties', run: () => Dlgs.properties({ tab, sel: entries }) }
  ];

  const items = [];
  if (one && one.isDir) {
    items.push({ label: 'Open', run: () => Ops.openEntries([one], { tab }) });
    items.push({ label: 'Open in new tab', icon: 'tabIcon', run: () => newTab(fsLoc(one.path)) });
    items.push({ label: 'Open in new window', icon: 'windowIcon', run: () => App.openWindowWith(one.path) });
    if (isFsLoc(tab)) {
      const pinned = S.settings.pinned || [];
      const isPinned = pinned.includes(one.path);
      items.push(isPinned
        ? { label: 'Unpin from Home', icon: 'unpin', run: () => Ops.togglePin(one.path) }
        : { label: 'Pin to Home', icon: 'pin', run: () => Ops.togglePin(one.path) });
    }
  } else if (one && !one.isDir) {
    items.push({ label: 'Open', run: () => Ops.openEntries([one], { tab }) });
    items.push({ label: 'Open in new tab', icon: 'tabIcon', run: () => Actions.exec('file.openNewTab') });
    items.push({ label: 'Open with', icon: 'openWith', submenu: Menus.openWithSubmenu(one) });
  }
  if (one && isFsLoc(tab)) {
    items.push({ label: 'Send to', icon: 'share', submenu: Menus.sendToSubmenu(entries) });
  }
  items.push({ sep: true });
  if (n === 1) {
    items.push({ label: 'Cut', hint: 'Ctrl+X', act: 'edit.cut' });
    items.push({ label: 'Copy', hint: 'Ctrl+C', act: 'edit.copy' });
  } else {
    items.push({ label: 'Cut (' + n + ' items)', hint: 'Ctrl+X', act: 'edit.cut' });
    items.push({ label: 'Copy (' + n + ' items)', hint: 'Ctrl+C', act: 'edit.copy' });
  }
  if (n === 1 && isFsLoc(tab)) items.push({ label: 'Rename', hint: 'F2', act: 'edit.rename' });
  items.push({ label: 'Delete', hint: 'Delete', act: 'edit.delete' });
  if (n === 1) items.push({ label: 'Properties', hint: 'Alt+Enter', run: () => Dlgs.properties({ tab, sel: entries }) });
  items.push({ sep: true });
  items.push({ label: 'Show more options', act: undefined, run: () => Menus.classicMenu(x, y, entries, opts) });

  Menus.open({ x, y, items, iconRow });
};

/* "Classic" (extended) menu — the Windows Shift+F10 equivalent. */
Menus.classicMenu = function (x, y, entries, opts = {}) {
  const tab = opts.tab || curTab();
  const one = entries.length === 1 ? entries[0] : null;
  const items = [];
  if (one) {
    items.push({ label: one.isDir ? 'Open' : 'Open' + (one.isDir ? '' : ''), run: () => Ops.openEntries([one], { tab }) });
    if (one.isDir) {
      items.push({ label: 'Open in new tab', run: () => newTab(fsLoc(one.path)) });
      items.push({ label: 'Open in new window', run: () => App.openWindowWith(one.path) });
    } else {
      items.push({ label: 'Open in new tab', run: () => Ops.openEntries([one], { tab, newTab: true }) });
      items.push({ label: 'Open with…', run: () => Dlgs.openWith(one.path) });
    }
    if (isFsLoc(tab)) items.push({ label: 'Pin to Home', icon: 'pin', run: () => Ops.togglePin(one.path) });
  }
  items.push({ sep: true });
  items.push({ label: 'Cut', hint: 'Ctrl+X', act: 'edit.cut' });
  items.push({ label: 'Copy', hint: 'Ctrl+C', act: 'edit.copy' });
  if (isFsLoc(tab)) items.push({ label: 'Paste', hint: 'Ctrl+V', act: 'edit.paste', disabled: !S.clipboard });
  if (one && isFsLoc(tab)) {
    items.push({ label: 'Rename', hint: 'F2', act: 'edit.rename' });
    items.push({ label: 'Create shortcut', run: () => Ops.createShortcutFor(one) });
  }
  items.push({ label: 'Delete', hint: 'Delete', act: 'edit.delete' });
  items.push({ label: 'Delete permanently', hint: 'Shift+Delete', act: 'edit.deletePermanent' });
  if (one) {
    items.push({ sep: true });
    items.push({ label: 'Properties', hint: 'Alt+Enter', run: () => Dlgs.properties({ tab, sel: entries }) });
  }
  Menus.open({ x, y, items });
};

/* Right-click on empty space inside a folder. */
Menus.backgroundMenu = function (x, y, opts = {}) {
  const tab = opts.tab || curTab();
  if (!tab) return;
  const kind = tab.loc.kind;

  if (kind === 'bin') {
    Menus.open({
      x, y, items: [
        { label: 'Empty the Recycle Bin', icon: 'trash', act: 'bin.empty' },
        { sep: true },
        { label: 'Refresh', icon: 'refresh', act: 'nav.refresh' }
      ]
    });
    return;
  }

  if (kind !== 'fs') {
    Menus.open({
      x, y, items: [
        { label: 'Refresh', icon: 'refresh', act: 'nav.refresh' },
        { sep: true },
        { label: 'View', icon: 'view', submenu: Menus.viewItems() },
        { label: 'Sort by', icon: 'sort', submenu: Menus.sortItems() }
      ]
    });
    return;
  }

  Menus.open({
    x, y, items: [
      {
        label: 'View', icon: 'view', submenu: [
          ...Menus.viewItems(),
          { sep: true },
          { label: 'Show', submenu: Menus.showItems() }
        ]
      },
      { label: 'Sort by', icon: 'sort', submenu: Menus.sortItems() },
      { label: 'Refresh', icon: 'refresh', act: 'nav.refresh' },
      { sep: true },
      { label: 'Paste', icon: 'paste', hint: 'Ctrl+V', act: 'edit.paste', disabled: !S.clipboard || !S.clipboard.paths.length },
      {
        label: 'New', icon: 'plus', submenu: Menus.newItems()
      },
      { sep: true },
      { label: 'Open in Terminal', icon: 'terminal', act: 'file.terminal' },
      { label: 'Properties', icon: 'info', run: () => Dlgs.properties({ tab, sel: [], folder: tab.loc.path }) }
    ]
  });
};

/* Navigation-pane item menu. */
Menus.navMenu = function (x, y, loc) {
  const items = [];
  if (loc.kind === 'fs') {
    const pinned = S.settings.pinned || [];
    items.push({ label: 'Open', run: () => navigate(loc) });
    items.push({ label: 'Open in new tab', run: () => newTab(loc) });
    items.push({ sep: true });
    if (pinned.includes(loc.path)) items.push({ label: 'Unpin from Home', icon: 'unpin', run: () => Ops.togglePin(loc.path) });
    else items.push({ label: 'Pin to Home', icon: 'pin', run: () => Ops.togglePin(loc.path) });
    items.push({ label: 'Open in Terminal', icon: 'terminal', run: () => Ops.terminalAt(loc.path) });
    items.push({ sep: true });
    items.push({ label: 'Properties', icon: 'info', run: () => Dlgs.properties({ tab: curTab(), sel: [], folder: loc.path }) });
  } else if (loc.kind === 'bin') {
    items.push({ label: 'Open', run: () => navigate(loc) });
    items.push({ label: 'Open in new tab', run: () => newTab(loc) });
    items.push({ sep: true });
    items.push({ label: 'Empty the Recycle Bin', icon: 'trash', act: 'bin.empty' });
  } else {
    items.push({ label: 'Open', run: () => navigate(loc) });
    items.push({ label: 'Open in new tab', run: () => newTab(loc) });
  }
  Menus.open({ x, y, items });
};

Menus.tabMenu = function (x, y, tabId) {
  Menus.open({
    x, y, items: [
      { label: 'New tab', hint: 'Ctrl+T', act: 'tab.new' },
      { sep: true },
      { label: 'Close', hint: 'Ctrl+W', run: () => closeTab(tabId) },
      {
        label: 'Close other tabs',
        run: () => {
          for (const t of [...S.tabs]) if (t.id !== tabId) closeTab(t.id);
          activateTab(tabId);
        }
      },
      { label: 'Close all tabs', run: () => { for (const t of [...S.tabs]) if (t.id !== tabId) closeTab(t.id); closeTab(tabId); } },
      { sep: true },
      { label: 'Refresh', run: () => { const t = tabById(tabId); if (t) refreshTab(t); } }
    ]
  });
};

Menus.driveMenu = function (x, y, drive) {
  const items = [];
  if (!drive.ejected) {
    items.push({ label: 'Open', run: () => navigate(fsLoc(drive.mount)) });
    if (drive.removable) items.push({ label: 'Eject', icon: 'eject', run: () => Ops.ejectDrive(drive) });
    items.push({ sep: true });
    items.push({ label: 'Properties', icon: 'info', run: () => Dlgs.driveProperties(drive) });
  } else {
    items.push({ label: 'Mount', icon: 'eject', run: () => Ops.mountDrive(drive) });
  }
  items.push({ sep: true });
  items.push({ label: 'Refresh', icon: 'refresh', act: 'nav.refresh' });
  Menus.open({ x, y, items });
};

Menus.openWithSubmenu = function (entry) {
  return [
    { label: 'Choose another app…', run: () => Dlgs.openWith(entry.path) }
  ];
};

Menus.sendToSubmenu = function (entries) {
  const dirs = [
    ['Desktop', (S.appInfo && S.appInfo.home ? S.appInfo.home + '/Desktop' : '~/Desktop')],
    ['Downloads', (S.appInfo && S.appInfo.home ? S.appInfo.home + '/Downloads' : '~/Downloads')],
    ['Documents', (S.appInfo && S.appInfo.home ? S.appInfo.home + '/Documents' : '~/Documents')]
  ];
  const items = dirs.map(([label, dir]) => ({
    label,
    run: () => Ops.sendTo(dir, entries)
  }));
  items.push({ sep: true });
  items.push({ label: 'Choose a folder…', run: () => Ops.sendToPick(entries) });
  return items;
};

function isFsLoc(tab) { return tab && tab.loc.kind === 'fs'; }
