import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { IPty } from 'node-pty';
import { createParser, frame } from './lsp.ts';
import { quote } from './shell.ts';
import { watchIgnored } from './watch.ts';
import type { AppUpdater } from 'electron-updater';
import { isNewer } from './version.ts';
import type { SearchHit, UpdateStatus } from './preload.ts';

const IGNORED = new Set(['.git', 'node_modules', 'tmp', 'log', '.bundle', 'coverage', '.ruby-lsp', 'vendor']);
const MAX_FILES = 20000;
const MAX_HITS = 2000;
let win: BrowserWindow | undefined;
let lsp: ChildProcess | null = null;
let allowClose = false;
let afterClose: 'quit' | 'relaunch' | 'install' = 'quit'; // set by the relaunch/installUpdate requests, reset by any other close attempt
let nativeControls = true; // false: window.controls 'mac' on Windows/Linux, the renderer draws the buttons
// backgroundMaterial needs Windows 11 22H2 (build 22621); vibrancy is macOS-only. Everything else stays solid.
const material = process.platform === 'darwin' ? 'vibrancy'
  : process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621 ? 'acrylic' : 'none';
const runs = new Map<string, ChildProcess>();
let debug: { proc?: ChildProcess; sock?: net.Socket } = {};
const ptys = new Map<string, IPty>();
let watcher: FSWatcher | undefined;
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const send = (ch: string, ...args: unknown[]) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...args); };

let rubyBin = ''; // bin dir of the interpreter chosen in Rubaxe, put first on PATH for every child process

// extra.RUBYOPT / RUBYLIB are appended to the user's own values instead of replacing them.
// Helper paths go in RUBYLIB (a real path list, spaces allowed); RUBYOPT cannot quote, so it only gets -r<name>.
function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env = { ...process.env, ...extra } as Record<string, string>;
  if (extra.RUBYOPT) env.RUBYOPT = [process.env.RUBYOPT, extra.RUBYOPT].filter(Boolean).join(' ');
  if (extra.RUBYLIB) env.RUBYLIB = [extra.RUBYLIB, process.env.RUBYLIB].filter(Boolean).join(path.delimiter);
  // Windows spells it "Path"; adding a second "PATH" key would leave which one wins to chance.
  const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
  if (rubyBin) env[key] = rubyBin + path.delimiter + (env[key] ?? '');
  return env;
}

// Packaged builds unpack src/ruby next to app.asar (see build.asarUnpack): ruby itself cannot read inside the archive.
const rubyHelpers = path.join(__dirname, '..', 'src', 'ruby').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const syncOutput = { RUBYOPT: '-rrubaxe_sync', RUBYLIB: rubyHelpers };

const shellSpawn = (cmd: string, args: string[], cwd: string, extra: Record<string, string> = {}) =>
  // detached on Linux/macOS: the shell leads its own process group, so kill() can reach ruby underneath it.
  spawn([cmd, ...args].map(quote).join(' '), { cwd, shell: true, env: childEnv(extra), detached: process.platform !== 'win32' });

