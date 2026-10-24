/*
 * system.js — desktop integration: open files, "Open with" app registry,
 * terminal here, default-file-manager query/set, mimeapps fallback.
 */
'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile, spawn, exec } = require('child_process');
const core = require('../shared/core');

const APP_DIRS = [
  path.join(os.homedir(), '.local', 'share', 'applications'),
  '/usr/share/applications',
  '/var/lib/snapd/desktop/applications',
  '/usr/local/share/applications'
];

const DESKTOP_ID = 'winexplorer.desktop';

/* ------------------------------------------------------------- opening */

/* xdg-open happily exits 0 even when the default association is a ghost
   (desktop file removed, binary gone), which leaves the user staring at
   nothing. Check the handler's health before trusting it. */
const brokenHandlers = new Map(); // mime -> bool

function desktopFileDirs() {
  const env = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':');
  return [path.join(os.homedir(), '.local', 'share', 'applications')]
    .concat(env.map((d) => path.join(d, 'applications')));
}

function findDesktopFile(id) {
  for (const d of desktopFileDirs()) {
    const f = path.join(d, id);
    try { fs.accessSync(f, fs.constants.R_OK); return f; } catch (e) { }
  }
  return null;
}

async function defaultHandlerBroken(p) {
  let mime = null;
  try {
    const r = await runCapture('xdg-mime', ['query', 'filetype', p]);
    mime = r.out || null;
  } catch (e) { mime = null; }
  if (!mime || mime === 'inode/directory') return false;
  if (brokenHandlers.has(mime)) return brokenHandlers.get(mime);
  let broken = true;
  try {
    const r = await runCapture('xdg-mime', ['query', 'default', mime]);
    const id = r.out;
    if (id) {
      const file = findDesktopFile(id);
      if (file) {
        const parsed = parseDesktopFile(file, id);
        /* parseDesktopFile returns lowercase `exec` (not desktop-file `Exec`). */
        if (parsed && parsed.exec) {
          const argv = execForFile(parsed.exec, p);
          const bin = argv[0];
          if (bin) {
            if (bin.includes('/')) {
              try { fs.accessSync(bin, fs.constants.X_OK); broken = false; } catch (e) { broken = true; }
            } else {
              broken = !whichSync(bin);
            }
          }
        }
      }
    }
  } catch (e) { broken = false; /* fail open: let xdg-open try */ }
  brokenHandlers.set(mime, broken);
  return broken;
}

function openPathOnce(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { detached: true, stdio: 'ignore', timeout: 8000 }, (err) => {
      if (err && err.killed) return resolve({ ok: true, timedOut: true }); // handoff done
      resolve({ ok: !err, error: err ? err.message : '' });
    });
  });
}

async function openPath(p) {
  if (await defaultHandlerBroken(p)) {
    return { ok: false, code: 'NOHANDLER', error: 'No default app is set for this file type.' };
  }
  const r = await openPathOnce('xdg-open', [p]);
  if (r.ok) return r;
  const g = await openPathOnce('gio', ['open', p]);
  if (g.ok) return g;
  return { ok: false, code: 'EOPEN', error: r.error || g.error || 'Could not open the file.' };
}

function showInFolder(p) {
  return openPath(path.dirname(p));
}

/* --------------------------------------------------------- app registry */

function parseDesktopFile(file, id) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const entry = core.parseDesktopEntry(text);
    if (!entry || entry.Type !== 'Application') return null;
    if (core.parseBool(entry.NoDisplay, false) || core.parseBool(entry.Hidden, false)) return null;
    if (!entry.Exec || !entry.Name) return null;
    return {
      id,
      name: entry.Name,
      genericName: entry.GenericName || '',
      exec: entry.Exec,
      icon: entry.Icon || '',
      comment: entry.Comment || '',
      file
    };
  } catch (e) {
    return null;
  }
}

let appCache = null;
async function listApps(force) {
  if (appCache && !force) return appCache;
  const byId = new Map();
  for (const dir of APP_DIRS) {
    let names = [];
    try { names = await fsp.readdir(dir); } catch (e) { continue; }
    for (const n of names) {
      if (!n.endsWith('.desktop')) continue;
      const parsed = parseDesktopFile(path.join(dir, n), n);
      if (parsed && !byId.has(parsed.id)) byId.set(parsed.id, parsed);
    }
  }
  const list = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  appCache = list;
  return list;
}

/* Expand an Exec line for one target path into [cmd, ...args]. */
function execForFile(execLine, targetPath) {
  const raw = core.execToArgv(execLine);
  const { argv, wantsFile } = core.stripFieldCodes(raw);
  if (wantsFile && targetPath) argv.push(targetPath);
  return argv;
}

