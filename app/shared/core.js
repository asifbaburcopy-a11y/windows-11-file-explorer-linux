/*
 * WXCore — pure, environment-agnostic helpers shared by the Electron main
 * process, the renderer (as a classic <script>) and the Node unit tests.
 * No Electron or DOM dependencies allowed in this file.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WXCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------------------------------------------------------- paths */

  function normalize(p) {
    if (!p) return '';
    const absolute = p.startsWith('/');
    const parts = [];
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (parts.length && parts[parts.length - 1] !== '..') parts.pop();
        else if (!absolute) parts.push('..');
      } else parts.push(seg);
    }
    return (absolute ? '/' : '') + parts.join('/');
  }

  function join() {
    const parts = [];
    for (let i = 0; i < arguments.length; i++) {
      const s = arguments[i];
      if (s === undefined || s === null || s === '') continue;
      parts.push(String(s));
    }
    if (!parts.length) return '';
    let joined = parts[0];
    for (let i = 1; i < parts.length; i++) {
      const next = parts[i];
      joined = joined.endsWith('/') ? joined.replace(/\/+$/, '') + '/' + next.replace(/^\/+/, '')
                                    : joined + '/' + next.replace(/^\/+/, '');
    }
    return normalize(joined);
  }

  function basename(p) {
    if (!p || p === '/') return p === '/' ? '/' : '';
    const clean = p.replace(/\/+$/, '');
    const idx = clean.lastIndexOf('/');
    return idx === -1 ? clean : clean.slice(idx + 1);
  }

  function dirname(p) {
    if (!p) return '';
    const clean = p.replace(/\/+$/, '');
    if (clean === '') return '/';
    const idx = clean.lastIndexOf('/');
    if (idx === -1) return '.';
    if (idx === 0) return '/';
    return clean.slice(0, idx);
  }

  function extname(name) {
    const b = basename(name);
    const idx = b.lastIndexOf('.');
    if (idx <= 0) return '';
    return b.slice(idx).toLowerCase();
  }

  /* Split a filename into [stem, extWithDot]; ext empty when none.
     "a.tar.gz" -> ["a.tar", ".gz"]; ".bashrc" -> [".bashrc", ""]. */
  function splitName(name) {
    const idx = name.lastIndexOf('.');
    if (idx <= 0) return [name, ''];
    return [name.slice(0, idx), name.slice(idx)];
  }

  /* Windows-style duplicate naming: "file.txt" -> "file (2).txt" */
  function collisionName(name, taken) {
    if (!taken.has(name)) return name;
    const [stem, ext] = splitName(name);
    for (let i = 2; i < 10000; i++) {
      const cand = stem + ' (' + i + ')' + ext;
      if (!taken.has(cand)) return cand;
    }
    return stem + ' (' + Date.now() + ')' + ext;
  }

  function expandHome(p, home) {
    if (!p) return p;
    if (p === '~') return home;
    if (p.startsWith('~/')) return home + p.slice(1);
    return p;
  }

  function isSubPath(parent, child) {
    const a = normalize(parent);
    const b = normalize(child);
    if (a === '/') return b.startsWith('/');
    return b === a || b.startsWith(a + '/');
  }

  function splitCrumbs(p) {
    if (!p || p === '/') return [];
    const clean = p.replace(/\/+$/, '');
    return clean.split('/').filter(Boolean);
  }

  /* ------------------------------------------------------------ formatting */

  const NBSP = '\u00a0';

  function fmtNumber(n) {
    return Number(n).toLocaleString('en-US');
  }

  /* Short size, Explorer-details style: KB/MB/GB, rounded like Explorer. */
  function fmtSizeShort(n) {
    if (n === null || n === undefined || isNaN(n)) return '';
    if (n < 1024) return n + ' bytes';
    const kb = n / 1024;
    if (kb < 1024) return Math.ceil(kb) + ' KB';
    const mb = kb / 1024;
    if (mb < 1024) return trimNum(mb, mb < 100 ? 1 : 0) + ' MB';
    const gb = mb / 1024;
    if (gb < 1024) return trimNum(gb, 1) + ' GB';
    return trimNum(gb / 1024, 1) + ' TB';
  }

  function trimNum(v, decimals) {
    let s = v.toFixed(decimals);
    if (s.includes('.')) s = s.replace(/\.?0+$/, '');
    return s;
  }

  function fmtBytesFull(n) {
    if (n === null || n === undefined || isNaN(n)) return '';
    return fmtNumber(n) + ' bytes';
  }

  /* Windows-style drive capacity: decimal units, e.g. "476 GB" */
  function fmtDriveSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    const gb = bytes / 1e9;
    if (gb < 1) return Math.round(bytes / 1e6) + ' MB';
    if (gb < 1000) return trimNum(gb, gb < 10 ? 1 : 0) + ' GB';
    return trimNum(gb / 1000, 1) + ' TB';
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function fmtDateTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    let h = d.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return d.getMonth() + 1 + '/' + d.getDate() + '/' + d.getFullYear() +
      ' ' + h + ':' + pad2(d.getMinutes()) + ' ' + ampm;
  }

  function fmtDateTimeSec(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    let h = d.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return d.getMonth() + 1 + '/' + d.getDate() + '/' + d.getFullYear() +
      ' ' + h + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + ' ' + ampm;
  }

  function fmtIsoLocal(ms) {
    const d = new Date(ms);
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? '+' : '-';
    const oh = pad2(Math.floor(Math.abs(off) / 60));
    const om = pad2(Math.abs(off) % 60);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + sign + oh + ':' + om;
  }

  function parseIsoLocal(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(s || '');
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  }

  function fmtDuration(ms) { // unused helper, kept for completeness
    return Math.round(ms / 1000) + 's';
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : (many || one + 's'));
  }

  /* ------------------------------------------------------- file type model */

  const EXT_TYPES = {
    '.txt': ['Text Document', 'text'],
    '.log': ['Log File', 'text'],
    '.md': ['Markdown Document', 'text'],
    '.csv': ['CSV File', 'sheet'],
    '.ini': ['Configuration Settings', 'text'],
    '.conf': ['Configuration File', 'text'],
    '.cfg': ['Configuration File', 'text'],
    '.json': ['JSON File', 'code'],
    '.xml': ['XML Document', 'code'],
    '.yaml': ['YAML File', 'code'],
    '.yml': ['YAML File', 'code'],
    '.pdf': ['PDF Document', 'pdf'],
    '.zip': ['Compressed (zipped) Folder', 'archive'],
    '.7z': ['7z Archive', 'archive'],
    '.rar': ['RAR Archive', 'archive'],
    '.tar': ['TAR Archive', 'archive'],
    '.gz': ['GZIP Archive', 'archive'],
    '.tgz': ['TAR Archive', 'archive'],
    '.xz': ['XZ Archive', 'archive'],
    '.bz2': ['BZIP2 Archive', 'archive'],
    '.jpg': ['JPEG image', 'image'],
    '.jpeg': ['JPEG image', 'image'],
    '.png': ['PNG image', 'image'],
    '.gif': ['GIF image', 'image'],
    '.bmp': ['Bitmap image', 'image'],
    '.svg': ['SVG image', 'image'],
    '.webp': ['WEBP image', 'image'],
    '.ico': ['Icon file', 'image'],
    '.avif': ['AVIF image', 'image'],
    '.tiff': ['TIFF image', 'image'],
    '.mp3': ['MP3 Audio', 'audio'],
    '.flac': ['FLAC Audio', 'audio'],
    '.wav': ['WAV Audio', 'audio'],
    '.ogg': ['OGG Audio', 'audio'],
    '.m4a': ['M4A Audio', 'audio'],
    '.opus': ['Opus Audio', 'audio'],
    '.mp4': ['MP4 Video', 'video'],
    '.mkv': ['Matroska Video', 'video'],
    '.avi': ['AVI Video', 'video'],
    '.mov': ['QuickTime Video', 'video'],
    '.webm': ['WebM Video', 'video'],
    '.m4v': ['M4V Video', 'video'],
    '.flv': ['Flash Video', 'video'],
    '.html': ['HTML Document', 'code'],
    '.htm': ['HTML Document', 'code'],
    '.css': ['CSS Stylesheet', 'code'],
    '.js': ['JavaScript File', 'code'],
    '.ts': ['TypeScript File', 'code'],
    '.jsx': ['JavaScript JSX File', 'code'],
    '.tsx': ['TypeScript TSX File', 'code'],
    '.py': ['Python File', 'code'],
    '.c': ['C Source File', 'code'],
    '.cpp': ['C++ Source File', 'code'],
    '.h': ['C/C++ Header File', 'code'],
    '.java': ['Java File', 'code'],
    '.go': ['Go Source File', 'code'],
    '.rs': ['Rust Source File', 'code'],
    '.rb': ['Ruby File', 'code'],
    '.php': ['PHP File', 'code'],
    '.sh': ['Shell Script', 'code'],
    '.bash': ['Shell Script', 'code'],
    '.exe': ['Application', 'exe'],
    '.msi': ['Windows Installer Package', 'exe'],
    '.appimage': ['AppImage', 'exe'],
    '.deb': ['Debian Software Package', 'deb'],
    '.rpm': ['RPM Package', 'deb'],
    '.iso': ['Disc Image File', 'disk'],
    '.img': ['Disk Image File', 'disk'],
    '.dmg': ['Apple Disk Image', 'disk'],
    '.ttf': ['TrueType Font', 'font'],
    '.otf': ['OpenType Font', 'font'],
    '.woff': ['Web Font File', 'font'],
    '.woff2': ['Web Font File', 'font'],
    '.doc': ['Word 97-2003 Document', 'office-doc'],
    '.docx': ['Word Document', 'office-doc'],
    '.odt': ['OpenDocument Text Document', 'office-doc'],
    '.rtf': ['Rich Text Document', 'office-doc'],
    '.xls': ['Excel 97-2003 Worksheet', 'office-sheet'],
    '.xlsx': ['Excel Worksheet', 'office-sheet'],
    '.ods': ['OpenDocument Spreadsheet', 'office-sheet'],
    '.ppt': ['PowerPoint 97-2003 Presentation', 'office-pres'],
    '.pptx': ['PowerPoint Presentation', 'office-pres'],
    '.odp': ['OpenDocument Presentation', 'office-pres'],
    '.eml': ['Email Message', 'text'],
    '.desktop': ['Shortcut', 'shortcut'],
    '.lnk': ['Shortcut', 'shortcut'],
    '.torrent': ['Torrent File', 'text'],
    '.iso.md5': ['Checksum File', 'text'],
    '.md5': ['Checksum File', 'text'],
    '.sha256': ['Checksum File', 'text'],
    '.srt': ['Subtitle File', 'text'],
    '.db': ['Database File', 'text'],
    '.sqlite': ['SQLite Database', 'text'],
    '.pyc': ['Python Compiled File', 'exe']
  };

  const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.avif', '.tiff']);
  const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.webm', '.m4v', '.flv']);
  const ARCHIVE_EXTS = new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.xz', '.bz2']);

  function typeInfo(name, isDir, mode) {
    if (isDir) return { label: 'File folder', cat: 'folder', ext: '' };
    const ext = extname(name);
    const hit = EXT_TYPES[ext];
    if (hit) return { label: hit[0], cat: hit[1], ext };
    if (!ext && mode !== undefined && (mode & 0o111)) return { label: 'Application', cat: 'exe', ext };
    if (!ext) return { label: 'File', cat: 'file', ext };
    const pretty = ext.slice(1).toUpperCase();
    return { label: pretty + ' File', cat: 'file', ext };
  }

  function typeWithExt(info, name) {
    if (info.cat === 'folder') return 'File folder';
    if (!info.ext) return info.label;
    return info.label + ' (' + info.ext + ')';
  }

  /* --------------------------------------------------------------- sorting */

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  /* Explorer sorts folders first, then natural case-insensitive order. */
  function compareEntries(a, b, key, asc) {
    const ad = a.isDir ? 0 : 1;
    const bd = b.isDir ? 0 : 1;
    if (ad !== bd) return ad - bd;
    let r = 0;
    if (key === 'name') r = collator.compare(a.name, b.name);
    else if (key === 'date') r = (a.mtime || 0) - (b.mtime || 0);
    else if (key === 'type') r = collator.compare(typeKey(a), typeKey(b));
    else if (key === 'size') r = (a.isDir ? -1 : (a.size || 0)) - (b.isDir ? -1 : (b.size || 0));
    if (r === 0) r = collator.compare(a.name, b.name);
    return asc ? r : -r;
  }

  function typeKey(e) {
    if (e._typeLabel) return e._typeLabel;
    const t = typeInfo(e.name, e.isDir, e.mode);
    e._typeLabel = t.label;
    return t.label;
  }

  function sortEntries(list, key, asc) {
    return list.slice().sort((a, b) => compareEntries(a, b, key, asc));
  }

  /* ------------------------------------------------------------- grouping */

  function dayBucket(ms, now) {
    const d = new Date(ms || now);
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const that = new Date(d); that.setHours(0, 0, 0, 0);
    const days = Math.round((today - that) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days <= 7) return 'Last Week';
    if (days <= 31) return 'Last Month';
    if (d.getFullYear() === new Date(now).getFullYear()) return 'Earlier This Year';
    return 'Older';
  }

  function sizeBucket(n) {
    if (n === 0) return 'Empty (0 KB)';
    if (n < 10 * 1024) return 'Tiny (0-10 KB)';
    if (n < 1024 * 1024) return 'Small (10 KB - 1 MB)';
    if (n < 16 * 1024 * 1024) return 'Medium (1 - 16 MB)';
    if (n < 128 * 1024 * 1024) return 'Large (16 - 128 MB)';
    if (n < 1024 * 1024 * 1024) return 'Huge (128 MB - 1 GB)';
    return 'Extreme (over 1 GB)';
  }

  function nameBucket(name) {
    const c = (name || '?').trim()[0] || '?';
    if (/[0-9]/.test(c)) return '#';
    if (/[a-zA-Z]/.test(c)) return c.toUpperCase();
    return '~';
  }

  /* Returns [{label, items}] preserving current sort inside groups. */
  function groupEntries(list, groupKey, now) {
    if (!groupKey || groupKey === 'none') return null;
    const map = new Map();
    for (const e of list) {
      let k;
      if (groupKey === 'date') k = dayBucket(e.mtime, now || Date.now());
      else if (groupKey === 'type') k = typeKey(e);
      else if (groupKey === 'size') k = e.isDir ? 'File Folder' : sizeBucket(e.size || 0);
      else if (groupKey === 'name') k = nameBucket(e.name);
      else k = '';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    const groups = [];
    for (const [label, items] of map) groups.push({ label, items });
    groups.sort((a, b) => {
      if (groupKey === 'date') return 0; // dayBucket order is display order
      return collator.compare(a.label, b.label);
    });
    if (groupKey === 'date') {
      const order = ['Today', 'Yesterday', 'Last Week', 'Last Month', 'Earlier This Year', 'Older'];
      groups.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
    }
    return groups;
  }

  /* ------------------------------------------------------ mounts & drives */

  function unescapeMount(s) {
    return (s || '')
      .replace(/\\040/g, ' ').replace(/\\011/g, '\t')
      .replace(/\\012/g, '\n').replace(/\\134/g, '\\');
  }

  function parseMounts(text) {
    const out = [];
    for (const line of String(text || '').split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split(/\s+/);
      if (parts.length < 4) continue;
      out.push({
        device: unescapeMount(parts[0]),
        mount: unescapeMount(parts[1]),
        fstype: parts[2],
        options: parts[3]
      });
    }
    return out;
  }

  const REAL_FS = new Set(['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'f2fs', 'vfat', 'exfat',
    'ntfs', 'ntfs3', 'fuseblk', 'hfsplus', 'zfs', 'udf', 'iso9660', 'erofs', 'jfs', 'reiserfs']);

  function isRealDrive(mount, fstype) {
    if (!REAL_FS.has(fstype)) return false;
    if (mount === '/boot' || mount.startsWith('/boot/')) return false;
    if (mount.startsWith('/snap/')) return false;
    if (mount.startsWith('/var/lib/docker')) return false;
    if (mount.startsWith('/var/lib/lxc')) return false;
    if (mount.startsWith('/var/lib/snapd')) return false;
    return true;
  }

  /* --------------------------------------------------------- trash (FDO) */

  function serializeTrashInfo(originalPath, deletedMs) {
    return '[Trash Info]\nPath=' + originalPath + '\nDeletionDate=' + fmtIsoLocal(deletedMs || Date.now()) + '\n';
  }

  function parseTrashInfo(text) {
    const out = { path: null, deletionDate: null };
    if (!text) return out;
    for (const line of String(text).split('\n')) {
      if (line.startsWith('Path=')) out.path = line.slice(5);
      else if (line.startsWith('DeletionDate=')) out.deletionDate = line.slice(13);
    }
    return out;
  }

  /* -------------------------------------------------------- desktop Exec */

  /* Split a .desktop Exec value into argv, honouring quotes. */
  function execToArgv(exec) {
    const argv = [];
    const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(exec || '')) !== null) argv.push(m[1] ?? m[2] ?? m[3]);
    return argv;
  }

  const FIELD_CODES = new Set(['%f', '%F', '%u', '%U', '%d', '%D', '%n', '%N', '%i', '%c', '%k', '%v', '%m', '%%']);

  /* Remove field codes from argv; return {argv, wantsFile}. */
  function stripFieldCodes(argv) {
    const out = [];
    let wantsFile = false;
    for (const tok of argv) {
      if (tok === '%f' || tok === '%u') { wantsFile = true; continue; }
      if (tok === '%F' || tok === '%U') { wantsFile = true; continue; }
      if (FIELD_CODES.has(tok)) continue;
      out.push(tok);
    }
    return { argv: out, wantsFile };
  }

  /* ------------------------------------------------------------- desktop */

  function parseDesktopEntry(text) {
    const out = {};
    let inEntry = false;
    for (const raw of String(text || '').split('\n')) {
      const line = raw.trim();
      if (line.startsWith('[')) { inEntry = line === '[Desktop Entry]'; continue; }
      if (!inEntry) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      const key = line.slice(0, idx);
      if (!key || key.startsWith('#')) continue;
      out[key] = line.slice(idx + 1);
    }
    return out;
  }

  function parseBool(v, def) {
    if (v === undefined) return def;
    return v === 'true' || v === '1';
  }

  return {
    normalize, join, basename, dirname, extname, splitName, collisionName,
    expandHome, isSubPath, splitCrumbs,
    fmtNumber, fmtSizeShort, fmtBytesFull, fmtDriveSize, fmtDateTime, fmtDateTimeSec,
    fmtIsoLocal, parseIsoLocal, fmtDuration, plural, trimNum,
    EXT_TYPES, IMAGE_EXTS, VIDEO_EXTS, ARCHIVE_EXTS, typeInfo, typeWithExt, typeKey,
    compareEntries, sortEntries, groupEntries, dayBucket, sizeBucket, nameBucket,
    unescapeMount, parseMounts, isRealDrive, REAL_FS,
    serializeTrashInfo, parseTrashInfo,
    execToArgv, stripFieldCodes, FIELD_CODES, parseDesktopEntry, parseBool
  };
});