// Interpreters from PATH and the usual version-manager folders (rbenv, rvm, asdf, chruby, mise, RubyInstaller).
async function findRubies(): Promise<{ path: string; manager: string }[]> {
  const home = os.homedir(), exe = process.platform === 'win32' ? 'ruby.exe' : 'ruby';
  const versions = async (dir: string, manager: string, sub = 'bin') =>
    (await fs.readdir(dir).catch(() => [] as string[])).map(v => ({ path: path.join(dir, v, sub, exe), manager }));
  const pathDirs = (process.env.PATH ?? process.env.Path ?? '').split(path.delimiter).filter(Boolean).map(d => ({ path: path.join(d, exe), manager: 'PATH' }));
  const roots = process.platform === 'win32'
    ? (await fs.readdir('C:\\').catch(() => [] as string[])).filter(d => /^Ruby\d/i.test(d)).map(d => ({ path: path.join('C:\\', d, 'bin', exe), manager: 'RubyInstaller' }))
    : [];
  // Manager folders first so a Ruby that is also on PATH keeps its manager's name after de-duplication.
  const all = [
    ...roots,
    ...await versions(path.join(home, '.rbenv', 'versions'), 'rbenv'), ...await versions(path.join(home, '.rvm', 'rubies'), 'rvm'),
    ...await versions(path.join(home, '.asdf', 'installs', 'ruby'), 'asdf'), ...await versions(path.join(home, '.rubies'), 'chruby'),
    ...await versions('/opt/rubies', 'chruby'), ...await versions(path.join(home, '.local', 'share', 'mise', 'installs', 'ruby'), 'mise'),
    ...pathDirs,
  ];
  const seen = new Set<string>();
  const out: { path: string; manager: string }[] = [];
  for (const r of all) {
    const real = await fs.realpath(r.path).catch(() => '');
    if (real && !seen.has(real.toLowerCase())) { seen.add(real.toLowerCase()); out.push(r); }
  }
  return out;
}

const exists = (p: string) => fs.access(p).then(() => true, () => false);
const pathDirs = () => (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
const firstExisting = async (ps: string[]) => { for (const p of ps) if (await exists(p)) return p; };

// wsl.exe with no distro turns any key into "install WSL": offer the profile only when -l -q names a distro. Once per session.
let wslDistro: Promise<boolean> | undefined;
const hasWslDistro = (wsl: string) => wslDistro ??= new Promise<boolean>(resolve => {
  // UTF-16LE output; no shell, stdin closed and a 2 s cap so it can never sit at a prompt.
  execFile(wsl, ['-l', '-q'], { encoding: 'utf16le', timeout: 2000, windowsHide: true }, (err, out) =>
    resolve(!err && out.replace(/\0/g, '').split(/\r?\n/).some(l => l.trim() !== ''))).stdin?.end();
});

// Terminal profiles that exist on this machine, default first.
async function listShells(): Promise<{ name: string; path: string; args: string[] }[]> {
  const out: { name: string; path: string; args: string[] }[] = [];
  const add = async (name: string, candidates: string[], args: string[] = []) => {
    const p = await firstExisting(candidates);
    if (p) out.push({ name, path: p, args });
  };
  if (process.platform === 'win32') {
    const sys32 = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
    const git = await firstExisting(pathDirs().map(d => path.join(d, 'git.exe')));
    await add('PowerShell', [path.join(sys32, 'WindowsPowerShell', 'v1.0', 'powershell.exe')]);
    await add('PowerShell 7', [...pathDirs().map(d => path.join(d, 'pwsh.exe')), 'C:\\Program Files\\PowerShell\\7\\pwsh.exe']);
    await add('Prompt de Comando', [process.env.ComSpec ?? path.join(sys32, 'cmd.exe')]);
    // git.exe lives in <Git>\cmd or <Git>\mingw64\bin; bash.exe in <Git>\bin.
    const fromGit = git ? [path.join(git, '..', '..', 'bin', 'bash.exe'), path.join(git, '..', '..', '..', 'bin', 'bash.exe')] : [];
    await add('Git Bash', ['C:\\Program Files\\Git\\bin\\bash.exe', ...fromGit], ['--login', '-i']);
    const wsl = path.join(sys32, 'wsl.exe');
    if (await exists(wsl) && await hasWslDistro(wsl)) out.push({ name: 'WSL', path: wsl, args: [] });
    return out;
  }
  const listed = (await fs.readFile('/etc/shells', 'utf8').catch(() => '')).split('\n').map(l => l.trim()).filter(l => l.startsWith('/'));
  const seen = new Set<string>();
  for (const p of [process.env.SHELL ?? '', ...listed]) {
    const real = p && await fs.realpath(p).catch(() => '');
    if (real && !seen.has(real)) { seen.add(real); out.push({ name: path.basename(p), path: p, args: [] }); }
  }
  return out;
}

function watchFolder(root: string) {
  watcher?.close();
  watcher = undefined;
  if (!root) return;
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  const stop = (e: Error) => { console.error(`watcher ${root}: ${e.message}`); clearTimeout(timer); w?.close(); if (watcher === w) watcher = undefined; };
  let w: FSWatcher | undefined;
  try {
    w = watcher = watch(root, { recursive: true }, (_ev, name) => {
      if (!name) return;
      // Windows reports a deleted root as its own absolute path, endlessly and without an error event.
      if (path.isAbsolute(name)) { send('fsChange', [root]); return stop(new Error('pasta removida')); }
      if (watchIgnored(name)) return;
      pending.add(path.join(root, name));
      // Batch window from the first event: a plain debounce would never fire while a build keeps writing.
      timer ??= setTimeout(() => {
        timer = undefined;
        if (watcher === w) send('fsChange', [...pending]);
        pending.clear();
      }, 300);
    });
  } catch (e) { return stop(e as Error); } // root missing or unreadable
  w.on('error', stop); // root deleted, EPERM...
}

function kill(child: ChildProcess) {
  // child is the shell; killing only it would leave ruby running. Windows: taskkill /T; elsewhere: the process group.
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else {
    try { process.kill(-child.pid!, 'SIGTERM'); } catch { child.kill(); }
  }
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const stack = [root];
  while (stack.length && out.length < MAX_FILES) {
    const dir = stack.pop()!;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (IGNORED.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p); else out.push(p);
    }
  }
  return out;
}

