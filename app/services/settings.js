/*
 * settings.js — persistent app settings stored as JSON in the Electron
 * userData directory (~/.config/winexplorer/settings.json).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  viewMode: 'details',          // xl | lg | md | sm | list | details | tiles | content
  sortBy: 'name',               // name | date | type | size
  sortAsc: true,
  groupBy: 'none',              // none | name | date | type | size
  showHidden: false,
  showExtensions: true,
  theme: 'system',              // system | light | dark
  openTo: 'home',               // home | thispc  (startup location)
  singleClick: false,
  neverThumbs: false,
  detailsPane: false,
  previewPane: false,           // Alt+P content preview pane
  previewWidth: 320,
  askedDefault: false,          // first-run "default file manager" question answered
  pinned: [],                   // quick-access pinned absolute paths
  navWidth: 232,
  detailsCols: null,            // visible details columns (null = default set)
  detailsWidths: {},            // column -> px
  folderViews: {},              // per-folder remembered view/sort/group
  windowBounds: null,           // {x,y,width,height,maximized}
  galleryDirs: []               // extra folders scanned by Gallery
};

class SettingsStore {
  constructor(file) {
    this.file = file;
    this.data = Object.assign({}, DEFAULTS);
    this._timer = null;
    this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') this.data = Object.assign({}, DEFAULTS, parsed);
    } catch (e) { /* first run or corrupt file — defaults are fine */ }
  }

  get() { return this.data; }

  set(patch) {
    Object.assign(this.data, patch);
    this._scheduleSave();
    return this.data;
  }

  _scheduleSave() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveNow(), 250);
  }

  saveNow() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[settings] save failed:', e.message);
    }
  }
}

module.exports = { SettingsStore, DEFAULTS };
