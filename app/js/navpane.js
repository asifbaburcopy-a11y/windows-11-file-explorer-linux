/*
 * navpane.js — left navigation pane: Home, Gallery, pinned folders,
 * known folders, This PC (with drives) and Network, with expand/collapse,
 * context menus and a drag-resizable splitter.
 */
'use strict';

const Nav = (() => {
  const KNOWN = [
    ['Desktop', 'desktop'],
    ['Downloads', 'download'],
    ['Documents', 'doc'],
    ['Pictures', 'pictures'],
    ['Music', 'music'],
    ['Videos', 'video']
  ];

  /* Expandable folder tree rows (Windows navigation pane). */
  const expanded = new Set();
  const treeCache = new Map();

  function loadChildren(path) {
    const c = treeCache.get(path);
    if (Array.isArray(c)) return Promise.resolve(c);
    if (c && typeof c.then === 'function') return c;
    const p = wx.list(path)
      .then((ents) => {
        const dirs = ents.filter((e) => e.isDir)
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        treeCache.set(path, dirs);
        return dirs;
      })
      .catch(() => { treeCache.set(path, []); return []; });
    treeCache.set(path, p);
    return p;
  }

  function toggleTree(path) {
    if (expanded.has(path)) { expanded.delete(path); render(); return; }
    expanded.add(path);
    if (!Array.isArray(treeCache.get(path))) loadChildren(path).then(() => render());
    else render();
  }

  function iconForLoc(loc) {
    const n = locIconName(loc);
    return n === 'folder' ? folderSvg() : I(n, '', 17);
  }

  function iconForName(name) {
    const hit = KNOWN.find((k) => k[0] === name);
    return hit ? I(hit[1], '', 17) : folderSvg();
  }

  function isActive(loc) {
    const t = curTab();
    if (!t) return false;
    if (loc.kind === 'fs' && t.loc.kind === 'fs') return loc.path === t.loc.path;
    return loc.kind === t.loc.kind;
  }

  function row(loc, opts = {}) {
    const el = h('div', {
      class: 'nav-row' + (isActive(loc) ? ' active' : '') + (opts.child ? ' child' : ''),
      title: opts.title || (loc.kind === 'fs' ? loc.path : '')
    });
    if (opts.expandable !== undefined) {
      const arrow = h('span', {
        class: 'nav-arrow' + (opts.expanded ? ' open' : ''),
        html: I('chevronR', '', 12),
        onclick: (ev) => { ev.stopPropagation(); toggleExpand(opts.key); }
      });
      el.appendChild(arrow);
    } else if (opts.tree && loc.kind === 'fs') {
      const isOpen = expanded.has(loc.path);
      el.appendChild(h('span', {
        class: 'nav-arrow' + (isOpen ? ' open' : ''),
        html: I('chevronR', '', 12),
        onclick: (ev) => { ev.stopPropagation(); toggleTree(loc.path); }
      }));
      if (opts.level) el.style.paddingLeft = (22 + opts.level * 14) + 'px';
    } else {
      el.appendChild(h('span', { class: 'nav-arrow spacer' }));
    }
    el.appendChild(h('span', { class: 'nav-ico', html: opts.icon || iconForLoc(loc) }));
    el.appendChild(h('span', { class: 'nav-label', text: opts.label || locTitle(loc) }));
    el.addEventListener('click', () => navigate(loc));
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      Menus.navMenu(ev.clientX, ev.clientY, loc);
    });
    return el;
  }

  function expandableHeader(label, icon, key, loc) {
    const collapsed = S.navCollapsed.has(key);
    const el = h('div', {
      class: 'nav-row nav-branch' + (collapsed ? '' : ' expanded') +
        (loc && isActive(loc) ? ' active' : ''),
      title: loc && loc.kind === 'fs' ? loc.path : ''
    });
    el.appendChild(h('span', {
      class: 'nav-arrow' + (collapsed ? '' : ' open'),
      html: I('chevronR', '', 12),
      onclick: (ev) => { ev.stopPropagation(); toggleExpand(key); }
    }));
    el.appendChild(h('span', { class: 'nav-ico', html: icon }));
    el.appendChild(h('span', { class: 'nav-label', text: label }));
    /* Like Windows: clicking the header navigates there and expands it. */
    el.addEventListener('click', () => {
      if (S.navCollapsed.has(key)) toggleExpand(key);
      if (loc) navigate(loc);
    });
    el.addEventListener('contextmenu', (ev) => {
      if (!loc) return;
      ev.preventDefault();
      Menus.navMenu(ev.clientX, ev.clientY, loc);
    });
    return el;
  }

  function toggleExpand(key) {
    if (S.navCollapsed.has(key)) S.navCollapsed.delete(key);
    else S.navCollapsed.add(key);
    render();
  }

  function renderChildren(root, path, level) {
    if (level > 6 || !expanded.has(path)) return;
    const cached = treeCache.get(path);
    const dirs = Array.isArray(cached) ? cached : [];
    for (const d of dirs) {
      root.appendChild(row(fsLoc(d.path), {
        tree: true, level,
        icon: folderSvg(),
        label: d.name,
        title: d.path
      }));
      renderChildren(root, d.path, level + 1);
    }
  }

  let data = { drives: [], ejected: [], network: [] };
  let deadPaths = new Set();  /* known folders/pins that do not exist here */

  async function refreshData() {
    try {
      const [d, net] = await Promise.all([wx.drives(), wx.network()]);
      data = { drives: d.drives || [], ejected: d.ejected || [], network: net || [] };
      /* Windows hides known folders that don't exist (no Desktop? no row). */
      const home = (S.appInfo && S.appInfo.home) || '';
      const candidates = [
        ...(S.settings.pinned || []),
        ...KNOWN.map(([name]) => home + '/' + name)
      ];
      const alive = await Promise.all(candidates.map((p) =>
        wx.stat(p).then((s) => !!(s && s.isDir)).catch(() => false)));
      deadPaths = new Set(candidates.filter((_, i) => !alive[i]));
      treeCache.clear(); /* pick up external folder changes in the tree */
      render();
    } catch (e) { /* keep previous */ }
  }

  /* Sliding selection pill — persists across renders so it animates. */
  let indEl = null;

  function updateIndicator(root) {
    if (!indEl) {
      indEl = document.createElement('div');
      indEl.className = 'nav-ind';
    }
    if (indEl.parentNode !== root) root.insertBefore(indEl, root.firstChild);
    const active = root.querySelector('.nav-row.active');
    if (!active) { indEl.style.opacity = '0'; return; }
    indEl.style.opacity = '1';
    indEl.style.height = active.offsetHeight + 'px';
    indEl.style.transform = 'translateY(' + active.offsetTop + 'px)';
  }

  function render() {
    const root = document.getElementById('navpane');
    if (!root) return;
    root.innerHTML = '';

    /* Home + Gallery */
    root.appendChild(row(homeLoc(), { icon: I('home', '', 17), label: 'Home' }));
    root.appendChild(row(galleryLoc(), { icon: I('gallery', '', 17), label: 'Gallery' }));

    /* Pinned folders */
    const pinned = (S.settings.pinned || []).slice().filter((p) => !deadPaths.has(p));
    if (pinned.length) {
      root.appendChild(h('div', { class: 'nav-sep' }));
    for (const p of pinned) {
      root.appendChild(row(fsLoc(p), { icon: folderSvg(), label: WXCore.basename(p), title: p, tree: true }));
      renderChildren(root, p, 1);
    }
    }

    /* Known folders (only those that exist on this machine) */
    const home = (S.appInfo && S.appInfo.home) || '';
    const knownRows = KNOWN.filter(([name]) => !deadPaths.has(home + '/' + name));
    if (knownRows.length) root.appendChild(h('div', { class: 'nav-sep' }));
    for (const [name, ico] of knownRows) {
      const p = home + '/' + name;
      root.appendChild(row(fsLoc(p), { icon: I(ico, '', 17), label: name, title: p, tree: true }));
      renderChildren(root, p, 1);
    }

    /* This PC */
    root.appendChild(h('div', { class: 'nav-sep' }));
    root.appendChild(expandableHeader('This PC', I('thispc', '', 17), 'thispc', thisPcLoc()));
    if (!S.navCollapsed.has('thispc')) {
      for (const d of data.drives) {
        if (!d.mount) continue;
        root.appendChild(row(fsLoc(d.mount), {
          child: true,
          tree: true,
          label: d.name || d.mount,
          icon: d.removable ? usbSvg('s15') : driveSvg('s15', d.removable),
          title: d.mount + (d.fstype ? ' · ' + d.fstype : '')
        }));
        renderChildren(root, d.mount, 1);
      }
      for (const d of data.ejected) {
        root.appendChild(h('div', {
          class: 'nav-row child muted', title: d.device || ''
        },
          h('span', { class: 'nav-arrow spacer' }),
          h('span', { class: 'nav-ico', html: usbSvg('s15') }),
          h('span', { class: 'nav-label', text: (d.name || 'Removable Disk') + ' (Not mounted)' })));
      }
    }

    /* Network */
    root.appendChild(expandableHeader('Network', I('network', '', 17), 'network', networkLoc()));
    if (!S.navCollapsed.has('network')) {
      for (const n of data.network) {
        root.appendChild(row(fsLoc(n.path), { child: true, tree: true, label: n.name, icon: folderSvg(), title: n.path }));
        renderChildren(root, n.path, 1);
      }
    }

    root.appendChild(h('div', { class: 'nav-end' }));
    updateIndicator(root);
  }

  /* ------------------------------------------------------- resizing */

  function initResizer() {
    const resizer = document.getElementById('navResizer');
    if (!resizer) return;
    let startX = 0, startW = 0, dragging = false;
    resizer.addEventListener('mousedown', (ev) => {
      dragging = true;
      startX = ev.clientX;
      startW = document.getElementById('navpane').offsetWidth;
      document.body.classList.add('resizing-nav');
      ev.preventDefault();
    });
    window.addEventListener('mousemove', (ev) => {
      if (!dragging) return;
      const w = clamp(startW + (ev.clientX - startX), 160, 460);
      setWidth(w, false);
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('resizing-nav');
      const w = document.getElementById('navpane').offsetWidth;
      wx.setSettings({ navWidth: w });
    });
    resizer.addEventListener('dblclick', () => {
      setWidth(232, true);
      wx.setSettings({ navWidth: 232 });
    });
  }

  function setWidth(w, immediate) {
    document.documentElement.style.setProperty('--nav-w', w + 'px');
    if (immediate) { /* noop */ }
  }

  function init() {
    setWidth(S.settings.navWidth || 232, true);
    initResizer();
    render();
    refreshData();
    setInterval(() => { if (document.hasFocus()) refreshData(); }, 30000);
  }

  return { render, init, refreshData };
})();