async function search(root: string, query: string, opts: { regex: boolean; caseSensitive: boolean }) {
  const re = new RegExp(opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opts.caseSensitive ? '' : 'i');
  const hits: SearchHit[] = [];
  for (const file of await walk(root)) {
    const text = await fs.stat(file).then(s => s.size > 1_000_000 ? '' : fs.readFile(file, 'utf8'), () => '');
    if (!text || text.includes('\0')) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && hits.length < MAX_HITS; i++) {
      const m = re.exec(lines[i]);
      if (m) hits.push({ file, line: i + 1, col: m.index + 1, len: m[0].length, text: lines[i].slice(0, 300) });
    }
    if (hits.length >= MAX_HITS) break;
  }
  return hits;
}

function startLsp(cmd: string, cwd: string) {
  stopLsp();
  const child = lsp = shellSpawn(cmd, [], cwd);
  // ruby-lsp creates .ruby-lsp before it answers; on Windows dot-folders are visible, so mark it hidden for Explorer too.
  if (process.platform === 'win32') child.stdout!.once('data', () => spawn('attrib', ['+h', path.join(cwd, '.ruby-lsp')]));
  child.stdout!.on('data', createParser(msg => send('lspMessage', msg)));
  child.stderr!.on('data', d => send('lspLog', d.toString()));
  child.stdin!.on('error', e => send('lspLog', e.message + '\n')); // EPIPE when ruby-lsp is missing and the shell already exited
  child.on('error', e => send('lspLog', e.message + '\n'));
  child.on('exit', code => { if (lsp === child) { lsp = null; send('lspExit', code); } });
}

function stopLsp() {
  if (!lsp) return;
  const child = lsp;
  lsp = null;
  kill(child);
}

// Debugger: rdbg (gem debug) opens a TCP port and speaks DAP on it, framed like LSP.
function dapConnect(port: number, host: string) {
  const sock = net.connect(port, host);
  debug.sock = sock;
  sock.on('connect', () => send('dapConnected'));
  sock.on('data', createParser(msg => send('dapMessage', msg)));
  sock.on('error', e => send('debugOutput', `${e.message}\n`));
  sock.on('close', () => { if (debug.sock === sock) { debug.sock = undefined; if (!debug.proc) send('debugEnd'); } });
}

