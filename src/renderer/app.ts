// Workbench entry: loads Monaco, wires layout, commands, keybindings and the status bar.
import type * as M from 'monaco-editor';
import { $, abs, api, basename, fileIcon, h, icon, notify, ws } from './dom.ts';
import * as Debug from './debug.ts';
import * as Editor from './editor.ts';
import { initExplorer, renderExplorer, renderOutline } from './explorer.ts';
import * as Features from './features.ts';
import * as Git from './git.ts';
import * as Hierarchy from './hierarchy.ts';
import { registerIntentions } from './intentions.ts';
import * as Lsp from './lsp-client.ts';
import * as Panel from './panel.ts';
import * as Rails from './rails.ts';
import { fuzzyScore, relativeTo } from './paths.ts';
import { quickPick, setCloseHandler, type QuickItem } from './quick-input.ts';
import * as Ruby from './ruby.ts';
import * as Terminal from './terminal.ts';
import * as Tests from './tests.ts';
import { focusSearch, initSearch } from './search.ts';

interface Command { id: string; label: string; key?: string; icon?: string; run: () => unknown }

const lspLog: string[] = [];

const commands: Command[] = [
  { id: 'openFolder', label: 'Arquivo: Abrir Pasta...', key: 'Ctrl+O', icon: 'folder-opened', run: () => openFolder() },
  { id: 'openFile', label: 'Arquivo: Abrir Arquivo...', icon: 'go-to-file', run: async () => { const f = await api.openFileDialog(); if (f) await Editor.openFile(f); } },
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
  { id: 'rerunFailed', label: 'Testes: Reexecutar Falhas', icon: 'debug-rerun', run: () => Tests.rerunFailed() },
  { id: 'coverageAll', label: 'Testes: Executar Todos com Cobertura', icon: 'run-coverage', run: () => Tests.runWithCoverage(() => Ruby.runAllTests()) },
  { id: 'coverageFile', label: 'Testes: Executar Testes do Arquivo com Cobertura', icon: 'run-coverage', run: () => Tests.runWithCoverage(() => Ruby.runTests()) },
  { id: 'hideCoverage', label: 'Testes: Ocultar Cobertura', icon: 'eye-closed', run: () => Tests.hideCoverage() },
  { id: 'testsView', label: 'Exibir: Testes', icon: 'beaker', run: () => showView('tests') },
  { id: 'profileFile', label: 'Ruby: Perfilar Arquivo (profiler)', icon: 'flame', run: () => Ruby.runFile(Tests.profile, 'profiler') },
  { id: 'gotoTest', label: 'Ruby: Ir para Teste / Implementação', key: 'Ctrl+Shift+T', icon: 'go-to-file', run: () => Ruby.gotoTest() },
  { id: 'stop', label: 'Ruby: Parar Execução', key: 'Ctrl+F2', icon: 'debug-stop', run: () => Ruby.stopAll() },
  { id: 'rake', label: 'Rake: Executar Tarefa...', icon: 'tools', run: () => Ruby.rakeTasks() },
  ...['install', 'update', 'outdated', 'lock', 'clean'].map(sub => ({ id: `bundle.${sub}`, label: `Bundler: ${sub}`, icon: 'package', run: () => Ruby.bundle(sub) })),
  { id: 'debugStart', label: 'Depurar: Iniciar / Continuar', key: 'F5', icon: 'debug-alt', run: () => Debug.active() ? Debug.cont() : debugFile() },
  { id: 'debugStop', label: 'Depurar: Parar', key: 'Shift+F5', icon: 'debug-stop', run: () => Debug.stop() },
  { id: 'stepOver', label: 'Depurar: Passar por Cima', key: 'F10', icon: 'debug-step-over', run: () => Debug.stepOver() },
  { id: 'stepInto', label: 'Depurar: Entrar', key: 'F11', icon: 'debug-step-into', run: () => Debug.stepInto() },
  { id: 'stepOut', label: 'Depurar: Sair', key: 'Shift+F11', icon: 'debug-step-out', run: () => Debug.stepOut() },
  { id: 'toggleBreakpoint', label: 'Depurar: Alternar Breakpoint', key: 'F9', icon: 'debug-breakpoint', run: () => Debug.toggleBreakpoint() },
  { id: 'conditionalBreakpoint', label: 'Depurar: Breakpoint Condicional...', icon: 'debug-breakpoint-conditional', run: () => Debug.conditionalBreakpoint() },
  { id: 'debugTests', label: 'Depurar: Testes do Arquivo', icon: 'beaker', run: () => Ruby.runTests(false, Debug.start, 'debugger') },
  { id: 'debugTestLine', label: 'Depurar: Teste na Linha', icon: 'debug-line-by-line', run: () => Ruby.runTests(true, Debug.start, 'debugger') },
  { id: 'debugAttach', label: 'Depurar: Anexar a Processo (rdbg)...', icon: 'debug-disconnect', run: () => Debug.attach() },
  { id: 'debugView', label: 'Exibir: Executar e Depurar', key: 'Ctrl+Shift+D', icon: 'debug-alt', run: () => showView('debug') },
  { id: 'debugConsole', label: 'Exibir: Console de Depuração', key: 'Ctrl+Shift+Y', icon: 'debug-console', run: () => Panel.show('debug') },
  { id: 'railsRelated', label: 'Rails: Ir para Arquivo Relacionado...', key: 'Ctrl+Shift+R', icon: 'references', run: () => Rails.related() },
  { id: 'railsGenerate', label: 'Rails: Executar Generator...', icon: 'wand', run: () => Rails.generate() },
  { id: 'railsDestroy', label: 'Rails: Desfazer Generator (destroy)...', icon: 'trash', run: () => Rails.generate(true) },
  { id: 'railsServer', label: 'Rails: Iniciar Servidor', icon: 'server-process', run: () => Rails.server() },
  ...['migrate', 'rollback', 'seed'].map(task => ({ id: `rails.db.${task}`, label: `Rails: db:${task}`, icon: 'database', run: () => Rails.db(task) })),
  { id: 'railsConsole', label: 'Rails: Console', icon: 'terminal', run: () => Rails.openConsole() },
  { id: 'terminal', label: 'Exibir: Terminal', key: 'Ctrl+`', icon: 'terminal', run: () => Terminal.show() },
  { id: 'terminalAbnt', label: 'Exibir: Terminal', key: "Ctrl+'", run: () => Terminal.show() },
  { id: 'terminalNew', label: 'Terminal: Novo Terminal', key: 'Ctrl+Shift+`', icon: 'add', run: () => Terminal.create() },
  { id: 'irb', label: 'Ruby: Console IRB', icon: 'terminal', run: () => openIrb() },
  { id: 'sendToConsole', label: 'Ruby: Enviar Seleção ao Console', key: 'Ctrl+Alt+Enter', icon: 'send', run: () => Terminal.sendSelection(openIrb) },
  { id: 'scmView', label: 'Exibir: Controle de Código', key: 'Ctrl+Shift+G', icon: 'source-control', run: () => showView('scm') },
  { id: 'gitCommit', label: 'Git: Commit', icon: 'check', run: () => Git.commit() },
  { id: 'gitBranch', label: 'Git: Trocar Branch...', icon: 'git-branch', run: () => Git.switchBranch() },
  { id: 'gitBlame', label: 'Git: Alternar Blame na Linha', icon: 'person', run: () => Git.toggleBlame() },
  { id: 'gitRefresh', label: 'Git: Atualizar Status', icon: 'refresh', run: () => Git.refresh() },
  { id: 'typeHierarchy', label: 'Ruby: Hierarquia de Tipos', icon: 'type-hierarchy', run: () => Hierarchy.showTypeHierarchy() },
  { id: 'callers', label: 'Ruby: Chamadas do Método', key: 'Shift+Alt+H', icon: 'call-incoming', run: () => Hierarchy.showCallers() },
  { id: 'selectRuby', label: 'Ruby: Selecionar Interpretador...', icon: 'ruby', run: () => Ruby.selectInterpreter(() => onSettingChange('ruby.path')) },
  { id: 'gems', label: 'Ruby: Recarregar Lista de Gems', icon: 'package', run: () => { showView('ruby'); void Ruby.loadGems($('#gems-body')); } },
  { id: 'codeStyle', label: 'Estilo de Código: Gravar Configuração RuboCop no Projeto', icon: 'symbol-ruler', run: () => Ruby.writeCodeStyle(startLsp) },
  { id: 'steep', label: 'Ruby: Steep Check (tipos RBS)', icon: 'checklist', run: () => Ruby.steepCheck() },
  { id: 'restartLsp', label: 'Ruby: Reiniciar Ruby LSP', icon: 'debug-restart', run: () => startLsp() },
  { id: 'lspLog', label: 'Ruby: Mostrar Log do Ruby LSP', icon: 'output', run: () => { Panel.show('output'); Panel.append(lspLog.join('')); } },
];

