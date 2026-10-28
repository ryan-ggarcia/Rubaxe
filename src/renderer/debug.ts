// Debugger: DAP client for rdbg (via main process), gutter breakpoints, debug view and debug console.
import type * as M from 'monaco-editor';
import { $, api, basename, h, icon, notify, ws } from './dom.ts';
import * as Editor from './editor.ts';
import * as Features from './features.ts';
import * as Panel from './panel.ts';
import { ANSI } from './paths.ts';
import { prompt } from './quick-input.ts';

interface Bp { line: number; condition?: string }
interface Frame { id: number; name: string; line: number; source?: { path?: string; name?: string } }
interface Var { name: string; value: string; type?: string; variablesReference: number }

let state: 'off' | 'running' | 'paused' = 'off';
let seq = 1, threadId = 1, skipEntry = false, localfs = true, launched = false;
let steppedOutOf: string | undefined; // frame name when Step Out was pressed
// Remote attach: project folder on the server <-> this workspace. Translated here because the debug gem's own
// localfsMap splits on every ':' and cannot hold a Windows path such as C:\proj.
let pathMap: { remote: string; local: string } | undefined;
let frames: Frame[] = [];
let frame: Frame | undefined;
let current: { model: M.editor.ITextModel; ids: string[] } | undefined;
const pending = new Map<number, { resolve: (body: any) => void; reject: (e: Error) => void }>();
const bps = new Map<string, Bp[]>(); // key: Monaco file URI string
const decoIds = new WeakMap<M.editor.ITextModel, string[]>();
const watches: string[] = [];
let consoleText = '';

const pathOf = (key: string) => monaco.Uri.parse(key).fsPath;
const fold = (p: string) => api.platform === 'win32' ? p.toLowerCase() : p;
const toRemote = (p: string) => pathMap && fold(p).startsWith(fold(pathMap.local)) ? pathMap.remote + p.slice(pathMap.local.length).replace(/\\/g, '/') : p;
const toLocal = (p: string) => pathMap && p.startsWith(pathMap.remote) ? pathMap.local + p.slice(pathMap.remote.length).split('/').join(ws.sep) : p;

function req(command: string, args: unknown = {}): Promise<any> {
  if (state === 'off') return Promise.reject(new Error('Nenhuma sessão de depuração.'));
  const s = seq++;
  api.dapSend({ seq: s, type: 'request', command, arguments: args });
  return new Promise((resolve, reject) => pending.set(s, { resolve, reject }));
}

function log(text: string) {
  consoleText = (consoleText + text.replace(ANSI, '')).slice(-200_000);
  const pre = $('#debug-console');
  pre.textContent = consoleText;
  pre.scrollTop = pre.scrollHeight;
}

// ---------- breakpoints ----------

function paintBreakpoints(model: M.editor.ITextModel) {
  const list = bps.get(model.uri.toString()) ?? [];
  decoIds.set(model, model.deltaDecorations(decoIds.get(model) ?? [], list.map(b => ({
    range: new monaco.Range(b.line, 1, b.line, 1),
    options: {
      glyphMarginClassName: `codicon codicon-debug-breakpoint${b.condition ? '-conditional' : ''} bp-glyph`,
      glyphMarginHoverMessage: b.condition ? { value: `Condição: ${b.condition}` } : undefined,
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      glyphMargin: { position: monaco.editor.GlyphMarginLane.Right }, // test ▶ icons use the left lane
    },
  }))));
}

// Breakpoint decorations move with edits; read their lines back so the next session uses the new positions.
function trackLines(model: M.editor.ITextModel) {
  const list = bps.get(model.uri.toString());
  const ids = decoIds.get(model);
  if (!list || !ids) return;
  list.forEach((b, i) => { b.line = model.getDecorationRange(ids[i])?.startLineNumber ?? b.line; });
}

async function sendBreakpoints(key: string) {
  if (state === 'off') return;
  const list = bps.get(key) ?? [];
  await req('setBreakpoints', { source: { path: toRemote(pathOf(key)) }, breakpoints: list.map(b => ({ line: b.line, condition: b.condition })) }).catch(e => log(`${e.message}\n`));
}

