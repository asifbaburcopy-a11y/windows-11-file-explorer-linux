/*
 * render.js — content rendering for every location kind and view mode.
 * Windows Explorer views: Extra large / Large / Medium / Small icons,
 * List, Details, Tiles, Content. Plus Home, This PC, Recycle Bin,
 * Gallery, Network and search-results rendering.
 */
'use strict';

const View = (() => {
  let lastVisible = [];
  let displayedTabId = null;
  let renaming = false;

  const contentEl = () => document.getElementById('content');

  /* ---------------------------------------------------------- pipeline */

  function poolFor(tab) {
    if (tab.loc.kind === 'results') return (tab.results && tab.results.results) || [];
    if (tab.loc.kind === 'fs') return tab.entries || [];
    return null;
  }

  function computeVisible(tab) {
    let list = poolFor(tab) || [];
    for (const e of list) if (e.key === undefined) e.key = e.path || e.name;
    if (tab.filter) {
      const f = tab.filter.toLowerCase();
      list = list.filter((e) => String(e.name).toLowerCase().includes(f));
    }
    if (tab.loc.kind !== 'bin') list = WXCore.sortEntries(list, tab.sortBy, tab.sortAsc);
    lastVisible = list;
    tab.visible = list;
    return list;
  }

  /* --------------------------------------------------------- columns */

  function columnsFor(tab) {
    const k = tab.loc.kind;
    if (k === 'results') return [
      { id: 'name', label: 'Name', flex: 1, min: 200 },
      { id: 'date', label: 'Date modified', w: 170 },
      { id: 'type', label: 'Type', w: 150 },
      { id: 'size', label: 'Size', w: 96, right: true },
      { id: 'folder', label: 'Folder', w: 240, nosort: true }
    ];
    if (k === 'bin') return [
      { id: 'name', label: 'Name', flex: 1, min: 200 },
      { id: 'folder', label: 'Original location', w: 260, nosort: true },
      { id: 'date', label: 'Date deleted', w: 170 },
      { id: 'type', label: 'Type', w: 150 },
      { id: 'size', label: 'Size', w: 96, right: true }
    ];
    /* fs folders: user-selectable column set (right-click a header). */
    const ALL = {
      name: { id: 'name', label: 'Name', flex: 1, min: 200 },
      date: { id: 'date', label: 'Date modified', w: 170 },
      created: { id: 'created', label: 'Date created', w: 170 },
      type: { id: 'type', label: 'Type', w: 150 },
      size: { id: 'size', label: 'Size', w: 96, right: true }
    };
    const want = (S.settings.detailsCols && S.settings.detailsCols.length)
      ? S.settings.detailsCols : ['name', 'date', 'type', 'size'];
    return want.map((id) => ALL[id]).filter(Boolean);
  }

  function colWidth(col) {
    if (col.flex) {
      const ovf = S.settings.detailsWidths && S.settings.detailsWidths[col.id];
      if (ovf) return ovf + 'px';
      return '1fr';
    }
    const ov = S.settings.detailsWidths && S.settings.detailsWidths[col.id];
    return (ov || col.w) + 'px';
  }

  function headerHtml(tab) {
    const cols = columnsFor(tab);
    let html = '<div class="colhead" style="grid-template-columns:' + cols.map(colWidth).join(' ') + '">';
    for (let ci = 0; ci < cols.length; ci++) {
      const c = cols[ci];
      const sorted = !c.nosort && tab.sortBy === c.id;
      html += '<div class="ch' + (c.right ? ' right' : '') + (sorted ? ' sorted' : '') +
        (c.nosort ? ' nosort' : '') + '" data-col="' + c.id + '">' +
        '<span>' + esc(c.label) + '</span>' +
        (sorted ? '<span class="sortarrow">' + I(tab.sortAsc ? 'chevronU' : 'chevronD', '', 11) + '</span>' : '') +
        (ci < cols.length - 1 ? '<div class="ch-div" data-col="' + c.id + '" title="Drag to resize — double-click to fit"></div>' : '') +
        '</div>';
    }
    return html + '</div>';
  }

  function cellHtml(tab, e) {
    const info = WXCore.typeInfo(e.name, e.isDir, e.mode);
    const typeLabel = WXCore.typeWithExt(info, e.name);
    const cols = columnsFor(tab);
    const vals = {
      name: null,
      date: e.isDir && tab.loc.kind !== 'bin' ? '' : formatDate(tab.loc.kind === 'bin' ? e.deletedAt : e.mtime),
      created: formatDate(e.ctime),
      type: tab.loc.kind === 'bin' ? WXCore.typeWithExt(WXCore.typeInfo(e.name, e.isDir, 0), e.name) : typeLabel,
      size: e.isDir ? '' : formatSize(e.size),
      folder: tab.loc.kind === 'results' ? (e.folder || '') : (e.origPath || '')
    };
    let out = '';
    for (const c of cols) {
      if (c.id === 'name') {
        out += '<div class="cell c-name">' +
          '<span class="icowrap">' + entryIcon(e) + thumbHtml(e, 'sm') + '</span>' +
          '<span class="nm">' + esc(displayName(e)) + '</span>' +
          (e.isLink ? '<span class="linkbadge" title="Shortcut"></span>' : '') +
          '</div>';
      } else {
        out += '<div class="cell c-' + c.id + (c.right ? ' right' : '') + '">' + esc(vals[c.id] ?? '') + '</div>';
      }
    }
    return out;
  }

  function displayName(e) {
    if (S.settings.showExtensions) return e.name;
    return WXCore.splitName(e.name)[0] || e.name;
  }

  function thumbHtml(e, size, allowVideo) {
    if (S.settings.neverThumbs) return '';
    if (isImageEntry(e)) {
      return '<img class="thumb" src="' + fileUrl(e.path) + '" loading="lazy" decoding="async" alt=""' +
        ' onerror="this.remove()">';
    }
    if (allowVideo && WXCore.VIDEO_EXTS.has(WXCore.extname(e.name))) {
      /* Windows shows video thumbnails; Chromium paints a frame after seek. */
      return '<video class="thumb vthumb" src="' + fileUrl(e.path) + '" preload="metadata" muted playsinline' +
        ' onloadedmetadata="this.currentTime=Math.min(1.0,(isFinite(this.duration)?this.duration:3)/3)"' +
        ' onerror="this.remove()"></video>';
    }
    return '';
  }

  /* Hover tooltip like Explorer: name, type, size, modified/deleted. */
  function tooltipFor(tab, e) {
    const info = WXCore.typeInfo(e.name, e.isDir, e.mode);
    const lines = [e.name, ''];
    lines.push(e.isDir ? 'File folder' : WXCore.typeWithExt(info, e.name));
    if (!e.isDir) lines.push('Size: ' + WXCore.fmtBytesFull(e.size || 0) + ' (' + formatSize(e.size || 0) + ')');
    if (tab.loc.kind === 'bin') {
      if (e.origPath) lines.push('Original location: ' + e.origPath);
      lines.push('Date deleted: ' + WXCore.fmtDateTimeSec(e.deletedAt));
    } else {
      lines.push('Date modified: ' + WXCore.fmtDateTimeSec(e.mtime));
    }
    return lines.join('\n');
  }

  /* ------------------------------------------------------- item nodes */

  function itemNode(tab, e) {
    const view = tab.view;
    const cls = ['it'];
    const selected = tab.selection.has(keyOf(e));
    if (selected) cls.push('sel');
    if (e.isDir) cls.push('dir');
    if (S.clipboard && S.clipboard.mode === 'cut' && S.clipboard.paths.includes(e.path)) cls.push('cut');
    if (tab.focusKey !== null && tab.focusKey !== undefined && String(keyOf(e)) === String(tab.focusKey)) cls.push('kf');
    const node = document.createElement('div');
    node.className = cls.join(' ');
    node.dataset.k = String(keyOf(e));
    node._entry = e;
    node.title = tooltipFor(tab, e);

    if (view === 'details') {
      node.innerHTML = cellHtml(tab, e);
      node.style.gridTemplateColumns = columnsFor(tab).map(colWidth).join(' ');
      return node;
    }

    const iconSize = view === 'xl' ? 96 : view === 'lg' ? 64 : view === 'md' ? 48 : view === 'sm' ? 20 : view === 'tiles' ? 40 : 32;
    const showThumb = (view === 'xl' || view === 'lg' || view === 'md' || view === 'tiles' || view === 'content');
    const info = WXCore.typeInfo(e.name, e.isDir, e.mode);

    if (view === 'list') {
      node.innerHTML = '<span class="icowrap s20">' + entryIcon(e) + thumbHtml(e, 'xs') + '</span>' +
        '<span class="nm">' + esc(displayName(e)) + '</span>';
      return node;
    }

    if (view === 'tiles') {
      node.innerHTML = '<span class="icowrap s40">' + entryIcon(e) + (showThumb ? thumbHtml(e, 'md', true) : '') + '</span>' +
        '<span class="tl"><span class="nm">' + esc(displayName(e)) + '</span>' +
        '<span class="sub">' + esc(e.isDir ? pluralize(countApprox(e), 'item') : info.label) +
        (e.isDir ? '' : ' · ' + formatSize(e.size)) + '</span>' +
        '<span class="sub2">' + esc(formatDate(e.mtime)) + '</span></span>';
      return node;
    }

    if (view === 'content') {
      node.innerHTML = '<span class="icowrap s32">' + entryIcon(e) + (showThumb ? thumbHtml(e, 'md', true) : '') + '</span>' +
        '<span class="tl"><span class="nm">' + esc(displayName(e)) + '</span>' +
        '<span class="sub">' + esc((e.isDir ? 'File folder' : info.label) + ' · ' +
          (e.isDir ? formatDate(e.mtime) : formatSize(e.size) + ' · ' + formatDate(e.mtime))) + '</span></span>';
      return node;
    }

    /* icon grid views: xl / lg / md / sm */
    node.innerHTML =
      '<span class="icowrap s' + iconSize + '">' + entryIcon(e) + (showThumb ? thumbHtml(e, view, true) : '') + '</span>' +
      '<span class="nm">' + esc(displayName(e)) + '</span>';
    return node;
  }

  function countApprox(e) { return e.__count || 0; }

  /* -------------------------------------------------------- containers */

  function itemsContainer(tab) {
    const div = document.createElement('div');
    div.className = 'items v-' + tab.view;
    div.style.setProperty('--cn', '1fr');
    return div;
  }

  function mountItems(tab, list, root) {
    if (tab.view === 'details') root.innerHTML = headerHtml(tab);
    else root.innerHTML = '';
    const groups = WXCore.groupEntries(list, tab.groupBy);
    const wrap = document.createElement('div');
    wrap.className = 'items-wrap';
    if (!groups) {
      const c = itemsContainer(tab);
      for (const e of list) c.appendChild(itemNode(tab, e));
      wrap.appendChild(c);
    } else {
      for (const g of groups) {
        const collapsed = tab.collapsedGroups.has(g.label);
        const gh = document.createElement('div');
        gh.className = 'grp-head' + (collapsed ? ' collapsed' : '');
        gh.innerHTML = '<span class="grp-arrow">' + I('chevronR', '', 12) + '</span>' +
          '<span class="glabel">' + esc(g.label) + '</span><span class="gcount">' +
          pluralize(g.items.length, 'item') + '</span>';
        gh.addEventListener('click', () => {
          if (tab.collapsedGroups.has(g.label)) tab.collapsedGroups.delete(g.label);
          else tab.collapsedGroups.add(g.label);
          renderActive();
        });
        wrap.appendChild(gh);
        if (collapsed) continue;
        const c = itemsContainer(tab);
        for (const e of g.items) c.appendChild(itemNode(tab, e));
        wrap.appendChild(c);
      }
    }
    root.appendChild(wrap);
  }

  /* ================================================== special pages === */

  function section(title, action) {
    const head = h('div', { class: 'sec-head' }, h('span', { class: 'sec-title', text: title }),
      action || null);
    return head;
  }

  function plainItem(tab, e, cls) {
    const node = itemNode(tab, Object.assign({ key: undefined }, e, { key: e.key !== undefined ? e.key : (e.path || e.name) }));
    if (cls) node.classList.add(cls);
    return node;
  }

  /* ------------------------------------------------------------- Home */

  function renderHome(tab, root) {
    const data = tab.data || {};
    const pins = data.pinned || [];

    const sec1 = h('div', { class: 'sec' });
    sec1.appendChild(section('Pinned'));
    if (!pins.length) {
      sec1.appendChild(h('div', { class: 'hint', text: 'Right-click a folder in the navigation pane and choose “Pin to Home”.' }));
    }
    const pinGrid = h('div', { class: 'items v-md pins' });
    for (const p of pins) {
      const node = h('div', { class: 'it pin', dataset: { k: p.path, path: p.path } });
      node._entry = Object.assign({ key: p.path, isDir: true, path: p.path, name: p.name }, p);
      node.innerHTML = '<span class="icowrap s48">' + folderSvg() + '</span>' +
        '<span class="nm">' + esc(p.name) + '</span>' +
        '<button class="pinbtn" title="Unpin from Home">' + I('unpin', '', 14) + '</button>';
      node.addEventListener('click', (ev) => {
        if (ev.target.closest('.pinbtn')) { ev.stopPropagation(); Ops.togglePin(p.path); }
      });
      pinGrid.appendChild(node);
    }
    sec1.appendChild(pinGrid);
    root.appendChild(sec1);
    root.appendChild(h('div', { class: 'sec-end' }));
  }

  /* ---------------------------------------------------------- This PC */

  const KNOWN_FOLDERS = ['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos'];

  function renderThisPc(tab, root) {
    const data = tab.data || {};
    const home = (S.appInfo && S.appInfo.home) || '';

    const fsec = h('div', { class: 'sec' });
    fsec.appendChild(section('Folders'));
    const fgrid = h('div', { class: 'items v-md pins' });
    const folders = (data.folders && data.folders.length)
      ? data.folders
      : KNOWN_FOLDERS.map((n) => ({ name: n, path: home + '/' + n }));
    for (const f of folders) {
      const p = f.path;
      const e = { key: p, path: p, name: f.name, isDir: true };
      const node = h('div', { class: 'it pin', dataset: { k: p, path: p } });
      node._entry = e;
      node.innerHTML = '<span class="icowrap s48">' + folderSvg() + '</span><span class="nm">' + esc(f.name) + '</span>';
      fgrid.appendChild(node);
    }
    fsec.appendChild(fgrid);
    root.appendChild(fsec);

    const dsec = h('div', { class: 'sec' });
    dsec.appendChild(section('Devices and drives'));
    const drives = (data.drives || []).concat(data.ejected || []);
    if (!drives.length) dsec.appendChild(h('div', { class: 'hint', text: 'No drives found.' }));
    const dgrid = h('div', { class: 'drives' });
    for (const d of drives) {
      const card = h('div', { class: 'drive' + (d.ejected ? ' ejected' : '') });
      card._drive = d;
      const total = d.size || 0;
      const free = d.free || 0;
      const capHtml = d.ejected
        ? '<div class="dsub">Not mounted</div>'
        : '<div class="capbar"><div class="capfill' + (d.usedPct >= 92 ? ' danger' : '') +
          '" style="width:' + (d.usedPct || 0) + '%"></div></div>' +
          '<div class="dsub">' + esc(formatSize(free)) + ' free of ' + esc(WXCore.fmtDriveSize(total)) + '</div>';
      card.innerHTML =
        '<div class="drow">' + (d.ejected ? usbSvg('s40') : driveSvg('s40', d.removable)) +
        '<div class="dinfo"><div class="dname">' + esc(d.name || d.device || 'Drive') + '</div>' +
        '<div class="dmeta">' + esc(d.ejected ? (d.device || '') : (d.fstype || '') +
          (d.mount && !d.isRoot ? '  ·  ' + d.mount : (d.isRoot ? '  ·  /' : ''))) + '</div></div></div>' + capHtml;
      dgrid.appendChild(card);
    }
    dsec.appendChild(dgrid);
    root.appendChild(dsec);

    const nsec = h('div', { class: 'sec' });
    nsec.appendChild(section('Network locations'));
    const nets = data.network || [];
    if (nets.length) {
      const ngrid = h('div', { class: 'items v-md pins' });
      for (const n of nets) {
        const e = { key: n.path, path: n.path, name: n.name, isDir: true };
        const node = h('div', { class: 'it pin', dataset: { k: e.key, path: e.path } });
        node._entry = e;
        node.innerHTML = '<span class="icowrap s48">' + folderSvg() + '</span><span class="nm">' + esc(n.name) + '</span>';
        ngrid.appendChild(node);
      }
      nsec.appendChild(ngrid);
    } else {
      nsec.appendChild(h('div', { class: 'hint', text: 'Mapped network drives and media devices appear here.' }));
    }
    root.appendChild(nsec);
    root.appendChild(h('div', { class: 'sec-end' }));
  }

  /* ------------------------------------------------------ Recycle Bin */

  function binPseudoItems(tab) {
    const items = ((tab.data && tab.data.items) || []).slice();
    for (const it of items) {
      it.key = it.id;
      it.path = ((S.appInfo && S.appInfo.home) || '') + '/.local/share/Trash/files/' + it.id;
      it.mtime = it.deletedAt;
    }
    const key = tab.sortBy;
    if (key === 'date' || key === 'name') {
      // Windows: newest deleted first by default; explicit date click toggles.
      if (key === 'name') items.sort((a, b) => b.deletedAt - a.deletedAt);
      else items.sort((a, b) => tab.sortAsc ? a.deletedAt - b.deletedAt : b.deletedAt - a.deletedAt);
    } else {
      const sorted = WXCore.sortEntries(items, key, tab.sortAsc);
      items.length = 0;
      items.push(...sorted);
    }
    lastVisible = items;
    tab.visible = items;
    return items;
  }

  function renderBin(tab, root) {
    const items = binPseudoItems(tab);
    if (!items.length) {
      root.appendChild(h('div', { class: 'empty-state' },
        h('div', { class: 'es-ico', html: I('trash', '', 64) }),
        h('div', { class: 'es-title', text: 'The Recycle Bin is empty' }),
        h('div', { class: 'es-sub', text: 'Items you delete will appear here until you empty it.' })));
      return;
    }
    mountItems(tab, items, root);
  }

  /* ---------------------------------------------------------- Gallery */

  function monthLabel(ms) {
    const d = new Date(ms || Date.now());
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function renderGallery(tab, root) {
    const items = (tab.data && tab.data.items) || [];
    if (!items.length) {
      root.appendChild(h('div', { class: 'empty-state' },
        h('div', { class: 'es-ico', html: I('gallery', '', 64) }),
        h('div', { class: 'es-title', text: 'No pictures found' }),
        h('div', { class: 'es-sub', text: 'Gallery shows images from your Pictures folder.' })));
      return;
    }
    const groups = new Map();
    for (const it of items) {
      const k = monthLabel(it.mtime);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    for (const [label, group] of groups) {
      const gh = h('div', { class: 'grp-head' },
        h('span', { class: 'glabel', text: label }),
        h('span', { class: 'gcount', text: pluralize(group.length, 'picture') }));
      root.appendChild(gh);
      const grid = h('div', { class: 'items v-xl gallery' });
      for (const it of group) {
        const e = Object.assign({}, it, { key: it.path, isDir: false });
        const node = h('div', { class: 'it', dataset: { k: e.key, path: e.path } });
        node._entry = e;
        node.innerHTML = '<span class="icowrap s96"><span class="fb">' + entryIcon(e) + '</span>' +
          '<img class="thumb" src="' + fileUrl(it.path) + '" loading="lazy" decoding="async" alt=""' +
          ' onerror="this.remove()"></span>' +
          '<span class="nm">' + esc(it.name) + '</span>';
        grid.appendChild(node);
      }
      root.appendChild(grid);
    }
  }

  /* ---------------------------------------------------------- Network */

  function renderNetwork(tab, root) {
    const items = (tab.data && tab.data.items) || [];
    if (!items.length) {
      root.appendChild(h('div', { class: 'empty-state' },
        h('div', { class: 'es-ico', html: I('network', '', 64) }),
        h('div', { class: 'es-title', text: 'No network locations' }),
        h('div', { class: 'es-sub', text: 'Mapped shares (SMB/SFTP) from your desktop appear here.' })));
      return;
    }
    const list = items.map((n) => Object.assign({}, n, { key: n.path, isDir: true }));
    lastVisible = list;
    tab.visible = list;
    mountItems(tab, list, root);
  }

  /* ----------------------------------------------------------- states */

  function renderError(tab, root, err) {
    const missing = !!(err && err.code === 'ENOENT');
    root.appendChild(h('div', { class: 'empty-state error' },
      h('div', { class: 'es-ico', html: I('warning', '', 64) }),
      h('div', { class: 'es-title', text: err && err.message ? err.message : 'Something went wrong' }),
      (err && err.code && !missing) ? h('div', { class: 'es-sub', text: 'Error code: ' + err.code }) : null,
      h('div', { class: 'es-actions' },
        missing ? h('button', { class: 'btn', text: 'Go to Home', onclick: () => navigate(homeLoc()) }) : null,
        h('button', { class: 'btn', text: 'Try again', onclick: () => refreshTab(tab) }))));
  }

  function renderEmptyFs(tab, root) {
    if (tab.loc.kind === 'results') {
      root.appendChild(h('div', { class: 'empty-state' },
        h('div', { class: 'es-ico', html: I('search', '', 64) }),
        h('div', { class: 'es-title', text: 'No items match your search.' }),
        h('div', { class: 'es-sub', text: 'Try a different search word, or check the folder for hidden items.' })));
      return;
    }
    // Windows shows a bare folder: only a faint hint when hidden items are off.
    if (!S.settings.showHidden) {
      root.appendChild(h('div', { class: 'hint faint', text: 'This folder is empty.' }));
    }
  }

  /* ==================================================== main entry ==== */

  function renderActive() {
    const c = contentEl();
    if (!c) return;
    if (displayedTabId !== null) {
      const dt = tabById(displayedTabId);
      if (dt) dt.scrollY = c.scrollTop;
    }
    const tab = curTab();
    c.innerHTML = '';
    c.className = '';
    if (!tab) { displayedTabId = null; lastVisible = []; return; }
    displayedTabId = tab.id;
    c.classList.add('view-' + tab.view);
    c.classList.add('loc-' + tab.loc.kind);
    if (tab.loading && !tab.entries && !tab.data && !tab.results && !tab.error) {
      c.appendChild(h('div', { class: 'loading-shimmer' }));
    }

    if (tab.error) { renderError(tab, c, tab.error); return; }

    switch (tab.loc.kind) {
      case 'fs': {
        const list = computeVisible(tab);
        if (!list.length) renderEmptyFs(tab, c);
        else mountItems(tab, list, c);
        break;
      }
      case 'results': {
        const list = computeVisible(tab);
        if (!list.length) renderEmptyFs(tab, c);
        else mountItems(tab, list, c);
        break;
      }
      case 'home': renderHome(tab, c); lastVisible = tab.visible || []; break;
      case 'thispc': renderThisPc(tab, c); lastVisible = tab.visible || []; break;
      case 'bin': renderBin(tab, c); break;
      case 'gallery': renderGallery(tab, c); break;
      case 'network': renderNetwork(tab, c); break;
      default: renderEmptyFs(tab, c);
    }
    c.scrollTop = tab.scrollY || 0;
    const kf = c.querySelector('.kf');
    if (kf && tab.focusKey !== null) kf.scrollIntoView({ block: 'nearest' });
  }

  /* ================================================== rename inline === */

  function nodeFor(tab, e) {
    const c = contentEl();
    if (!c) return null;
    const k = String(keyOf(e));
    return $$('.it', c).find((n) => n.dataset.k === k) ||
      $$('.it', c).find((n) => n._entry === e) || null;
  }

  function selectPath(tab, path) {
    tab.selection.clear();
    tab.selection.add(path);
    tab.anchor = path;
    renderActive();
    const node = nodeFor(tab, { key: path, path });
    if (node) node.scrollIntoView({ block: 'nearest' });
    App.renderStatus();
  }

  async function beginRename(tab) {
    if (!tab || renaming || !isFsLoc(tab)) return;
    const sel = selectedEntries(tab);
    if (sel.length !== 1) return;
    const e = sel[0];
    const node = nodeFor(tab, e);
    if (!node) return;
    const nmEl = node.querySelector('.nm');
    if (!nmEl) return;

    renaming = true;
    tab.renamePending = e;
    const input = h('input', { class: 'rename-input', value: e.name, spellcheck: 'false' });
    nmEl.textContent = '';
    nmEl.appendChild(input);
    input.focus();
    const [, ext] = WXCore.splitName(e.name);
    try { input.setSelectionRange(0, Math.max(0, e.name.length - ext.length)); } catch (err) { }

    let done = false;
    let to = null;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const val = (input.value || '').trim();
      renaming = false;
      tab.renamePending = null;
      let ok = false;
      if (commit && val && val !== e.name && !val.includes('/')) {
        to = WXCore.join(WXCore.dirname(e.path), val);
        try {
          await wx.rename(e.path, to);
          pushUndo({
            label: 'Rename',
            undo: () => wx.rename(to, e.path),
            redo: () => wx.rename(e.path, to)
          });
          ok = true;
        } catch (err) {
          Dlgs.error('Could not rename “' + e.name + '”:\n\n' + ((err && err.message) || err));
        }
      }
      await loadTab(tab, { quiet: true });
      if (ok) selectPath(tab, to);
      else { renderActive(); App.renderStatus(); }
    };
    commitInput(input, () => finish(true), () => finish(false));
    input.addEventListener('blur', () => finish(true));
  }

  /* ================================================== interactions ==== */

  function entryFromNode(node, tab) {
    if (!node) return null;
    if (node._entry) return node._entry;
    const k = node.dataset && node.dataset.k;
    if (!k) return null;
    const pool = poolFor(tab) || (tab.data && tab.data.items) || [];
    return pool.find((e) => String(keyOf(e)) === k) || null;
  }

  function onItemMouseDown(ev, node, tab) {
    if (renaming) return;
    const e = entryFromNode(node, tab);
    if (!e) return;
    if (ev.button === 2) {
      // Right-click: select the item first unless it is part of a multi-selection.
      if (!tab.selection.has(keyOf(e))) { selectOnly(tab, e); renderActive(); App.renderStatus(); }
      return;
    }
    if (ev.button !== 0) return;
    if (ev.ctrlKey && ev.shiftKey) { rangeSelect(tab, e, lastVisible); renderActive(); App.renderStatus(); return; }
    if (ev.ctrlKey) { toggleSelect(tab, e); renderActive(); App.renderStatus(); return; }
    if (ev.shiftKey) { rangeSelect(tab, e, lastVisible); renderActive(); App.renderStatus(); return; }
    if (!tab.selection.has(keyOf(e))) {
      selectOnly(tab, e);
      renderActive();
      App.renderStatus();
    }
  }

  function onContentClick(ev, tab) { /* selection handled in mousedown */ }

  async function onDblClick(ev, tab) {
    const node = ev.target.closest && ev.target.closest('.it');
    if (!node) return;
    const e = entryFromNode(node, tab);
    if (!e) return;
    if (renaming && ev.target.closest('.rename-input')) return;

    if (tab.loc.kind === 'bin') {
      // Opening an item in the Recycle Bin previews it from its trash location.
      await wx.open(e.path);
      return;
    }
    if (e._drive) { /* handled by drive card dblclick */ }
    await Ops.openEntries([e], { tab });
  }

  function onContextMenu(ev, tab) {
    ev.preventDefault();
    if (ev.target.closest && ev.target.closest('.ch')) { headerMenu(ev.clientX, ev.clientY); return; }
    const node = ev.target.closest && ev.target.closest('.it');
    if (node && node._drive) { Menus.driveMenu(ev.clientX, ev.clientY, node._drive); return; }
    if (node) {
      const e = entryFromNode(node, tab);
      if (!e) return;
      Menus.itemMenu(ev.clientX, ev.clientY, selectedEntries(tab).length && tab.selection.has(keyOf(e))
        ? selectedEntries(tab) : [e], { tab });
      return;
    }
    Menus.backgroundMenu(ev.clientX, ev.clientY, { tab });
  }

  /* Header sorting */
  function onContentClickImpl(ev, tab) {
    const th = ev.target.closest && ev.target.closest('.ch');
    if (th && tab) {
      const col = th.dataset.col;
      if (!col || th.classList.contains('nosort')) return;
      if (ev.target.classList && ev.target.classList.contains('ch-div')) return;
      if (tab.sortBy === col) tab.sortAsc = !tab.sortAsc;
      else { tab.sortBy = col; tab.sortAsc = true; }
      wx.setSettings({ sortBy: tab.sortBy, sortAsc: tab.sortAsc });
      refreshUI();
      return;
    }
    const node = ev.target.closest && ev.target.closest('.it');
    if (!node) {
      if (tab && tab.selection.size && !renaming) {
        clearSelection(tab);
        renderActive();
        App.renderStatus();
      }
      return;
    }
    /* single-click open (Folder Options \u201cpoint to select\u201d) */
    if (S.settings.singleClick && !renaming && ev.detail === 1) {
      const e = entryFromNode(node, tab);
      if (e) setTimeout(() => Ops.openEntries([e], { tab }).catch(() => { }), 120);
    }
  }

  /* ------------------------------------------------- column resizing */

  function applyColWidths(tab) {
    const c = contentEl();
    if (!c) return;
    const tpl = columnsFor(tab).map(colWidth).join(' ');
    const head = c.querySelector('.colhead');
    if (head) head.style.gridTemplateColumns = tpl;
    for (const row of $$('.items.v-details .it', c)) row.style.gridTemplateColumns = tpl;
  }

  function startColumnResize(div, ev) {
    const tab = curTab();
    if (!tab) return;
    const id = div.dataset.col;
    const head = div.closest('.ch');
    if (!head) return;
    const startW = head.getBoundingClientRect().width;
    const startX = ev.clientX;
    document.body.classList.add('resizing-col');
    const onMove = (mv) => {
      const w = Math.max(44, Math.min(900, Math.round(startW + (mv.clientX - startX))));
      const dw = Object.assign({}, S.settings.detailsWidths || {});
      dw[id] = w;
      S.settings.detailsWidths = dw;
      applyColWidths(tab);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      document.body.classList.remove('resizing-col');
      wx.setSettings({ detailsWidths: S.settings.detailsWidths });
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    ev.preventDefault();
    ev.stopPropagation();
  }

  function colTextFor(tab, e, id) {
    if (id === 'name') return e.name || '';
    if (id === 'date') return tab.loc.kind === 'bin' ? formatDate(e.deletedAt) : formatDate(e.mtime);
    if (id === 'created') return formatDate(e.ctime);
    if (id === 'type') return WXCore.typeWithExt(WXCore.typeInfo(e.name, e.isDir, e.mode));
    if (id === 'size') return e.isDir ? '' : formatSize(e.size);
    if (id === 'folder') return e.folder || e.origPath || '';
    return '';
  }

  /* Ctrl+Plus equivalent: double-click a divider fits the column. */
  function autofitColumn(id) {
    const tab = curTab();
    if (!tab) return;
    let max = id === 'name' ? 6 : 4;
    for (const e of lastVisible.slice(0, 500)) {
      max = Math.max(max, colTextFor(tab, e, id).length);
    }
    const w = Math.max(48, Math.min(720, Math.round(max * 7.1 + 34)));
    const dw = Object.assign({}, S.settings.detailsWidths || {});
    dw[id] = w;
    S.settings.detailsWidths = dw;
    applyColWidths(tab);
    wx.setSettings({ detailsWidths: dw });
  }

  /* Right-click a header: the Windows column chooser. */
  function headerMenu(x, y) {
    const tab = curTab();
    if (!tab) return;
    const ALL_COLS = [
      ['name', 'Name'], ['date', 'Date modified'], ['created', 'Date created'],
      ['type', 'Type'], ['size', 'Size']
    ];
    const cur = (S.settings.detailsCols && S.settings.detailsCols.length)
      ? S.settings.detailsCols.slice() : ['name', 'date', 'type', 'size'];
    const items = ALL_COLS.map(([id, label]) => ({
      label,
      checked: cur.includes(id),
      disabled: id === 'name',
      run: () => {
        let next = cur.includes(id) ? cur.filter((c) => c !== id) : cur.concat([id]);
        if (!next.includes('name')) next.unshift('name');
        const order = ['name', 'date', 'created', 'type', 'size'];
        next = next.filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => order.indexOf(a) - order.indexOf(b));
        S.settings.detailsCols = next;
        wx.setSettings({ detailsCols: next });
        refreshUI();
      }
    }));
    items.push({ sep: true });
    items.push({
      label: 'Restore default columns',
      run: () => {
        S.settings.detailsCols = null;
        S.settings.detailsWidths = {};
        wx.setSettings({ detailsCols: null, detailsWidths: {} });
        refreshUI();
      }
    });
    Menus.open({ x, y, items });
  }

  /* ------------------------------------- keyboard navigation model -- */

  function focusedEntry(tab) {
    if (!tab || tab.focusKey === null || tab.focusKey === undefined) return null;
    return lastVisible.find((e) => String(keyOf(e)) === String(tab.focusKey)) || null;
  }

  /* Steps between grid columns (or list-column rows for List/Small). */
  function horizStep(tab) {
    const c = contentEl();
    if (!c) return 1;
    const first = c.querySelector('.it');
    if (!first) return 1;
    if (tab.view === 'list' || tab.view === 'sm') {
      const r = first.getBoundingClientRect();
      return Math.max(1, Math.floor(c.clientHeight / (r.height + 1)));
    }
    const r = first.getBoundingClientRect();
    return Math.max(1, Math.floor(c.clientWidth / (r.width + 4)));
  }

  function pageSize(tab) {
    const c = contentEl();
    if (!c) return 10;
    const first = c.querySelector('.it');
    if (!first) return 10;
    const r = first.getBoundingClientRect();
    if (tab.view === 'details') return Math.max(1, Math.floor(c.clientHeight / 26) - 1);
    if (tab.view === 'list' || tab.view === 'sm') return horizStep(tab);
    const cols = Math.max(1, Math.floor(c.clientWidth / (r.width + 4)));
    const rows = Math.max(1, Math.floor(c.clientHeight / (r.height + 4)));
    return Math.max(1, cols * (rows - 1));
  }

  /* Arrow/Home/End/PageUp/PageDown navigation. mode: select|extend|focus */
  function nav(dir, mode) {
    const tab = curTab();
    if (!tab || !lastVisible.length || renaming) return;
    const horiz = dir === 'left' || dir === 'right';
    if (horiz && tab.view === 'details') return; // Details: rows only
    const list = lastVisible;
    const startKey = (tab.focusKey !== null && tab.focusKey !== undefined)
      ? String(tab.focusKey)
      : (tab.selection.size === 1 ? [...tab.selection][0] : null);
    let idx = startKey !== null ? list.findIndex((e) => String(keyOf(e)) === startKey) : -1;
    if (idx === -1) idx = 0;
    else if (dir === 'home') idx = 0;
    else if (dir === 'end') idx = list.length - 1;
    else if (dir === 'up') idx -= 1;
    else if (dir === 'down') idx += 1;
    else if (dir === 'left') idx -= horizStep(tab);
    else if (dir === 'right') idx += horizStep(tab);
    else if (dir === 'pageup') idx -= pageSize(tab);
    else if (dir === 'pagedown') idx += pageSize(tab);
    idx = Math.max(0, Math.min(list.length - 1, idx));
    const e = list[idx];
    tab.focusKey = keyOf(e);
    if (mode === 'extend') rangeSelect(tab, e, list);
    else if (mode !== 'focus') selectOnly(tab, e);
    renderActive();
    App.renderStatus();
  }

  function init() {
    const c = contentEl();
    if (!c) return;

    /* column resize handles (capture, before item selection logic) */
    c.addEventListener('mousedown', (ev) => {
      const div = ev.target.closest && ev.target.closest('.ch-div');
      if (div && ev.button === 0) startColumnResize(div, ev);
    }, true);

    c.addEventListener('dblclick', (ev) => {
      const div = ev.target.closest && ev.target.closest('.ch-div');
      if (div) { autofitColumn(div.dataset.col); return; }
    });

    /* middle-click: folder opens in a new tab (Explorer behavior) */
    c.addEventListener('auxclick', async (ev) => {
      if (ev.button !== 1) return;
      const tab = curTab();
      const node = ev.target.closest && ev.target.closest('.it');
      if (!tab || !node || !node._entry) return;
      ev.preventDefault();
      const e = node._entry;
      if (e.path && e.isDir) newTab(fsLoc(e.path));
      else if (e.path && !e.isDir) { await wx.open(e.path); }
    });

    c.addEventListener('mousedown', (ev) => {
      const tab = curTab();
      if (!tab) return;
      const node = ev.target.closest && ev.target.closest('.it');
      if (node) {
        if (node._drive) {
          if (ev.button === 0) node.classList.add('pressed');
          return;
        }
        onItemMouseDown(ev, node, tab);
      }
    }, true);

    c.addEventListener('mouseup', () => {
      $$('.drive.pressed', c).forEach((d) => d.classList.remove('pressed'));
    });

    c.addEventListener('click', (ev) => {
      const tab = curTab();
      if (!tab) return;
      const driveCard = ev.target.closest && ev.target.closest('.drive');
      if (driveCard && driveCard._drive) {
        const d = driveCard._drive;
        if (d.ejected) Ops.mountDrive(d);
        else if (ev.detail === 1 && !d.__opened) { /* single click just highlights */ }
        return;
      }
      onContentClickImpl(ev, tab);
    });

    c.addEventListener('dblclick', (ev) => {
      const tab = curTab();
      if (!tab) return;
      const driveCard = ev.target.closest && ev.target.closest('.drive');
      if (driveCard && driveCard._drive) {
        const d = driveCard._drive;
        if (d.ejected) Ops.mountDrive(d);
        else navigate(fsLoc(d.mount));
        return;
      }
      const pin = ev.target.closest && ev.target.closest('.pin');
      if (pin && pin.dataset.path) {
        navigate(fsLoc(pin.dataset.path));
        return;
      }
      onDblClick(ev, tab).catch((e) => console.error('open failed', e));
    });

    c.addEventListener('contextmenu', (ev) => {
      const tab = curTab();
      if (!tab) return;
      onContextMenu(ev, tab);
    });

    c.addEventListener('scroll', () => {
      const tab = curTab();
      if (tab) tab.scrollY = c.scrollTop;
    });
  }

  return {
    get lastVisible() { return lastVisible; },
    renderActive,
    beginRename,
    selectPath,
    nodeFor,
    nav,
    focusedEntry,
    applyColWidths,
    autofitColumn,
    init,
    isRenaming: () => renaming
  };
})();