const debugFile = () => Ruby.runFile(Debug.start, 'debugger');
const openIrb = () => Terminal.create('irb', ws.hasGemfile ? 'bundle exec irb' : 'irb', true);

const RUBY_VIEW = ['runFile', 'runTests', 'runTestLine', 'runAllTests', 'rerunFailed', 'coverageAll', 'profileFile', 'gotoTest', 'railsRelated', 'railsGenerate', 'railsServer', 'rails.db.migrate', 'irb', 'railsConsole', 'sendToConsole', 'selectRuby', 'typeHierarchy', 'callers', 'codeStyle', 'stop', 'rake', 'bundle.install', 'bundle.update', 'bundle.outdated', 'restartLsp', 'lspLog'];

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
    h('img', { className: 'welcome-logo', src: '../../assets/logo.png', alt: 'Rubaxe' }), h('p', { className: 'setting-desc' }, 'IDE rápida para Ruby'),
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
  statusItem('sb-branch', 'left', () => Git.switchBranch()).hidden = true;
  statusItem('sb-lsp', 'left', () => quickPick({
    placeholder: 'Ruby LSP',
    items: () => [commands.find(c => c.id === 'restartLsp')!, commands.find(c => c.id === 'lspLog')!].map(c => ({ label: c.label, icon: c.icon, run: c.run })),
  }));
  statusItem('sb-ruby', 'left', () => Ruby.selectInterpreter(() => onSettingChange('ruby.path')));
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
  ws.isRails = await api.exists(abs('config/application.rb')) && await api.exists(abs('bin/rails'));
  Rails.resetRails();
  document.title = `${basename(target)} — Rubaxe`;
  $('#command-center-label').textContent = basename(target);
  Features.set('window.lastFolder', target);
  void api.saveSettings(Features.all());
  renderWelcome();
  showView('explorer');
  await renderExplorer();
  startLsp();
  void refreshInterpreter();
  void Git.refresh();
  void Ruby.loadGems($('#gems-body'));
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
  if (key === 'ruby.path') void Ruby.applyRubyBin().then(() => { if (ws.root) startLsp(); });
  if (key === 'features.gemsView') void Ruby.loadGems($('#gems-body'));
}