function debugStop() {
  const { proc, sock } = debug;
  debug = {};
  sock?.destroy();
  if (proc) kill(proc);
}

const freePort = () => new Promise<number>((resolve, reject) => {
  const srv = net.createServer().listen(0, '127.0.0.1', () => { const { port } = srv.address() as net.AddressInfo; srv.close(() => resolve(port)); });
  srv.on('error', reject);
});

ipcMain.handle('debugLaunch', async (_e, cmd: string, args: string[], cwd: string) => {
  debugStop();
  const port = await freePort();
  // -c runs any command (ruby, bundle exec rspec...) with the debugger loaded through RUBYOPT.
  const proc = shellSpawn('rdbg', ['--open', '--host=127.0.0.1', `--port=${port}`, '-c', '--', cmd, ...args], cwd, syncOutput);
  debug = { proc };
  let attached = false;
  const out = (d: Buffer) => {
    const text = d.toString();
    send('debugOutput', text);
    if (!attached && text.includes('can attach via TCP/IP')) { attached = true; dapConnect(port, '127.0.0.1'); }
  };
  proc.stdout!.on('data', out);
  proc.stderr!.on('data', out);
  proc.on('error', e => send('debugOutput', e.message + '\n'));
  proc.on('close', code => { if (debug.proc === proc) { debug.sock?.destroy(); debug = {}; send('debugOutput', `\n[encerrado com código ${code}]\n`); send('debugEnd'); } });
});
ipcMain.handle('debugAttach', (_e, host: string, port: number) => { debugStop(); dapConnect(port, host); });
ipcMain.handle('debugStop', () => debugStop());
ipcMain.on('dapSend', (_e, msg: unknown) => { debug.sock?.write(frame(msg)); });

// Terminal: real pseudo-terminals (ConPTY on Windows) so shells, irb and rails console behave interactively.
ipcMain.handle('ptySpawn', async (_e, id: string, cwd: string, cols: number, rows: number, shellPath: string, args?: string[]) => {
  const pty = await import('node-pty'); // native module: loaded only when the first terminal opens
  const file = shellPath || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash');
  // CHERE_INVOKING: Git Bash --login would otherwise cd to HOME.
  const p = pty.spawn(file, args ?? [], { name: 'xterm-256color', cols, rows, cwd: cwd || os.homedir(), env: childEnv({ CHERE_INVOKING: '1' }) });
  ptys.set(id, p);
  p.onData(d => send('ptyData', id, d));
  p.onExit(({ exitCode }) => { ptys.delete(id); send('ptyExit', id, exitCode); });
});
ipcMain.on('ptyWrite', (_e, id: string, data: string) => ptys.get(id)?.write(data));
ipcMain.on('ptyResize', (_e, id: string, cols: number, rows: number) => { if (cols > 0 && rows > 0) ptys.get(id)?.resize(cols, rows); });
ipcMain.handle('ptyKill', (_e, id: string) => ptys.get(id)?.kill());
ipcMain.handle('listShells', () => listShells());
ipcMain.handle('watchFolder', (_e, root: string) => watchFolder(root));

