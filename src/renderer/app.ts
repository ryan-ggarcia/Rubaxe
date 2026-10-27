// Workbench entry: loads Monaco, wires layout, commands, keybindings and the status bar.
import type * as M from 'monaco-editor';
import { $, abs, api, basename, fileIcon, h, icon, notify, ws } from './dom.ts';
import * as Debug from './debug.ts';
import * as Editor from './editor.ts';
import { initExplorer, renderExplorer, renderOutline, resetExplorer, syncTree } from './explorer.ts';
import * as Features from './features.ts';
import * as Git from './git.ts';
import * as Hierarchy from './hierarchy.ts';
import { enterInBraceBlock, registerIntentions } from './intentions.ts';
import * as Lsp from './lsp-client.ts';
import * as Markdown from './markdown.ts';
import { initMenubar, type Menu, type MenuItem } from './menu.ts';
import pkg from '../../package.json' with { type: 'json' };
import * as Panel from './panel.ts';
import * as Rails from './rails.ts';
import * as RightPanel from './right-panel.ts';
import { eventKey, fuzzyScore, isGemfile, relativeTo, usesStandard } from './paths.ts';
import { quickPick, setCloseHandler, type QuickItem } from './quick-input.ts';
import * as Ruby from './ruby.ts';
import * as Terminal from './terminal.ts';
import * as Update from './update.ts';
import * as Tests from './tests.ts';
import { focusSearch, initSearch } from './search.ts';

