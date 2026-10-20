// Integrated terminal: xterm.js views over node-pty shells in the main process; IRB/Rails consoles run inside them.
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { $, api, h, notify, ws } from './dom.ts';
import * as Editor from './editor.ts';
import * as Features from './features.ts';
import * as Panel from './panel.ts';

interface Term { id: string; title: string; xterm: Terminal; fit: FitAddon; el: HTMLElement; alive: boolean; console: boolean; tail: string }

// irb(main):001>, pry(main)>, myapp(dev)> — the console is ready for input once its prompt shows.
const PROMPT = /\w+\([\w:-]+\)(:\d+)?[>*]\s*$/;

const terms: Term[] = [];
let active: Term | undefined;
let seq = 0;

function select(t: Term | undefined) {
  active = t;
  for (const x of terms) x.el.hidden = x !== t;
  const pick = $('#terminal-select') as HTMLSelectElement;
  pick.replaceChildren(...terms.map(x => h('option', { value: x.id, selected: x === t }, `${x.title}${x.alive ? '' : ' (encerrado)'}`)));
  if (t) requestAnimationFrame(() => { t.fit.fit(); t.xterm.focus(); });
}

export async function create(title = 'terminal', command?: string, isConsole = false): Promise<Term> {
  Panel.show('terminal');
  const el = h('div', { className: 'term' });
  $('#terminal-host').append(el);
  const xterm = new Terminal({
    fontFamily: "Consolas, 'Courier New', monospace", fontSize: 13, cursorBlink: true, scrollback: 5000,
    theme: { background: '#181818', foreground: '#CCCCCC', cursor: '#AEAFAD', selectionBackground: '#264F78' },
  });
  const fit = new FitAddon();
  xterm.loadAddon(fit);
  xterm.open(el);
  const t: Term = { id: String(++seq), title, xterm, fit, el, alive: true, console: isConsole, tail: '' };
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
    await api.ptySpawn(t.id, ws.root, xterm.cols, xterm.rows, Features.get<string>('terminal.shell'));
  } catch (e) {
    t.alive = false;
    xterm.write(`\r\nNão foi possível abrir o terminal: ${(e as Error).message}\r\n`);
    return t;
  }
  if (command) api.ptyWrite(t.id, command + '\r');
  return t;
}

export function show() {
  if (!terms.length) return void create();
  Panel.show('terminal');
  select(active ?? terms[terms.length - 1]);
}

export function kill(t = active) {
  if (!t) return;
  if (t.alive) void api.ptyKill(t.id);
  t.xterm.dispose();
  t.el.remove();
  terms.splice(terms.indexOf(t), 1);
  select(terms[terms.length - 1]);
}

// Sends the selection (or the current line) to the newest console terminal, opening IRB if none is running.
export async function sendSelection(openConsole: () => Promise<Term>) {
  const sel = Editor.editor.getSelection();
  const model = Editor.editor.getModel();
  if (!sel || !model) return notify('Abra um arquivo Ruby e selecione o código.');
  const text = sel.isEmpty() ? model.getLineContent(sel.startLineNumber) : model.getValueInRange(sel);
  let target = [...terms].reverse().find(t => t.console && t.alive);
  if (!target) {
    target = await openConsole();
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
  $('#terminal-kill').onclick = () => kill();
  new ResizeObserver(() => { if (active && !active.el.hidden && active.el.offsetParent) active.fit.fit(); }).observe($('#terminal-host'));
  api.onPtyData((id, data) => {
    const t = terms.find(x => x.id === id);
    if (!t) return;
    t.xterm.write(data);
    t.tail = (t.tail + data.replace(/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g, '')).slice(-300);
  });
  api.onPtyExit((id, code) => {
    const t = terms.find(x => x.id === id);
    if (!t) return;
    t.alive = false;
    t.xterm.write(`\r\n\x1b[90m[processo encerrado com código ${code}]\x1b[0m\r\n`);
    select(active);
  });
}