function setBreakpoint(model: M.editor.ITextModel, line: number, bp: Bp | null) {
  const key = model.uri.toString();
  trackLines(model);
  const list = (bps.get(key) ?? []).filter(b => b.line !== line);
  if (bp) list.push(bp);
  list.sort((a, b) => a.line - b.line);
  if (list.length) bps.set(key, list); else bps.delete(key);
  paintBreakpoints(model);
  renderBreakpoints();
  void sendBreakpoints(key);
}

function enabled() {
  if (!Features.on('debugger')) notify('Esta funcionalidade está desativada em Configurações.');
  return Features.on('debugger');
}

export function toggleBreakpoint(line = Editor.editor.getPosition()?.lineNumber) {
  const model = Editor.editor.getModel();
  if (!model || !line || !enabled()) return;
  trackLines(model);
  const exists = bps.get(model.uri.toString())?.some(b => b.line === line);
  setBreakpoint(model, line, exists ? null : { line });
}

export async function conditionalBreakpoint(line = Editor.editor.getPosition()?.lineNumber) {
  const model = Editor.editor.getModel();
  if (!model || !line || !enabled()) return;
  trackLines(model);
  const old = bps.get(model.uri.toString())?.find(b => b.line === line);
  const condition = await prompt(`Condição do breakpoint na linha ${line} (Ruby; vazio remove a condição)`, old?.condition ?? '');
  if (condition === undefined) return; // Esc keeps the current condition; an empty answer removes it
  setBreakpoint(model, line, { line, condition: condition || undefined });
}

// ---------- session ----------

function setState(s: typeof state) {
  state = s;
  document.querySelectorAll<HTMLElement>('[data-when]').forEach(el => el.classList.toggle('disabled', !el.dataset.when!.split(' ').includes(s)));
  $('#statusbar').classList.toggle('debugging', s !== 'off');
  $('#debug-toolbar').hidden = s === 'off';
  $('#debug-stdin').hidden = s === 'off' || !launched; // attach has no stdin of ours
}

export async function start(cmd: string, args: string[]) {
  if (state !== 'off') await stop();
  consoleText = '';
  log(`> ${[cmd, ...args].join(' ')}\n`);
  Panel.show('debug');
  launched = true;
  setState('running');
  localfs = true;
  pathMap = undefined;
  await api.debugLaunch(cmd, args, ws.root);
}

export async function attach() {
  if (!enabled()) return;
  const target = await prompt('Anexar: host:porta [pasta do projeto no servidor] — ex.: 10.0.0.5:12345 /app (processo iniciado com rdbg --open --port=PORTA)', '127.0.0.1:12345');
  const m = target && /^([^\s:]+):(\d+)(?:\s+(.+))?$/.exec(target.trim());
  if (!m) return;
  if (state !== 'off') await stop();
  consoleText = '';
  log(`> anexar ${target}\n`);
  Panel.show('debug');
  launched = false;
  setState('running');
  // Without a folder map, breakpoint paths only match when the debuggee sees the same files (same machine).
  pathMap = m[3] ? { remote: m[3].replace(/\\/g, '/').replace(/\/?$/, '/'), local: ws.root + ws.sep } : undefined;
  localfs = !!pathMap || ['127.0.0.1', 'localhost'].includes(m[1]);
  if (!localfs) log('Aviso: host remoto sem pasta do projeto; os breakpoints só funcionam se os caminhos forem iguais.\n');
  await api.debugAttach(m[1], Number(m[2]));
}

export async function stop() {
  if (state === 'off') return;
  await Promise.race([req('disconnect', { terminateDebuggee: true }).catch(() => {}), new Promise(r => setTimeout(r, 500))]);
  await api.debugStop();
  end();
}

function end() {
  pending.forEach(p => p.reject(new Error('Sessão encerrada.')));
  pending.clear();
  frames = [];
  frame = undefined;
  clearCurrentLine();
  setState('off');
  renderPaused();
}