// when: the shortcut only applies if it returns true (otherwise the key goes on, e.g. Ctrl+Shift+V pastes as text).
interface Command { id: string; label: string; key?: string; icon?: string; when?: () => boolean; run: () => unknown }

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
  { id: 'togglePanel', label: 'Exibir: Alternar Painel', key: 'Ctrl+J', icon: 'layout-panel', run: () => togglePanel() },
  { id: 'toggleRightPanel', label: 'Exibir: Alternar Painel Direito', key: 'Ctrl+Alt+B', icon: 'layout-sidebar-right', run: () => RightPanel.toggle() },
  { id: 'problems', label: 'Exibir: Problemas', key: 'Ctrl+Shift+M', icon: 'warning', run: () => Panel.show('problems') },
  { id: 'output', label: 'Exibir: Saída', key: 'Ctrl+Shift+U', icon: 'output', run: () => Panel.show('output') },
  { id: 'mdPreview', label: 'Markdown: Abrir Prévia', key: 'Ctrl+Shift+V', icon: 'open-preview', when: () => Editor.isMarkdown(), run: () => Editor.openPreview() },
  { id: 'zoomIn', label: 'Exibir: Ampliar', key: 'Ctrl+=', icon: 'zoom-in', run: () => zoomStep(1) },
  // Ctrl++ = numeric keypad (or a layout with an unshifted +); Ctrl+Shift++ = Ctrl+Shift+= on US/ABNT layouts.
  { id: 'zoomInPlus', label: 'Exibir: Ampliar', key: 'Ctrl++', run: () => zoomStep(1) },
  { id: 'zoomInShift', label: 'Exibir: Ampliar', key: 'Ctrl+Shift++', run: () => zoomStep(1) },
  { id: 'zoomOut', label: 'Exibir: Reduzir', key: 'Ctrl+-', icon: 'zoom-out', run: () => zoomStep(-1) },
  { id: 'zoomReset', label: 'Exibir: Redefinir Zoom', key: 'Ctrl+0', icon: 'screen-normal', run: () => setZoom(0) }, // also Ctrl+NumPad0 (same e.key)
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
  { id: 'profileFile', label: 'Ruby: Perfilar Arquivo (amostragem)', icon: 'flame', run: () => Ruby.runFile(Tests.profile, 'profiler') },
  { id: 'profileExact', label: 'Ruby: Perfilar Arquivo (instrumentado, exato)', icon: 'flame', run: () => Ruby.runFile((cmd, args) => Tests.profile(cmd, args, true), 'profiler') },
  { id: 'gotoTest', label: 'Ruby: Ir para Teste / Implementação', key: 'Ctrl+Shift+T', icon: 'go-to-file', run: () => Ruby.gotoTest() },
  { id: 'stop', label: 'Ruby: Parar Execução', key: 'Shift+F2', icon: 'debug-stop', run: () => Ruby.stopAll() },
  { id: 'rake', label: 'Rake: Executar Tarefa...', icon: 'tools', run: () => Ruby.rakeTasks() },
  { id: 'bundleGem', label: 'Bundler: Criar Gem...', icon: 'package', run: () => Ruby.bundleGem() },
  { id: 'rspecFolder', label: 'RSpec: Executar Pasta...', icon: 'run-all', run: () => Ruby.runSpecFolder() },
  ...['install', 'update', 'outdated', 'lock', 'clean', 'init', 'pack'].map(sub => ({ id: `bundle.${sub}`, label: `Bundler: ${sub}`, icon: 'package', run: () => Ruby.bundle(sub) })),
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
  { id: 'railsRelated', label: 'Rails: Ir para Arquivo Relacionado...', key: 'Shift+Alt+R', icon: 'references', run: () => Rails.related() },
  { id: 'railsRename', label: 'Rails: Renomear Recurso...', icon: 'edit', run: () => Rails.renameResource() },
  { id: 'railsGenerate', label: 'Rails: Executar Generator...', icon: 'wand', run: () => Rails.generate() },
  { id: 'railsDestroy', label: 'Rails: Desfazer Generator (destroy)...', icon: 'trash', run: () => Rails.generate(true) },
  { id: 'railsServer', label: 'Rails: Iniciar Servidor', icon: 'server-process', run: () => Rails.server() },
  ...['migrate', 'rollback', 'seed'].map(task => ({ id: `rails.db.${task}`, label: `Rails: db:${task}`, icon: 'database', run: () => Rails.db(task) })),
  { id: 'railsConsole', label: 'Rails: Console', icon: 'terminal', run: () => Rails.openConsole() },
  { id: 'terminal', label: 'Exibir: Terminal', key: 'Ctrl+`', icon: 'terminal', run: () => Terminal.show() },
  { id: 'terminalAbnt', label: 'Exibir: Terminal', key: "Ctrl+'", run: () => Terminal.show() },
  { id: 'terminalNew', label: 'Terminal: Novo Terminal', key: 'Ctrl+Shift+`', icon: 'add', run: () => Terminal.create() },
  { id: 'terminalNewAbnt', label: 'Terminal: Novo Terminal', key: 'Ctrl+Shift+"', run: () => Terminal.create() },
  { id: 'terminalProfile', label: 'Terminal: Novo Terminal com Perfil...', icon: 'chevron-down', run: () => Terminal.pickProfile('Novo terminal com o perfil...', p => void Terminal.create(p.name, undefined, false, p)) },
  { id: 'terminalDefault', label: 'Terminal: Selecionar Perfil Padrão...', icon: 'gear', run: () => Terminal.pickProfile('Perfil padrão do terminal', p => { Features.set('terminal.shell', p.name); onSettingChange('terminal.shell'); notify(`Perfil padrão: ${p.name}.`); }) },
  { id: 'irb', label: 'Ruby: Console IRB', icon: 'terminal', run: () => openIrb() },
  { id: 'setupRuby', label: 'Ruby: Configurar Ambiente (Ruby, ruby-lsp, ridk)', icon: 'tools', run: () => setupRuby() },
  { id: 'intentions', label: 'Editor: Mostrar Ações e Correções Rápidas', key: 'Alt+Enter', icon: 'lightbulb', run: () => { Editor.editor.focus(); Editor.editor.trigger('menu', 'editor.action.quickFix', null); } },
  { id: 'sendToConsole', label: 'Ruby: Enviar Seleção ao Console', key: 'Shift+Alt+Enter', icon: 'send', run: () => Terminal.sendSelection(openIrb) },
  { id: 'scmView', label: 'Exibir: Controle de Código', key: 'Ctrl+Shift+G', icon: 'source-control', run: () => showView('scm') },
  { id: 'gitCommit', label: 'Git: Commit', icon: 'check', run: () => Git.commit() },
  { id: 'gitPush', label: 'Git: Push', icon: 'repo-push', run: () => Git.sync('push') },
  { id: 'gitPull', label: 'Git: Pull', icon: 'repo-pull', run: () => Git.sync('pull') },
  { id: 'gitFetch', label: 'Git: Fetch', icon: 'repo-fetch', run: () => Git.sync('fetch') },
  { id: 'gitBranch', label: 'Git: Trocar Branch...', icon: 'git-branch', run: () => Git.switchBranch() },
  { id: 'gitBlame', label: 'Git: Alternar Blame na Linha', icon: 'person', run: () => Git.toggleBlame() },
  { id: 'gitRefresh', label: 'Git: Atualizar Status', icon: 'refresh', run: () => Git.refresh() },
  { id: 'typeHierarchy', label: 'Ruby: Hierarquia de Tipos', icon: 'type-hierarchy', run: () => Hierarchy.showTypeHierarchy() },
  { id: 'callers', label: 'Ruby: Chamadas do Método', key: 'Shift+Alt+H', icon: 'call-incoming', run: () => Hierarchy.showCallers() },
  { id: 'selectRuby', label: 'Ruby: Selecionar Interpretador...', icon: 'ruby', run: () => Ruby.selectInterpreter(() => onSettingChange('ruby.path')) },
  { id: 'gems', label: 'Ruby: Recarregar Lista de Gems', icon: 'package', run: () => { showView('ruby'); void Ruby.loadGems($('#gems-body')); } },
  { id: 'codeStyle', label: 'Estilo de Código: Gravar Configuração RuboCop no Projeto', icon: 'symbol-ruler', run: () => Ruby.writeCodeStyle(startLsp) },
  { id: 'steep', label: 'Ruby: Steep Check (tipos RBS)', icon: 'checklist', run: () => Ruby.steepCheck() },
  { id: 'checkUpdates', label: 'Ajuda: Verificar Atualizações...', icon: 'cloud-download', run: () => Update.check() },
  { id: 'restartLsp', label: 'Ruby: Reiniciar Ruby LSP', icon: 'debug-restart', run: () => startLsp() },
  { id: 'lspLog', label: 'Ruby: Mostrar Log do Ruby LSP', icon: 'output', run: () => { Panel.show('output'); Panel.append(lspLog.join('')); } },
];

