/*
 * toolbar.js — title-bar tab strip, address bar (breadcrumbs + editable
 * path + search) and the Windows 11 command bar.
 */
'use strict';

const Bar = (() => {

  function ctxOf(tab) {
    return { tab, sel: tab ? selectedEntries(tab) : [], selPaths: tab ? selectedPaths(tab) : [] };
  }

  function canAct(id, tab) {
    const def = Actions.get(id);
    if (!def) return false;
    if (!def.when) return true;
    try { return !!def.when(ctxOf(tab)); } catch (e) { return false; }
  }

  /* ======================================================= tab strip == */

  function tabTitle(tab) {
    if (tab.loc.kind === 'results') return 'Search: ' + tab.loc.query;
    return locTitle(tab.loc);
  }

  /* The strip used to rebuild on every state change, which killed :hover
     mid-pointing and made the close button vanish under the cursor.
     Rebuild only when the tab structure actually changed. */
  let tabsKey = null;

  function renderTabs() {
    const strip = document.getElementById('tabstrip');
    if (!strip) return;
    const key = S.tabs.map((t) => t.id + '\u0001' + tabTitle(t) + '\u0001' + (t.id === S.activeId)).join('\u0002');
    if (key === tabsKey && strip.querySelector('.tab')) return;
    tabsKey = key;
    strip.innerHTML = '';
    for (const tab of S.tabs) {
      const active = tab.id === S.activeId;
      const el = h('div', { class: 'tab' + (active ? ' active' : ''), dataset: { id: tab.id }, title: tabTitle(tab) });
      el.appendChild(h('span', { class: 'tab-ico', html: iconFor(tab) }));
      el.appendChild(h('span', { class: 'tab-title', text: tabTitle(tab) }));
      if (S.tabs.length > 1 || true) {
        el.appendChild(h('button', {
          class: 'tab-close', title: 'Close (Ctrl+W)', html: I('close', '', 12),
          onclick: (ev) => { ev.stopPropagation(); closeTab(tab.id); }
        }));
      }
      el.addEventListener('click', () => activateTab(tab.id));
      el.addEventListener('auxclick', (ev) => { if (ev.button === 1) closeTab(tab.id); });
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        Menus.tabMenu(ev.clientX, ev.clientY, tab.id);
      });
      strip.appendChild(el);
    }
    const add = h('button', {
      class: 'tab-add', title: 'New tab (Ctrl+T)', html: I('plus', '', 14),
      onclick: () => newTab(homeLoc())
    });
    strip.appendChild(add);
    /* Keep the active tab reachable when the strip scrolls (many tabs). */
    const act = strip.querySelector('.tab.active');
    if (act && act.scrollIntoView) act.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function iconFor(tab) {
    if (tab.loc.kind === 'fs') return folderSvg();
    return I(locIconName(tab.loc), '', 15);
  }

  /* ===================================================== address bar == */

  function currentPath(tab) {
    return pathOf(tab && tab.loc) || '';
  }

  function displayPath(tab) {
    const loc = tab.loc;
    if (loc.kind === 'fs') {
      const home = S.appInfo && S.appInfo.home;
      if (home && loc.path === home) return '~';
      return loc.path;
    }
    return locTitle(loc);
  }

  function crumbsFor(tab) {
    const loc = tab.loc;
    if (loc.kind === 'fs') {
      const crumbs = [];
      const home = S.appInfo && S.appInfo.home;
      if (loc.path === '/') {
        crumbs.push({ label: 'Computer', icon: I('thispc', '', 15), path: '/', last: true });
        return crumbs;
      }
      const abs = loc.path;
      let prefix = '';
      const segs = WXCore.splitCrumbs(abs);
      let built = '';
      for (let i = 0; i < segs.length; i++) {
        built = '/' + segs.slice(0, i + 1).join('/');
        crumbs.push({
          label: segs[i],
          path: built,
          icon: i === 0 ? (home && built === home ? I('home', '', 15) : null) : null,
          last: i === segs.length - 1
        });
      }
      if (home && abs.startsWith(home + '/')) {
        // Replace the root-level crumb sequence with Home for readability.
        const homeSegs = WXCore.splitCrumbs(home);
        if (segs.slice(0, homeSegs.length).join('/') === homeSegs.join('/')) {
          const rest = segs.slice(homeSegs.length);
          const out = [{ label: 'Home', icon: I('home', '', 15), path: home }];
          let b = home;
          for (let i = 0; i < rest.length; i++) {
            b = b + '/' + rest[i];
            out.push({ label: rest[i], path: b });
          }
          out[out.length - 1].last = true;
          return out;
        }
      }
      crumbs[0].icon = crumbs[0].icon || null;
      crumbs[crumbs.length - 1].last = true;
      return crumbs;
    }
    /* special locations: single crumb */
    return [{ label: locTitle(loc), icon: iconFor(tab), special: true, last: true }];
  }

  function siblingsMenu(path, anchorEl) {
    wx.list(path).then((entries) => {
      const dirs = entries.filter((e) => e.isDir)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      if (!dirs.length) return;
      Menus.open({
        anchor: anchorEl.getBoundingClientRect(),
        items: dirs.map((d) => ({
          label: d.name,
          icon: null,
          run: () => navigate(fsLoc(d.path))
        })).slice(0, 60)
      });
    }).catch(() => { });
  }

  function renderAddress() {
    const tab = curTab();
    const addr = document.getElementById('addr');
    if (!addr) return;
    if (addr.classList.contains('editing')) return;

    /* nav buttons */
    const back = document.getElementById('btnBack');
    const fwd = document.getElementById('btnFwd');
    const up = document.getElementById('btnUp');
    if (back) back.classList.toggle('disabled', !tab || tab.hi === 0);
    if (fwd) fwd.classList.toggle('disabled', !tab || tab.hi >= tab.hist.length - 1);
    if (up) up.classList.toggle('disabled', !canAct('nav.up', tab));

    addr.classList.toggle('loading', !!(tab && tab.loading));

    /* crumbs */
    addr.innerHTML = '';
    if (!tab) return;
    const crumbs = crumbsFor(tab);
    const ico = h('span', { class: 'crumb ico', html: iconFor(tab) });
    addr.appendChild(ico);
    for (let i = 0; i < crumbs.length; i++) {
      const c = crumbs[i];
      const el = h('div', { class: 'crumb' + (c.last ? ' current' : ''), title: c.path || c.label });
      if (c.icon) el.appendChild(h('span', { class: 'crumb-ico', html: c.icon }));
      el.appendChild(h('span', { class: 'crumb-label', text: c.label }));
      if (!c.last) el.appendChild(h('span', { class: 'crumb-sep', html: I('chevronR', '', 11) }));
      else if (tab.loc.kind === 'fs' && !c.special) el.appendChild(h('span', { class: 'crumb-sep', html: I('chevronD', '', 11) }));
      el.addEventListener('click', (ev) => {
        if (ev.target.closest('.crumb-sep') && !c.last) {
          siblingsMenu(c.path, ev.target.closest('.crumb-sep'));
          return;
        }
        if (c.last && tab.loc.kind === 'fs' && !c.special) {
          const parent = WXCore.dirname(c.path);
          if (parent && parent !== c.path) siblingsMenu(parent, el);
          return;
        }
        if (c.special) return;
        if (c.path) navigate(fsLoc(c.path));
      });
      addr.appendChild(el);
    }

    /* search box */
    const search = document.getElementById('searchInput');
    if (search && document.activeElement !== search) {
      search.value = tab.loc.kind === 'results' ? tab.loc.query : '';
    }
    const clear = document.getElementById('searchClear');
    if (clear) clear.style.display = search && search.value ? 'flex' : 'none';
    const ph = document.getElementById('search');
    if (ph) {
      ph.classList.toggle('has-query', !!(search && search.value));
      const title = tab.loc.kind === 'fs' ? (WXCore.basename(tab.loc.path) || 'Local Disk') : locTitle(tab.loc);
      search.placeholder = 'Search ' + title;
    }
  }

  function editAddress() {
    const addr = document.getElementById('addr');
    const tab = curTab();
    if (!addr || !tab) return;
    addr.classList.add('editing');
    addr.innerHTML = '';
    const input = h('input', { class: 'addr-input', spellcheck: 'false', value: displayPath(tab) });
    addr.appendChild(input);
    input.focus();
    input.select();
    const finish = (commit) => {
      if (!addr.classList.contains('editing')) return;
      addr.classList.remove('editing');
      const val = (input.value || '').trim();
      if (commit && val) applyAddress(val, tab);
      renderAddress();
    };
    commitInput(input, () => finish(true), () => finish(false));
    input.addEventListener('blur', () => finish(true));
  }

  function applyAddress(text, tab) {
    const lower = text.toLowerCase();
    if (lower === 'home') { navigate(homeLoc()); return; }
    if (lower === 'this pc' || lower === 'computer' || lower === 'thispc') { navigate(thisPcLoc()); return; }
    if (lower === 'recycle bin' || lower === 'trash') { navigate(binLoc()); return; }
    if (lower === 'gallery') { navigate(galleryLoc()); return; }
    if (lower === 'network') { navigate(networkLoc()); return; }
    let p = text;
    const home = (S.appInfo && S.appInfo.home) || '';
    if (p === '~') p = home;
    else if (p.startsWith('~/')) p = home + p.slice(1);
    else if (!p.startsWith('/')) p = WXCore.join(pathOf(tab.loc) || home, p);
    p = WXCore.normalize(p);
    navigate(fsLoc(p));
  }

  /* ========================================================== search == */

  let searchTimer = null;

  function runSearch(tab, q) {
    q = (q || '').trim();
    if (!q) {
      if (tab.loc.kind === 'results') navigate(fsLoc(tab.loc.path));
      return;
    }
    const root = tab.loc.kind === 'results' ? tab.loc.path
      : (pathOf(tab.loc) || ((S.appInfo && S.appInfo.home) || '/'));
    const loc = resultsLoc(root, q);
    if (tab.loc.kind === 'results') navigate(loc, { push: false });
    else navigate(loc);
  }

  function initSearch() {
    const input = document.getElementById('searchInput');
    const clear = document.getElementById('searchClear');
    if (!input) return;
    input.addEventListener('input', () => {
      const tab = curTab();
      if (!tab) return;
      clearTimeout(searchTimer);
      const v = input.value;
      clear.style.display = v ? 'flex' : 'none';
      if (!v) {
        if (tab.loc.kind === 'results') { runSearch(tab, ''); }
        return;
      }
      if (tab.loc.kind === 'results') {
        searchTimer = setTimeout(() => runSearch(tab, v), 450);
      }
    });
    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') {
        clearTimeout(searchTimer);
        runSearch(curTab(), input.value);
        input.blur();
      } else if (ev.key === 'Escape') {
        clearTimeout(searchTimer);
        const tab = curTab();
        input.value = '';
        clear.style.display = 'none';
        if (tab && tab.loc.kind === 'results') runSearch(tab, '');
        input.blur();
      }
    });
    if (clear) {
      clear.addEventListener('click', () => {
        input.value = '';
        clear.style.display = 'none';
        const tab = curTab();
        if (tab && tab.loc.kind === 'results') runSearch(tab, '');
        input.focus();
      });
    }
  }

  /* ===================================================== command bar == */

  function iconBtn(actId, opts = {}) {
    const tab = curTab();
    const def = Actions.get(actId);
    const disabled = opts.forceDisabled || !canAct(actId, tab);
    const b = h('button', {
      class: 'cbtn' + (disabled ? ' disabled' : ''),
      title: (opts.title || (def && def.title) || actId) + (def && def.hint ? '  (' + def.hint + ')' : ''),
      html: I(opts.icon || (def && def.icon) || 'dots', '', 17)
    });
    if (!disabled) b.addEventListener('click', () => Actions.exec(actId));
    return b;
  }

  function dropdownBtn(label, icon, buildItems, opts = {}) {
    const b = h('button', {
      class: 'cbtn wide' + (opts.disabled ? ' disabled' : ''),
      title: opts.title || label
    },
      opts.iconOnly ? null : h('span', { class: 'cico', html: I(icon, '', 17) }),
      opts.iconOnly ? null : h('span', { class: 'clabel', text: label }),
      h('span', { class: 'cchev', html: I('chevronD', '', 11) }));
    if (!opts.disabled) {
      b.addEventListener('click', () => {
        Menus.open({ anchor: b.getBoundingClientRect(), items: buildItems() });
      });
    }
    return b;
  }

  function sep() { return h('span', { class: 'csep' }); }

  function renderCommand() {
    const bar = document.getElementById('cmdbar');
    if (!bar) return;
    bar.innerHTML = '';
    const tab = curTab();
    if (!tab) return;
    const kind = tab.loc.kind;

    if (kind === 'bin') {
      const restoreBtn = h('button', {
        class: 'cbtn wide text' + (canAct('bin.restore', tab) ? '' : ' disabled'),
        title: 'Restore the selected items to their original locations'
      }, h('span', { class: 'cico', html: I('restore', '', 17) }),
        h('span', { class: 'clabel', text: 'Restore the selected items' }));
      if (canAct('bin.restore', tab)) restoreBtn.addEventListener('click', () => Actions.exec('bin.restore'));
      bar.appendChild(restoreBtn);

      const emptyBtn = h('button', {
        class: 'cbtn wide text' + (canAct('bin.empty', tab) ? '' : ' disabled'),
        title: 'Permanently delete every item in the Recycle Bin'
      }, h('span', { class: 'cico', html: I('trash', '', 17) }),
        h('span', { class: 'clabel', text: 'Empty Recycle Bin' }));
      if (canAct('bin.empty', tab)) emptyBtn.addEventListener('click', () => Actions.exec('bin.empty'));
      bar.appendChild(emptyBtn);
      bar.appendChild(h('span', { class: 'cspacer' }));
      bar.appendChild(dropdownBtn('Sort', 'sort', Menus.sortItems));
      bar.appendChild(dropdownBtn('View', 'view', Menus.viewItems));
      bar.appendChild(overflowBtn());
      return;
    }

    if (kind === 'fs') {
      /* New split button */
      const newBtn = h('button', { class: 'cbtn wide newbtn' + (canAct('file.newFolder', tab) ? '' : ' disabled'), title: 'Create a new item' },
        h('span', { class: 'cico', html: I('plus', '', 17) }),
        h('span', { class: 'clabel', text: 'New' }),
        h('span', { class: 'cchev', html: I('chevronD', '', 11) }));
      if (canAct('file.newFolder', tab)) {
        newBtn.addEventListener('click', () => Menus.open({ anchor: newBtn.getBoundingClientRect(), items: Menus.newItems() }));
      }
      bar.appendChild(newBtn);
      bar.appendChild(sep());
      bar.appendChild(iconBtn('edit.cut'));
      bar.appendChild(iconBtn('edit.copy'));
      bar.appendChild(iconBtn('edit.paste'));
      bar.appendChild(iconBtn('edit.rename'));
      bar.appendChild(iconBtn('edit.delete'));
      bar.appendChild(sep());
      bar.appendChild(dropdownBtn('Sort', 'sort', Menus.sortItems));
      bar.appendChild(dropdownBtn('View', 'view', () => [
        ...Menus.viewItems(),
        { sep: true },
        { label: 'Show', submenu: Menus.showItems() }
      ]));
      bar.appendChild(h('span', { class: 'cspacer' }));
      bar.appendChild(overflowBtn());
      return;
    }

    /* special pages: Home / This PC / Gallery / Network / results */
    if (kind === 'results') {
      const backBtn = h('button', { class: 'cbtn wide text', title: 'Back to the folder' },
        h('span', { class: 'cico', html: I('back', '', 17) }),
        h('span', { class: 'clabel', text: 'Back to ' + (WXCore.basename(tab.loc.path) || 'folder') }));
      backBtn.addEventListener('click', () => navigate(fsLoc(tab.loc.path)));
      bar.appendChild(backBtn);
      bar.appendChild(h('span', { class: 'cspacer' }));
      bar.appendChild(dropdownBtn('Sort', 'sort', Menus.sortItems));
      bar.appendChild(dropdownBtn('View', 'view', Menus.viewItems));
      bar.appendChild(overflowBtn());
      return;
    }

    if (kind === 'home' || kind === 'thispc' || kind === 'gallery' || kind === 'network') {
      bar.appendChild(dropdownBtn('Sort', 'sort', Menus.sortItems));
      bar.appendChild(dropdownBtn('View', 'view', () => [
        ...Menus.viewItems(),
        { sep: true },
        { label: 'Show', submenu: Menus.showItems() }
      ]));
      bar.appendChild(h('span', { class: 'cspacer' }));
      bar.appendChild(overflowBtn());
      return;
    }
  }

  function overflowBtn() {
    const tab = curTab();
    const b = h('button', { class: 'cbtn', title: 'See more', html: I('dots', '', 17) });
    b.addEventListener('click', () => {
      const items = [
        { label: 'Select all', hint: 'Ctrl+A', run: () => Actions.exec('edit.selectAll') },
        { label: 'Select none', hint: 'Esc', run: () => Actions.exec('edit.selectNone') },
        { label: 'Invert selection', run: () => Actions.exec('edit.invertSelection') },
        { sep: true },
        { label: 'Undo', hint: 'Ctrl+Z', disabled: !S.undo.length, run: () => Actions.exec('edit.undo') },
        { label: 'Redo', hint: 'Ctrl+Y', disabled: !S.redo.length, run: () => Actions.exec('edit.redo') },
        { sep: true }
      ];
      if (tab && tab.loc.kind === 'fs') {
        items.push({ label: 'Open in Terminal', icon: 'terminal', run: () => Actions.exec('file.terminal') });
        items.push({ label: 'Properties', icon: 'info', run: () => Actions.exec('file.properties') });
        items.push({ sep: true });
      }
      items.push({ label: 'Details pane', checked: () => !!S.settings.detailsPane, hint: 'Alt+Shift+P', run: () => Actions.exec('view.toggleDetailsPane') });
      items.push({ label: 'Set as default file manager', run: () => Actions.exec('app.setDefault') });
      items.push({ label: 'Options', icon: 'settings', run: () => Actions.exec('app.options') });
      items.push({ label: 'About Explorer', icon: 'info', run: () => Actions.exec('app.about') });
      Menus.open({ anchor: b.getBoundingClientRect(), align: 'right', items });
    });
    return b;
  }

  /* ========================================================== wiring == */

  function renderAll() {
    renderTabs();
    renderAddress();
    renderCommand();
  }

  function init() {
    const back = document.getElementById('btnBack');
    const fwd = document.getElementById('btnFwd');
    const up = document.getElementById('btnUp');
    const ref = document.getElementById('btnRefresh');
    if (back) back.addEventListener('click', () => Actions.exec('nav.back'));
    if (fwd) fwd.addEventListener('click', () => Actions.exec('nav.forward'));
    if (up) up.addEventListener('click', () => Actions.exec('nav.up'));
    if (ref) ref.addEventListener('click', () => {
      ref.classList.remove('spin');
      void ref.offsetWidth; /* restart the animation */
      ref.classList.add('spin');
      setTimeout(() => ref.classList.remove('spin'), 650);
      Actions.exec('nav.refresh');
    });

    const addr = document.getElementById('addr');
    if (addr) addr.addEventListener('click', (ev) => {
      if (addr.classList.contains('editing')) return;
      if (ev.target.closest('.crumb')) return;
      editAddress();
    });

    initSearch();
    renderAll();
  }

  function focusAddress() { editAddress(); }
  function focusSearch() {
    const s = document.getElementById('searchInput');
    if (s) { s.focus(); s.select(); }
  }

  /* F4 — Explorer drops down the location list under the address bar. */
  function addrDropdown() {
    const tab = curTab();
    const addr = document.getElementById('addr');
    if (!tab || !addr) return;
    if (tab.loc.kind === 'fs') {
      siblingsMenu(tab.loc.path, addr);
      return;
    }
    editAddress();
  }

  return { init, renderAll, renderTabs, renderAddress, renderCommand, focusAddress, focusSearch, editAddress, addrDropdown };
})();