// ---------- boot ----------

function defineTheme() {
  monaco.editor.defineTheme('rubaxe-dark', {
    base: 'vs-dark', inherit: true,
    // Semantic token types from the Ruby LSP (VS Code Dark Modern colors).
    rules: [
      { token: 'namespace', foreground: '4EC9B0' }, { token: 'class', foreground: '4EC9B0' }, { token: 'type', foreground: '4EC9B0' },
      { token: 'method', foreground: 'DCDCAA' }, { token: 'function', foreground: 'DCDCAA' }, { token: 'parameter', foreground: '9CDCFE' },
      { token: 'variable', foreground: '9CDCFE' }, { token: 'property', foreground: '9CDCFE' }, { token: 'enumMember', foreground: '4FC1FF' },
    ],
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
  await Ruby.applyRubyBin();
  defineTheme();
  Editor.createEditor(container => Features.render(container, onSettingChange));
  Lsp.registerProviders();
  registerIntentions(id => Features.on(id));
  Panel.initPanel(Ruby.stopAll);
  initExplorer(() => openFolder());
  initSearch();
  Debug.initDebug(() => debugFile());
  Tests.initTests();
  Rails.initRails();
  Terminal.initTerminal();
  Git.initGit();
  initStatusBar();
  renderRubyView();
  $('#gems-refresh').onclick = e => { e.stopPropagation(); void Ruby.loadGems($('#gems-body')); };
  $('#gems-header').onclick = () => { const b = $('#gems-body'); b.hidden = !b.hidden; $('#gems-header').firstElementChild!.className = `codicon codicon-chevron-${b.hidden ? 'right' : 'down'}`; };
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

  window.addEventListener('focus', () => void Editor.syncFromDisk());
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
