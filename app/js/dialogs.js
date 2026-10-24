/*
 * dialogs.js — Windows-style modal dialogs (Fluent look): generic shell,
 * error/confirm/prompt/info, file-conflict dialog, Properties, Open with,
 * Options (Folder Options) and About.
 */
'use strict';

const Dlgs = (() => {
  let layerEl = null;
  function layer() {
    if (!layerEl) {
      layerEl = h('div', { id: 'modalLayer' });
      document.body.appendChild(layerEl);
    }
    return layerEl;
  }

  /*
   * show({title, icon, body(node), buttons:[{label, primary, danger, value}],
   *       width}) → Promise<buttonValue|null>
   */
  function show(opts) {
    return new Promise((resolve) => {
      const host = layer();
      const scrim = h('div', { class: 'scrim' });
      const dlg = h('div', { class: 'dlg' + (opts.cls ? ' ' + opts.cls : ''), role: 'dialog' });
      if (opts.width) dlg.style.width = opts.width + 'px';

      dlg.appendChild(h('div', { class: 'dlg-title' },
        opts.icon ? h('span', { class: 'dlg-title-ico', html: I(opts.icon, '', 16) }) : null,
        h('span', { text: opts.title || '' })));

      const bodyWrap = h('div', { class: 'dlg-body' });
      if (typeof opts.body === 'string') bodyWrap.appendChild(h('div', { class: 'dlg-text', html: opts.body }));
      else if (opts.body) bodyWrap.appendChild(opts.body);
      dlg.appendChild(bodyWrap);

      const btnRow = h('div', { class: 'dlg-buttons' });
      const close = (value) => {
        scrim.remove();
        dlg.remove();
        document.removeEventListener('keydown', onKey, true);
        resolve(value);
      };
      for (const b of (opts.buttons || [{ label: 'OK', primary: true, value: true }])) {
        const el = h('button', {
          class: 'dbtn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''),
          text: b.label,
          onclick: () => close(b.value !== undefined ? b.value : b.label)
        });
        btnRow.appendChild(el);
        if (b.primary) setTimeout(() => el.focus(), 20);
      }
      dlg.appendChild(btnRow);

      const onKey = (ev) => {
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(null); }
        if (ev.key === 'Enter' && !ev.target.closest('textarea')) {
          const primary = (opts.buttons || []).findIndex((b) => b.primary);
          if (primary >= 0) { ev.preventDefault(); close(opts.buttons[primary].value !== undefined ? opts.buttons[primary].value : opts.buttons[primary].label); }
        }
      };
      document.addEventListener('keydown', onKey, true);

      host.appendChild(scrim);
      host.appendChild(dlg);
    });
  }

  const error = (message, title) =>
    show({ title: title || 'Explorer', icon: 'warning', body: esc(message).replace(/\n/g, '<br>'), buttons: [{ label: 'OK', primary: true, value: true }] });

  const info = (message, title) =>
    show({ title: title || 'Explorer', icon: 'info', body: esc(message).replace(/\n/g, '<br>'), buttons: [{ label: 'OK', primary: true, value: true }] });

  function confirm(message, title, opts = {}) {
    return show({
      title: title || 'Confirm', icon: 'warning',
      body: esc(message).replace(/\n/g, '<br>'),
      buttons: [
        { label: opts.okLabel || 'Yes', primary: true, danger: !!opts.danger, value: true },
        { label: 'No', value: false }
      ]
    }).then((v) => !!v);
  }

  function prompt(title, label, initial, okLabel) {
    const body = h('div', {},
      h('div', { class: 'dlg-text', text: label || '' }),
      h('input', { class: 'dlg-input', value: initial || '', spellcheck: 'false' }));
    const input = body.querySelector('input');
    setTimeout(() => { input.focus(); input.select(); }, 20);
    return show({ title, body, buttons: [{ label: okLabel || 'OK', primary: true, value: 'ok' }, { label: 'Cancel', value: null }] })
      .then((v) => (v === 'ok' ? input.value.trim() : null));
  }

  /* ---------------------------------------------- replace-or-skip file */

  function conflictDialog(names) {
    const list = h('div', { class: 'conflict-list' });
    for (const n of names.slice(0, 6)) {
      list.appendChild(h('div', { class: 'conflict-item' },
        h('span', { class: 'icowrap s16', html: '' }),
        h('span', { class: 'nm', text: n })));
    }
    if (names.length > 6) list.appendChild(h('div', { class: 'conflict-item more', text: '…and ' + (names.length - 6) + ' more' }));
    const body = h('div', {},
      h('div', { class: 'dlg-text big', text: 'The destination already has ' + pluralize(names.length, 'item') + ' with the same name' + (names.length === 1 ? '' : 's') + '.' }),
      list);
    return show({
      title: 'Replace or Skip Files', icon: 'copy', cls: 'conflict', width: 460,
      body,
      buttons: [
        { label: 'Replace the files', primary: true, value: 'replace' },
        { label: 'Skip these files', value: 'skip' },
        { label: 'Keep both files', value: 'rename' },
        { label: 'Cancel', value: null }
      ]
    });
  }

  /* ==================================================== properties ==== */

  function kv(label, value, opts = {}) {
    return h('div', { class: 'prop-row' + (opts.cls ? ' ' + opts.cls : '') },
      h('span', { class: 'prop-label', text: label }),
      h('span', { class: 'prop-value' + (opts.mono ? ' mono' : ''), text: value === undefined || value === null ? '' : String(value) }));
  }

  function propsButtons(onApply) {
    return [
      { label: 'OK', primary: true, value: 'ok' },
      { label: onApply ? 'Apply' : 'Cancel', value: onApply ? 'apply' : 'cancel' },
      { label: 'Cancel', value: 'cancel' }
    ];
  }

  async function properties(ctx) {
    const tab = ctx.tab || curTab();
    const sel = ctx.sel || [];

    if (sel.length > 1) return multiProperties(tab, sel);
    if (sel.length === 1) return itemProperties(tab, sel[0]);
    const folder = ctx.folder || (tab && tab.loc.kind === 'fs' ? tab.loc.path : null);
    if (!folder) return;
    return itemProperties(tab, { name: WXCore.basename(folder) || '/', path: folder, isDir: true });
  }

  async function itemProperties(tab, e) {
    let st;
    try { st = await wx.stat(e.path); } catch (err) { return error('Could not read properties:\n' + (err.message || err)); }
    const isDir = st.isDir;
    const body = h('div', { class: 'props' });
    const head = h('div', { class: 'props-head' },
      h('span', { class: 'icowrap s32', html: isDir ? folderSvg() : entryIcon(e) }),
      h('div', {},
        h('div', { class: 'props-name', text: e.name || st.name }),
        h('div', { class: 'props-type', text: isDir ? 'File folder' : WXCore.typeWithExt(WXCore.typeInfo(e.name || st.name, false, st.mode)) })));
    body.appendChild(head);
    body.appendChild(h('div', { class: 'props-sep' }));

    let contains = null;
    if (isDir) {
      contains = await wx.countItems(e.path);
    }

    body.appendChild(kv('Type of file', isDir ? 'File folder' : WXCore.typeWithExt(WXCore.typeInfo(e.name || st.name, false, st.mode))));
    if (isDir) {
      body.appendChild(kv('Contains', contains
        ? pluralize(contains.files, 'File', 'Files') + ', ' + pluralize(contains.dirs, 'Folder', 'Folders') +
        (contains.capped ? ' (count capped)' : '')
        : ''));
    }
    body.appendChild(kv('Location', WXCore.dirname(e.path)));
    body.appendChild(kv('Size', isDir
      ? (contains ? WXCore.fmtBytesFull(contains.bytes) + ' (' + formatSize(contains.bytes) + ')' : '')
      : WXCore.fmtBytesFull(st.size) + ' (' + formatSize(st.size) + ')'));
    body.appendChild(h('div', { class: 'props-sep' }));
    body.appendChild(kv('Created', WXCore.fmtDateTimeSec(st.ctime)));
    body.appendChild(kv('Modified', WXCore.fmtDateTimeSec(st.mtime)));
    body.appendChild(kv('Accessed', WXCore.fmtDateTimeSec(st.atime)));
    body.appendChild(h('div', { class: 'props-sep' }));

    const roRow = h('label', { class: 'prop-check' });
    const ro = h('input', { type: 'checkbox' });
    ro.checked = (st.mode & 0o222) === 0;
    roRow.appendChild(ro);
    roRow.appendChild(h('span', { text: 'Read-only' }));
    body.appendChild(roRow);
    body.appendChild(kv('Permissions', '0' + st.mode.toString(8), { mono: true }));

    const applyFn = async () => {
      try {
        await wx.setPerms(e.path, { readOnly: ro.checked });
        return true;
      } catch (err) { return error('Could not change permissions:\n' + (err.message || err)); }
    };

    return show({
      title: (e.name || st.name) + ' Properties', body, width: 420,
      buttons: propsButtons(applyFn)
    }).then(async (choice) => {
      if (choice === 'apply') await applyFn();
    });
  }

  async function multiProperties(tab, sel) {
    const body = h('div', { class: 'props' });
    let total = 0;
    let dirs = 0;
    const locs = new Set();
    let capped = false;
    for (const e of sel.slice(0, 200)) {
      locs.add(WXCore.dirname(e.path || ''));
      if (e.isDir) { dirs++; continue; }
      total += e.size || 0;
    }
    body.appendChild(h('div', { class: 'props-head' },
      h('span', { class: 'icowrap s32', html: folderSvg() }),
      h('div', {},
        h('div', { class: 'props-name', text: pluralize(sel.length, 'item', 'items') + ' selected' }))));
    body.appendChild(h('div', { class: 'props-sep' }));
    body.appendChild(kv('Type', dirs === sel.length ? 'File folders' : (dirs ? 'Files and folders' : 'Files')));
    body.appendChild(kv('Location', [...locs].slice(0, 2).join('; ') + (locs.size > 2 ? ' …' : '')));
    body.appendChild(kv('Total size', WXCore.fmtBytesFull(total) + ' (' + formatSize(total) + ')'));
    return show({ title: 'Properties', body, width: 420, buttons: [{ label: 'Close', primary: true, value: true }] });
  }

  async function driveProperties(drive) {
    const body = h('div', { class: 'props' });
    body.appendChild(h('div', { class: 'props-head' },
      h('span', { class: 'icowrap s32', html: drive.removable ? usbSvg('s32') : driveSvg('s32', drive.removable) }),
      h('div', {},
        h('div', { class: 'props-name', text: drive.name || drive.device }),
        h('div', { class: 'props-type', text: drive.fstype || 'Drive' }))));
    body.appendChild(h('div', { class: 'props-sep' }));
    body.appendChild(kv('Mounted at', drive.mount || '(not mounted)'));
    body.appendChild(kv('Device', drive.device || ''));
    body.appendChild(kv('File system', drive.fstype || ''));
    body.appendChild(kv('Capacity', WXCore.fmtDriveSize(drive.size || 0)));
    body.appendChild(kv('Free space', WXCore.fmtDriveSize(drive.free || 0)));
    body.appendChild(kv('Used', (drive.usedPct || 0) + '%'));
    return show({ title: (drive.name || 'Drive') + ' Properties', body, width: 420, buttons: [{ label: 'Close', primary: true, value: true }] });
  }

  /* ==================================================== open with ===== */

  async function openWith(path) {
    const ext = WXCore.extname(path);
    const apps = await wx.listApps(true).catch(() => []);
    const body = h('div', {});
    body.appendChild(h('div', { class: 'dlg-text', text: 'Choose the app you want to open “' + WXCore.basename(path) + '” with:' }));
    const list = h('div', { class: 'applist' });
    let chosen = null;
    for (const a of apps) {
      const row = h('label', { class: 'approw', title: a.comment || a.exec });
      const radio = h('input', { type: 'radio', name: 'wx-openwith', value: a.id });
      row.appendChild(radio);
      row.appendChild(h('span', { class: 'app-ico', html: I('windowIcon', '', 18) }));
      row.appendChild(h('span', { class: 'app-name', text: a.name }));
      radio.addEventListener('change', () => { chosen = a.id; });
      list.appendChild(row);
    }
    if (!apps.length) list.appendChild(h('div', { class: 'hint', text: 'No applications found.' }));
    const scroll = h('div', { class: 'applistscroll' }, list);
    body.appendChild(scroll);
    if (apps.length) {
      setTimeout(() => { const first = list.querySelector('input'); if (first) { first.checked = true; chosen = apps[0].id; } }, 10);
    }
    const r = await show({
      title: 'Open with' + (ext ? '  (' + ext + ')' : ''), body, width: 460,
      buttons: [{ label: 'OK', primary: true, value: 'ok' }, { label: 'Cancel', value: null }]
    });
    if (r === 'ok' && chosen) {
      const res = await wx.launchApp(chosen, path);
      if (!res.ok) error('Could not start the application:\n' + res.error);
    }
  }

  /* ====================================================== options ====== */

  async function options() {
    const st = S.settings;
    let tabName = 'general';
    const body = h('div', {});
    const tabs = h('div', { class: 'dlg-tabs' });
    const content = h('div', { class: 'dlg-tabbody' });
    body.appendChild(tabs);
    body.appendChild(content);

    const draft = {
      openTo: st.openTo || 'home',
      singleClick: !!st.singleClick,
      showHidden: !!st.showHidden,
      showExtensions: !!st.showExtensions,
      theme: st.theme || 'system'
    };

    function renderTab() {
      tabs.innerHTML = '';
      for (const t of [['general', 'General'], ['view', 'View']]) {
        const el = h('div', { class: 'dlg-tab' + (tabName === t[0] ? ' active' : ''), text: t[1] });
        el.addEventListener('click', () => { tabName = t[0]; renderTab(); });
        tabs.appendChild(el);
      }
      content.innerHTML = '';
      if (tabName === 'general') {
        content.appendChild(h('div', { class: 'opt-sec' }, h('div', { class: 'opt-title', text: 'Open File Explorer to:' })));
        const sel = h('select', { class: 'dlg-select' });
        sel.appendChild(h('option', { value: 'home', text: 'Home', selected: draft.openTo === 'home' || undefined }));
        sel.appendChild(h('option', { value: 'thispc', text: 'This PC', selected: draft.openTo === 'thispc' || undefined }));
        sel.addEventListener('change', () => { draft.openTo = sel.value; });
        content.appendChild(sel);

        content.appendChild(h('div', { class: 'opt-sec' }, h('div', { class: 'opt-title', text: 'Click items as follows:' })));
        const single = h('label', { class: 'opt-check' });
        const singleCb = h('input', { type: 'checkbox' });
        singleCb.checked = draft.singleClick;
        singleCb.addEventListener('change', () => { draft.singleClick = singleCb.checked; });
        single.appendChild(singleCb);
        single.appendChild(h('span', { text: 'Single-click to open an item (point to select)' }));
        content.appendChild(single);

        content.appendChild(h('div', { class: 'opt-sec' }, h('div', { class: 'opt-title', text: 'Theme:' })));
        const themeSel = h('select', { class: 'dlg-select' });
        for (const [v, l] of [['system', 'Use system setting'], ['light', 'Light'], ['dark', 'Dark']]) {
          themeSel.appendChild(h('option', { value: v, text: l, selected: draft.theme === v || undefined }));
        }
        themeSel.addEventListener('change', () => { draft.theme = themeSel.value; });
        content.appendChild(themeSel);
      } else {
        const mk = (key, label) => {
          const row = h('label', { class: 'opt-check' });
          const cb = h('input', { type: 'checkbox' });
          cb.checked = !!draft[key];
          cb.addEventListener('change', () => { draft[key] = cb.checked; });
          row.appendChild(cb);
          row.appendChild(h('span', { text: label }));
          return row;
        };
        content.appendChild(mk('showHidden', 'Show hidden files, folders, and drives'));
        content.appendChild(mk('showExtensions', 'Hide extensions for known file types  (uncheck to show)'));
        content.appendChild(h('div', { class: 'hint', text: 'Click OK to apply your changes.' }));
      }
    }
    renderTab();

    const r = await show({
      title: 'Options', body, width: 460,
      buttons: [{ label: 'OK', primary: true, value: 'ok' }, { label: 'Cancel', value: null }]
    });
    if (r === 'ok') {
      wx.setSettings({
        openTo: draft.openTo,
        singleClick: draft.singleClick,
        showHidden: draft.showHidden,
        showExtensions: draft.showExtensions,
        theme: draft.theme
      });
      await reloadForFsChanges();
    }
  }

  /* ======================================================== about ====== */

  async function about() {
    const info = S.appInfo || {};
    const body = h('div', { class: 'about' },
      h('div', { class: 'about-logo', html: folderSvg('s48') }),
      h('div', {},
        h('div', { class: 'about-name', text: 'Explorer for Linux' }),
        h('div', { class: 'about-ver', text: 'Version ' + (info.version || '1.0.0') }),
        h('div', { class: 'about-note', text: 'A Windows 11 File Explorer look-alike built with Electron. Native FreeDesktop trash, drives, and XDG integration.' }),
        h('div', { class: 'about-note mono', text: (info.hostname || '') + ' · ' + (info.user || '') })
      ));
    return show({
      title: 'About Explorer', body, width: 440,
      buttons: [{ label: 'OK', primary: true, value: true }]
    });
  }

  /* ============================================ default-manager prompt = */

  async function defaultPrompt() {
    const r = await show({
      title: 'Set as default file manager', icon: 'home', width: 460,
      body: h('div', {},
        h('div', { class: 'dlg-text big', text: 'Make Explorer your default file manager?' }),
        h('div', { class: 'dlg-text dim', text: 'Folders you open from the desktop, the Start menu and other apps will open in Explorer — just like choosing a default app in Windows.' })),
      buttons: [
        { label: 'Set as default', primary: true, value: 'yes' },
        { label: 'Ask me later', value: 'later' },
        { label: "Don't ask again", value: 'never' }
      ]
    });
    if (r === 'yes') {
      await Ops.setAsDefault();
      S.settings.askedDefault = true;
      wx.setSettings({ askedDefault: true });
    } else if (r === 'never') {
      S.settings.askedDefault = true;
      wx.setSettings({ askedDefault: true });
    }
  }

  return {
    show, error, info, confirm, prompt,
    conflictDialog, properties, itemProperties, driveProperties,
    openWith, options, about, defaultPrompt
  };
})();
