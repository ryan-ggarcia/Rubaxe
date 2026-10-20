// Workbench entry: loads Monaco, wires layout, commands, keybindings and the status bar.
import type * as M from 'monaco-editor';
import { $, abs, api, basename, fileIcon, h, icon, notify, ws } from './dom.ts';
import * as Editor from './editor.ts';
import { initExplorer, renderExplorer, renderOutline } from './explorer.ts';
import * as Features from './features.ts';
import * as Lsp from './lsp-client.ts';
import * as Panel from './panel.ts';
import { fuzzyScore, relativeTo } from './paths.ts';
import { quickPick, setCloseHandler, type QuickItem } from './quick-input.ts';
import * as Ruby from './ruby.ts';
import { focusSearch, initSearch } from './search.ts';

interface Command { id: string; label: string; key?: string; icon?: string; run: () => unknown }

const lspLog: string[] = [];

const commands: Command[] = [
  { id: 'openFolder', label: 'Arquivo: Abrir Pasta...', key: 'Ctrl+O', icon: 'folder-opened', run: () => openFolder() },
  { id: 'save', label: 'Arquivo: Salvar', key: 'Ctrl+S', icon: 'save', run: () => Editor.save() },
  { id: 'closeTab', label: 'Arquivo: Fechar Editor', key: 'Ctrl+W', icon: 'close', run: () => Editor.active && Editor.closeTab(Editor.active) },
  { id: 'quickOpen', label: 'Ir: Arquivo...', key: 'Ctrl+P', icon: 'go-to-file', run: () => quickOpen() },
  { id: 'palette', label: 'Exibir: Paleta de Comandos', key: 'Ctrl+Shift+P', icon: 'terminal', run: () => quickOpen('>') },
  { id: 'paletteF1', label: 'Exibir: Paleta de Comandos', key: 'F1', run: () => quickOpen('>') },
  { id: 'workspaceSymbol', label: 'Ir: Símbolo no Projeto...', key: 'Ctrl+T', icon: 'symbol-class', run: () => quickOpen('#') },
  { id: 'explorer', label: 'Exibir: Explorer', key: 'Ctrl+Shift+E', icon: 'files', run: () => showView('explorer') },
  { id: 'search', label: 'Exibir: Pesquisar no Projeto', key: 'Ctrl+Shift+F', icon: 'search', run: () => { showView('search'); focusSearch(); } },
  { id: 'rubyView', label: 'Exibir: Ruby', icon: 'ruby', run: () => showView('ruby') },
  { id: 'toggleSidebar', label: 'Exibir: Alternar Barra Lateral', key: 'Ctrl+B', icon: 'layout-sidebar-left', run: () => toggleSidebar() },
  { id: 'togglePanel', label: 'Exibir: Alternar Painel', key: 'Ctrl+J', icon: 'layout-panel', run: () => Panel.toggle() },
  { id: 'problems', label: 'Exibir: Problemas', key: 'Ctrl+Shift+M', icon: 'warning', run: () => Panel.show('problems') },
  { id: 'output', label: 'Exibir: Saída', key: 'Ctrl+Shift+U', icon: 'output', run: () => Panel.show('output') },
  { id: 'settings', label: 'Preferências: Abrir Configurações', key: 'Ctrl+,', icon: 'settings-gear', run: () => Editor.openSettings() },
  { id: 'runFile', label: 'Ruby: Executar Arquivo', key: 'Ctrl+F5', icon: 'play', run: () => Ruby.runFile() },
  { id: 'runTests', label: 'Ruby: Executar Testes do Arquivo', key: 'Ctrl+Shift+F10', icon: 'beaker', run: () => Ruby.runTests() },
  { id: 'runTestLine', label: 'Ruby: Executar Teste na Linha', key: 'Ctrl+Alt+F10', icon: 'debug-line-by-line', run: () => Ruby.runTests(true) },
  { id: 'runAllTests', label: 'Ruby: Executar Todos os Testes', icon: 'run-all', run: () => Ruby.runAllTests() },
  { id: 'gotoTest', label: 'Ruby: Ir para Teste / Implementação', key: 'Ctrl+Shift+T', icon: 'go-to-file', run: () => Ruby.gotoTest() },
  { id: 'stop', label: 'Ruby: Parar Execução', key: 'Ctrl+F2', icon: 'debug-stop', run: () => Ruby.stopAll() },
  { id: 'rake', label: 'Rake: Executar Tarefa...', icon: 'tools', run: () => Ruby.rakeTasks() },
  ...['install', 'update', 'outdated', 'lock', 'clean'].map(sub => ({ id: `bundle.${sub}`, label: `Bundler: ${sub}`, icon: 'package', run: () => Ruby.bundle(sub) })),
  { id: 'restartLsp', label: 'Ruby: Reiniciar Ruby LSP', icon: 'debug-restart', run: () => startLsp() },
  { id: 'lspLog', label: 'Ruby: Mostrar Log do Ruby LSP', icon: 'output', run: () => { Panel.show('output'); Panel.append(lspLog.join('')); } },
];

