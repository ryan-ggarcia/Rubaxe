// Integrated terminal: xterm.js views over node-pty shells in the main process; IRB/Rails consoles run inside them.
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { $, api, h, notify, ws } from './dom.ts';
import * as Editor from './editor.ts';
import * as Features from './features.ts';
import * as Panel from './panel.ts';
import { ipcMessage } from './paths.ts';
import { quickPick } from './quick-input.ts';

type Profile = { name: string; path: string; args: string[] };
const PROFILE_ICONS: [RegExp, string][] = [[/powershell/i, 'terminal-powershell'], [/prompt|cmd/i, 'terminal-cmd'], [/bash/i, 'terminal-bash'], [/wsl|linux|ubuntu/i, 'terminal-linux']];

// Lists the installed shells; the pick runs with the chosen profile.
export async function pickProfile(placeholder: string, run: (p: Profile) => void) {
  const shells = await api.listShells();
  quickPick({ placeholder, items: () => shells.map(p => ({ label: p.name, description: p.path, icon: PROFILE_ICONS.find(([re]) => re.test(p.name))?.[1] ?? 'terminal', run: () => run(p) })) });
}

export interface Term { id: string; title: string; xterm: Terminal; fit: FitAddon; el: HTMLElement; alive: boolean; console: boolean; tail: string }

// irb(main):001>, pry(main)>, myapp(dev)> — the console is ready for input once its prompt shows.
const PROMPT = /\w+\([\w:-]+\)(:\d+)?[>*]\s*$/;

function allowed(feature: string) {
  if (!Features.on(feature)) notify('Esta funcionalidade está desativada em Configurações.');
  return Features.on(feature);
}

const DARK = { background: '#181818', foreground: '#CCCCCC', cursor: '#AEAFAD', selectionBackground: '#6B2420' };
// White/yellow ANSI colors are unreadable on a light background.
const LIGHT = { background: '#F3F3F3', foreground: '#3B3B3B', cursor: '#3B3B3B', selectionBackground: '#F6D5D2', white: '#555555', brightWhite: '#1F1F1F', yellow: '#795E26', brightYellow: '#8A6A00',
  cyan: '#0E6F7E', brightCyan: '#0E6F7E', green: '#1E7B45', brightGreen: '#1E7B45', magenta: '#A3199B', brightMagenta: '#A3199B' };
const xtermTheme = () => document.documentElement.dataset.theme === 'light' ? LIGHT : DARK;
export const applyTheme = () => terms.forEach(t => { t.xterm.options.theme = xtermTheme(); });

const terms: Term[] = [];
const listeners: ((t: Term) => void)[] = [];
export const onDidChange = (fn: (t: Term) => void) => listeners.push(fn);
export const touch = (t: Term) => listeners.forEach(fn => fn(t));
let active: Term | undefined;
let seq = 0;

function select(t: Term | undefined) {
  active = t;
  for (const x of terms) x.el.hidden = x !== t;
  const pick = $('#terminal-select') as HTMLSelectElement;
  pick.replaceChildren(...terms.map(x => h('option', { value: x.id, selected: x === t }, `${x.title}${x.alive ? '' : ' (encerrado)'}`)));
  if (t) { t.xterm.focus(); requestAnimationFrame(() => t.fit.fit()); } // focus now: rAF is throttled while the window is not visible
}

