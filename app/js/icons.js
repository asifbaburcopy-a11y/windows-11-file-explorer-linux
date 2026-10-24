/*
 * icons.js — SVG icon library.
 * Line icons share stroke attributes; file/folder/drive icons are colored.
 */
'use strict';

const ICONS = {
  /* navigation */
  back: '<path d="M20 12H4.5"/><path d="M11 5.5 4.5 12 11 18.5"/>',
  forward: '<path d="M4 12h15.5"/><path d="M13 5.5 19.5 12 13 18.5"/>',
  up: '<path d="M12 20V4.5"/><path d="M5.5 11 12 4.5 18.5 11"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5V9H15"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.2"/><path d="M15.2 15.2 20 20"/>',

  /* places */
  home: '<path d="M3.8 11.3 12 4.5l8.2 6.8"/><path d="M6.3 10.2V19.5h11.4V10.2"/><path d="M10 19.5v-5h4v5"/>',
  gallery: '<path d="M4 6h16v12.5H4z"/><circle cx="8.7" cy="10" r="1.4"/><path d="M4 15.5l4.4-3.9 3.4 3 2.8-2.4L20 15.9"/>',
  desktop: '<path d="M3 5h18v10.5H3z"/><path d="M9 19.5h6"/><path d="M12 15.5v4"/>',
  download: '<path d="M12 4v10.5"/><path d="M8 10.8l4 4 4-4"/><path d="M4.5 19.5h15"/>',
  doc: '<path d="M6.5 3h7.5l4 4v14h-11.5z"/><path d="M14 3v4h4"/><path d="M9 12.5h6"/><path d="M9 15.5h6"/><path d="M9 18.5h4"/>',
  pictures: '<path d="M4 6h16v12.5H4z"/><circle cx="8.7" cy="10" r="1.4"/><path d="M4 15.5l4.4-3.9 3.4 3 2.8-2.4L20 15.9"/>',
  music: '<path d="M9.5 17.5V6.2l8.5-2v10.6"/><circle cx="7.3" cy="17.7" r="2.2"/><circle cx="15.8" cy="15.2" r="2.2"/>',
  video: '<path d="M3.5 6h17v12h-17z"/><path d="M10 9.3v5.4l4.8-2.7z" fill="currentColor" stroke="none"/>',
  thispc: '<path d="M3.2 4.8h17.6v10.7H3.2z"/><path d="M8.5 19.5h7"/><path d="M12 15.5v4"/><path d="M5.7 12.8h5.5"/>',
  network: '<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8"/><path d="M12 3.6c2.4 2.3 3.7 5.2 3.7 8.4s-1.3 6.1-3.7 8.4c-2.4-2.3-3.7-5.2-3.7-8.4S9.6 5.9 12 3.6z"/>',
  terminal: '<path d="M4 4.5h16v15H4z"/><path d="M7.5 9.2l3 3-3 3"/><path d="M13 15.2h4"/>',

  /* command bar / actions */
  cut: '<circle cx="6.3" cy="6.5" r="2.6"/><circle cx="6.3" cy="17.5" r="2.6"/><path d="M8.5 8.1 19.5 19"/><path d="M19.5 5 8.5 15.9"/>',
  copy: '<path d="M9 9h11v11.5H9z"/><path d="M6 15.5H4.5V4H15v1.6"/>',
  paste: '<path d="M9.5 4.5h5v2.2h-5z"/><path d="M8.2 5.7H6.4a1.2 1.2 0 0 0-1.2 1.2v12.4a1.2 1.2 0 0 0 1.2 1.2h11.2a1.2 1.2 0 0 0 1.2-1.2V6.9a1.2 1.2 0 0 0-1.2-1.2h-1.8"/><path d="M8.8 11.5h6.4v6.8H8.8z"/>',
  rename: '<path d="M4.5 19.5l1-4L16.8 4.3a2 2 0 0 1 2.9 2.9L8.4 18.5z"/><path d="M14.8 6.3l2.9 2.9"/>',
  share: '<path d="M12 15.5V3.8"/><path d="M8.2 7.4 12 3.6l3.8 3.8"/><path d="M5.5 12.5v7.2h13v-7.2"/>',
  trash: '<path d="M4.5 6.5h15"/><path d="M9 6.5V5.2a1.6 1.6 0 0 1 1.6-1.6h2.8A1.6 1.6 0 0 1 15 5.2v1.3"/><path d="M6.6 6.5 7.5 20a1.6 1.6 0 0 0 1.6 1.5h5.8a1.6 1.6 0 0 0 1.6-1.5l.9-13.5"/><path d="M10.2 10.5v6.3"/><path d="M13.8 10.5v6.3"/>',
  sort: '<path d="M4.5 6.5h15"/><path d="M4.5 11.5h9.5"/><path d="M4.5 16.5h6"/><path d="M17.5 11v7"/><path d="M14.7 15.3l2.8 2.8 2.8-2.8"/>',
  view: '<path d="M4 4.5h6.7v6.7H4z"/><path d="M13.3 4.5H20v6.7h-6.7z"/><path d="M4 13.3h6.7V20H4z"/><path d="M13.3 13.3H20V20h-6.7z"/>',
  dots: '<circle cx="5.2" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="18.8" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 4.8v14.4"/><path d="M4.8 12h14.4"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
  chevronR: '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  chevronD: '<path d="M5.5 9.5 12 16l6.5-6.5"/>',
  chevronU: '<path d="M5.5 14.5 12 8l6.5 6.5"/>',
  check: '<path d="M5 12.5 10 17.5 19.5 7"/>',
  info: '<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5.6"/><circle cx="12" cy="7.7" r="1" fill="currentColor" stroke="none"/>',
  pin: '<path d="M9.2 3.8h5.6l-.8 5.4 3.2 3.1H6.8l3.2-3.1z"/><path d="M12 12.3v7.9"/>',
  unpin: '<path d="M9.2 3.8h5.6l-.8 5.4 3.2 3.1H6.8l3.2-3.1z"/><path d="M12 12.3v7.9"/><path d="M4.5 4.5l15 15"/>',
  restore: '<path d="M8.2 7.2H15a5.4 5.4 0 0 1 0 10.8H10"/><path d="M8.2 7.2l4-4"/><path d="M8.2 7.2l4 4"/>',
  newFolder: '<path d="M3 18.8V6a1.4 1.4 0 0 1 1.4-1.4h4.4l1.7 2.1h8.1A1.4 1.4 0 0 1 20 8.1v10.7a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 18.8z"/><path d="M14.7 12.4v5.4"/><path d="M12 15.1h5.4"/>',
  openWith: '<path d="M14 4.2h5.8V10"/><path d="M19.8 4.2 12 12"/><path d="M18.2 13.6V19a1.2 1.2 0 0 1-1.2 1.2H5.2A1.2 1.2 0 0 1 4 19V7a1.2 1.2 0 0 1 1.2-1.2h5.4"/>',
  windowIcon: '<path d="M3.5 5.5h17v13h-17z"/><path d="M3.5 9h17"/><path d="M6 7.2h.01" fill="currentColor"/>',
  tabIcon: '<path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l1.6 1.8H19a1.5 1.5 0 0 1 1.5 1.5v8.2A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M12 10.2v5"/><path d="M9.5 12.7h5"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.2v2.6"/><path d="M12 18.2v2.6"/><path d="M3.2 12h2.6"/><path d="M18.2 12h2.6"/><path d="M5.7 5.7l1.9 1.9"/><path d="M16.4 16.4l1.9 1.9"/><path d="M18.3 5.7l-1.9 1.9"/><path d="M7.6 16.4l-1.9 1.9"/>',
  warning: '<path d="M12 3.8 21.5 20H2.5z"/><path d="M12 9.8v4.8"/><circle cx="12" cy="17.2" r="1" fill="currentColor" stroke="none"/>',
  eject: '<path d="M6 14.5 12 7l6 7.5z"/><path d="M5.5 18h13"/>',
  selectAll: '<path d="M4 4.5h6.7v6.7H4z"/><path d="M13.3 4.5H20v6.7h-6.7z"/><path d="M4 13.3h6.7V20H4z"/><path d="M13.6 13.6l5.9 5.9"/><path d="M19.5 16v3.5H16"/>',
  undo: '<path d="M8.2 7.2H15a5.4 5.4 0 0 1 0 10.8H10"/><path d="M8.2 7.2l4-4"/><path d="M8.2 7.2l4 4"/>',
  redo: '<path d="M15.8 7.2H9a5.4 5.4 0 0 0 0 10.8h5"/><path d="M15.8 7.2l-4-4"/><path d="M15.8 7.2l-4 4"/>',

  /* view modes */
  vXL: '<path d="M5.5 5.5h13v13h-13z" rx="1"/>',
  vLG: '<path d="M4 4.5h7v7H4z"/><path d="M13 4.5h7v7h-7z"/><path d="M4 13h7v7H4z"/><path d="M13 13h7v7h-7z"/>',
  vMD: '<path d="M5 5h6v6H5z"/><path d="M13 5h6v6h-6z"/><path d="M5 13h6v6H5z"/><path d="M13 13h6v6h-6z"/>',
  vSM: '<path d="M4.5 4.5h4v4h-4z"/><path d="M10.5 4.5h4v4h-4z"/><path d="M16.5 4.5h4v4h-4z"/><path d="M4.5 10.5h4v4h-4z"/><path d="M10.5 10.5h4v4h-4z"/><path d="M16.5 10.5h4v4h-4z"/><path d="M4.5 16.5h4v4h-4z"/><path d="M10.5 16.5h4v4h-4z"/><path d="M16.5 16.5h4v4h-4z"/>',
  vList: '<path d="M4.5 6.5h1.4"/><path d="M8.5 6.5H20"/><path d="M4.5 12h1.4"/><path d="M8.5 12H20"/><path d="M4.5 17.5h1.4"/><path d="M8.5 17.5H20"/>',
  vDetails: '<path d="M4 5h16v14H4z"/><path d="M4 9.5h16"/><path d="M9.5 9.5V19"/>',
  vTiles: '<path d="M4 5.5h6.5v5H4z"/><path d="M4 13.5h6.5v5H4z"/><path d="M12.5 7.5H20"/><path d="M12.5 10.5H18"/><path d="M12.5 15.5H20"/><path d="M12.5 18.5H18"/>',
  vContent: '<path d="M4 6h4v4H4z"/><path d="M10.5 6.5H20"/><path d="M10.5 9.5H17"/><path d="M4 14h4v4H4z"/><path d="M10.5 14.5H20"/><path d="M10.5 17.5H17"/>',
  filter: '<path d="M4 5.5h16l-6.2 7v6.2l-3.6-1.8v-4.4z"/>'
};