export const active = () => state !== 'off';
export const cont = () => state === 'paused' && step('continue');
export const stepOver = () => state === 'paused' && step('next');
export const stepInto = () => state === 'paused' && step('stepIn');
export const stepOut = () => state === 'paused' && step('stepOut');

function step(command: string) {
  steppedOutOf = command === 'stepOut' ? frame?.name : undefined;
  setState('running');
  clearCurrentLine();
  void req(command, { threadId }).catch(e => log(`${e.message}\n`));
}

async function onEvent(event: string, body: any) {
  switch (event) {
    case 'initialized':
      for (const key of bps.keys()) await sendBreakpoints(key);
      await req('configurationDone').catch(e => log(`${e.message}\n`));
      return;
    case 'stopped':
      threadId = body.threadId ?? threadId;
      // rdbg stops once at program load; skip it so the run goes to the first breakpoint.
      if (skipEntry && body.reason === 'pause') { skipEntry = false; return void req('continue', { threadId }).catch(() => {}); }
      skipEntry = false;
      setState('paused');
      return refresh();
    case 'continued':
      setState('running');
      return clearCurrentLine();
    case 'output':
      if (body.category !== 'telemetry') log(body.output);
      return;
    case 'terminated':
    case 'exited':
      return stop();
  }
}

async function refresh() {
  const { stackFrames } = await req('stackTrace', { threadId, startFrame: 0, levels: 50 }).catch(() => ({ stackFrames: [] }));
  frames = stackFrames.map((f: Frame) => f.source?.path ? { ...f, source: { ...f.source, path: toLocal(f.source.path) } } : f);
  // rdbg's Step Out stops on the method's return (its `end` line); show the caller instead, as users expect.
  const out = steppedOutOf && frames[0]?.name === steppedOutOf && frames[1]?.source?.path ? frames[1] : undefined;
  steppedOutOf = undefined;
  await selectFrame(out ?? frames.find(f => f.source?.path) ?? frames[0]);
}

async function selectFrame(f: Frame | undefined) {
  frame = f;
  renderPaused();
  if (!f?.source?.path) return;
  await Editor.openFile(f.source.path, { lineNumber: f.line, column: 1 });
  const model = Editor.editor.getModel();
  if (!model || frame !== f) return;
  clearCurrentLine();
  current = { model, ids: model.deltaDecorations([], [{
    range: new monaco.Range(f.line, 1, f.line, 1),
    options: { isWholeLine: true, className: 'debug-line', glyphMarginClassName: 'codicon codicon-debug-stackframe debug-frame-glyph' },
  }]) };
}

function clearCurrentLine() {
  if (current && !current.model.isDisposed()) current.model.deltaDecorations(current.ids, []);
  current = undefined;
}

// ---------- views ----------

function varNode(v: Var, depth: number, open = false): HTMLElement {
  const kids = h('div', {});
  kids.hidden = true;
  const chevron = icon(v.variablesReference ? 'chevron-right' : 'blank');
  const row = h('div', { className: 'tree-row', title: v.type ? `${v.name}: ${v.type}` : v.name },
    chevron, h('span', { className: 'var-name' }, v.name), h('span', { className: 'var-value' }, v.value));
  row.style.paddingLeft = `${8 + depth * 12}px`;
  let loaded = false;
  const toggle = async () => {
    if (!v.variablesReference) return;
    if (!loaded) {
      loaded = true;
      const { variables } = await req('variables', { variablesReference: v.variablesReference }).catch(() => ({ variables: [] }));
      kids.replaceChildren(...(variables as Var[]).map(c => varNode(c, depth + 1)));
    }
    kids.hidden = !kids.hidden;
    chevron.className = `codicon codicon-chevron-${kids.hidden ? 'right' : 'down'}`;
  };
  row.onclick = () => void toggle();
  if (open) void toggle();
  return h('div', {}, row, kids);
}

