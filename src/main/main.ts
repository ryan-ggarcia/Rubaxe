import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import type { IPty } from 'node-pty';
import { createParser, frame } from './lsp.ts';
import { quote } from './shell.ts';
import type { SearchHit } from './preload.ts';

const IGNORED = new Set(['.git', 'node_modules', 'tmp', 'log', '.bundle', 'coverage', '.ruby-lsp', 'vendor']);
const MAX_FILES = 20000;
const MAX_HITS = 2000;
let win: BrowserWindow | undefined;
let lsp: ChildProcess | null = null;
let allowClose = false;
const runs = new Map<string, ChildProcess>();
let debug: { proc?: ChildProcess; sock?: net.Socket } = {};
const ptys = new Map<string, IPty>();
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
  const proc = shellSpawn('rdbg', ['--open', '--host=127.0.0.1', `--port=${port}`, '-c', '--', cmd, ...args], cwd);
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
ipcMain.handle('ptySpawn', async (_e, id: string, cwd: string, cols: number, rows: number, shellPath: string) => {
  const pty = await import('node-pty'); // native module: loaded only when the first terminal opens
  const file = shellPath || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash');
  const p = pty.spawn(file, [], { name: 'xterm-256color', cols, rows, cwd: cwd || os.homedir(), env: childEnv() });
  ptys.set(id, p);
  p.onData(d => send('ptyData', id, d));
  p.onExit(({ exitCode }) => { ptys.delete(id); send('ptyExit', id, exitCode); });
});
ipcMain.on('ptyWrite', (_e, id: string, data: string) => ptys.get(id)?.write(data));
ipcMain.on('ptyResize', (_e, id: string, cols: number, rows: number) => { if (cols > 0 && rows > 0) ptys.get(id)?.resize(cols, rows); });
ipcMain.handle('ptyKill', (_e, id: string) => ptys.get(id)?.kill());

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
// Trash instead of rm so a mistaken delete can be undone from the OS.
ipcMain.handle('trashPath', (_e, p: string) => shell.trashItem(p));
ipcMain.handle('exists', (_e, p: string) => fs.access(p).then(() => true, () => false));
ipcMain.handle('listFiles', (_e, root: string) => walk(root));
ipcMain.handle('search', (_e, root: string, query: string, opts) => search(root, query, opts));
ipcMain.handle('exec', (_e, cmd: string, args: string[], cwd: string) => new Promise(resolve => {
  const c = shellSpawn(cmd, args, cwd);
  let out = '';
  c.stdout!.on('data', d => out += d);
  c.stderr!.on('data', d => out += d);
  c.on('error', e => resolve({ code: -1, out: e.message }));
  c.on('close', code => resolve({ code, out }));
}));
ipcMain.handle('run', (_e, id: string, cmd: string, args: string[], cwd: string, env?: Record<string, string>) => {
  const c = shellSpawn(cmd, args, cwd, env);
  runs.set(id, c);
  c.stdout!.on('data', d => send('runData', id, d.toString()));
  c.stderr!.on('data', d => send('runData', id, d.toString()));
  c.on('error', e => send('runData', id, e.message + '\n'));
  c.on('close', code => { runs.delete(id); send('runExit', id, code); });
});
// Fresh directory per run for test reports, coverage and profiles.
ipcMain.handle('mkTemp', () => fs.mkdtemp(path.join(os.tmpdir(), 'rubaxe-')));
// Packaged builds unpack src/ruby next to app.asar (see build.asarUnpack): ruby itself cannot read inside the archive.
ipcMain.handle('rubyHelpers', () => path.join(__dirname, '..', 'src', 'ruby').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`));
ipcMain.handle('findRubies', () => findRubies());
ipcMain.handle('setRubyBin', (_e, dir: string) => { rubyBin = dir; });
ipcMain.handle('stop', (_e, id: string) => { const c = runs.get(id); if (c) kill(c); });
// A truncated settings file must not block startup.
ipcMain.handle('loadSettings', () => fs.readFile(settingsPath(), 'utf8').then(JSON.parse).catch(() => ({})));
ipcMain.handle('saveSettings', (_e, s: unknown) => fs.writeFile(settingsPath(), JSON.stringify(s, null, 2)));
ipcMain.handle('lspStart', (_e, cmd: string, cwd: string) => startLsp(cmd, cwd));
ipcMain.handle('lspStop', () => stopLsp());
ipcMain.on('lspSend', (_e, msg: unknown) => { lsp?.stdin?.write(frame(msg)); });

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1400, height: 900, backgroundColor: '#1F1F1F', title: 'Rubaxe',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'), // the logo's mark without the wordmark
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#181818', symbolColor: '#CCCCCC', height: 35 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  // The preload grants file and process access: never let a remote page load in this window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win!.webContents.toggleDevTools();
  });
  // Let the renderer confirm unsaved changes before the window actually closes.
  win.on('close', e => {
    if (allowClose) return;
    e.preventDefault();
    win!.webContents.send('closeRequest');
  });
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
});

ipcMain.handle('confirmClose', () => { allowClose = true; win?.close(); });

app.on('window-all-closed', () => {
  stopLsp();
  debugStop();
  ptys.forEach(p => p.kill());
  runs.forEach(kill);
  app.quit();
});