let panelOpened = false;
function togglePanel() {
  const opening = $('#panel').hidden;
  Panel.toggle();
  if (!opening && Editor.editor?.getModel()) Editor.editor.focus();
  if (opening && (Panel.current === 'terminal' || !panelOpened)) Terminal.show();
  panelOpened = true;
}

// Gemfile present but `bundle check` fails: a status bar item offers bundle install (exit 1 = gems missing).
async function checkBundle() {
  const el = $('#sb-bundle');
  const missing = ws.root && ws.hasGemfile && Features.on('bundler') && (await api.exec('bundle', ['check'], ws.root)).code === 1;
  el.hidden = !missing;
}

const debugFile = () => Ruby.runFile(Debug.start, 'debugger');
const openIrb = () => Terminal.create('irb', ws.hasGemfile ? 'bundle exec irb' : 'irb', true);
// Same script the installer offers: Ruby+Devkit if missing, ridk toolchain, ruby-lsp. Runs in a terminal so progress shows.
const setupRuby = async () => api.platform === 'win32'
  ? void Terminal.create('configurar ruby', `powershell -NoProfile -ExecutionPolicy Bypass -File "${await api.rubyHelpers()}${ws.sep}setup-ruby.ps1"`)
  : notify('No Linux/macOS: instale o Ruby por um gerenciador de versões (rbenv, asdf, mise…) e rode gem install ruby-lsp.');

const RUBY_VIEW = ['runFile', 'runTests', 'runTestLine', 'runAllTests', 'rerunFailed', 'coverageAll', 'profileFile', 'gotoTest', 'railsRelated', 'railsGenerate', 'railsServer', 'rails.db.migrate', 'irb', 'railsConsole', 'sendToConsole', 'setupRuby', 'selectRuby', 'typeHierarchy', 'callers', 'codeStyle', 'stop', 'rake', 'bundle.install', 'bundle.update', 'bundle.outdated', 'restartLsp', 'lspLog'];

// "Ctrl+Shift+P" style keys -> handler; compared with the normalized key of each keydown.
const keymap = new Map(commands.filter(c => c.key).map(c => [c.key!.toLowerCase(), c]));

// ---------- menu bar ----------