const RUBY_VIEW = ['runFile', 'runTests', 'runTestLine', 'runAllTests', 'gotoTest', 'stop', 'rake', 'bundle.install', 'bundle.update', 'bundle.outdated', 'restartLsp', 'lspLog'];

// "Ctrl+Shift+P" style keys -> handler; compared with the normalized key of each keydown.
const keymap = new Map(commands.filter(c => c.key).map(c => [c.key!.toLowerCase(), c]));
const eventKey = (e: KeyboardEvent) => [e.ctrlKey && 'ctrl', e.shiftKey && 'shift', e.altKey && 'alt', e.key.toLowerCase()].filter(Boolean).join('+');

// ---------- layout ----------

function showView(view: string) {
  $('#sidebar').hidden = false;
  $('#sash-side').hidden = false;
  document.querySelectorAll<HTMLElement>('.ab-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  document.querySelectorAll<HTMLElement>('#sidebar .view').forEach(el => { el.hidden = el.id !== `view-${view}`; });
}

function toggleSidebar(visible = $('#sidebar').hidden) {
  $('#sidebar').hidden = !visible;
  $('#sash-side').hidden = !visible;
}

function makeSash(sash: HTMLElement, onMove: (e: MouseEvent) => void) {
  sash.onmousedown = down => {
    down.preventDefault();
    document.body.classList.add('dragging');
    const up = () => { document.body.classList.remove('dragging'); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', up);
  };
}

function renderRubyView() {
  $('#ruby-body').replaceChildren(...RUBY_VIEW.map(id => {
    const c = commands.find(x => x.id === id)!;
    const row = h('div', { className: 'tree-row' }, icon(c.icon ?? 'blank'), h('span', { className: 'tree-label' }, c.label.replace(/^[^:]+: /, '')), h('span', { className: 'desc' }, c.key ?? ''));
    row.onclick = () => c.run();
    return row;
  }));
}

function renderWelcome() {
  const shortcut = (label: string, key: string) => h('div', { className: 'shortcut' }, h('span', {}, label), h('kbd', {}, key));
  const open = h('button', { className: 'button' }, icon('folder-opened'), ' Abrir pasta');
  open.onclick = () => openFolder();
  $('#welcome').replaceChildren(h('div', { className: 'welcome-inner' },
    h('h1', {}, 'Rubaxe'), h('p', { className: 'setting-desc' }, 'IDE rápida para Ruby'),
    ws.root ? '' : open,
    shortcut('Ir para arquivo', 'Ctrl+P'), shortcut('Paleta de comandos', 'Ctrl+Shift+P'), shortcut('Pesquisar no projeto', 'Ctrl+Shift+F'),
    shortcut('Executar arquivo Ruby', 'Ctrl+F5'), shortcut('Ir para teste', 'Ctrl+Shift+T'), shortcut('Configurações', 'Ctrl+,')));
}

// ---------- status bar ----------

function statusItem(id: string, side: 'left' | 'right', onclick?: () => void) {
  const el = h('div', { className: 'sb-item', id });
  if (onclick) el.onclick = onclick; else el.classList.add('static');
  $(side === 'left' ? '#sb-left' : '#sb-right').append(el);
  return el;
}

function setStatus(el: HTMLElement, iconName: string, text: string, tooltip = '') {
  el.replaceChildren(...(iconName ? [icon(iconName)] : []), h('span', {}, text));
  el.title = tooltip;
}

function initStatusBar() {
  statusItem('sb-lsp', 'left', () => quickPick({
    placeholder: 'Ruby LSP',
    items: () => [commands.find(c => c.id === 'restartLsp')!, commands.find(c => c.id === 'lspLog')!].map(c => ({ label: c.label, icon: c.icon, run: c.run })),
  }));
  statusItem('sb-ruby', 'left', () => Editor.openSettings());
  const problems = statusItem('sb-problems', 'left', () => Panel.show('problems'));
  problems.append(icon('error'), h('span', { id: 'sb-errors' }, '0'), icon('warning'), h('span', { id: 'sb-warnings' }, '0'));
  const cursor = statusItem('sb-cursor', 'right', () => { Editor.editor.focus(); void Editor.editor.getAction('editor.action.gotoLine')?.run(); });
  const indent = statusItem('sb-indent', 'right');
  const eol = statusItem('sb-eol', 'right');
  const lang = statusItem('sb-lang', 'right');
  const update = () => {
    const model = Editor.active?.kind === 'file' ? Editor.editor.getModel() : null;
    for (const el of [cursor, indent, eol, lang]) el.hidden = !model;
    if (!model) return;
    const p = Editor.editor.getPosition();
    setStatus(cursor, '', `Ln ${p?.lineNumber ?? 1}, Col ${p?.column ?? 1}`, 'Ir para linha');
    setStatus(indent, '', `Espaços: ${model.getOptions().tabSize}`);
    setStatus(eol, '', model.getEOL() === '\n' ? 'LF' : 'CRLF');
    setStatus(lang, '', model.getLanguageId() === 'ruby' ? 'Ruby' : model.getLanguageId());
  };
  Editor.editor.onDidChangeCursorPosition(update);
  Editor.onDidChange(update);
  update();
  setStatus($('#sb-lsp'), 'circle-slash', 'Ruby LSP', 'Abra uma pasta para iniciar o Ruby LSP');
}

async function refreshInterpreter() {
  const el = $('#sb-ruby');
  if (!Features.on('sdk')) return setStatus(el, '', '');
  setStatus(el, 'loading', 'Ruby…');
  const info = await Ruby.interpreterInfo();
  setStatus(el, info.ok ? 'ruby' : 'warning', info.text, info.tooltip);
}

// ---------- workspace ----------

function startLsp() {
  if (!ws.root) return notify('Abra uma pasta para iniciar o Ruby LSP.');
  const el = $('#sb-lsp');
  void Lsp.start(ws.root, Features.get<string>('ruby.lspPath'), {
    ensureModel: Editor.ensureModel,
    log: text => { lspLog.push(text); if (lspLog.length > 2000) lspLog.splice(0, 500); },
    status: (state, detail) => {
      const look = { starting: ['loading', 'Ruby LSP: iniciando'], ready: ['check', 'Ruby LSP'], busy: ['sync', `Ruby LSP: ${detail ?? 'trabalhando'}`], error: ['error', 'Ruby LSP'], off: ['circle-slash', 'Ruby LSP'] }[state];
      setStatus(el, look[0], look[1], detail ?? '');
      el.classList.toggle('error', state === 'error');
      if (state === 'ready') void renderOutline();
    },
  });
}

async function openFolder(path?: string) {
  const target = path ?? await api.openFolder();
  if (!target || !Editor.closeAll()) return;
  ws.root = target;
  ws.files = await api.listFiles(target);
  ws.hasGemfile = await api.exists(abs('Gemfile'));
  document.title = `${basename(target)} — Rubaxe`;
  $('#command-center-label').textContent = basename(target);
  Features.set('window.lastFolder', target);
  void api.saveSettings(Features.all());
  renderWelcome();
  showView('explorer');
  await renderExplorer();
  startLsp();
  void refreshInterpreter();
}

// ---------- quick open ----------

function fileItems(q: string): QuickItem[] {
  return ws.files
    .map(f => ({ f, rel: relativeTo(ws.root, f) ?? f }))
    .map(x => ({ ...x, score: q ? fuzzyScore(q, x.rel) : 0 }))
    .filter(x => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 200)
    .map(({ f, rel }) => ({ label: basename(rel), description: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', icon: fileIcon(rel), run: () => Editor.openFile(f) }));
}

function commandItems(q: string): QuickItem[] {
  const seen = new Set<string>();
  const own = commands.filter(c => !seen.has(c.label) && seen.add(c.label)).map(c => ({ label: c.label, description: c.key, icon: c.icon, run: c.run }));
  const editorActions = Editor.editor.getModel()
    ? Editor.editor.getSupportedActions().map(a => ({ label: `Editor: ${a.label}`, icon: 'edit', run: () => { Editor.editor.focus(); void a.run(); } }))
    : [];
  return [...own, ...editorActions]
    .map(item => ({ item, score: fuzzyScore(q.trim(), item.label) }))
    .filter(x => x.score >= 0)
    .sort((a, b) => q.trim() ? b.score - a.score : 0)
    .map(x => x.item);
}

async function symbolItems(q: string): Promise<QuickItem[]> {
  if (!q) return [];
  const symbols = await Lsp.workspaceSymbols(q) ?? [];
  return symbols.slice(0, 200).map((s: any) => {
    const uri = monaco.Uri.parse(s.location.uri);
    const range: M.IRange | undefined = s.location.range && Lsp.range(s.location.range);
    return { label: s.name, description: `${s.containerName ? s.containerName + ' · ' : ''}${relativeTo(ws.root, uri.fsPath) ?? uri.fsPath}`, icon: 'symbol-class', run: () => Editor.openUri(uri, range) };
  });
}

function quickOpen(prefix = '') {
  quickPick({
    placeholder: 'Pesquisar arquivos pelo nome (> comandos, # símbolos, : linha)',
    value: prefix,
    items: q => {
      if (q.startsWith('>')) return commandItems(q.slice(1));
      if (q.startsWith('#')) return symbolItems(q.slice(1).trim());
      if (q.startsWith(':')) {
        const line = parseInt(q.slice(1), 10);
        return line && Editor.editor.getModel() ? [{ label: `Ir para a linha ${line}`, icon: 'arrow-right', run: () => Editor.reveal({ lineNumber: line, column: 1 }) }] : [];
      }
      return fileItems(q);
    },
  });
}

// ---------- settings ----------

function onSettingChange(key: string) {
  void api.saveSettings(Features.all());
  if (key.startsWith('editor.')) Editor.applyOptions();
  if (key === 'features.diagnostics') Lsp.refreshDiagnostics();
  if (key === 'features.documentSymbols') void renderOutline();
  if (key === 'ruby.lspPath' && ws.root) startLsp();
  if (key === 'ruby.path' || key === 'features.sdk') void refreshInterpreter();
}

// ---------- boot ----------

function defineTheme() {
  monaco.editor.defineTheme('rubaxe-dark', {
    base: 'vs-dark', inherit: true, rules: [],
    colors: {
      'editor.background': '#1F1F1F', 'editor.foreground': '#CCCCCC', 'editorLineNumber.foreground': '#6E7681',
      'editorLineNumber.activeForeground': '#CCCCCC', 'editorWidget.background': '#202020', 'editorWidget.border': '#313131',
      'editor.findMatchBackground': '#9E6A03', 'editorOverviewRuler.border': '#010409', 'input.background': '#313131',
      'input.border': '#3C3C3C', 'focusBorder': '#0078D4', 'editorGroup.border': '#FFFFFF17', 'peekViewEditor.background': '#1F1F1F',
      'peekViewResult.background': '#1F1F1F', 'peekViewEditor.matchHighlightBackground': '#BB800966',
    },
  });
}

async function boot() {
  Features.load(await api.loadSettings());
  defineTheme();
  Editor.createEditor(container => Features.render(container, onSettingChange));
  Lsp.registerProviders();
  Panel.initPanel(Ruby.stopAll);
  initExplorer(() => openFolder());
  initSearch();
  initStatusBar();
  renderRubyView();
  renderWelcome();
  setCloseHandler(() => { if (Editor.editor.getModel()) Editor.editor.focus(); });

  document.querySelectorAll<HTMLElement>('.ab-item[data-view]').forEach(el => {
    el.onclick = () => {
      const view = el.dataset.view!;
      if (el.classList.contains('active') && !$('#sidebar').hidden) toggleSidebar(false); else showView(view);
      if (view === 'search') focusSearch();
    };
  });
  $('#ab-settings').onclick = () => Editor.openSettings();
  $('#command-center').onclick = () => quickOpen();
  makeSash($('#sash-side'), e => { $('#sidebar').style.width = `${Math.min(600, Math.max(170, e.clientX - 48))}px`; });
  makeSash($('#sash-panel'), e => { $('#panel').style.height = `${Math.min(window.innerHeight - 200, Math.max(100, window.innerHeight - 22 - e.clientY))}px`; });

  // Capture phase so workbench shortcuts win over Monaco's own bindings.
  window.addEventListener('keydown', e => {
    const cmd = keymap.get(eventKey(e));
    if (!cmd) return;
    e.preventDefault();
    e.stopPropagation();
    void cmd.run();
  }, true);

  api.onCloseRequest(() => {
    const dirty = Editor.tabs.filter(t => t.dirty).map(t => t.title);
    if (!dirty.length || confirm(`Há alterações não salvas em: ${dirty.join(', ')}.\nFechar o Rubaxe e descartar as alterações?`)) api.confirmClose();
  });

  showView('explorer');
  Panel.show('problems');
  Panel.toggle(false);
  Panel.refreshProblems();
  await renderExplorer();
  const last = Features.get<string | undefined>('window.lastFolder');
  if (last && await api.exists(last)) await openFolder(last);
}

const amd = (window as unknown as { require: { config(c: unknown): void; (deps: string[], cb: () => void): void } }).require;
amd.config({ paths: { vs: '../../node_modules/monaco-editor/min/vs' } });
amd(['vs/editor/editor.main'], () => { boot().catch(e => notify(`Falha ao iniciar: ${(e as Error).message}`, 'error')); });
