// Editor group: tabs, Monaco models, open/save/close.
import type * as M from 'monaco-editor';
import { $, api, basename, h, notify } from './dom.ts';
import { fileSvg } from './file-icons.ts';
import * as Features from './features.ts';
import * as Lsp from './lsp-client.ts';
import { ipcMessage, languageFor } from './paths.ts';

export interface Tab {
  conflict?: string; // disk text that differs from this dirty tab (outside edit not yet decided on)
  key: string;
  kind: 'file' | 'settings' | 'diff' | 'preview';
  title: string;
  path?: string; // preview: the .md file shown
  scroll?: number; // preview: scroll position when last left
  model?: M.editor.ITextModel;
  saved?: number;
  dirty?: boolean;
  disk?: string; // text last read from or written to disk, to spot outside edits
  view?: M.editor.ICodeEditorViewState | null;
  diff?: { original: M.editor.ITextModel; modified: M.editor.ITextModel }; // read-only, owned by the tab
}

export const tabs: Tab[] = [];
export let active: Tab | undefined;
export let editor: M.editor.IStandaloneCodeEditor;
let diffEditor: M.editor.IStandaloneDiffEditor;
const loadedVersion = new WeakMap<M.editor.ITextModel, number>();
const loadedText = new WeakMap<M.editor.ITextModel, string>();
const changeListeners: (() => void)[] = [];
const saveListeners: ((path: string) => void)[] = [];
let renderSettings: (container: HTMLElement) => void = () => {};
let renderPreview: (tab: Tab, container: HTMLElement) => void = () => {};

export const onDidChange = (fn: () => void) => changeListeners.push(fn);
export const onDidSave = (fn: (path: string) => void) => saveListeners.push(fn);
const fire = () => { renderTabs(); changeListeners.forEach(fn => fn()); };
const tabFor = (model: M.editor.ITextModel) => tabs.find(t => t.model === model);

export function editorOptions(): M.editor.IEditorOptions {
  return {
    fontSize: Features.get<number>('editor.fontSize'),
    fontFamily: Features.get<string>('editor.fontFamily'),
    minimap: { enabled: Features.get<boolean>('editor.minimap') },
    wordWrap: Features.get<boolean>('editor.wordWrap') ? 'on' : 'off',
    formatOnType: true,
  };
}

export function createEditor(settingsRenderer: (container: HTMLElement) => void, previewRenderer: (tab: Tab, container: HTMLElement) => void) {
  renderSettings = settingsRenderer;
  renderPreview = previewRenderer;
  editor = monaco.editor.create($('#editor'), {
    model: null, theme: 'rubaxe-dark', automaticLayout: true, fixedOverflowWidgets: true,
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true }, renderWhitespace: 'selection', stickyScroll: { enabled: true }, 'semanticHighlighting.enabled': true,
    ...editorOptions(),
  });
  diffEditor = monaco.editor.createDiffEditor($('#diff-editor'), {
    theme: 'rubaxe-dark', automaticLayout: true, readOnly: true, originalEditable: false, ...editorOptions(),
  });
  // Monaco measures the font on creation, but the web font loads lazily: measure again once it is in, or the cursor drifts.
  void Promise.all(['14px', 'bold 14px'].map(f => document.fonts.load(`${f} "JetBrains Mono"`))).then(() => monaco.editor.remeasureFonts());
  monaco.editor.registerEditorOpener({ openCodeEditor: (_source, resource, selection) => { void openUri(resource, selection); return true; } });
  // Rename and quick-fixes can edit files without a tab: give them one so the change can be seen and saved.
  editor.onDidBlurEditorText(() => autoSave(active));
  monaco.editor.onDidCreateModel(model => model.onDidChangeContent(() => { if (model.uri.scheme === 'file' && !tabFor(model)) adopt(model); }));
}

export function applyOptions() {
  editor.updateOptions(editorOptions());
  diffEditor.updateOptions(editorOptions());
  for (const t of tabs) t.model?.updateOptions({ tabSize: Features.get<number>('editor.tabSize'), insertSpaces: true });
}

export async function ensureModel(uri: M.Uri): Promise<M.editor.ITextModel | null> {
  const existing = monaco.editor.getModel(uri);
  if (existing) return existing;
  let text: string;
  try {
    text = await api.readFile(uri.fsPath);
  } catch (e) {
    notify(`Não foi possível abrir ${uri.fsPath}: ${ipcMessage(e)}`, 'error');
    return null;
  }
  // Saving a binary file decoded as UTF-8 would corrupt it, so it is never opened.
  if (text.includes('\0')) {
    notify(`${basename(uri.fsPath)} é um arquivo binário.`, 'error');
    return null;
  }
  const raced = monaco.editor.getModel(uri);
  if (raced) return raced;
  const model = monaco.editor.createModel(text, languageFor(uri.fsPath), uri);
  model.updateOptions({ tabSize: Features.get<number>('editor.tabSize'), insertSpaces: true });
  loadedVersion.set(model, model.getAlternativeVersionId());
  loadedText.set(model, text);
  return model;
}