async function renderPaused() {
  const f = frame;
  $('#debug-stack').replaceChildren(...frames.map(x => {
    const where = x.source?.path ? `${basename(x.source.path)}:${x.line}` : x.source?.name ?? '';
    const row = h('div', { className: 'tree-row' + (x === f ? ' selected' : '') }, h('span', { className: 'tree-label' }, x.name), h('span', { className: 'desc' }, where));
    row.onclick = () => void selectFrame(x);
    return row;
  }));
  if (!f) {
    $('#debug-vars').replaceChildren(h('div', { className: 'empty' }, state === 'off' ? 'Inicie a depuração com F5.' : 'Executando…'));
    renderWatches();
    return;
  }
  const { scopes } = await req('scopes', { frameId: f.id }).catch(() => ({ scopes: [] }));
  if (frame !== f) return; // stepped again while loading
  $('#debug-vars').replaceChildren(...scopes.map((s: any, i: number) => varNode({ name: s.name, value: '', variablesReference: s.variablesReference }, 0, i === 0)));
  renderWatches();
}

async function renderWatches() {
  const f = state === 'paused' ? frame : undefined;
  const rows = await Promise.all(watches.map(async (expr, i) => {
    const r = f ? await req('evaluate', { expression: expr, frameId: f.id, context: 'watch' }).catch((e: Error) => ({ result: e.message, variablesReference: 0 })) : { result: '', variablesReference: 0 };
    const node = varNode({ name: expr, value: r.result, variablesReference: r.variablesReference }, 0);
    const remove = icon('close', 'Remover');
    remove.classList.add('row-action');
    remove.onclick = e => { e.stopPropagation(); watches.splice(i, 1); void renderWatches(); };
    node.firstElementChild!.append(remove);
    return node;
  }));
  $('#debug-watch').replaceChildren(...(rows.length ? rows : [h('div', { className: 'empty' }, 'Use + para inspecionar uma expressão.')]));
}

function renderBreakpoints() {
  const rows: HTMLElement[] = [];
  for (const [key, list] of bps) for (const b of list) {
    const path = pathOf(key);
    const remove = icon('close', 'Remover');
    remove.classList.add('row-action');
    const row = h('div', { className: 'tree-row' }, icon(`debug-breakpoint${b.condition ? '-conditional' : ''}`), h('span', { className: 'tree-label' }, `${basename(path)}:${b.line}`), h('span', { className: 'desc' }, b.condition ?? ''), remove);
    row.onclick = () => void Editor.openFile(path, { lineNumber: b.line, column: 1 });
    remove.onclick = async e => {
      e.stopPropagation();
      const model = monaco.editor.getModel(monaco.Uri.parse(key));
      if (model) return setBreakpoint(model, b.line, null);
      bps.set(key, list.filter(x => x !== b));
      renderBreakpoints();
      void sendBreakpoints(key);
    };
    rows.push(row);
  }
  $('#debug-bps').replaceChildren(...(rows.length ? rows : [h('div', { className: 'empty' }, 'Clique na margem do editor (ou F9) para criar.')]));
}

async function evaluateRepl(expression: string) {
  log(`> ${expression}\n`);
  if (state !== 'paused') return log('Pause o programa (breakpoint) para avaliar expressões.\n');
  const r = await req('evaluate', { expression, frameId: frame?.id, context: 'repl' }).catch((e: Error) => ({ result: e.message }));
  log(`${r.result}\n`);
  void renderPaused(); // the expression may have changed variables
}