/* ------------------------------------------------------------- colored */

function folderSvg(cls) {
  return '<svg viewBox="0 0 24 24" class="ico ico-folder ' + (cls || '') + '" aria-hidden="true">' +
    '<path d="M2.2 5.9C2.2 4.8 3.1 4 4.2 4h4.2c.45 0 .87.2 1.15.55L11.4 6h8.4c1.1 0 2 .9 2 2v9.4c0 1.1-.9 2-2 2H4.2c-1.1 0-2-.9-2-2z" fill="var(--folder-back)"/>' +
    '<path d="M2.2 9.6h19.6v7.8c0 1.1-.9 2-2 2H4.2c-1.1 0-2-.9-2-2z" fill="var(--folder-front)"/>' +
    '<path d="M2.2 9.6h19.6" stroke="rgba(0,0,0,.14)" stroke-width=".7"/>' +
    '</svg>';
}

function driveSvg(cls, removable) {
  const led = removable ? '#3FA552' : '#4C8BF5';
  return '<svg viewBox="0 0 24 24" class="ico ico-drive ' + (cls || '') + '" aria-hidden="true">' +
    '<rect x="2.2" y="6.8" width="19.6" height="10.4" rx="1.8" fill="var(--drive-body)" stroke="var(--drive-edge)" stroke-width="1"/>' +
    '<path d="M2.2 13.4h19.6" stroke="var(--drive-edge)" stroke-width="1"/>' +
    '<circle cx="18.4" cy="16" r="1.05" fill="' + led + '"/>' +
    '<rect x="4.6" y="9" width="7" height="2.2" rx="1.1" fill="var(--drive-slot)"/>' +
    '</svg>';
}