// Undefined when the terminal (or console) feature is switched off.
// `profile` overrides the default shell (setting terminal.shell: a profile name, or a path as before).
export async function create(title?: string, command?: string, isConsole = false, profile?: Profile): Promise<Term | undefined> {
  if (!allowed(isConsole ? 'console' : 'terminal')) return;
  Panel.show('terminal');
  const el = h('div', { className: 'term' });
  $('#terminal-host').append(el);
  const xterm = new Terminal({
    fontFamily: "Consolas, 'Courier New', monospace", fontSize: 13, cursorBlink: true, scrollback: 5000,
    theme: xtermTheme(),
  });
  const fit = new FitAddon();
  xterm.loadAddon(fit);
  xterm.open(el);
  const chosen = Features.get<string>('terminal.shell');
  const shells = profile ? [] : await api.listShells().catch(() => []);
  const p = profile ?? (chosen ? shells.find(s => s.name === chosen) ?? { name: chosen, path: chosen, args: [] } : shells[0]);
  const t: Term = { id: String(++seq), title: title ?? p?.name ?? 'terminal', xterm, fit, el, alive: true, console: isConsole, tail: '' };
  terms.push(t);
  select(t);
  fit.fit();
  // Ctrl+C copies when text is selected (otherwise it interrupts); Ctrl+V is left to the browser's paste event.
  xterm.attachCustomKeyEventHandler(e => {
    if (e.type !== 'keydown' || !e.ctrlKey || e.shiftKey || e.altKey) return true;
    if (e.key === 'c' && xterm.hasSelection()) { void navigator.clipboard.writeText(xterm.getSelection()); xterm.clearSelection(); return false; }
    return e.key !== 'v';
  });
  xterm.onData(d => api.ptyWrite(t.id, d));
  xterm.onResize(({ cols, rows }) => api.ptyResize(t.id, cols, rows));
  try {
    await api.ptySpawn(t.id, ws.root, xterm.cols, xterm.rows, p?.path ?? '', p?.args);
  } catch (e) {
    t.alive = false;
    xterm.write(`\r\nNão foi possível abrir o terminal: ${ipcMessage(e)}\r\n`);
    return t;
  }
  if (command) api.ptyWrite(t.id, command + '\r');
  return t;
}

export function show() {
  if (!allowed('terminal')) return;
  if (!terms.length) return void create();
  Panel.show('terminal');
  select(active ?? terms[terms.length - 1]);
}

export function kill(t = active) {
  if (!t) return;
  if (t.alive) void api.ptyKill(t.id);
  t.alive = false;
  t.xterm.dispose();
  t.el.remove();
  terms.splice(terms.indexOf(t), 1);
  select(terms[terms.length - 1]);
  touch(t);
}

// Sends the selection (or the current line) to the newest console terminal, opening IRB if none is running.
export async function sendSelection(openConsole: () => Promise<Term | undefined>) {
  if (!allowed('console')) return;
  const sel = Editor.editor.getSelection();
  const model = Editor.editor.getModel();
  if (!sel || !model) return notify('Abra um arquivo Ruby e selecione o código.');
  const text = sel.isEmpty() ? model.getLineContent(sel.startLineNumber) : model.getValueInRange(sel);
  let target = [...terms].reverse().find(t => t.console && t.alive);
  if (!target) {
    target = await openConsole();
    if (!target) return;
    // Input typed while the console is still booting is dropped, so wait for its prompt (15 s at most).
    for (let waited = 0; waited < 15000 && target.alive && !PROMPT.test(target.tail); waited += 100) await new Promise(r => setTimeout(r, 100));
  }
  Panel.show('terminal');
  select(target);
  api.ptyWrite(target.id, text.replace(/\r?\n/g, '\r') + '\r');
}

export function initTerminal() {
  const pick = $('#terminal-select') as HTMLSelectElement;
  pick.onchange = () => select(terms.find(t => t.id === pick.value));
  $('#terminal-new').onclick = () => void create();
  $('#terminal-profiles').onclick = () => void pickProfile('Novo terminal com o perfil...', p => void create(p.name, undefined, false, p));
  $('#terminal-kill').onclick = () => kill();
  new ResizeObserver(() => { if (active && !active.el.hidden && active.el.offsetParent) active.fit.fit(); }).observe($('#terminal-host'));
  api.onPtyData((id, data) => {
    const t = terms.find(x => x.id === id);
    if (!t) return;
    t.xterm.write(data);
    t.tail = (t.tail + data.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '')).slice(-2000);
    touch(t);
  });
  api.onPtyExit((id, code) => {
    const t = terms.find(x => x.id === id);
    if (!t) return;
    t.alive = false;
    t.xterm.write(`\r\n\x1b[90m[processo encerrado com código ${code}]\x1b[0m\r\n`);
    select(active);
    touch(t);
  });
}