// A string is a command id, an object a custom item (act = Monaco action on the editor), null a separator.
type Entry = string | MenuItem | null;
const act = (label: string, action: string, key: string): Entry => ({ label, key, run: () => { Editor.editor.focus(); if (Editor.editor.getModel()) Editor.editor.trigger('menu', action, null); } });
const MENUS: [string, Entry[]][] = [
  ['Arquivo', ['openFolder', 'openFile', null, 'save', 'closeTab', null, 'settings']],
  ['Editar', [act('Desfazer', 'undo', 'Ctrl+Z'), act('Refazer', 'redo', 'Ctrl+Y'), null,
    act('Recortar', 'editor.action.clipboardCutAction', 'Ctrl+X'), act('Copiar', 'editor.action.clipboardCopyAction', 'Ctrl+C'), act('Colar', 'editor.action.clipboardPasteAction', 'Ctrl+V'), null,
    act('Localizar', 'actions.find', 'Ctrl+F'), act('Substituir', 'editor.action.startFindReplace', 'Ctrl+H'), 'search', null,
    act('Comentar Linha', 'editor.action.commentLine', 'Ctrl+/')]],
  ['Seleção', [act('Selecionar Tudo', 'editor.action.selectAll', 'Ctrl+A'), act('Expandir Seleção', 'editor.action.smartSelect.expand', 'Shift+Alt+→'), null,
    act('Copiar Linha para Cima', 'editor.action.copyLinesUpAction', 'Shift+Alt+↑'), act('Copiar Linha para Baixo', 'editor.action.copyLinesDownAction', 'Shift+Alt+↓'),
    act('Mover Linha para Cima', 'editor.action.moveLinesUpAction', 'Alt+↑'), act('Mover Linha para Baixo', 'editor.action.moveLinesDownAction', 'Alt+↓'), null,
    act('Adicionar Cursor Acima', 'editor.action.insertCursorAbove', 'Ctrl+Alt+↑'), act('Adicionar Cursor Abaixo', 'editor.action.insertCursorBelow', 'Ctrl+Alt+↓'), act('Adicionar Próxima Ocorrência', 'editor.action.addSelectionToNextFindMatch', 'Ctrl+D')]],
  ['Exibir', ['palette', null, 'explorer', 'search', 'scmView', 'debugView', 'testsView', 'rubyView', null, 'problems', 'output', 'debugConsole', 'terminal', null, 'toggleSidebar', 'toggleRightPanel', 'togglePanel', null, 'mdPreview']],
  ['Ir', ['quickOpen', 'workspaceSymbol', act('Ir para Linha...', 'editor.action.gotoLine', 'Ctrl+G'), null, 'gotoTest', 'railsRelated']],
  ['Executar', ['rspecFolder', 'debugStart', 'debugStop', null, 'runFile', 'runTests', 'runTestLine', 'runAllTests', 'stop', null, 'stepOver', 'stepInto', 'stepOut', 'toggleBreakpoint']],
  ['Terminal', ['terminalNew', 'terminalProfile', 'terminalDefault', 'terminal', null, 'irb', 'sendToConsole']],
  ['Ajuda', ['palette', 'checkUpdates', { label: 'Atalhos', run: () => quickOpen('>') }, { label: 'Sobre o Rubaxe', run: () => notify(`Rubaxe ${pkg.version} — IDE para Ruby`) }]],
];

function menuItem(e: Entry): MenuItem | null {
  if (e === null || typeof e === 'object') return e;
  const c = commands.find(x => x.id === e)!;
  return { label: c.label.replace(/^[^:]+: /, ''), key: c.key, run: () => void c.run() };
}

// ---------- layout ----------

function showView(view: string) {
  toggleSidebar(true);
  document.querySelectorAll<HTMLElement>('.ab-item[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  document.querySelectorAll<HTMLElement>('#sidebar .view').forEach(el => { el.hidden = el.id !== `view-${view}`; });
}

function toggleSidebar(visible = !!$('#sidebar').hidden) {
  $('#sidebar').hidden = !visible;
  $('#sash-side').hidden = !visible;
  $('#tb-left').classList.toggle('active', visible);
  $('#tb-left').setAttribute('aria-pressed', String(visible));
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
    h('img', { className: 'welcome-logo', src: '../../assets/logo.png', alt: '' }), h('h1', {}, 'Rub', h('span', {}, 'axe')), h('p', { className: 'setting-desc' }, 'IDE rápida para Ruby'),
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
  const bundleItem = statusItem('sb-bundle', 'left', () => Ruby.bundle('install'));
  setStatus(bundleItem, 'warning', 'Gems faltando', 'Há gems do Gemfile não instaladas. Clique para rodar bundle install.');
  bundleItem.hidden = true;
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
  const zoom = statusItem('sb-zoom', 'right', () => toggleZoomPopup());
  zoom.role = 'button';
  zoom.tabIndex = 0;
  zoom.onmousedown = e => e.preventDefault(); // a click keeps focus where it was, so Esc can return there
  zoom.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zoom.click(); } };
  window.addEventListener('mousedown', e => { if (zoomPopup && !zoomPopup.contains(e.target as Node) && !zoom.contains(e.target as Node)) toggleZoomPopup(); }, true);
  setStatus($('#sb-lsp'), 'circle-slash', 'Ruby LSP', 'Abra uma pasta para iniciar o Ruby LSP');
}