ipcMain.handle('openFolder', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('readDir', async (_e, dir: string) => (await fs.readdir(dir, { withFileTypes: true }))
  .filter(d => d.name !== '.git' && d.name !== '.ruby-lsp') // .ruby-lsp: ruby-lsp's private bundle, not project code
  .map(d => ({ name: d.name, path: path.join(dir, d.name), dir: d.isDirectory() }))
  .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
ipcMain.handle('readFile', (_e, p: string) => fs.readFile(p, 'utf8'));
ipcMain.handle('writeFile', (_e, p: string, text: string) => fs.writeFile(p, text, 'utf8'));
ipcMain.handle('createPath', async (_e, p: string, isDir: boolean) => {
  // mkdir with recursive (needed for nested paths) silently succeeds on an existing folder.
  if (await fs.access(p).then(() => true, () => false)) throw new Error(`${path.basename(p)} já existe`);
  if (isDir) return void await fs.mkdir(p, { recursive: true });
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, '', { flag: 'wx' });
});
ipcMain.handle('openFileDialog', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});
// No overwrite: fs.rename silently replaces an existing target on most platforms.
ipcMain.handle('renamePath', async (_e, from: string, to: string) => {
  // A case-only rename on a case-insensitive disk finds the same file (same inode) as the target, and is allowed.
  const [src, dst] = await Promise.all([fs.stat(from, { bigint: true }), fs.stat(to, { bigint: true }).catch(() => null)]);
  if (dst && (dst.ino !== src.ino || dst.dev !== src.dev)) throw new Error(`${path.basename(to)} já existe`);
  await fs.rename(from, to);
});
// Trash instead of rm so a mistaken delete can be undone from the OS. false: the Recycle Bin refused it, nothing was touched.
ipcMain.handle('trashPath', async (_e, p: string) => {
  try { await shell.trashItem(p); return true; } catch (e) {
    if (process.platform !== 'win32') throw e;
    // Windows says "Operation was aborted" for every refusal. Renaming onto itself needs the same delete access, so it
    // separates "in use" (open in another program, a shell cd'ed inside) from "no Recycle Bin" (network drive, bin off, too big).
    await fs.rename(p, p).catch((err: NodeJS.ErrnoException) => {
      throw err.code === 'EBUSY' || err.code === 'EPERM' ? new Error('em uso por outro programa (terminal, servidor...) ou sem permissão') : err;
    });
    return shell.trashItem(p).then(() => true, () => false); // retry: the lock may have been brief (antivirus, git)
  }
});
// Permanent: only after the user confirms it, when trashPath returned false.
ipcMain.handle('deletePath', (_e, p: string) => fs.rm(p, { recursive: true }));
ipcMain.handle('exists', (_e, p: string) => exists(p));
ipcMain.handle('listFiles', (_e, root: string) => walk(root));
ipcMain.handle('search', (_e, root: string, query: string, opts) => search(root, query, opts));
ipcMain.handle('exec', async (_e, cmd: string, args: string[], cwd: string) => {
  // A missing cwd makes spawn blame the shell ("cmd.exe ENOENT").
  if (!await fs.stat(cwd).then(s => s.isDirectory(), () => false)) return { code: -1, out: `Pasta não encontrada: ${cwd}` };
  return new Promise(resolve => {
    // No TTY to answer a credential prompt: git would wait forever.
    const c = shellSpawn(cmd, args, cwd, cmd === 'git' ? { GIT_TERMINAL_PROMPT: '0' } : {});
    let out = '';
    c.stdout!.on('data', d => out += d);
    c.stderr!.on('data', d => out += d);
    c.on('error', e => resolve({ code: -1, out: e.message }));
    c.on('close', code => resolve({ code, out }));
  });
});
ipcMain.handle('run', (_e, id: string, cmd: string, args: string[], cwd: string, env?: Record<string, string>) => {
  // Tests and the profiler pass env: rspec/minitest sync their own output, and sync writes would skew profiles.
  const c = shellSpawn(cmd, args, cwd, env ?? syncOutput);
  runs.set(id, c);
  c.stdin!.on('error', e => send('runData', id, e.message + '\n')); // EPIPE when writing after the program ended
  c.stdout!.on('data', d => send('runData', id, d.toString()));
  c.stderr!.on('data', d => send('runData', id, d.toString()));
  c.on('error', e => send('runData', id, e.message + '\n'));
  c.on('close', code => { runs.delete(id); send('runExit', id, code); });
});
// Fresh directory per run for test reports, coverage and profiles.
ipcMain.handle('mkTemp', () => fs.mkdtemp(path.join(os.tmpdir(), 'rubaxe-')));
ipcMain.handle('rubyHelpers', () => rubyHelpers);
ipcMain.handle('findRubies', () => findRubies());
ipcMain.handle('setRubyBin', (_e, dir: string) => { rubyBin = dir; });
ipcMain.on('runWrite', (_e, id: string, data: string) => runs.get(id)?.stdin?.write(data));
ipcMain.handle('stop', (_e, id: string) => { const c = runs.get(id); if (c) kill(c); });
// A truncated settings file must not block startup.
const loadSettings = () => fs.readFile(settingsPath(), 'utf8').then(JSON.parse).catch(() => ({})) as Promise<Record<string, unknown> | null>;
ipcMain.handle('loadSettings', loadSettings);
ipcMain.handle('saveSettings', (_e, s: unknown) => fs.writeFile(settingsPath(), JSON.stringify(s, null, 2)));
ipcMain.handle('lspStart', (_e, cmd: string, cwd: string) => startLsp(cmd, cwd));
ipcMain.handle('lspStop', () => stopLsp());
ipcMain.on('lspSend', (_e, msg: unknown) => { lsp?.stdin?.write(frame(msg)); });
// #rrggbbaa: over acrylic the overlay must be see-through.
const hex = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c);
// macOS has no titleBarOverlay (traffic lights instead); in 'mac' mode there is none to recolor (it would throw).
ipcMain.on('setTitleBarOverlay', (_e, color: unknown, symbolColor: unknown) => {
  if (process.platform !== 'darwin' && nativeControls && hex(color) && hex(symbolColor) && win && !win.isDestroyed()) win.setTitleBarOverlay({ color, symbolColor, height: 35 });
});
ipcMain.handle('windowMaterial', () => material);
ipcMain.on('windowControl', (_e, action: unknown) => {
  if (!win || win.isDestroyed()) return;
  if (action === 'minimize') win.minimize();
  else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
});
// Same unsaved-tabs confirmation as closing; confirmClose then quits with the relaunch armed.
ipcMain.on('relaunch', () => { afterClose = 'relaunch'; send('closeRequest'); });

