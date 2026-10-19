import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { createParser, frame } from './lsp.ts';
import type { SearchHit } from './preload.ts';

const IGNORED = new Set(['.git', 'node_modules', 'tmp', 'log', '.bundle', 'coverage', '.ruby-lsp', 'vendor']);
const MAX_FILES = 20000;
const MAX_HITS = 2000;
let win: BrowserWindow | undefined;
let lsp: ChildProcess | null = null;
const runs = new Map<string, ChildProcess>();
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const send = (ch: string, ...args: unknown[]) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...args); };

// .bat shims (bundle, rake, ruby-lsp) only start through a shell on Windows, so every token is quoted.
const quote = (a: string) => process.platform === 'win32' ? `"${a}"` : `'${a.replace(/'/g, `'\\''`)}'`;
const shellSpawn = (cmd: string, args: string[], cwd: string) =>
  spawn([cmd, ...args].map(quote).join(' '), { cwd, shell: true, env: process.env });

function kill(child: ChildProcess) {
  // child is the shell; on Windows only taskkill /T reaches the ruby process underneath it.
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else child.kill();
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

ipcMain.handle('openFolder', async () => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('readDir', async (_e, dir: string) => (await fs.readdir(dir, { withFileTypes: true }))
  .filter(d => d.name !== '.git')
  .map(d => ({ name: d.name, path: path.join(dir, d.name), dir: d.isDirectory() }))
  .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
ipcMain.handle('readFile', (_e, p: string) => fs.readFile(p, 'utf8'));
ipcMain.handle('writeFile', (_e, p: string, text: string) => fs.writeFile(p, text, 'utf8'));
ipcMain.handle('createPath', async (_e, p: string, isDir: boolean) => {
  if (isDir) return void await fs.mkdir(p, { recursive: true });
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, '', { flag: 'wx' });
});
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
ipcMain.handle('run', (_e, id: string, cmd: string, args: string[], cwd: string) => {
  const c = shellSpawn(cmd, args, cwd);
  runs.set(id, c);
  c.stdout!.on('data', d => send('runData', id, d.toString()));
  c.stderr!.on('data', d => send('runData', id, d.toString()));
  c.on('error', e => send('runData', id, e.message + '\n'));
  c.on('close', code => { runs.delete(id); send('runExit', id, code); });
});
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
  win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
});

app.on('window-all-closed', () => {
  stopLsp();
  runs.forEach(kill);
  app.quit();
});
