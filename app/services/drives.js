/*
 * drives.js — This PC data: mounted drives with capacity, removable
 * devices (mount/unmount via udisksctl/gio), and gvfs network locations.
 */
'use strict';
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');
const core = require('../shared/core');

const GVFS_ROOT = path.join('/run/user', String(process.getuid ? process.getuid() : ''), 'gvfs');

function readMounts() {
  try { return core.parseMounts(fs.readFileSync('/proc/mounts', 'utf8')); } catch (e) { return []; }
}

function lsblkLabels() {
  try {
    const out = execFileSync('lsblk', ['-J', '-b', '-o', 'PATH,LABEL,FSTYPE,SIZE,MOUNTPOINT,RM,TYPE'],
      { encoding: 'utf8', timeout: 4000 });
    const j = JSON.parse(out);
    const map = new Map();
    const unmounted = [];
    const walk = (nodes) => {
      for (const n of nodes || []) {
        if (n.path) {
          map.set(n.path, {
            label: n.label || '', fstype: n.fsusage || n.fstype || '',
            size: n.size || 0, mountpoint: n.mountpoint || '', rm: !!n.rm, type: n.type
          });
        }
        if (n.children) walk(n.children);
        // unmounted removable whole-disk devices
        if (n.type === 'disk' && n.rm && !n.mountpoint && (n.children || []).every((c) => !c.mountpoint)) {
          unmounted.push({ path: n.path, size: n.size || 0, label: n.label || '', removable: true });
        }
      }
    };
    walk(j.blockdevices);
    return { map, unmounted };
  } catch (e) {
    return { map: new Map(), unmounted: [] };
  }
}

async function statfsSafe(p) {
  try {
    const st = await fsp.statfs(p);
    const bs = st.bsize || 4096;
    return { size: st.blocks * bs, free: st.bavail * bs };
  } catch (e) { return null; }
}

/*
 * Returns drives: [{name, mount, device, fstype, removable, isRoot,
 *                   size, free, used, usedPct, label}]
 */
async function listDrives() {
  const mounts = readMounts();
  const { map: labels, unmounted } = lsblkLabels();
  const real = mounts.filter((m) => core.isRealDrive(m.mount, m.fstype));
  const seen = new Set();
  const drives = [];

  for (const m of real) {
    if (seen.has(m.mount)) continue;
    seen.add(m.mount);
    const cap = await statfsSafe(m.mount);
    const info = labels.get(m.device) || {};
    const isRoot = m.mount === '/';
    const label = info.label || (isRoot ? os.hostname() : path.basename(m.mount));
    const pretty = isRoot ? label : label;
    const name = isRoot ? `${pretty}` : pretty;
    const rm = info.rm || m.mount.startsWith('/media/') || m.mount.startsWith('/run/media/') || m.mount.startsWith('/mnt/');
    drives.push({
      name,
      mount: m.mount,
      device: m.device,
      fstype: m.fstype,
      removable: !!rm,
      isRoot,
      label: info.label || '',
      size: cap ? cap.size : 0,
      free: cap ? cap.free : 0,
      used: cap ? cap.size - cap.free : 0,
      usedPct: cap && cap.size ? Math.min(100, Math.max(0, Math.round(((cap.size - cap.free) / cap.size) * 100))) : 0
    });
  }
  drives.sort((a, b) => (b.isRoot ? 1 : 0) - (a.isRoot ? 1 : 0) || a.mount.localeCompare(b.mount));

  const ejected = unmounted.map((u) => ({
    name: u.label || 'Removable Disk',
    mount: '',
    device: u.path,
    fstype: '',
    removable: true,
    isRoot: false,
    ejected: true,
    size: u.size,
    free: u.size,
    used: 0,
    usedPct: 0
  }));

  return { drives, ejected };
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 15000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, error: err ? (stderr || err.message) : '' });
    });
  });
}

async function unmount(mount) {
  // Prefer udisksctl (polkit-aware); fall back to gio.
  const mounts = readMounts();
  const entry = mounts.find((m) => m.mount === mount);
  if (entry && entry.device.startsWith('/dev/')) {
    const r = await run('udisksctl', ['unmount', '-b', entry.device]);
    if (r.ok) return r;
  }
  return run('gio', ['mount', '-u', mount]);
}

async function mountDevice(device) {
  const r = await run('udisksctl', ['mount', '-b', device]);
  if (r.ok) {
    // parse "Mounted /dev/sdb1 at /media/..." for the mountpoint
    const m = /at\s+(.+)$/.exec(r.stdout || '');
    return { ok: true, mount: m ? m[1].trim() : '' };
  }
  return { ok: false, error: r.error };
}

/* gvfs network shares (smb://, sftp://, ftp:// …) mounted under /run/user/N/gvfs */
function listNetwork() {
  let entries = [];
  try {
    entries = fs.readdirSync(GVFS_ROOT, { withFileTypes: true })
      .filter((e) => e.isSymbolicLink() || e.isDirectory())
      .map((e) => ({ name: decodeURIComponent(e.name).replace(/^(smb|sftp|ftp|davs|mtp|gphoto2):\/\//, ''), path: path.join(GVFS_ROOT, e.name) }));
  } catch (e) { /* gvfs not available */ }
  return entries;
}

module.exports = { listDrives, unmount, mountDevice, listNetwork, GVFS_ROOT };