// Window zoom like VS Code: window.zoomLevel, factor 1.2^level. The status bar shows it while it is not 100%.
const zoomPercent = () => `${Math.round(1.2 ** Features.get<number>('window.zoomLevel') * 100)}%`;
let zoomPopup: HTMLElement | undefined;

function setZoom(level: number) {
  Features.set('window.zoomLevel', level);
  applyZoom();
  void api.saveSettings(Features.all());
}

// A fractional level (min 80%, or typed in Settings) snaps back to the integer scale: 80% -> 83% -> 100%.
function zoomStep(d: 1 | -1) {
  const level = Features.get<number>('window.zoomLevel');
  setZoom(d > 0 ? Math.floor(level) + 1 : Math.ceil(level) - 1);
}

function applyZoom() {
  const level = Math.min(8, Math.max(Features.MIN_ZOOM, Features.get<number>('window.zoomLevel'))); // also fixes an out-of-range saved value
  Features.set('window.zoomLevel', level);
  api.setZoom(level);
  const el = $('#sb-zoom');
  el.hidden = !level && !zoomPopup; // the open popup stays anchored to a visible item
  setStatus(el, level > 0 ? 'zoom-in' : 'zoom-out', zoomPercent(), 'Zoom da janela');
  el.ariaLabel = `Zoom da janela: ${zoomPercent()}`;
  if (zoomPopup) zoomPopup.querySelector('span')!.textContent = zoomPercent();
  const input = document.querySelector<HTMLInputElement>('input[name="window.zoomLevel"]'); // open Settings tab
  if (input) input.value = String(level);
}

// Like a menu: focus landing anywhere else (Tab, including Tab leaving the document and coming back) closes it.
const zoomFocusIn = (e: FocusEvent) => { if (zoomPopup && !zoomPopup.contains(e.target as Node) && !$('#sb-zoom').contains(e.target as Node)) closeZoomPopup(); };

function closeZoomPopup() {
  document.removeEventListener('focusin', zoomFocusIn);
  zoomPopup?.remove();
  zoomPopup = undefined;
  $('#sb-zoom').hidden = !Features.get<number>('window.zoomLevel');
}

function toggleZoomPopup() {
  if (zoomPopup) return closeZoomPopup();
  const button = (text: string, label: string, run: () => void) => {
    const b = h('button', { className: 'button secondary', title: label, ariaLabel: label }, text);
    b.onclick = run;
    return b;
  };
  zoomPopup = h('div', { className: 'menu-popup zoom-popup', role: 'dialog', ariaLabel: 'Zoom da janela' },
    button('−', 'Reduzir (Ctrl+-)', () => zoomStep(-1)), h('span', { ariaLive: 'polite' }, zoomPercent()), button('+', 'Ampliar (Ctrl+=)', () => zoomStep(1)), button('Redefinir', 'Redefinir zoom (Ctrl+0)', () => setZoom(0)));
  zoomPopup.tabIndex = -1; // a click on the % text keeps focus here, so Esc still works
  const previous = document.activeElement as HTMLElement | null;
  zoomPopup.onkeydown = e => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    closeZoomPopup();
    const item = $('#sb-zoom');
    (item.hidden ? previous : item)?.focus();
  };
  document.addEventListener('focusin', zoomFocusIn);
  const r = $('#sb-zoom').getBoundingClientRect();
  zoomPopup.style.right = `${window.innerWidth - r.right}px`;
  zoomPopup.style.bottom = `${window.innerHeight - r.top + 4}px`;
  document.body.append(zoomPopup);
  zoomPopup.querySelector('button')!.focus();
}

async function refreshInterpreter() {
  const el = $('#sb-ruby');
  if (!Features.on('sdk')) return setStatus(el, '', '');
  setStatus(el, 'loading', 'Ruby…');
  const info = await Ruby.interpreterInfo();
  setStatus(el, info.ok ? 'ruby' : 'warning', info.text, info.tooltip);
}

// ---------- workspace ----------