function adopt(model: M.editor.ITextModel): Tab {
  const tab: Tab = {
    key: model.uri.toString(), kind: 'file', title: basename(model.uri.fsPath), path: model.uri.fsPath, model,
    saved: loadedVersion.get(model) ?? model.getAlternativeVersionId(), disk: loadedText.get(model),
  };
  tab.dirty = tab.saved !== model.getAlternativeVersionId();
  model.onDidChangeContent(() => { updateDirty(tab); autoSaveSoon(tab); });
  tabs.push(tab);
  Lsp.didOpen(model);
  fire();
  return tab;
}

function updateDirty(tab: Tab) {
  const dirty = tab.model!.getAlternativeVersionId() !== tab.saved;
  if (dirty !== tab.dirty) { tab.dirty = dirty; renderTabs(); }
}

// Auto save: 1 s after the last edit, and on blur / tab switch. Never formats (only an explicit save does).
const autoTimers = new Map<Tab, ReturnType<typeof setTimeout>>();
function autoSave(tab: Tab | undefined) {
  if (!Features.get<boolean>('files.autoSave') || !tab?.dirty || tab.kind !== 'file' || !tabs.includes(tab) || tab.model?.isDisposed() || tab.model?.uri.scheme !== 'file') return;
  clearTimeout(autoTimers.get(tab));
  void save(tab, true);
}
function autoSaveSoon(tab: Tab) {
  clearTimeout(autoTimers.get(tab));
  autoTimers.set(tab, setTimeout(() => autoSave(tab), 1000));
}

export const openFile = (path: string, selection?: M.IRange | M.IPosition) => openUri(monaco.Uri.file(path), selection);

export async function openUri(uri: M.Uri, selection?: M.IRange | M.IPosition) {
  const model = await ensureModel(uri);
  if (!model) return;
  activate(tabFor(model) ?? adopt(model));
  if (selection) reveal(selection);
}

export function reveal(selection: M.IRange | M.IPosition) {
  if ('startLineNumber' in selection) {
    editor.setSelection(selection);
    editor.revealRangeInCenterIfOutsideViewport(selection);
  } else {
    editor.setPosition(selection);
    editor.revealPositionInCenterIfOutsideViewport(selection);
  }
  editor.focus();
}

export function openSettings() {
  activate(tabs.find(t => t.kind === 'settings') ?? (tabs.push({ key: 'rubaxe:settings', kind: 'settings', title: 'Configurações' }), tabs[tabs.length - 1]));
}

// Opens (or refreshes) a read-only diff tab; `key` identifies it, e.g. "git:staged:app/a.rb".
export function openDiff(key: string, title: string, path: string, original: string, modified: string) {
  let tab = tabs.find(t => t.key === key);
  if (tab?.diff) {
    tab.diff.original.setValue(original);
    tab.diff.modified.setValue(modified);
  } else {
    const make = (text: string, side: string) => monaco.editor.createModel(text, languageFor(path), monaco.Uri.from({ scheme: 'rubaxe-diff', path: `/${side}/${key}` }));
    tab = { key, kind: 'diff', title, path, diff: { original: make(original, 'a'), modified: make(modified, 'b') } };
    tabs.push(tab);
  }
  activate(tab);
}

export const isMarkdown = (tab = active) => tab?.kind === 'file' && /\.md$/i.test(tab.path ?? '');

// Opens the preview of a .md tab next to it. A tab of its own: the editor group has no split view.
export function openPreview(tab = active) {
  if (!Features.on('markdownPreview')) return notify('Esta funcionalidade está desativada em Configurações.');
  if (!tab || !isMarkdown(tab)) return notify('Abra um arquivo Markdown (.md) para ver a prévia.');
  const key = `preview:${tab.path}`;
  let preview = tabs.find(t => t.key === key);
  if (!preview) tabs.splice(tabs.indexOf(tab) + 1, 0, preview = { key, kind: 'preview', title: `Prévia: ${tab.title}`, path: tab.path });
  activate(preview);
}

export function activate(tab: Tab) {
  if (active !== tab) autoSave(active);
  if (active?.model && active.model === editor.getModel()) active.view = editor.saveViewState();
  if (active?.kind === 'preview') active.scroll = $('#preview-page').scrollTop;
  active = tab;
  const isFile = tab.kind === 'file';
  $('#editor').hidden = !isFile;
  $('#diff-editor').hidden = tab.kind !== 'diff';
  $('#settings-page').hidden = tab.kind !== 'settings';
  $('#preview-page').hidden = tab.kind !== 'preview';
  $('#welcome').hidden = true;
  if (isFile) {
    editor.setModel(tab.model!);
    if (tab.view) editor.restoreViewState(tab.view);
    editor.focus();
  } else if (tab.diff) {
    diffEditor.setModel(tab.diff);
  } else if (tab.kind === 'preview') {
    renderPreview(tab, $('#preview-page'));
  } else {
    renderSettings($('#settings-page'));
  }
  disposeOrphans();
  fire();
}

// Models loaded only for peek/definition lookups are dropped once the user moves on.
function disposeOrphans() {
  for (const m of monaco.editor.getModels()) if (m.uri.scheme === 'file' && !tabFor(m) && m !== editor.getModel()) m.dispose();
}

