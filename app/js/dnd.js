/*
 * dnd.js — drag & drop: internal move/copy, drops from other apps,
 * drop-into-folder highlighting and marquee (rubber-band) selection.
 */
'use strict';

const DnD = (() => {
  let dragPaths = null;

  function contentEl() { return document.getElementById('content'); }

  function hasFiles(dt) {
    if (!dt) return false;
    if (dt.files && dt.files.length) return true;
    const types = dt.types || [];
    return types.includes('Files');
  }

  function pathsFromDrop(dt) {
    const out = [];
    if (dt.files && dt.files.length) {
      for (const f of dt.files) {
        const p = wx.pathOf(f);
        if (p) out.push(p);
      }
    }
    if (!out.length) {
      try {
        const uriList = dt.getData('text/uri-list') || '';
        for (const line of uriList.split(/\r?\n/)) {
          if (!line || line.startsWith('#')) continue;
          let p = line;
          if (p.startsWith('file://')) p = decodeURIComponent(p.slice(7));
          if (p) out.push(p);
        }
      } catch (e) { /* ignore */ }
    }
    return out;
  }

  /* Folder under the pointer, or the current folder. */
  function dropTarget(ev) {
    const tab = curTab();
    if (!tab) return null;
    const node = ev.target.closest && ev.target.closest('.it.dir');
    if (node && node._entry && node._entry.path) return node._entry.path;
    if (node && node.dataset && node.dataset.path) return node.dataset.path;
    if (tab.loc.kind === 'fs') return tab.loc.path;
    return null;
  }

  function highlight(destPath) {
    const c = contentEl();
    if (!c) return;
    $$('.it.drop-target', c).forEach((n) => n.classList.remove('drop-target'));
    if (!destPath) return;
    const tab = curTab();
    if (!tab || tab.loc.kind !== 'fs') return;
    if (destPath === tab.loc.path) return;
    const node = $$('.it', c).find((n) => n.dataset.k === destPath || (n._entry && n._entry.path === destPath));
    if (node) node.classList.add('drop-target');
    c.classList.add('dest-folder', 'dest-hover');
  }

  function clearHighlight() {
    const c = contentEl();
    if (!c) return;
    c.classList.remove('dest-folder', 'dest-hover');
    $$('.it.drop-target', c).forEach((n) => n.classList.remove('drop-target'));
  }

  /* ------------------------------------------------------ marquee --- */

  function startMarquee(ev) {
    const c = contentEl();
    if (!c || ev.button !== 0) return;
    if (ev.target.closest('.it') || ev.target.closest('.colhead')) return;
    const tab = curTab();
    if (!tab) return;
    const additive = ev.ctrlKey || ev.shiftKey;
    const baseSel = additive ? new Set(tab.selection) : new Set();
    const startX = ev.clientX;
    const startY = ev.clientY + c.scrollTop;
    const marq = h('div', { class: 'marq' });
    let active = false;

    const onMove = (mv) => {
      const x2 = mv.clientX;
      const y2 = mv.clientY + c.scrollTop;
      if (!active && Math.abs(x2 - startX) < 4 && Math.abs(y2 - startY) < 4) return;
      active = true;
      const left = Math.min(startX, x2) - c.getBoundingClientRect().left;
      const top = Math.min(startY, y2) - c.scrollTop;
      const w = Math.abs(x2 - startX);
      const ht = Math.abs(y2 - startY);
      marq.style.transform = 'translate(' + left + 'px,' + top + 'px)';
      marq.style.width = w + 'px';
      marq.style.height = ht + 'px';
      if (!marq.parentNode) c.appendChild(marq);

      const cr = c.getBoundingClientRect();
      const r1 = { l: Math.min(startX, x2), t: Math.min(startY, y2), r: Math.max(startX, x2), b: Math.max(startY, y2) };
      const sel = new Set(baseSel);
      for (const node of $$('.it', c)) {
        const ir = node.getBoundingClientRect();
        const r2 = { l: ir.left + cr.left - 0, t: ir.top + c.scrollTop, r: ir.right, b: ir.bottom + c.scrollTop };
        // Normalize to viewport coordinates:
        const vr = { l: ir.left, t: ir.top, r: ir.right, b: ir.bottom };
        const hit = !(r1.r < vr.l || r1.l > vr.r || r1.b < vr.t || r1.t > vr.b);
        if (hit && node.dataset.k) sel.add(node.dataset.k);
      }
      tab.selection = sel;
      for (const node of $$('.it', c)) {
        node.classList.toggle('sel', tab.selection.has(node.dataset.k));
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      if (marq.parentNode) marq.remove();
      if (active) App.renderStatus();
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
  }

  /* ================================================================ */

  function init() {
    const c = contentEl();
    if (!c) return;

    document.addEventListener('dragstart', (ev) => {
      const tab = curTab();
      const node = ev.target.closest && ev.target.closest('.it');
      if (!tab || !node || !node._entry) return;
      const e = node._entry;
      if (!e.path) return;
      let paths;
      if (tab.selection.has(keyOf(e))) paths = selectedPaths(tab);
      else { selectOnly(tab, e); paths = [e.path]; }
      dragPaths = paths.filter(Boolean);
      if (!dragPaths.length) return;
      try {
        ev.dataTransfer.setData('text/uri-list', dragPaths.map((p) => 'file://' + encodeURI(p)).join('\r\n'));
        ev.dataTransfer.setData('application/x-wxpaths', JSON.stringify(dragPaths));
        ev.dataTransfer.setData('x-special/gnome-copied-files', 'copy\n' + dragPaths.join('\n'));
        ev.dataTransfer.effectAllowed = 'copyMove';
      } catch (err) { /* dataTransfer may be restricted */ }
    }, true);

    document.addEventListener('dragend', () => {
      dragPaths = null;
      clearHighlight();
    });

    c.addEventListener('dragover', (ev) => {
      const dt = ev.dataTransfer;
      const dest = dropTarget(ev);
      if (!dest) return;
      if (dragPaths && dragPaths.length) {
        ev.preventDefault();
        dt.dropEffect = ev.ctrlKey ? 'copy' : 'move';
        highlight(dest);
        return;
      }
      if (hasFiles(dt)) {
        ev.preventDefault();
        dt.dropEffect = 'copy';
        highlight(dest);
      }
    });

    c.addEventListener('dragleave', (ev) => {
      if (!c.contains(ev.relatedTarget)) clearHighlight();
    });

    c.addEventListener('drop', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      clearHighlight();
      const tab = curTab();
      const dest = dropTarget(ev);
      if (!tab || !dest) return;
      const internal = dragPaths && dragPaths.length
        ? dragPaths
        : (() => {
          try { return JSON.parse(ev.dataTransfer.getData('application/x-wxpaths') || 'null'); } catch (e) { return null; }
        })();
      dragPaths = null;

      if (internal && internal.length) {
        const sources = internal.filter((p) => !WXCore.isSubPath(p, dest) && WXCore.dirname(p) !== dest);
        if (!sources.length) return;
        const mode = ev.ctrlKey ? 'copy' : 'move';
        let conflict = 'rename';
        try {
          const conflicts = (await wx.planConflicts(sources, dest)) || [];
          if (conflicts.length) {
            const choice = await Dlgs.conflictDialog(conflicts);
            if (!choice) return;
            conflict = choice;
          }
          await Ops.finishPaste(sources, dest, mode, conflict, conflicts);
        } catch (e) { Dlgs.error('Drop failed: ' + (e.message || e)); }
        return;
      }

      const paths = pathsFromDrop(ev.dataTransfer);
      if (!paths.length) return;
      try {
        const conflicts = (await wx.planConflicts(paths, dest)) || [];
        const conflict = conflicts.length ? 'rename' : 'rename';
        await Ops.finishPaste(paths, dest, 'copy', conflict, conflicts);
      } catch (e) { Dlgs.error('Could not copy the dropped items: ' + (e.message || e)); }
    });

    c.addEventListener('mousedown', (ev) => {
      const tab = curTab();
      if (tab && tab.loc.kind === 'fs') startMarquee(ev);
    });
  }

  return { init };
})();