async function startLsp() {
  if (!ws.root) return notify('Abra uma pasta para iniciar o Ruby LSP.');
  const el = $('#sb-lsp');
  const standard = Features.get<boolean>('rubocop.standard') && usesStandard(await api.readFile(abs('Gemfile.lock')).catch(() => ''));
  void Lsp.start(ws.root, Features.get<string>('ruby.lspPath'), {
    ensureModel: Editor.ensureModel,
    options: standard ? { formatter: 'standard', linters: ['standard'] } : undefined,
    log: text => { lspLog.push(text); if (lspLog.length > 2000) lspLog.splice(0, 500); },
    status: (state, detail) => {
      const look = { starting: ['loading', 'Ruby LSP: iniciando'], ready: ['check', 'Ruby LSP'], busy: ['sync', `Ruby LSP: ${(detail ?? 'trabalhando').replace(/^Ruby LSP:? */, '')}`], error: ['error', 'Ruby LSP'], off: ['circle-slash', 'Ruby LSP'] }[state];
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
  void api.watchFolder(target);
  ws.files = await api.listFiles(target);
  ws.hasGemfile = await api.exists(abs('Gemfile'));
  ws.isRails = await api.exists(abs('config/application.rb')) && await api.exists(abs('bin/rails'));
  Rails.resetRails();
  resetExplorer();
  document.title = `${basename(target)} — Rubaxe`;
  $('#folder-label').textContent = basename(target);
  Features.set('window.lastFolder', target);
  void api.saveSettings(Features.all());
  renderWelcome();
  showView('explorer');
  await renderExplorer();
  startLsp();
  void refreshInterpreter();
  void Git.refresh();
  void checkBundle();
  void Ruby.loadGems($('#gems-body'));
  RightPanel.schedule();
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
  if (key === 'workbench.theme') applyTheme();
  if (key === 'window.zoomLevel') applyZoom();
  if (key === 'window.controls' || key === 'window.transparent') { notify('Reiniciar para aplicar'); void api.saveSettings(Features.all()).then(() => api.relaunch()); }
  if (key === 'features.inspections') Ruby.inspectAll();
  if (key === 'ruby.lspPath' && ws.root) void startLsp();
  if (key === 'rubocop.standard' && ws.root) void startLsp();
  if (key === 'rubocop.config' && Features.get('rubocop.config') === 'Rubaxe' && ws.root) void Ruby.writeCodeStyle(startLsp);
  if (key === 'ruby.path' || key === 'features.sdk') void refreshInterpreter();
  if (key === 'ruby.path') void Ruby.applyRubyBin().then(() => { if (ws.root) startLsp(); });
  if (key === 'features.git') void Git.refresh();
  if (key === 'features.testTree') Tests.refreshTree();
  if (key === 'features.gemsView') void Ruby.loadGems($('#gems-body'));
}

// ---------- boot ----------

// 'mac' (or a transparent window, where Linux loses the native frame) draws our own traffic-light circles; macOS keeps its own.
function initWindowControls(material: string) {
  if ((Features.get<string>('window.controls') !== 'mac' && material !== 'transparent') || api.platform === 'darwin') return;
  document.body.classList.add('controls-mac');
  const max = $('#wc-max');
  $('#wc-close').onclick = () => api.windowControl('close');
  $('#wc-min').onclick = () => api.windowControl('minimize');
  max.onclick = () => api.windowControl('maximize');
  api.onMaximizeChange(maximized => {
    max.firstElementChild!.className = `codicon codicon-chrome-${maximized ? 'restore' : 'maximize'}`;
    max.title = max.ariaLabel = maximized ? 'Restaurar' : 'Maximizar';
    document.documentElement.toggleAttribute('data-maximized', maximized);
  });
}

// Live switch of every themed surface: CSS variables, Monaco and the terminals. (The window's native title bar overlay is the main process's.)
function applyTheme() {
  document.documentElement.dataset.theme = Features.get<string>('workbench.theme') === 'claro' ? 'light' : 'dark';
  monaco.editor.setTheme(document.documentElement.dataset.theme === 'light' ? 'rubaxe-light' : 'rubaxe-dark');
  Terminal.applyTheme();
  if (document.body.classList.contains('controls-mac')) return;
  const light = document.documentElement.dataset.theme === 'light';
  // Over acrylic/vibrancy the overlay must be see-through (#rrggbbaa).
  void api.setTitleBarOverlay(document.documentElement.dataset.material ? '#00000000' : light ? '#F3F3F3' : '#181818', light ? '#3B3B3B' : '#CCCCCC');
}

function defineTheme() {
  monaco.editor.defineTheme('rubaxe-light', {
    base: 'vs', inherit: true,
    rules: [
      { token: 'namespace', foreground: '267F99' }, { token: 'class', foreground: '267F99' }, { token: 'type', foreground: '267F99' },
      { token: 'method', foreground: '795E26' }, { token: 'function', foreground: '795E26' }, { token: 'parameter', foreground: '001080' },
      { token: 'variable', foreground: '001080' }, { token: 'property', foreground: '001080' }, { token: 'enumMember', foreground: '0070C1' },
    ],
    colors: {
      'editor.background': '#FFFFFF', 'editor.foreground': '#3B3B3B', 'editorLineNumber.foreground': '#6E7681', 'editorLineNumber.activeForeground': '#3B3B3B',
      'editorWidget.background': '#F8F8F8', 'editorWidget.border': '#C8C8C8', 'editor.findMatchBackground': '#F2C94C', 'editor.selectionBackground': '#F6D5D2',
      'editor.inactiveSelectionBackground': '#FBE6E4', 'list.activeSelectionBackground': '#F6D5D2', 'list.activeSelectionForeground': '#1F1F1F',
      'list.inactiveSelectionBackground': '#FBE6E4', 'list.focusOutline': '#CC342D', 'list.highlightForeground': '#A9261F',
      'editorSuggestWidget.selectedBackground': '#F6D5D2', 'editorSuggestWidget.highlightForeground': '#A9261F', 'peekViewBorder': '#CC342D',
      'peekViewResult.selectionBackground': '#F6D5D2', 'peekViewTitle.background': '#FBEFEE', 'button.background': '#CC342D', 'button.hoverBackground': '#A9261F',
      'textLink.foreground': '#A9261F', 'textLink.activeForeground': '#7F1D18', 'editorWidget.resizeBorder': '#CC342D', 'inputOption.activeBorder': '#CC342D',
      'inputOption.activeBackground': '#CC342D33', 'editorCursor.foreground': '#3B3B3B', 'input.background': '#FFFFFF', 'input.border': '#C8C8C8',
      'focusBorder': '#CC342D', 'editorGroup.border': '#E0E0E0', 'peekViewEditor.background': '#FFFFFF', 'peekViewResult.background': '#F8F8F8',
      'peekViewEditor.matchHighlightBackground': '#F2C94C88',
    },
  });
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
      'editor.findMatchBackground': '#9E6A03', 'editor.selectionBackground': '#6B2420', 'editor.inactiveSelectionBackground': '#4A2220',
      'list.activeSelectionBackground': '#5A1F1C', 'list.inactiveSelectionBackground': '#3A2220', 'list.focusOutline': '#CC342D', 'list.highlightForeground': '#FF6B63',
      'editorSuggestWidget.selectedBackground': '#5A1F1C', 'editorSuggestWidget.highlightForeground': '#FF6B63', 'peekViewBorder': '#CC342D', 'peekViewResult.selectionBackground': '#5A1F1C',
      'peekViewTitle.background': '#2A1F1F', 'button.background': '#CC342D', 'button.hoverBackground': '#A9261F', 'textLink.foreground': '#FF6B63', 'textLink.activeForeground': '#FF8A83',
      'editorWidget.resizeBorder': '#CC342D', 'inputOption.activeBorder': '#CC342D', 'inputOption.activeBackground': '#CC342D66', 'editorCursor.foreground': '#CCCCCC', 'editorOverviewRuler.border': '#010409', 'input.background': '#313131',
      'input.border': '#3C3C3C', 'focusBorder': '#CC342D', 'editorGroup.border': '#FFFFFF17', 'peekViewEditor.background': '#1F1F1F',
      'peekViewResult.background': '#1F1F1F', 'peekViewEditor.matchHighlightBackground': '#BB800966',
    },
  });
}