// Updates. Windows (NSIS) and Linux (AppImage): electron-updater downloads the GitHub Release and installs on restart.
// macOS: the build is unsigned and Squirrel.Mac only takes signed updates, so a newer Release is only announced.
const RELEASES = 'https://github.com/ryan-ggarcia/Rubaxe/';
let updater: AppUpdater | undefined;
let updateReady = false;
let releaseUrl = ''; // macOS: page of the newer Release, already checked to start with RELEASES
const updateStatus = (s: UpdateStatus) => send('updateStatus', s);
const shortError = (e: Error) => e.message.split('\n')[0].slice(0, 200);

// Loaded on first check: requiring electron-updater takes ~150 ms, too much to add to startup.
// require, not import(): Node's ESM view of this CommonJS package misses autoUpdater (a getter export).
function loadUpdater() {
  const u: AppUpdater = require('electron-updater').autoUpdater; // autoDownload is on by default
  u.on('update-available', i => updateStatus({ state: 'available', version: i.version }));
  u.on('download-progress', p => updateStatus({ state: 'downloading', percent: p.percent }));
  u.on('update-downloaded', i => { updateReady = true; updateStatus({ state: 'ready', version: i.version }); });
  u.on('update-not-available', () => updateStatus({ state: 'none' }));
  u.on('error', e => updateStatus({ state: 'error', message: shortError(e) }));
  return u;
}

