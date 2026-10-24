#!/usr/bin/env node
/*
 * run-tests.js — dependency-free unit tests for WXCore and the trash
 * service (FreeDesktop spec roundtrip). Run: npm test
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const core = require('../app/shared/core');
const trash = require('../app/services/trash');
const { SettingsStore } = require('../app/services/settings');

let passed = 0;
let failed = 0;
const failures = [];

function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log('  ✓ ' + name); })
    .catch((e) => {
      failed++;
      failures.push({ name, e });
      console.log('  ✗ ' + name + '\n    ' + (e && e.message));
    });
}

async function main() {
  console.log('WXCore — paths');
  await t('normalize collapses slashes and dots', () => {
    assert.strictEqual(core.normalize('/a//b/./c/../d'), '/a/b/d');
    assert.strictEqual(core.normalize('a/../b'), 'b');
    assert.strictEqual(core.normalize('/'), '/');
  });
  await t('join keeps absolute roots', () => {
    assert.strictEqual(core.join('/a', 'b', 'c'), '/a/b/c');
    assert.strictEqual(core.join('~', 'x'), '~/x');
    assert.strictEqual(core.join('', 'x'), 'x');
  });
  await t('basename/dirname/splitCrumbs', () => {
    assert.strictEqual(core.basename('/a/b/c.txt'), 'c.txt');
    assert.strictEqual(core.basename('/'), '/');
    assert.strictEqual(core.dirname('/a/b'), '/a');
    assert.strictEqual(core.dirname('/a'), '/');
    assert.deepStrictEqual(core.splitCrumbs('/a/b/c'), ['a', 'b', 'c']);
  });
  await t('splitName: extension split incl. dotfiles', () => {
    assert.deepStrictEqual(core.splitName('a.tar.gz'), ['a.tar', '.gz']);
    assert.deepStrictEqual(core.splitName('.bashrc'), ['.bashrc', '']);
    assert.deepStrictEqual(core.splitName('noext'), ['noext', '']);
  });
  await t('collisionName produces Windows-style " (2)" copies', () => {
    const taken = new Set(['file.txt', 'file (2).txt']);
    assert.strictEqual(core.collisionName('file.txt', taken), 'file (3).txt');
    assert.strictEqual(core.collisionName('other.txt', taken), 'other.txt');
  });
  await t('isSubPath guards copy-into-self', () => {
    assert.ok(core.isSubPath('/a/b', '/a/b/c'));
    assert.ok(core.isSubPath('/a/b', '/a/b'));
    assert.ok(!core.isSubPath('/a/b', '/a/bc'));
  });

  console.log('WXCore — formatting');
  await t('fmtSizeShort mimics Explorer units', () => {
    assert.strictEqual(core.fmtSizeShort(512), '512 bytes');
    assert.strictEqual(core.fmtSizeShort(2048), '2 KB');
    assert.strictEqual(core.fmtSizeShort(1024 * 1024 * 5), '5 MB');
    assert.ok(core.fmtSizeShort(1024 * 1024 * 1024 * 3.5).endsWith('GB'));
  });
  await t('fmtDateTime is m/d/yyyy h:mm AM/PM', () => {
    const d = new Date(2026, 0, 5, 13, 5).getTime();
    assert.strictEqual(core.fmtDateTime(d), '1/5/2026 1:05 PM');
  });
  await t('trash info serialize/parse roundtrip', () => {
    const now = Date.now();
    const text = core.serializeTrashInfo('/home/u/Doc A.txt', now);
    const parsed = core.parseTrashInfo(text);
    assert.strictEqual(parsed.path, '/home/u/Doc A.txt');
    assert.strictEqual(parsed.deletionDate, core.fmtIsoLocal(now));
    const back = core.parseIsoLocal(parsed.deletionDate);
    assert.strictEqual(Math.floor(back / 1000), Math.floor(now / 1000));
  });

  console.log('WXCore — type model + sorting');
  await t('typeInfo labels known extensions like Windows', () => {
    assert.strictEqual(core.typeInfo('a.txt').label, 'Text Document');
    assert.strictEqual(core.typeInfo('a.zip').label, 'Compressed (zipped) Folder');
    assert.strictEqual(core.typeInfo('a.png').cat, 'image');
    assert.strictEqual(core.typeInfo('folder', true).label, 'File folder');
  });
  await t('sortEntries: folders first, natural order, desc flips', () => {
    const list = [
      { name: 'b.txt', isDir: false },
      { name: 'A folder', isDir: true },
      { name: 'file10.txt', isDir: false },
      { name: 'file2.txt', isDir: false }
    ];
    const s = core.sortEntries(list, 'name', true).map((e) => e.name);
    assert.deepStrictEqual(s, ['A folder', 'b.txt', 'file2.txt', 'file10.txt']);
    const d = core.sortEntries(list, 'name', false).map((e) => e.name);
    assert.deepStrictEqual(d, ['A folder', 'file10.txt', 'file2.txt', 'b.txt']);
  });
  await t('groupEntries date buckets in day order', () => {
    const now = Date.now();
    const list = [
      { name: 'old.txt', mtime: now - 400 * 86400000 },
      { name: 'today.txt', mtime: now },
      { name: 'yest.txt', mtime: now - 86400000 }
    ];
    const groups = core.groupEntries(list, 'date', now).map((g) => g.label);
    assert.deepStrictEqual(groups, ['Today', 'Yesterday', 'Older']);
  });

  console.log('WXCore — desktop integration helpers');
  await t('execToArgv + stripFieldCodes', () => {
    const argv = core.execToArgv('env FOO=1 "my app" --flag %U');
    const { argv: clean, wantsFile } = core.stripFieldCodes(argv);
    assert.strictEqual(wantsFile, true);
    assert.deepStrictEqual(clean, ['env', 'FOO=1', 'my app', '--flag']);
  });
  await t('parseDesktopEntry reads Name/Exec/MimeType', () => {
    const e = core.parseDesktopEntry('[Desktop Entry]\nType=Application\nName=Explorer\nExec=winexplorer %U\nMimeType=inode/directory;\n\n[Other]\nName=Nope\n');
    assert.strictEqual(e.Name, 'Explorer');
    assert.strictEqual(e.MimeType, 'inode/directory;');
    assert.strictEqual(e.Other, undefined);
  });
  await t('parseMounts + isRealDrive filters virtual fs', () => {
    const mounts = core.parseMounts('/dev/sda2 / ext4 rw 0 0\nproc /proc proc rw 0 0\n/dev/sdb1 /media/usb exfat rw 0 0\n/dev/sda1 /boot ext4 rw 0 0\n');
    const drives = mounts.filter((m) => core.isRealDrive(m.mount, m.fstype)).map((m) => m.mount);
    assert.deepStrictEqual(drives, ['/', '/media/usb']);
  });

  console.log('Trash service — FreeDesktop roundtrip');
  await t('trash a file, list it, restore it', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-test-'));
    const victim = path.join(tmp, 'victim doc.txt');
    fs.writeFileSync(victim, 'hello');
    const r = await trash.trashPaths([victim]);
    assert.strictEqual(r.done.length, 1);
    assert.ok(!fs.existsSync(victim), 'moved out of place');
    const items = trash.listTrash();
    const item = items.find((i) => i.id === r.done[0].trashName);
    assert.ok(item, 'listed in trash');
    assert.strictEqual(item.origPath, victim);
    assert.strictEqual(item.size, 5);
    const back = await trash.restoreIds([r.done[0].trashName]);
    assert.strictEqual(back.done.length, 1);
    assert.ok(fs.existsSync(victim), 'restored');
    assert.strictEqual(fs.readFileSync(victim, 'utf8'), 'hello');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  await t('trash collision keeps both items', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-test-'));
    const a = path.join(tmp, 'dup.txt');
    fs.writeFileSync(a, '1');
    await trash.trashPaths([a]);
    fs.writeFileSync(a, '2');
    await trash.trashPaths([a]);
    const dups = trash.listTrash().filter((i) => i.name.startsWith('dup'));
    assert.strictEqual(dups.length, 2);
    for (const d of dups) await trash.deleteForever([d.id]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  await t('deleteForever removes everything', async () => {
    await trash.deleteForever('all');
    assert.strictEqual(trash.listTrash().length, 0);
  });

  console.log('Settings store');
  await t('settings merge + persistence', () => {
    const file = path.join(os.tmpdir(), 'wx-settings-' + Date.now() + '.json');
    const s = new SettingsStore(file);
    assert.strictEqual(s.get().viewMode, 'details');
    s.set({ viewMode: 'lg', pinned: ['/a'] });
    s.saveNow();
    const s2 = new SettingsStore(file);
    assert.strictEqual(s2.get().viewMode, 'lg');
    assert.deepStrictEqual(s2.get().pinned, ['/a']);
    fs.rmSync(file, { force: true });
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