export function initDebug(onStartFile: () => void) {
  Editor.editor.updateOptions({ glyphMargin: true });
  Editor.editor.onMouseDown(e => {
    if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !e.target.position) return;
    if ((e.target.element as HTMLElement | null)?.classList.contains('test-glyph')) return; // tests.ts runs it
    const line = e.target.position.lineNumber;
    if (e.event.shiftKey) void conditionalBreakpoint(line); else toggleBreakpoint(line);
  });
  // Faded breakpoint under the mouse as a click hint (not where one already exists).
  let hint: string[] = [];
  const setHint = (line?: number) => { hint = Editor.editor.deltaDecorations(hint, line ? [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'codicon codicon-debug-breakpoint bp-hint', glyphMargin: { position: monaco.editor.GlyphMarginLane.Right } } }] : []); };
  Editor.editor.onMouseMove(e => {
    const m = Editor.editor.getModel();
    const line = e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ? e.target.position?.lineNumber : undefined;
    const taken = line && (bps.get(m?.uri.toString() ?? '') ?? []).some(b => b.line === line);
    const test = (e.target.element as HTMLElement | null)?.classList.contains('test-glyph');
    setHint(line && !taken && !test ? line : undefined);
  });
  Editor.editor.onMouseLeave(() => setHint());
  Editor.onDidChange(() => { const m = Editor.editor.getModel(); if (m && !decoIds.has(m)) paintBreakpoints(m); });
  monaco.editor.onDidCreateModel(m => m.onDidChangeContent(() => trackLines(m)));

  const action = (tag: 'span' | 'button') => ([name, title, when, run]: [string, string, string, () => unknown]) => {
    const el = h(tag, { className: `codicon codicon-${name}`, title });
    el.setAttribute('aria-label', title);
    el.dataset.when = when;
    el.onclick = () => void run();
    return el;
  };
  const steps: [string, string, string, () => unknown][] = [
    ['debug-continue', 'Continuar (F5)', 'paused', cont],
    ['debug-step-over', 'Passar por cima (F10)', 'paused', stepOver],
    ['debug-step-into', 'Entrar (F11)', 'paused', stepInto],
    ['debug-step-out', 'Sair (Shift+F11)', 'paused', stepOut],
    ['debug-stop', 'Parar (Shift+F5)', 'running paused', stop],
  ];
  $('#debug-actions').replaceChildren(...[['debug-start', 'Iniciar depuração do arquivo (F5)', 'off', onStartFile] as typeof steps[0], ...steps].map(action('span')));
  // The sidebar may show another view (or be hidden) when a breakpoint hits: these float over the editor during a session.
  $('#debug-toolbar').replaceChildren(...steps.map(action('button')));
  $('#debug-watch-add').onclick = async e => {
    e.stopPropagation();
    const expr = await prompt('Expressão para inspecionar');
    if (expr) { watches.push(expr); void renderWatches(); }
  };
  const input = $('#debug-input') as HTMLInputElement;
  input.onkeydown = e => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    void evaluateRepl(input.value.trim());
    input.value = '';
  };
  const stdin = $('#debug-stdin') as HTMLInputElement;
  stdin.onkeydown = e => {
    if (e.key !== 'Enter') return;
    api.debugWrite(stdin.value + '\n');
    log(stdin.value + '\n');
    stdin.value = '';
  };

  api.onDapConnected(async () => {
    skipEntry = true;
    try {
      await req('initialize', { clientID: 'rubaxe', clientName: 'Rubaxe', adapterID: 'rdbg', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path', supportsVariableType: true });
      await req('attach', { localfs });
    } catch (e) {
      log(`${(e as Error).message}\n`);
    }
  });
  api.onDapMessage(msg => {
    if (msg.type === 'response') {
      const p = pending.get(msg.request_seq);
      pending.delete(msg.request_seq);
      if (msg.success) p?.resolve(msg.body ?? {}); else p?.reject(new Error(msg.message ?? msg.command));
    } else if (msg.type === 'event') {
      void onEvent(msg.event, msg.body ?? {});
    } else if (msg.type === 'request') {
      // Reverse requests (e.g. runInTerminal) are not supported; refusing keeps the adapter from waiting forever.
      api.dapSend({ seq: seq++, type: 'response', request_seq: msg.seq, command: msg.command, success: false, message: 'não suportado' });
    }
  });
  api.onDebugOutput(log);
  api.onDebugEnd(() => { if (state !== 'off') end(); });

  setState('off');
  void renderPaused();
  renderBreakpoints();
}
