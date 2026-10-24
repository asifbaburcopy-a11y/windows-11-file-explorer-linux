/*
 * util.js — DOM helpers and shared renderer utilities.
 */
'use strict';

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

/*
 * h('div', {class:'x', text:'hi', onclick: fn}, child, child…)
 * Children may be nodes, strings, arrays or null.
 */
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value') el.value = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) appendChildren(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Line-icon markup helper: I('back', 'cls', 16) */
function I(name, cls, size) {
  const body = ICONS[name] || '';
  const s = size || '';
  return '<svg class="ico ico-line ' + (cls || '') + '"' + (s ? ' width="' + s + '" height="' + s + '"' : '') +
    ' viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.55" ' +
    'stroke-linecap="round" stroke-linejoin="round">' + body + '</g></svg>';
}

/* Icon for a filesystem entry (folder / file category). */
function entryIcon(e) {
  if (e.isDir) return folderSvg();
  return fileSvg(e._cat || (e._cat = WXCore.typeInfo(e.name, false, e.mode).cat));
}

function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function formatSize(n) { return WXCore.fmtSizeShort(n); }
function formatDate(ms) { return WXCore.fmtDateTime(ms); }
function pluralize(n, one, many) { return WXCore.plural(n, one, many); }

/* file:// URL for an absolute path (for <img src>) */
function fileUrl(p) {
  const parts = String(p).split('/').map((seg) => encodeURIComponent(seg));
  return 'file://' + parts.join('/');
}

function isImageEntry(e) {
  return !e.isDir && WXCore.IMAGE_EXTS.has(WXCore.extname(e.name));
}

/* Enter/Escape-aware one-shot key handler for inline inputs */
function commitInput(input, onCommit, onCancel) {
  input.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter') { ev.preventDefault(); onCommit(input.value); }
    else if (ev.key === 'Escape') { ev.preventDefault(); onCancel(); }
  });
}

function isTypingTarget(ev) {
  const t = ev.target;
  if (!t) return false;
  const tag = (t.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
}