function launchApp(app, targetPath) {
  const argv = execForFile(app.exec, targetPath);
  if (!argv.length) return { ok: false, error: 'Invalid Exec entry' };
  try {
    const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore', cwd: path.dirname(targetPath || process.cwd()) });
    child.unref();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* --------------------------------------------------------- terminal here */

const TERMINAL_HINTS = [
  { cmd: 'kgx', args: (cwd) => ['--working-directory=' + cwd] },
  { cmd: 'gnome-terminal', args: (cwd) => ['--working-directory=' + cwd] },
  { cmd: 'konsole', args: (cwd) => ['--workdir', cwd] },
  { cmd: 'xfce4-terminal', args: (cwd) => ['--working-directory=' + cwd] },
  { cmd: 'tilix', args: (cwd) => ['--working-directory=' + cwd] },
  { cmd: 'terminator', args: (cwd) => ['--working-directory=' + cwd] },
  { cmd: 'alacritty', args: (cwd) => ['--working-directory', cwd] },
  { cmd: 'kitty', args: (cwd) => ['--directory', cwd] },
  { cmd: 'foot', args: (cwd) => ['--working-directory', cwd] },
  { cmd: 'ghostty', args: (cwd) => ['--working-directory=' + cwd] },
  { cmd: 'xterm', args: (cwd) => ['-e', 'sh', '-lc', 'cd "$1" && exec "${SHELL:-/bin/sh}"', 'sh', cwd] }
];

function whichSync(cmd) {
  const paths = (process.env.PATH || '').split(':');
  for (const p of paths) {
    const full = path.join(p, cmd);
    try { fs.accessSync(full, fs.constants.X_OK); return full; } catch (e) { }
  }
  return null;
}

function openTerminal(cwd) {
  const tried = [];
  const pref = process.env.TERMINAL;
  if (pref) {
    const [bin, ...rest] = core.execToArgv(pref);
    if (bin && whichSync(bin)) {
      tried.push(bin);
      try {
        const child = spawn(bin, [...rest, '--working-directory=' + cwd], { detached: true, stdio: 'ignore' });
        child.on('error', () => { });
        child.unref();
        return { ok: true, terminal: bin };
      } catch (e) { /* try next */ }
    }
  }
  for (const t of TERMINAL_HINTS) {
    if (tried.includes(t.cmd)) continue;
    if (!whichSync(t.cmd)) continue;
    try {
      const child = spawn(t.cmd, t.args(cwd), { detached: true, stdio: 'ignore' });
      child.on('error', () => { });
      child.unref();
      return { ok: true, terminal: t.cmd };
    } catch (e) { /* try next */ }
  }
  return { ok: false, error: 'No supported terminal emulator found (looked for GNOME Terminal, Konsole, xterm, …).' };
}

/* -------------------------------------------------- default file manager */

function runCapture(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000 }, (err, stdout) => {
      resolve({ out: (stdout || '').trim(), err });
    });
  });
}

async function queryDefaultFileManager() {
  const { out } = await runCapture('xdg-mime', ['query', 'default', 'inode/directory']);
  return out || null;
}

async function isDefaultFileManager() {
  const id = await queryDefaultFileManager();
  return { isDefault: id === DESKTOP_ID, current: id };
}

/* Fallback: patch ~/.config/mimeapps.list directly. */
function setDefaultViaMimeapps() {
  const file = path.join(os.homedir(), '.config', 'mimeapps.list');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { }
    const lines = text.split('\n');
    const out = [];
    let section = null;
    let replaced = false;
    const keyRe = /^inode\/directory=/;
    for (const line of lines) {
      if (/^\[.*\]$/.test(line.trim())) {
        if (section === '[Default Applications]' && !replaced) {
          out.push('inode/directory=' + DESKTOP_ID);
          replaced = true;
        }
        section = line.trim();
        out.push(line);
        continue;
      }
      if (section === '[Default Applications]' && keyRe.test(line.trim())) {
        out.push('inode/directory=' + DESKTOP_ID);
        replaced = true;
        continue;
      }
      out.push(line);
    }
    if (section === '[Default Applications]' && !replaced) out.push('inode/directory=' + DESKTOP_ID);
    if (!section) {
      if (out.length && out[out.length - 1] === '') out.pop();
      out.push('', '[Default Applications]', 'inode/directory=' + DESKTOP_ID);
    }
    fs.writeFileSync(file, out.join('\n').replace(/\n{3,}/g, '\n\n'));
    return true;
  } catch (e) {
    console.error('[setDefault] mimeapps fallback failed:', e.message);
    return false;
  }
}

async function setDefaultFileManager() {
  // 1) xdg-mime (preferred — it merges mimeapps.list correctly)
  const r = await runCapture('xdg-mime', ['default', DESKTOP_ID, 'inode/directory']);
  let ok = !r.err;
  // 2) verify
  let current = await queryDefaultFileManager();
  if (current !== DESKTOP_ID) {
    const fallbackOk = setDefaultViaMimeapps();
    current = await queryDefaultFileManager();
    if (current !== DESKTOP_ID && fallbackOk) current = DESKTOP_ID; // xdg-mime may not refresh in-process
    ok = current === DESKTOP_ID;
  }
  return { ok, current };
}

/* Post-install flag written by the Debian maintainer script. */
const POSTINST_FLAG = '/var/lib/winexplorer/default-asked';

function defaultAskState() {
  let postinstAsked = false;
  try { postinstAsked = fs.existsSync(POSTINST_FLAG); } catch (e) { }
  return { postinstAsked, postinstFlag: POSTINST_FLAG };
}

module.exports = {
  DESKTOP_ID, openPath, showInFolder, listApps, launchApp, execForFile,
  openTerminal, queryDefaultFileManager, isDefaultFileManager, setDefaultFileManager,
  defaultAskState, setDefaultViaMimeapps
};