export function closeTab(tab: Tab, discard = false): boolean {
  if (tab.dirty && !discard && !confirm(`"${tab.title}" tem alterações não salvas. Fechar e descartar as alterações?`)) return false;
  const i = tabs.indexOf(tab);
  tabs.splice(i, 1);
  if (active === tab) {
    active = undefined;
    editor.setModel(null);
    const next = tabs[i] ?? tabs[i - 1];
    if (next) activate(next);
    else { $('#editor').hidden = true; $('#diff-editor').hidden = true; $('#settings-page').hidden = true; $('#preview-page').hidden = true; $('#welcome').hidden = false; }
  }
  if (tab.diff) {
    if (diffEditor.getModel()?.original === tab.diff.original) diffEditor.setModel(null);
    tab.diff.original.dispose();
    tab.diff.modified.dispose();
  }
  if (tab.model) {
    Lsp.didClose(tab.model);
    tab.model.dispose();
  }
  fire();
  return true;
}

export function closeAll(): boolean {
  for (const t of [...tabs]) if (!closeTab(t)) return false;
  return true;
}

export async function save(tab = active, auto = false): Promise<boolean> {
  if (!tab?.model || !tab.path) return false;
  const model = tab.model;
  // Auto save must not clobber an outside edit the user has not seen yet (syncFromDisk warns, the user decides).
  if (auto && await api.readFile(tab.path).then(t => t !== tab.disk, () => false)) return false;
  if (!auto && Features.get<boolean>('editor.formatOnSave') && Features.on('formatting') && model.getLanguageId() === 'ruby' && editor.getModel() === model) {
    await editor.getAction('editor.action.formatDocument')?.run();
  }
  const text = model.getValue();
  try {
    await api.writeFile(tab.path, text);
  } catch (e) {
    notify(`Erro ao salvar ${tab.title}: ${ipcMessage(e)}`, 'error');
    return false;
  }
  tab.saved = model.getAlternativeVersionId();
  tab.disk = text;
  tab.conflict = undefined;
  updateDirty(tab);
  Lsp.didSave(model);
  saveListeners.forEach(fn => fn(tab.path!));
  return true;
}

// Picks up edits made outside Rubaxe (git checkout, rubocop -a, another editor) when the window regains focus.
// `only` limits the check to those absolute paths (file watcher events).
export async function syncFromDisk(only?: string[]) {
  const fold = (p: string) => api.platform === 'win32' ? p.toLowerCase().replaceAll('/', '\\') : p;
  const wanted = only && new Set(only.map(fold));
  for (const tab of [...tabs]) {
    if (!tab.model || !tab.path || (wanted && !wanted.has(fold(tab.path)))) continue;
    const text = await api.readFile(tab.path).catch(() => undefined);
    if (text === undefined && tab.disk !== undefined && !tab.model.isDisposed() && !await api.exists(tab.path)) {
      tab.disk = undefined; // warn once; if the file comes back it differs from undefined and reloads
      notify(`${tab.title} foi apagado fora do Rubaxe. Salvar vai recriá-lo.`, 'error');
    }
    if (text === undefined || text === tab.disk || text.includes('\0') || tab.model.isDisposed()) continue;
    if (tab.dirty) {
      // tab.disk stays the old text: that is what makes auto save (save(auto)) refuse to overwrite the outside edit; only Ctrl+S does.
      if (tab.conflict !== text) notify(`${tab.title} foi alterado fora do Rubaxe. O salvamento automático foi suspenso; Ctrl+S sobrescreve essa versão.`, 'error');
      tab.conflict = text;
      continue;
    }
    tab.disk = text;
    // An edit (not setValue) keeps undo history, so the reload itself can be undone.
    tab.model.pushEditOperations([], [{ range: tab.model.getFullModelRange(), text }], () => null);
    tab.saved = tab.model.getAlternativeVersionId();
    updateDirty(tab);
  }
}

function renderTabs() {
  $('#tabs').hidden = !tabs.length;
  const preview = h('button', { className: 'tab-action codicon codicon-open-preview', title: 'Abrir prévia (Ctrl+Shift+V)', ariaLabel: 'Abrir prévia' });
  preview.onclick = () => openPreview();
  $('#tabs').replaceChildren(...tabs.map(t => {
    const close = h('span', { className: 'codicon close codicon-close', title: 'Fechar (Ctrl+W)' });
    close.onclick = e => { e.stopPropagation(); closeTab(t); };
    const el = h('div', { className: 'tab' + (t === active ? ' active' : '') + (t.dirty ? ' dirty' : ''), title: t.path ?? t.title },
      (t.kind === 'file' ? fileSvg(t.path ?? t.title) : h('span', { className: `codicon codicon-${{ settings: 'settings-gear', diff: 'diff', preview: 'open-preview' }[t.kind]}` })), h('span', { className: 'tab-label' }, t.title), close);
    el.onclick = () => activate(t);
    el.onauxclick = e => { if (e.button === 1) closeTab(t); };
    return el;
  }), ...(isMarkdown() && Features.on('markdownPreview') ? [preview] : []));
  $('#tabs').querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