async function checkForUpdates() {
  if (process.platform !== 'darwin') {
    // Check and download failures also arrive as the 'error' event, already reported.
    const r = await (updater ??= loadUpdater()).checkForUpdates().catch(() => null);
    return void r?.downloadPromise?.catch(() => {});
  }
  try {
    const r = await fetch('https://api.github.com/repos/ryan-ggarcia/Rubaxe/releases/latest', { headers: { 'User-Agent': 'Rubaxe' }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`);
    const { tag_name, html_url } = await r.json();
    const version = String(tag_name).replace(/^v/, '');
    if (!isNewer(version, app.getVersion())) return updateStatus({ state: 'none' });
    if (typeof html_url !== 'string' || !html_url.startsWith(RELEASES)) throw new Error('endereço do Release inesperado');
    releaseUrl = html_url;
    updateStatus({ state: 'manual', version });
  } catch (e) { updateStatus({ state: 'error', message: shortError(e as Error) }); }
}

ipcMain.handle('checkForUpdates', () => app.isPackaged ? checkForUpdates() : updateStatus({ state: 'none', message: 'Disponível só no app instalado.' }));
// No URL from the renderer: main opens only the Release it validated, or installs what it downloaded.
ipcMain.on('installUpdate', () => {
  if (releaseUrl) shell.openExternal(releaseUrl);
  else if (updateReady) { afterClose = 'install'; send('closeRequest'); } // same unsaved-tabs confirmation as closing
});

app.whenReady().then(async () => {
  // Windows/Linux use the HTML menu bar; macOS needs a native menu or Cmd+C/V/X/A and Cmd+Q stop working.
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  // macOS always keeps its traffic lights.
  nativeControls = process.platform === 'darwin' || (await loadSettings())?.['window.controls'] !== 'mac';
  win = new BrowserWindow({
    width: 1400, height: 900, title: 'Rubaxe',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'), // the logo's mark without the wordmark
    // Transparent base color: the page background shows the material where its CSS is transparent.
    backgroundColor: material === 'none' ? '#1F1F1F' : '#00000000',
    ...(material === 'acrylic' && { backgroundMaterial: 'acrylic' }),
    ...(material === 'vibrancy' && { vibrancy: 'under-window', visualEffectState: 'active' }),
    titleBarStyle: 'hidden', ...(nativeControls && { titleBarOverlay: { color: '#181818', symbolColor: '#CCCCCC', height: 35 } }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  // The preload grants file and process access: never let a remote page load in this window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  // file://host/... (and ////host, \\host, %5C%5Chost) is a UNC path on Windows: one <img> from a .md or an LSP hover
  // would send the user's NTLM hash to that SMB server. Only local files load; fileURLToPath throws on the odd forms.
  win.webContents.session.webRequest.onBeforeRequest((d, cb) => {
    if (!d.url.startsWith('file:')) return cb({});
    try { cb({ cancel: fileURLToPath(d.url, { windows: process.platform === 'win32' }).startsWith('\\\\') }); }
    catch { cb({ cancel: true }); }
  });
  win.webContents.on('before-input-event', (e, input) => {
    // F12 belongs to Monaco (go to definition); DevTools uses Chromium's Ctrl+Shift+I.
    if (input.type === 'keyDown' && input.control && input.shift && input.key.toLowerCase() === 'i') {
      e.preventDefault();
      win!.webContents.toggleDevTools();
    }
  });
  // Let the renderer confirm unsaved changes before the window actually closes.
  win.on('close', e => {
    if (allowClose) return;
    e.preventDefault();
    afterClose = 'quit';
    win!.webContents.send('closeRequest');
  });
  win.on('maximize', () => send('maximizeChange', true));
  win.on('unmaximize', () => send('maximizeChange', false));
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
  if (app.isPackaged) {
    setTimeout(checkForUpdates, 10_000);
    setInterval(checkForUpdates, 6 * 3600_000);
  }
});

ipcMain.handle('confirmClose', () => { if (afterClose === 'relaunch') app.relaunch(); allowClose = true; win?.close(); });

app.on('window-all-closed', () => {
  stopLsp();
  debugStop();
  ptys.forEach(p => p.kill());
  runs.forEach(kill);
  watcher?.close();
  // quitAndInstall quits by itself; if the installer cannot start it only emits 'error', so quit then.
  if (afterClose === 'install' && updater) { updater.once('error', () => app.quit()); updater.quitAndInstall(true, true); }
  else app.quit();
});