async function boot() {
  document.body.classList.add(`platform-${api.platform}`);
  Features.load(await api.loadSettings());
  const material = await api.windowMaterial();
  if (material !== 'none') document.documentElement.dataset.material = 'glass';
  if (material === 'transparent') document.documentElement.dataset.transparent = '';
  initWindowControls(material);
  await Ruby.applyRubyBin();
  defineTheme();
  Editor.createEditor(container => Features.render(container, onSettingChange), (tab, page) => void Markdown.render(tab, page));
  Markdown.initPreview();
  applyTheme(); // after createEditor: its theme option would reset the global one
  Lsp.registerProviders();
  // Enter inside a one-line { } block becomes do…end (opt-in); anything else is the normal Enter.
  // onKeyDown is per instance (addCommand is global and would also hit the peek and diff editors); no hit = Monaco's normal Enter.
  Editor.editor.onKeyDown(e => {
    const ed = Editor.editor, pos = ed.getPosition(), model = ed.getModel();
    if (e.keyCode !== monaco.KeyCode.Enter || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey || !Features.get<boolean>('style.braceToDoEndOnEnter') || !pos || !model) return;
    if (ed.getSelections()?.length !== 1 || !ed.getSelection()!.isEmpty() || model.getLanguageId() !== 'ruby') return;
    const ctx = (ed as unknown as { _contextKeyService?: { getContextKeyValue(k: string): unknown } })._contextKeyService;
    if (['suggestWidgetVisible', 'parameterHintsVisible', 'inSnippetMode', 'renameInputVisible', 'findWidgetVisible'].some(k => ctx?.getContextKeyValue(k))) return;
    const hit = enterInBraceBlock(model.getLinesContent(), pos.lineNumber, pos.column);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    ed.executeEdits('brace-enter', hit.edits.map(x => ({ range: new monaco.Range(...x.range), text: x.text })));
    ed.setPosition({ lineNumber: hit.cursor[0], column: hit.cursor[1] });
  });
  registerIntentions(id => Features.on(id));
  initMenubar(MENUS.map(([title, items]): Menu => [title, items.map(menuItem)]), $('#menu-btn'));
  Panel.initPanel(Ruby.stopAll, Terminal.show);
  initExplorer(() => openFolder());
  initSearch();
  Debug.initDebug(() => debugFile());
  Tests.initTests();
  Rails.initRails();
  Ruby.initInspect();
  Terminal.initTerminal();
  Update.initUpdate();
  // Click selects a row in the side lists (the explorer keeps its own selection); the red edge bar follows .selected.
  document.addEventListener('click', e => {
    const row = (e.target as Element).closest<HTMLElement>('.tree-row:not(.scm-section), .rp-row');
    const list = row?.closest('.view-body, .rp-card');
    if (!row || !list || list.id === 'explorer-tree') return;
    list.querySelectorAll('.selected').forEach(el => el.classList.remove('selected'));
    row.classList.add('selected');
  });
  Git.initGit(path => void openFolder(path));
  RightPanel.initRightPanel();
  initStatusBar();
  applyZoom();
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
  document.querySelectorAll<HTMLElement>('.ab-item').forEach(el => { el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } }; });
  $('#command-center').onclick = () => quickOpen();
  $('#folder-btn').onclick = () => openFolder();
  $('#branch-btn').onclick = () => void Git.switchBranch();
  Git.onDidRefresh(() => { $('#branch-btn').hidden = !Git.branch; $('#branch-label').textContent = Git.branch; });
  $('#tb-run').onclick = () => void Ruby.runFile();
  $('#tb-left').onclick = () => toggleSidebar();
  $('#tb-terminal').onclick = () => togglePanel();
  $('#tb-settings').onclick = () => Editor.openSettings();
  makeSash($('#sash-side'), e => { $('#sidebar').style.width = `${Math.min(600, Math.max(170, e.clientX - $('#sidebar').getBoundingClientRect().left - 4))}px`; });
  makeSash($('#sash-panel'), e => { $('#panel').style.height = `${Math.min(window.innerHeight - 200, Math.max(100, window.innerHeight - 46 - e.clientY))}px`; });

  // Capture phase so workbench shortcuts win over Monaco's own bindings.
  window.addEventListener('keydown', e => {
    const k = eventKey(e, api.platform);
    // In the terminal everything belongs to the shell (readline) except these IDE keys (Ctrl+Shift+V stays the terminal's paste).
    if ((e.target as HTMLElement | null)?.closest?.('.xterm') && !/^(ctrl\+(shift\+)?(j|`|'|"|c|=|\+|-|0)|ctrl\+shift\+p|f1|f5|f9|f10|f11|shift\+f5)$/.test(k)) return;
    const cmd = keymap.get(k);
    if (!cmd || cmd.when?.() === false) return;
    e.preventDefault();
    e.stopPropagation();
    void cmd.run();
  }, true);

  window.addEventListener('focus', () => void Editor.syncFromDisk());
  api.onFsChange(async paths => { if (paths.some(p => isGemfile(p, ws.root))) ws.hasGemfile = await api.exists(abs('Gemfile')); await Editor.syncFromDisk(paths); await syncTree(paths); Git.scheduleRefresh(); if (paths.some(p => isGemfile(p, ws.root))) void checkBundle(); });
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
