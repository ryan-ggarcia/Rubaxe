// Editor group: tabs, Monaco models, open/save/close.
import type * as M from 'monaco-editor';
import { $, api, basename, fileIcon, h, notify } from './dom.ts';
import * as Features from './features.ts';
import * as Lsp from './lsp-client.ts';
import { languageFor } from './paths.ts';

export interface Tab {
  key: string;
  kind: 'file' | 'settings';
  title: string;
  path?: string;
  model?: M.editor.ITextModel;
  saved?: number;
  dirty?: boolean;
  view?: M.editor.ICodeEditorViewState | null;
}

export const tabs: Tab[] = [];
export let active: Tab | undefined;
export let editor: M.editor.IStandaloneCodeEditor;
const loadedVersion = new WeakMap<M.editor.ITextModel, number>();
const changeListeners: (() => void)[] = [];
let renderSettings: (container: HTMLElement) => void = () => {};

export const onDidChange = (fn: () => void) => changeListeners.push(fn);
const fire = () => { renderTabs(); changeListeners.forEach(fn => fn()); };
const tabFor = (model: M.editor.ITextModel) => tabs.find(t => t.model === model);

export function editorOptions(): M.editor.IEditorOptions {
  return {
    fontSize: Features.get<number>('editor.fontSize'),
    minimap: { enabled: Features.get<boolean>('editor.minimap') },
    wordWrap: Features.get<boolean>('editor.wordWrap') ? 'on' : 'off',
  };
}

export function createEditor(settingsRenderer: (container: HTMLElement) => void) {
  renderSettings = settingsRenderer;
  editor = monaco.editor.create($('#editor'), {
    model: null, theme: 'rubaxe-dark', automaticLayout: true, fixedOverflowWidgets: true,
    fontFamily: "Consolas, 'Courier New', monospace", bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true }, renderWhitespace: 'selection', stickyScroll: { enabled: true },
    ...editorOptions(),
  });
  monaco.editor.registerEditorOpener({ openCodeEditor: (_source, resource, selection) => { void openUri(resource, selection); return true; } });
  // Rename and quick-fixes can edit files without a tab: give them one so the change can be seen and saved.
  monaco.editor.onDidCreateModel(model => model.onDidChangeContent(() => { if (!tabFor(model)) adopt(model); }));
}

export function applyOptions() {
  editor.updateOptions(editorOptions());
  for (const t of tabs) t.model?.updateOptions({ tabSize: Features.get<number>('editor.tabSize'), insertSpaces: true });
}

export async function ensureModel(uri: M.Uri): Promise<M.editor.ITextModel | null> {
  const existing = monaco.editor.getModel(uri);
  if (existing) return existing;
  let text: string;
  try {
    text = await api.readFile(uri.fsPath);
  } catch (e) {
    notify(`Não foi possível abrir ${uri.fsPath}: ${(e as Error).message}`, 'error');
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
  return model;
}

function adopt(model: M.editor.ITextModel): Tab {
  const tab: Tab = {
    key: model.uri.toString(), kind: 'file', title: basename(model.uri.fsPath), path: model.uri.fsPath, model,
    saved: loadedVersion.get(model) ?? model.getAlternativeVersionId(),
  };
  tab.dirty = tab.saved !== model.getAlternativeVersionId();
  model.onDidChangeContent(() => updateDirty(tab));
  tabs.push(tab);
  Lsp.didOpen(model);
  fire();
  return tab;
}

function updateDirty(tab: Tab) {
  const dirty = tab.model!.getAlternativeVersionId() !== tab.saved;
  if (dirty !== tab.dirty) { tab.dirty = dirty; renderTabs(); }
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

export function activate(tab: Tab) {
  if (active?.model && active.model === editor.getModel()) active.view = editor.saveViewState();
  active = tab;
  const isFile = tab.kind === 'file';
  $('#editor').hidden = !isFile;
  $('#settings-page').hidden = isFile;
  $('#welcome').hidden = true;
  if (isFile) {
    editor.setModel(tab.model!);
    if (tab.view) editor.restoreViewState(tab.view);
    editor.focus();
  } else {
    renderSettings($('#settings-page'));
  }
  disposeOrphans();
  fire();
}

// Models loaded only for peek/definition lookups are dropped once the user moves on.
function disposeOrphans() {
  for (const m of monaco.editor.getModels()) if (!tabFor(m) && m !== editor.getModel()) m.dispose();
}

export function closeTab(tab: Tab): boolean {
  if (tab.dirty && !confirm(`"${tab.title}" tem alterações não salvas. Fechar e descartar as alterações?`)) return false;
  const i = tabs.indexOf(tab);
  tabs.splice(i, 1);
  if (active === tab) {
    active = undefined;
    editor.setModel(null);
    const next = tabs[i] ?? tabs[i - 1];
    if (next) activate(next);
    else { $('#editor').hidden = true; $('#settings-page').hidden = true; $('#welcome').hidden = false; }
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

export async function save(tab = active): Promise<boolean> {
  if (!tab?.model || !tab.path) return false;
  const model = tab.model;
  if (Features.get<boolean>('editor.formatOnSave') && Features.on('formatting') && model.getLanguageId() === 'ruby' && editor.getModel() === model) {
    await editor.getAction('editor.action.formatDocument')?.run();
  }
  try {
    await api.writeFile(tab.path, model.getValue());
  } catch (e) {
    notify(`Erro ao salvar ${tab.title}: ${(e as Error).message}`, 'error');
    return false;
  }
  tab.saved = model.getAlternativeVersionId();
  updateDirty(tab);
  Lsp.didSave(model);
  return true;
}

function renderTabs() {
  $('#tabs').hidden = !tabs.length;
  $('#tabs').replaceChildren(...tabs.map(t => {
    const close = h('span', { className: 'codicon close codicon-close', title: 'Fechar (Ctrl+W)' });
    close.onclick = e => { e.stopPropagation(); closeTab(t); };
    const el = h('div', { className: 'tab' + (t === active ? ' active' : '') + (t.dirty ? ' dirty' : ''), title: t.path ?? t.title },
      h('span', { className: `codicon codicon-${t.kind === 'settings' ? 'settings-gear' : fileIcon(t.title)}` }), h('span', { className: 'tab-label' }, t.title), close);
    el.onclick = () => activate(t);
    el.onauxclick = e => { if (e.button === 1) closeTab(t); };
    return el;
  }));
  $('#tabs').querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