function usbSvg(cls) {
  return '<svg viewBox="0 0 24 24" class="ico ' + (cls || '') + '" aria-hidden="true">' +
    '<path d="M9 3.5h6v4.5H9z" fill="var(--drive-slot)" stroke="var(--drive-edge)" stroke-width="1"/>' +
    '<rect x="7.2" y="8" width="9.6" height="12.5" rx="1.6" fill="var(--drive-body)" stroke="var(--drive-edge)" stroke-width="1"/>' +
    '<path d="M12 11v5.5" stroke="var(--drive-edge)" stroke-width="1.4" stroke-linecap="round"/>' +
    '<circle cx="14.4" cy="12" r="1" fill="#4C8BF5"/>' +
    '</svg>';
}

/* White page with a colored glyph — one icon per file category. */
function fileSvg(cat) {
  const page = '<path d="M6.5 2.6h7.1L18.4 7.9V21.4H6.5z" fill="var(--file-page)" stroke="var(--file-edge)" stroke-width="1.1" stroke-linejoin="round"/>' +
    '<path d="M13.6 2.6v5.3h4.8" fill="none" stroke="var(--file-edge)" stroke-width="1.1" stroke-linejoin="round"/>';
  const g = {
    text: '<path d="M8.7 12.6h6.6M8.7 15h6.6M8.7 17.4h4.6" stroke="#3E7BD8" stroke-width="1.3" stroke-linecap="round"/>',
    code: '<path d="M10.4 12.8 8.2 15.2l2.2 2.4M13.6 12.8l2.2 2.4-2.2 2.4M12.6 12.2l-1.2 6" stroke="#D9822B" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>',
    pdf: '<rect x="8.4" y="12.6" width="7.2" height="4.6" rx=".8" fill="#E0484D"/><text x="12" y="16" text-anchor="middle" font-size="3.3" font-weight="700" fill="#fff" font-family="sans-serif">PDF</text>',
    archive: '<path d="M11.2 11.6v1.1M11.2 14v1.1M11.2 16.4v1.1" stroke="#8A8A8A" stroke-width="1.6" stroke-linecap="round"/><rect x="10.1" y="10.4" width="2.2" height="2" rx=".5" fill="#8A8A8A"/><rect x="9.7" y="18" width="3" height="2" rx=".6" fill="#6E6E6E"/>',
    image: '<rect x="8.4" y="12.3" width="7.2" height="5.4" rx=".6" fill="#E7F2FE"/><circle cx="10.3" cy="14" r="1" fill="#F5B942"/><path d="M8.4 17.7l2.3-2.3 1.8 1.7 1.5-1.4 1.6 2z" fill="#54A05C"/>',
    audio: '<path d="M10.6 17.9V12l5.2-1.4v4.6" stroke="#5B7FE8" stroke-width="1.3" fill="none"/><circle cx="9.4" cy="18" r="1.5" fill="#5B7FE8"/><circle cx="14.6" cy="16.2" r="1.5" fill="#5B7FE8"/>',
    video: '<rect x="8.4" y="12.4" width="7.4" height="5.4" rx="1" fill="#4A5BC4"/><path d="M11.2 14v2.9l2.6-1.5z" fill="#fff"/>',
    exe: '<rect x="8.4" y="12.4" width="7.4" height="5.4" rx="1" fill="#EAF2FD" stroke="#3E7BD8" stroke-width="1"/><path d="M8.4 14.1h7.4" stroke="#3E7BD8" stroke-width="1"/><circle cx="9.7" cy="13.3" r=".45" fill="#3E7BD8"/><circle cx="11.1" cy="13.3" r=".45" fill="#3E7BD8"/>',
    deb: '<circle cx="12" cy="15" r="3.4" fill="#D8552A"/><path d="M10.2 16.4c.8-2.3 3-2.6 4.3-1.2" stroke="#fff" stroke-width="1.1" fill="none" stroke-linecap="round"/><circle cx="13.4" cy="13.6" r=".8" fill="#fff"/>',
    disk: '<circle cx="12" cy="15" r="3.4" fill="none" stroke="#5C6B7F" stroke-width="1.2"/><circle cx="12" cy="15" r="1.1" fill="#5C6B7F"/><path d="M9.8 12.8a3.3 3.3 0 0 1 2.4-1.4" stroke="#9FB6D8" stroke-width="1" fill="none"/>',
    font: '<text x="12" y="18.4" text-anchor="middle" font-size="9" font-weight="700" fill="#333" font-family="serif">A</text>',
    sheet: '<rect x="8.4" y="12.4" width="7.4" height="5.4" rx=".7" fill="#1E7045"/><path d="M8.4 14.6h7.4M8.4 16.4h7.4M11 12.4v5.4M13.4 12.4v5.4" stroke="#fff" stroke-width=".7"/>',
    'office-doc': '<rect x="8.4" y="12.4" width="7.4" height="5.4" rx=".7" fill="#2B579A"/><text x="12.1" y="16.6" text-anchor="middle" font-size="4.6" font-weight="700" fill="#fff" font-family="sans-serif">W</text>',
    'office-sheet': '<rect x="8.4" y="12.4" width="7.4" height="5.4" rx=".7" fill="#1E7045"/><text x="12.1" y="16.6" text-anchor="middle" font-size="4.6" font-weight="700" fill="#fff" font-family="sans-serif">X</text>',
    'office-pres': '<rect x="8.4" y="12.4" width="7.4" height="5.4" rx=".7" fill="#C8501E"/><text x="12.1" y="16.6" text-anchor="middle" font-size="4.6" font-weight="700" fill="#fff" font-family="sans-serif">P</text>',
    shortcut: '<path d="M15.4 11.8l-4.6 4.6" stroke="#2E7CD6" stroke-width="1.5" stroke-linecap="round"/><path d="M14.6 17.4v-3.8h3.8" stroke="#2E7CD6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M9 12.4h3.4" stroke="#9AA0A6" stroke-width="1.2" stroke-linecap="round"/>',
    file: '<path d="M8.7 12.8h6.6M8.7 15.2h6.6M8.7 17.6h4.6" stroke="#9AA0A6" stroke-width="1.3" stroke-linecap="round"/>'
  }[cat] || '';
  return '<svg viewBox="0 0 24 24" class="ico ico-file" aria-hidden="true">' + page + g + '</svg>';
}
