/*
 * app.js — renderer bootstrap: settings, theme, keyboard shortcuts,
 * window controls, status bar, progress overlay, toasts, first-run prompt.
 */
'use strict';

const App = (() => {
  const progressCards = new Map();

  /* ======================================================= theming == */

  function setTheme(t) {
    document.body.dataset.theme = t === 'dark' ? 'dark' : 'light';
  }

  /* ===================================================== boot ======= */

  async function boot() {
    document.body.classList.add('booting');
    try {
      S.settings = await wx.getSettings();
    } catch (e) { S.settings = {}; }
    try {
      S.appInfo = await wx.appInfo();
    } catch (e) { S.appInfo = { home: '', version: '1.0.0' }; }

    wx.on('wx:theme', (t) => setTheme(t));
    wx.on('wx:settings', (data) => { S.settings = data; Nav.render(); refreshUI(); });
    wx.on('wx:dirChanged', (dir) => { onDirChanged(dir).catch(() => { }); });
    wx.on('wx:progress', (payload) => onProgress(payload));
    wx.on('wx:openPaths', (paths) => openPaths(paths));

    fillChromeIcons();
    wireWindowControls();
    wireKeys();

    Nav.init();
    Bar.init();
    View.init();
    DnD.init();
    applyPanes();

    const q = new URLSearchParams(location.search);
    const open = (q.get('open') || '').split('|').filter(Boolean);
    const demo = q.get('demo') || '';
    if (demo) { applyDemo(demo); applyPanes(); } /* re-apply: demo flags may toggle panes */

    let startTab = null;
    if (open.length) await openPaths(open, true);
    else if (demoLoc) startTab = newTab(demoLoc);
    else {
      const start = S.settings.openTo === 'thispc' ? thisPcLoc() : homeLoc();
      startTab = newTab(start);
    }
    if (startTab && demoFlags.sel && startTab.loadPromise) {
      startTab.loadPromise.then(() => {
        const v = startTab.visible || View.lastVisible;
        if (v && v.length) {
          selectOnly(startTab, v[0]);
          startTab.focusKey = keyOf(v[0]);
          View.renderActive();
          App.renderStatus();
          if (S.settings.previewPane) renderPreview();
        }
      }).catch(() => { });
    }

    renderStatus();
    document.body.classList.remove('booting');
    if (!demo) setTimeout(firstRunPrompt, 1100);
  }

  /* Demo states used by --demo=… for automated screenshots.
     Flags after '+': prev (preview pane), sel (select first item),
     grp (group by date), dark. */
  let demoLoc = null;
  const demoFlags = {};
  function applyDemo(demo) {
    const map = {
      home: homeLoc, thispc: thisPcLoc, bin: binLoc, gallery: galleryLoc, network: networkLoc
    };
    for (const part of demo.split('+').slice(1)) {
      demoFlags[part] = true;
      if (part.startsWith('view:')) S.settings.viewMode = part.slice(5);
    }
    const base = demo.split('+')[0];
    if (map[base]) demoLoc = map[base]();
    else if (base.startsWith('fs:')) demoLoc = fsLoc(base.slice(3));
    if (base.startsWith('view:')) S.settings.viewMode = base.slice(5);
    if (base === 'dark' || demoFlags.dark) setTheme('dark');
    if (demoFlags.prev) S.settings.previewPane = true;
    if (demoFlags.grp) S.settings.groupBy = 'date';
  }

  async function openPaths(paths, waitForFirst) {
    for (let i = 0; i < paths.length; i++) {
      let p = paths[i];
      if (p.startsWith('~')) p = ((S.appInfo && S.appInfo.home) || '') + p.slice(1);
      let st = null;
      try { st = await wx.stat(p); } catch (e) { continue; }
      const dir = st.isDir ? p : WXCore.dirname(p);
      const tab = newTab(fsLoc(dir));
      if (tab.loadPromise) await tab.loadPromise;
      if (!st.isDir) View.selectPath(tab, p);
    }
  }

  function openNewWindow() { wx.newWindow(null); }
  function openWindowWith(path) { wx.newWindow(path); }

  /* ================================================ window chrome == */

  const WIN_ICONS = {
    min: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" stroke-width="1"/></svg>',
    max: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
    restore: '<svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/><path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
    close: '<svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" stroke-width="1"/></svg>'
  };

  function fillChromeIcons() {
    const set = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };
    set('btnBack', I('back', '', 16));
    set('btnFwd', I('forward', '', 16));
    set('btnUp', I('up', '', 16));
    set('btnRefresh', I('refresh', '', 15));
    set('wMin', WIN_ICONS.min);
    set('wMax', WIN_ICONS.max);
    set('wClose', WIN_ICONS.close);
  }

  function wireWindowControls() {
    const min = document.getElementById('wMin');
    const max = document.getElementById('wMax');
    const close = document.getElementById('wClose');
    if (min) min.addEventListener('click', () => wx.window('min'));
    if (close) close.addEventListener('click', () => wx.window('close'));
    if (max) {
      max.addEventListener('click', async () => {
        wx.window('max');
        setTimeout(updateMaxIcon, 120);
      });
    }
    const tb = document.getElementById('titlebar');
    if (tb) tb.addEventListener('dblclick', (ev) => {
      if (ev.target.closest('.tab') || ev.target.closest('#wctl') || ev.target.closest('button')) return;
      wx.window('max');
      setTimeout(updateMaxIcon, 120);
    });
    window.addEventListener('focus', () => setTimeout(updateMaxIcon, 100));
    updateMaxIcon();
  }

  async function updateMaxIcon() {
    const max = document.getElementById('wMax');
    if (!max) return;
    try {
      const st = await wx.windowState();
      max.innerHTML = st && st.maximized ? WIN_ICONS.restore : WIN_ICONS.max;
      document.body.classList.toggle('maximized', !!(st && st.maximized));
    } catch (e) { /* ignore */ }
  }

  /* ==================================================== shortcuts === */

  function wireKeys() {
    /* type-to-select buffer (Explorer: typing jumps to the first match) */
    let typeBuf = '';
    let typeBufAt = 0;
    window.addEventListener('keydown', (ev) => {
      if (typeof Menus !== 'undefined' && MenusOpenGuard(ev)) return;
      const tab = curTab();
      const typing = isTypingTarget(ev);
      const ctrl = ev.ctrlKey || ev.metaKey;

      if (ev.key === 'Escape' && !typing) {
        typeBuf = ''; typeBufAt = 0;   /* Esc also cancels type-ahead */
        if (tab && tab.selection.size) { clearSelection(tab); View.renderActive(); renderStatus(); }
        return;
      }
      if (typing) return;
      if (!tab) return;

      const k = ev.key;

      /* type-to-select: letters/digits jump to the first matching item */
      if (!ctrl && !ev.altKey && k.length === 1 && /[a-z0-9]/i.test(k)) {
        ev.preventDefault();
        const now = Date.now();
        typeBuf = (now - typeBufAt < 900) ? typeBuf + k : k;
        typeBufAt = now;
        const list = (typeof View !== 'undefined' && View.lastVisible) || tab.visible || [];
        if (list.length) {
          const q = typeBuf.toLowerCase();
          let curIdx = -1;
          if (tab.focusKey !== null && tab.focusKey !== undefined) {
            curIdx = list.findIndex((e) => String(keyOf(e)) === String(tab.focusKey));
          }
          let idx = -1;
          if (typeBuf.length === 1) {
            /* single letter: cycle through matches after the current one */
            for (let n = 1; n <= list.length; n++) {
              const i = (curIdx + n + list.length) % list.length;
              if (String(list[i].name || '').toLowerCase().startsWith(q)) { idx = i; break; }
            }
          } else {
            idx = list.findIndex((e) => String(e.name || '').toLowerCase().startsWith(q));
            if (idx === -1) idx = curIdx;
          }
          if (idx !== -1) {
            const e = list[idx];
            tab.focusKey = keyOf(e);
            selectOnly(tab, e);
            View.renderActive();
            renderStatus();
          }
        }
        return;
      }

      /* tabs */
      if (ctrl && k.toLowerCase() === 't' && ev.shiftKey) { ev.preventDefault(); Actions.exec('tab.reopen'); return; }
      if (ctrl && k.toLowerCase() === 't') { ev.preventDefault(); newTab(homeLoc()); return; }
      if (ctrl && k.toLowerCase() === 'w') { ev.preventDefault(); closeTab(tab.id); return; }
      if (ctrl && k.toLowerCase() === 'n' && ev.shiftKey) { ev.preventDefault(); Actions.exec('file.newFolder'); return; }
      if (ctrl && k.toLowerCase() === 'n') { ev.preventDefault(); openWindowWith(pathOf(tab.loc)); return; }
      if (ctrl && k === 'Tab') { ev.preventDefault(); cycleTab(ev.shiftKey ? -1 : 1); return; }
      if (ctrl && /^[1-9]$/.test(k)) {
        ev.preventDefault();
        if (k === '9') activateTab(S.tabs[S.tabs.length - 1].id);
        else gotoTabNumber(parseInt(k, 10));
        return;
      }

      /* navigation */
      if (ev.altKey && k === 'ArrowLeft') { ev.preventDefault(); goBack(); return; }
      if (ev.altKey && k === 'ArrowRight') { ev.preventDefault(); goForward(); return; }
      if (ev.altKey && k === 'ArrowUp') { ev.preventDefault(); goUp(); return; }
      if (ev.altKey && k.toLowerCase() === 'd') { ev.preventDefault(); Bar.focusAddress(); return; }
      if (ev.altKey && k === 'Enter') { ev.preventDefault(); Actions.exec('file.properties'); return; }
      if (k === 'F5' || (ctrl && k.toLowerCase() === 'r')) { ev.preventDefault(); refreshTab(tab); return; }
      if (k === 'Backspace') { ev.preventDefault(); goBack(); return; }

      /* address / search */
      if (ctrl && k.toLowerCase() === 'l') { ev.preventDefault(); Bar.focusAddress(); return; }
      if (ctrl && (k.toLowerCase() === 'e' || k.toLowerCase() === 'f')) { ev.preventDefault(); Bar.focusSearch(); return; }
      if (k === 'F4') { ev.preventDefault(); Bar.addrDropdown(); return; }

      /* edit */
      if (ctrl && !ev.shiftKey && k.toLowerCase() === 'a') { ev.preventDefault(); Actions.exec('edit.selectAll'); return; }
      if (ctrl && k.toLowerCase() === 'x') { ev.preventDefault(); Actions.exec('edit.cut'); return; }
      if (ctrl && k.toLowerCase() === 'c') { ev.preventDefault(); Actions.exec('edit.copy'); return; }
      if (ctrl && k.toLowerCase() === 'v') { ev.preventDefault(); Actions.exec('edit.paste'); return; }
      if (ctrl && !ev.shiftKey && k.toLowerCase() === 'z') { ev.preventDefault(); Actions.exec('edit.undo'); return; }
      if (ctrl && !ev.shiftKey && k.toLowerCase() === 'y') { ev.preventDefault(); Actions.exec('edit.redo'); return; }
      if (ev.shiftKey && k.toLowerCase() === 'z' && ctrl) { ev.preventDefault(); Actions.exec('edit.redo'); return; }

      /* items */
      if (k === 'F2') { ev.preventDefault(); View.beginRename(tab); return; }
      if (k === 'Delete' && ev.shiftKey) { ev.preventDefault(); Actions.exec('edit.deletePermanent'); return; }
      if (k === 'Delete') { ev.preventDefault(); Actions.exec('edit.delete'); return; }
      if (k === 'Enter') {
        ev.preventDefault();
        const sel = selectedEntries(tab);
        if (sel.length) { Ops.openEntries(sel, { tab }); return; }
        const fe = View.focusedEntry(tab);
        if (fe) Ops.openEntries([fe], { tab });
        return;
      }

      /* arrow / page navigation (Explorer semantics) */
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
        ev.preventDefault();
        const mode = ev.shiftKey ? 'extend' : (ev.ctrlKey ? 'focus' : 'select');
        View.nav(k.slice(5).toLowerCase(), mode);
        return;
      }
      if (k === 'PageUp' || k === 'PageDown') {
        ev.preventDefault();
        View.nav(k.toLowerCase(), ev.shiftKey ? 'extend' : 'select');
        return;
      }
      if (k === 'Home') { ev.preventDefault(); View.nav('home', ev.shiftKey ? 'extend' : 'select'); return; }
      if (k === 'End') { ev.preventDefault(); View.nav('end', ev.shiftKey ? 'extend' : 'select'); return; }
      if (ctrl && k === ' ') {
        ev.preventDefault();
        const fe = View.focusedEntry(tab);
        if (fe) { toggleSelect(tab, fe); View.renderActive(); renderStatus(); }
        return;
      }
      if (ev.altKey && !ev.shiftKey && k.toLowerCase() === 'p') { ev.preventDefault(); Actions.exec('view.togglePreviewPane'); return; }
      if (ev.altKey && ev.shiftKey && k.toLowerCase() === 'p') { ev.preventDefault(); Actions.exec('view.toggleDetailsPane'); return; }

      /* view switching like Windows: Ctrl+Shift+1..8? not standard — skip */
    });
  }

  /* While a menu owns the keyboard, View/App handlers stay out of the way. */
  function MenusOpenGuard(ev) { return false; }

  /* ================================================= status bar ===== */

  async function renderStatus() {
    const el = document.getElementById('statusText');
    const right = document.getElementById('statusRight');
    if (!el) return;
    const tab = curTab();
    if (!tab) { el.textContent = ''; return; }

    let text = '';
    if (tab.loading) text = 'Loading…';
    else if (tab.error) text = tab.error.message || 'Error';
    else if (tab.loc.kind === 'results') {
      const n = (tab.results && tab.results.results) ? tab.results.results.length : 0;
      text = pluralize(n, 'item') + ' found in ' + tab.loc.query + (tab.results && tab.results.truncated ? ' (search stopped early)' : '');
    } else if (tab.loc.kind === 'fs') {
      const vis = tab.visible || View.lastVisible || [];
      const sel = tab.selection.size;
      if (sel) {
        let bytes = 0;
        for (const en of selectedEntries(tab)) if (!en.isDir) bytes += en.size || 0;
        text = pluralize(vis.length, 'item') + ', ' + pluralize(sel, 'item') + ' selected' +
          (bytes ? ' (' + formatSize(bytes) + ')' : '');
      } else {
        text = pluralize(vis.length, 'item');
      }
    } else if (tab.loc.kind === 'bin') {
      const n = tab.data && tab.data.items ? tab.data.items.length : 0;
      text = pluralize(n, 'item') + (n ? '' : ' — the Recycle Bin is empty');
    } else if (tab.loc.kind === 'home') {
      text = 'Quick access';
    } else if (tab.loc.kind === 'thispc') {
      const d = tab.data || {};
      text = pluralize((d.drives || []).length + (d.ejected || []).length, 'drive');
    } else if (tab.loc.kind === 'gallery') {
      text = pluralize((tab.data && tab.data.items ? tab.data.items.length : 0), 'picture');
    } else if (tab.loc.kind === 'network') {
      text = pluralize((tab.data && tab.data.items ? tab.data.items.length : 0), 'network location');
    }
    el.textContent = text;

    if (right) {
      const path = pathOf(tab.loc);
      if (path) {
        try {
          const fs2 = await wx.freeSpace(path);
          if (fs2 && curTab() === tab) {
            right.textContent = formatSize(fs2.free) + ' free';
          } else right.textContent = '';
        } catch (e) { right.textContent = ''; }
      } else right.textContent = '';
    }

    renderDetailsPane();
    if (S.settings.previewPane) renderPreview();
  }

  function renderDetailsPane() {
    const pane = document.getElementById('detailsPane');
    if (!pane) return;
    const tab = curTab();
    pane.innerHTML = '';
    if (!tab) return;
    const sel = selectedEntries(tab);
    const wrap = h('div', { class: 'dp-inner' });

    if (sel.length === 1) {
      const e = sel[0];
      const info = WXCore.typeInfo(e.name, e.isDir, e.mode);
      wrap.appendChild(h('div', { class: 'dp-hero' },
        h('span', { class: 'icowrap s48', html: e.isDir ? folderSvg() : entryIcon(e) }),
        h('div', { class: 'dp-name', text: e.name })));
      wrap.appendChild(h('div', { class: 'dp-rows' },
        h('div', { class: 'dp-row' }, h('span', { text: 'Type' }), h('span', { text: info.label })),
        h('div', { class: 'dp-row' }, h('span', { text: 'Size' }), h('span', { text: e.isDir ? '—' : formatSize(e.size) })),
        h('div', { class: 'dp-row' }, h('span', { text: 'Modified' }), h('span', { text: formatDate(e.mtime) })),
        h('div', { class: 'dp-row' }, h('span', { text: 'Location' }), h('span', { text: WXCore.dirname(e.path || '') }))));
      if (isImageEntry(e)) {
        wrap.appendChild(h('img', { class: 'dp-thumb', src: fileUrl(e.path), alt: '', onerror: function () { this.remove(); } }));
      }
    } else if (sel.length > 1) {
      let size = 0;
      let dirs = 0;
      for (const e of sel) { if (e.isDir) dirs++; else size += e.size || 0; }
      wrap.appendChild(h('div', { class: 'dp-hero' },
        h('span', { class: 'icowrap s48', html: folderSvg() }),
        h('div', { class: 'dp-name', text: pluralize(sel.length, 'item') + ' selected' })));
      wrap.appendChild(h('div', { class: 'dp-rows' },
        h('div', { class: 'dp-row' }, h('span', { text: 'Folders' }), h('span', { text: String(dirs) })),
        h('div', { class: 'dp-row' }, h('span', { text: 'Files' }), h('span', { text: String(sel.length - dirs) })),
        h('div', { class: 'dp-row' }, h('span', { text: 'Total size' }), h('span', { text: formatSize(size) }))));
    } else {
      const loc = tab.loc;
      wrap.appendChild(h('div', { class: 'dp-hero' },
        h('span', { class: 'icowrap s48', html: loc.kind === 'fs' ? folderSvg() : I(locIconName(loc), '', 44) }),
        h('div', { class: 'dp-name', text: locTitle(loc) })));
      if (loc.kind === 'fs') {
        const vis = tab.visible || [];
        wrap.appendChild(h('div', { class: 'dp-rows' },
          h('div', { class: 'dp-row' }, h('span', { text: 'Items' }), h('span', { text: String(vis.length) })),
          h('div', { class: 'dp-row' }, h('span', { text: 'Path' }), h('span', { text: loc.path }))));
      }
    }
    pane.appendChild(wrap);
  }

  /* ================================================ preview pane ==== */

  function isTexty(e) {
    if (e.isDir) return false;
    const t = WXCore.typeInfo(e.name, false, e.mode);
    return (t.cat === 'text' || t.cat === 'code') && (e.size || 0) < 5 * 1024 * 1024;
  }

  function pvFallback(box, e) {
    box.innerHTML = '';
    box.appendChild(h('div', { class: 'pv-icon', html: e.isDir ? folderSvg() : entryIcon(e) }));
    const rows = h('div', { class: 'pv-rows' });
    const add = (k, v) => { if (v) rows.appendChild(h('div', { class: 'pv-row' }, h('span', { text: k }), h('span', { text: v }))); };
    add('Type', e.isDir ? 'File folder' : WXCore.typeWithExt(WXCore.typeInfo(e.name, false, e.mode)));
    add('Size', e.isDir ? '' : WXCore.fmtBytesFull(e.size || 0) + ' (' + formatSize(e.size || 0) + ')');
    add('Modified', WXCore.fmtDateTimeSec(e.mtime));
    add('Location', WXCore.dirname(e.path || ''));
    box.appendChild(rows);
  }

  function renderPreview() {
    const pane = document.getElementById('previewPane');
    if (!pane) return;
    pane.innerHTML = '';
    const tab = curTab();
    if (!tab) return;
    const sel = selectedEntries(tab);
    if (!sel.length) {
      pane.appendChild(h('div', { class: 'pv-empty' },
        h('div', { class: 'pv-empty-ico', html: I('gallery', '', 44) }),
        h('div', { class: 'pv-empty-title', text: 'Select a file to preview' }),
        h('div', { class: 'pv-empty-sub', text: 'Alt+P toggles the preview pane' })));
      return;
    }
    if (sel.length > 1) {
      pane.appendChild(h('div', { class: 'pv-empty' },
        h('div', { class: 'pv-empty-ico', html: folderSvg() }),
        h('div', { class: 'pv-empty-title', text: pluralize(sel.length, 'item') + ' selected' })));
      return;
    }
    const e = sel[0];
    pane.appendChild(h('div', { class: 'pv-head' },
      h('div', { class: 'pv-name', text: e.name }),
      h('div', {
        class: 'pv-meta',
        text: (e.isDir ? 'File folder' : WXCore.typeWithExt(WXCore.typeInfo(e.name, false, e.mode))) +
          (e.isDir ? '' : ' · ' + formatSize(e.size || 0))
      })));
    const box = h('div', { class: 'pv-box' });
    pane.appendChild(box);
    const ext = WXCore.extname(e.name);
    const typeCat = WXCore.EXT_TYPES[ext] ? WXCore.EXT_TYPES[ext][1] : '';
    if (isImageEntry(e)) {
      box.appendChild(h('img', {
        class: 'pv-img', src: fileUrl(e.path), alt: '',
        onerror: function () { pvFallback(box, e); }
      }));
    } else if (!e.isDir && WXCore.VIDEO_EXTS.has(ext)) {
      box.appendChild(h('video', { class: 'pv-media', src: fileUrl(e.path), controls: true, preload: 'metadata' }));
    } else if (!e.isDir && typeCat === 'audio') {
      box.appendChild(h('audio', { class: 'pv-audio', src: fileUrl(e.path), controls: true, preload: 'metadata' }));
    } else if (isTexty(e)) {
      box.appendChild(h('div', { class: 'pv-loading', text: 'Loading preview…' }));
      wx.readText(e.path, 120 * 1024).then((r) => {
        box.innerHTML = '';
        box.appendChild(h('pre', { class: 'pv-text', text: r.text }));
        if (r.truncated) box.appendChild(h('div', { class: 'pv-trunc', text: '…preview truncated' }));
      }).catch(() => pvFallback(box, e));
    } else {
      pvFallback(box, e);
    }
    pane.appendChild(h('div', { class: 'pv-foot', text: e.path || '' }));
  }

  function applyPanes() {
    document.body.classList.toggle('with-details', !!S.settings.detailsPane);
    document.body.classList.toggle('with-preview', !!S.settings.previewPane);
    const pv = document.getElementById('previewPane');
    if (pv && S.settings.previewWidth) pv.style.setProperty('--pv-w', S.settings.previewWidth + 'px');
    if (S.settings.previewPane) renderPreview();
  }

  function afterTabChange() {
    Bar.renderAll();
    refreshUI();
  }

  /* ================================================ progress + toasts */

  function showProgress(id, label) {
    const host = document.getElementById('progressHost');
    if (!host) return;
    const card = h('div', { class: 'prog-card', dataset: { id } },
      h('div', { class: 'prog-label', text: label || 'Working…' }),
      h('div', { class: 'prog-current', text: '' }),
      h('div', { class: 'prog-bar' }, h('div', { class: 'prog-fill indeterminate' })),
      h('div', { class: 'prog-buttons' },
        h('button', {
          class: 'dbtn', text: 'Cancel',
          onclick: () => { wx.cancelOp(id); }
        })));
    host.appendChild(card);
    progressCards.set(id, card);
  }

  function hideProgress(id) {
    const card = progressCards.get(id);
    if (card) { card.remove(); progressCards.delete(id); }
  }

  function onProgress(p) {
    if (!p || !p.id) return;
    const card = progressCards.get(p.id);
    if (!card) return;
    const label = card.querySelector('.prog-label');
    const cur = card.querySelector('.prog-current');
    const fill = card.querySelector('.prog-fill');
    if (label && p.phase && p.phase !== 'working') label.textContent = p.phase + '…';
    if (cur) cur.textContent = p.current ? WXCore.basename(p.current) : '';
    if (fill) {
      if (p.total) {
        fill.classList.remove('indeterminate');
        fill.style.width = Math.min(100, Math.round(((p.done || 0) / p.total) * 100)) + '%';
      } else {
        fill.classList.add('indeterminate');
      }
    }
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  /* ================================================ first-run prompt = */

  async function firstRunPrompt() {
    try {
      if (S.settings.askedDefault) return;
      const st = await wx.askState();
      if (st && st.postinstAsked) return;
      Dlgs.defaultPrompt();
    } catch (e) { console.error('[firstRunPrompt]', e); }
  }

  document.addEventListener('DOMContentLoaded', () => { boot().catch((e) => console.error('[boot]', e)); });

  return {
    boot, renderStatus, applyPanes, afterTabChange,
    showProgress, hideProgress, toast,
    openNewWindow, openWindowWith, setTheme
  };
})();
