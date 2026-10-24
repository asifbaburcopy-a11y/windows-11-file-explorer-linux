/*
 * special.js — loaders for non-filesystem locations: Home (Quick access),
 * This PC, Recycle Bin, Gallery and Network.
 */
'use strict';

const Special = (() => {
  const KNOWN = ['Desktop', 'Documents', 'Downloads', 'Music', 'Pictures', 'Videos'];

  async function existsDir(p) {
    return wx.stat(p).then((s) => !!(s && s.isDir)).catch(() => false);
  }

  async function loadHome() {
    const home = (S.appInfo && S.appInfo.home) || '';
    let pinnedPaths = S.settings.pinned || [];
    if (!pinnedPaths.length) {
      pinnedPaths = KNOWN.map((n) => home + '/' + n);
    }
    const pinned = pinnedPaths.map((p) => ({ name: WXCore.basename(p), path: p }));
    /* Windows never offers pinned folders that no longer exist. */
    const alive = await Promise.all(pinned.map((x) => existsDir(x.path)));
    return { pinned: pinned.filter((x, i) => alive[i]) };
  }

  async function loadThisPc() {
    const home = (S.appInfo && S.appInfo.home) || '';
    const [d, network] = await Promise.all([
      wx.drives().catch(() => ({ drives: [], ejected: [] })),
      wx.network().catch(() => [])
    ]);
    /* Only offer known folders that actually exist on this machine. */
    const names = KNOWN.slice();
    const alive = await Promise.all(names.map((n) => existsDir(home + '/' + n)));
    const folders = names
      .filter((n, i) => alive[i])
      .map((n) => ({ name: n, path: home + '/' + n }));
    return { drives: d.drives || [], ejected: d.ejected || [], network: network || [], folders };
  }

  async function loadBin() {
    const items = await wx.trashList();
    return { items: items || [] };
  }

  async function loadGallery() {
    const items = await wx.gallery();
    return { items: items || [] };
  }

  async function loadNetwork() {
    const items = await wx.network();
    return { items: items || [] };
  }

  async function load(loc) {
    switch (loc.kind) {
      case 'home': return loadHome();
      case 'thispc': return loadThisPc();
      case 'bin': return loadBin();
      case 'gallery': return loadGallery();
      case 'network': return loadNetwork();
      default: return {};
    }
  }

  return { load, KNOWN };
})();
