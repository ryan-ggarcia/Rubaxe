// Minimal LSP client: Ruby LSP (stdio, via main process) <-> Monaco providers.
import type * as M from 'monaco-editor';
import { api } from './dom.ts';
import * as Features from './features.ts';

type Pos = { line: number; character: number };
type LRange = { start: Pos; end: Pos };
type LEdit = { range: LRange; newText: string };
type LWorkspaceEdit = { changes?: Record<string, LEdit[]>; documentChanges?: { textDocument: { uri: string }; edits?: LEdit[] }[] };
type LDiagnostic = { range: LRange; severity?: number; message: string; source?: string; code?: string | number | { value: string | number } };

export interface Hooks {
  ensureModel(uri: M.Uri): Promise<M.editor.ITextModel | null>;
  status(state: 'starting' | 'ready' | 'busy' | 'error' | 'off', detail?: string): void;
  log(text: string): void;
}

const COMPLETION_KINDS = ['Text', 'Method', 'Function', 'Constructor', 'Field', 'Variable', 'Class', 'Interface', 'Module', 'Property', 'Unit', 'Value', 'Enum', 'Keyword', 'Snippet', 'Color', 'File', 'Reference', 'Folder', 'EnumMember', 'Constant', 'Struct', 'Event', 'Operator', 'TypeParameter'] as const;

let nextId = 1, ready = false, generation = 0;
let hooks: Hooks | undefined;
let semanticRegistered = false;
let keepAlive: ReturnType<typeof setInterval> | undefined;
const pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void }>();
const opened = new Map<string, M.editor.ITextModel>();
const listeners = new Map<string, { dispose(): void }>();
const diagnostics = new Map<string, LDiagnostic[]>(); // kept as LSP objects for code action context
const progress = new Map<string | number, { title: string; pct?: number }>();

const pos = (p: M.IPosition): Pos => ({ line: p.lineNumber - 1, character: p.column - 1 });
export const range = (r: LRange) => new monaco.Range(r.start.line + 1, r.start.character + 1, r.end.line + 1, r.end.character + 1);
const lspRange = (r: M.IRange): LRange => ({ start: { line: r.startLineNumber - 1, character: r.startColumn - 1 }, end: { line: r.endLineNumber - 1, character: r.endColumn - 1 } });
const doc = (model: M.editor.ITextModel) => ({ uri: model.uri.toString() });
const uriKey = (uri: string) => monaco.Uri.parse(uri).toString();

function markdown(c: any): { value: string } | undefined {
  if (!c) return undefined;
  if (typeof c === 'string') return { value: c };
  if (c.value === undefined) return undefined;
  return { value: c.language ? '```' + c.language + '\n' + c.value + '\n```' : c.value };
}

function request<T = any>(method: string, params: unknown, force = false): Promise<T | null> {
  if (!ready && !force) return Promise.resolve(null);
  const id = nextId++;
  api.lspSend({ jsonrpc: '2.0', id, method, params });
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
const notify = (method: string, params: unknown) => api.lspSend({ jsonrpc: '2.0', method, params });
// type: 1 created, 3 deleted (LSP FileChangeType).
export const filesChanged = (changes: (readonly [path: string, type: 1 | 3])[]) => {
  if (ready && changes.length) notify('workspace/didChangeWatchedFiles', { changes: changes.map(([p, type]) => ({ uri: monaco.Uri.file(p).toString(), type })) });
};
// Providers must never throw into Monaco; a failed request just means no result.
// Non-file documents (e.g. rubaxe-diff:) make ruby-lsp crash trying to read them, so they never reach the server.
const ask = <T = any>(feature: string, method: string, params: unknown): Promise<T | null> => {
  const uri = (params as { textDocument?: { uri?: string } })?.textDocument?.uri;
  return Features.on(feature) && ready && (uri === undefined || uri.startsWith('file:')) ? request<T>(method, params).catch(() => null) : Promise.resolve(null);
};

function rejectPending(reason: string) {
  pending.forEach(p => p.reject(new Error(reason)));
  pending.clear();
}

function reportProgress() {
  const first = progress.values().next().value;
  hooks?.status(first ? 'busy' : 'ready', first && `${first.title}${first.pct !== undefined ? ` ${first.pct}%` : ''}`);
}

function onMessage(msg: any) {
  if (msg.id !== undefined && !msg.method) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (p) msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    return;
  }
  if (msg.id !== undefined) return void answerServer(msg);
  switch (msg.method) {
    case 'textDocument/publishDiagnostics':
      return setDiagnostics(msg.params.uri, msg.params.diagnostics);
    case 'window/logMessage':
    case 'window/showMessage':
      return hooks?.log(msg.params.message + '\n');
    case '$/progress': {
      const { token, value: v } = msg.params;
      // Only 'begin' carries the title; 'report' carries just the new percentage.
      if (v.kind === 'end') progress.delete(token);
      else progress.set(token, { title: v.title ?? progress.get(token)?.title ?? '', pct: v.percentage ?? progress.get(token)?.pct });
      return reportProgress();
    }
  }
}

async function answerServer(msg: any) {
  let result: unknown = null;
  if (msg.method === 'workspace/configuration') result = msg.params.items.map(() => null);
  if (msg.method === 'workspace/applyEdit') {
    const { edits } = await toWorkspaceEdit(msg.params.edit);
    for (const e of edits) monaco.editor.getModel(e.resource)?.pushEditOperations([], [{ range: e.textEdit.range, text: e.textEdit.text }], () => null);
    result = { applied: true };
  }
  api.lspSend({ jsonrpc: '2.0', id: msg.id, result });
}

function setDiagnostics(uri: string, list: LDiagnostic[]) {
  diagnostics.set(uriKey(uri), list);
  const model = monaco.editor.getModel(monaco.Uri.parse(uri));
  if (!model) return;
  const severity = [monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Info, monaco.MarkerSeverity.Hint];
  monaco.editor.setModelMarkers(model, 'ruby-lsp', (Features.on('diagnostics') ? list : []).map(d => ({
    ...range(d.range), severity: severity[d.severity ?? 1], message: d.message, source: d.source,
    code: d.code === undefined ? undefined : String(typeof d.code === 'object' ? d.code.value : d.code),
  })));
}

// Only loads models; the workbench opens a tab when a tab-less model is actually edited.
async function toWorkspaceEdit(we: LWorkspaceEdit): Promise<M.languages.WorkspaceEdit & { edits: M.languages.IWorkspaceTextEdit[] }> {
  const edits: M.languages.IWorkspaceTextEdit[] = [];
  const add = (uri: string, e: LEdit) => edits.push({ resource: monaco.Uri.parse(uri), textEdit: { range: range(e.range), text: e.newText }, versionId: undefined });
  for (const [uri, list] of Object.entries(we.changes ?? {})) list.forEach(e => add(uri, e));
  for (const dc of we.documentChanges ?? []) (dc.edits ?? []).forEach(e => add(dc.textDocument.uri, e));
  await Promise.all([...new Set(edits.map(e => e.resource.toString()))].map(u => hooks!.ensureModel(monaco.Uri.parse(u))));
  return { edits };
}

async function locations(result: any): Promise<M.languages.Location[]> {
  const list: any[] = !result ? [] : Array.isArray(result) ? result : [result];
  const locs = list.map(l => l.targetUri ? { uri: l.targetUri, range: l.targetSelectionRange ?? l.targetRange } : l);
  await Promise.all(locs.map(l => hooks!.ensureModel(monaco.Uri.parse(l.uri))));
  return locs.map(l => ({ uri: monaco.Uri.parse(l.uri), range: range(l.range) }));
}

function symbols(list: any[] | null | undefined): M.languages.DocumentSymbol[] {
  return (list ?? []).map(s => {
    const r = range(s.range ?? s.location.range);
    // LSP SymbolKind is 1-based, Monaco's is the same enum 0-based.
    return { name: s.name, detail: s.detail ?? '', kind: s.kind - 1, tags: [], range: r, selectionRange: s.selectionRange ? range(s.selectionRange) : r, children: symbols(s.children) };
  });
}

export function registerProviders() {
  const L = monaco.languages, id = 'ruby';
  L.registerCompletionItemProvider(id, {
    triggerCharacters: ['.', ':', '@', '/', '"'],
    async provideCompletionItems(model, position) {
      const res = await ask('completion', 'textDocument/completion', { textDocument: doc(model), position: pos(position) });
      if (!res) return { suggestions: [] };
      const word = model.getWordUntilPosition(position);
      const fallback = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const items: any[] = Array.isArray(res) ? res : res.items;
      return {
        incomplete: !!res.isIncomplete,
        suggestions: items.map(it => ({
          label: it.label, detail: it.detail, documentation: markdown(it.documentation), sortText: it.sortText, filterText: it.filterText,
          kind: L.CompletionItemKind[COMPLETION_KINDS[(it.kind ?? 1) - 1]],
          insertText: it.textEdit ? it.textEdit.newText : it.insertText ?? it.label,
          insertTextRules: it.insertTextFormat === 2 ? L.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          range: it.textEdit ? range(it.textEdit.range ?? it.textEdit.replace) : fallback,
          lsp: it,
        })),
      };
    },
    async resolveCompletionItem(item) {
      const r = await ask('completion', 'completionItem/resolve', (item as any).lsp);
      if (r) Object.assign(item, { detail: r.detail ?? item.detail, documentation: markdown(r.documentation) ?? item.documentation });
      return item;
    },
  });
  L.registerHoverProvider(id, {
    async provideHover(model, position) {
      const r = await ask('hover', 'textDocument/hover', { textDocument: doc(model), position: pos(position) });
      if (!r) return null;
      const contents = (Array.isArray(r.contents) ? r.contents : [r.contents]).map(markdown).filter((c: unknown): c is { value: string } => !!c);
      return { contents, range: r.range && range(r.range) };
    },
  });
  L.registerSignatureHelpProvider(id, {
    signatureHelpTriggerCharacters: ['(', ','],
    async provideSignatureHelp(model, position) {
      const r = await ask('signatureHelp', 'textDocument/signatureHelp', { textDocument: doc(model), position: pos(position) });
      if (!r?.signatures?.length) return null;
      const signatures = r.signatures.map((s: any) => ({
        label: s.label, documentation: markdown(s.documentation),
        parameters: (s.parameters ?? []).map((p: any) => ({ label: p.label, documentation: markdown(p.documentation) })),
      }));
      return { value: { signatures, activeSignature: r.activeSignature ?? 0, activeParameter: r.activeParameter ?? 0 }, dispose() {} };
    },
  });
  L.registerDefinitionProvider(id, {
    provideDefinition: async (model, position) => locations(await ask('definition', 'textDocument/definition', { textDocument: doc(model), position: pos(position) })),
  });
  L.registerReferenceProvider(id, {
    provideReferences: async (model, position, context) => locations(await ask('references', 'textDocument/references', { textDocument: doc(model), position: pos(position), context })),
  });
  L.registerDocumentHighlightProvider(id, {
    async provideDocumentHighlights(model, position) {
      const r = await ask<any[]>('documentHighlight', 'textDocument/documentHighlight', { textDocument: doc(model), position: pos(position) });
      return (r ?? []).map(x => ({ range: range(x.range), kind: (x.kind ?? 1) - 1 }));
    },
  });
  L.registerDocumentSymbolProvider(id, {
    provideDocumentSymbols: async model => symbols(await ask('documentSymbols', 'textDocument/documentSymbol', { textDocument: doc(model) })),
  });
  L.registerDocumentFormattingEditProvider(id, {
    async provideDocumentFormattingEdits(model, options) {
      const r = await ask<LEdit[]>('formatting', 'textDocument/formatting', { textDocument: doc(model), options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces } });
      return (r ?? []).map(e => ({ range: range(e.range), text: e.newText }));
    },
  });
  L.registerRenameProvider(id, {
    async provideRenameEdits(model, position, newName) {
      const r = await ask<LWorkspaceEdit>('rename', 'textDocument/rename', { textDocument: doc(model), position: pos(position), newName });
      return r ? toWorkspaceEdit(r) : { edits: [], rejectReason: 'O Ruby LSP não conseguiu renomear este símbolo.' };
    },
  });
  L.registerInlayHintsProvider(id, {
    async provideInlayHints(model, r) {
      const res = await ask<any[]>('inlayHints', 'textDocument/inlayHint', { textDocument: doc(model), range: lspRange(r) });
      const hints = (res ?? []).map(x => ({
        position: { lineNumber: x.position.line + 1, column: x.position.character + 1 },
        label: typeof x.label === 'string' ? x.label : x.label.map((p: any) => p.value).join(''),
        kind: x.kind === 2 ? L.InlayHintKind.Parameter : L.InlayHintKind.Type, paddingLeft: x.paddingLeft, paddingRight: x.paddingRight,
        tooltip: typeof x.tooltip === 'string' ? x.tooltip : x.tooltip?.value,
      }));
      return { hints, dispose() {} };
    },
  });
  L.registerCodeActionProvider(id, {
    async provideCodeActions(model, r) {
      const context = (diagnostics.get(model.uri.toString()) ?? []).filter(d => range(d.range).intersectRanges(r));
      const res = await ask<any[]>('codeActions', 'textDocument/codeAction', { textDocument: doc(model), range: lspRange(r), context: { diagnostics: context } });
      // Edits are converted lazily in resolveCodeAction: this runs on every cursor move.
      const actions = (res ?? []).filter(a => typeof a.command !== 'string').map(a => ({ title: a.title, kind: a.kind, isPreferred: a.isPreferred, lsp: a }));
      return { actions, dispose() {} };
    },
    async resolveCodeAction(action) {
      const lsp = (action as any).lsp;
      const resolved = lsp.edit ? lsp : await ask('codeActions', 'codeAction/resolve', lsp);
      if (resolved?.edit) action.edit = await toWorkspaceEdit(resolved.edit);
      return action;
    },
  });
}

export async function start(root: string, command: string, h: Hooks) {
  hooks = h;
  stop();
  const mine = ++generation;
  hooks.status('starting');
  api.lspStart(command, root);
  const rootUri = monaco.Uri.file(root).toString();
  let init: any;
  try {
    init = await request('initialize', {
      processId: null, rootUri, workspaceFolders: [{ uri: rootUri, name: root.split(/[\\/]/).pop() }],
      initializationOptions: { formatter: 'auto', featuresConfiguration: { inlayHint: { implicitRescue: true, implicitHashValue: true } } },
      capabilities: {
        window: { workDoneProgress: true },
        workspace: { workspaceFolders: true, applyEdit: true, configuration: true, symbol: {} },
        textDocument: {
          synchronization: { didSave: true },
          completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] } },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'] } },
          definition: { linkSupport: true }, references: {}, documentHighlight: {}, rename: {}, formatting: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          inlayHint: {}, typeHierarchy: {},
          semanticTokens: { requests: { full: true }, tokenTypes: [], tokenModifiers: [], formats: ['relative'] },
          publishDiagnostics: {},
          codeAction: {
            resolveSupport: { properties: ['edit'] },
            codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source'] } },
          },
        },
      },
    }, true);
  } catch (e) {
    // A newer start() already took over; its status wins.
    if (mine === generation) hooks.status('error', (e as Error).message);
    return;
  }
  if (mine !== generation) return;
  registerSemanticTokens(init?.capabilities?.semanticTokensProvider?.legend);
  notify('initialized', {});
  // Windows deadlock: while ruby-lsp's reader thread waits on stdin, a process spawned by another thread (e.g. the
  // ruby-lsp-rails server) blocks in CreateProcess and freezes the server. A message every 500 ms keeps that read
  // from staying pending. Same request id every time, so the server's set of cancelled ids never grows.
  if (api.platform === 'win32') keepAlive = setInterval(() => { if (mine === generation) notify('$/cancelRequest', { id: -1 }); }, 500);
  ready = true;
  hooks.status('ready');
  opened.forEach(sendOpen);
}

// The legend comes from the server, so the provider can only be registered after the first initialize.
function registerSemanticTokens(legend: M.languages.SemanticTokensLegend | undefined) {
  if (!legend || semanticRegistered) return;
  semanticRegistered = true;
  monaco.languages.registerDocumentSemanticTokensProvider('ruby', {
    getLegend: () => legend,
    async provideDocumentSemanticTokens(model) {
      const r = await ask<{ data: number[]; resultId?: string }>('semanticHighlighting', 'textDocument/semanticTokens/full', { textDocument: doc(model) });
      return r ? { data: new Uint32Array(r.data), resultId: r.resultId } : null;
    },
    releaseDocumentSemanticTokens() {},
  });
}

type HierarchyItem = { name: string; kind: number; detail?: string; uri: string; range: LRange; selectionRange: LRange };
export interface TypeNode { item: HierarchyItem; parents: TypeNode[] }

// Supertypes recursively (ruby-lsp answers supertypes; subtypes are asked for but may be unsupported).
export async function typeHierarchy(model: M.editor.ITextModel, position: M.IPosition) {
  const items = await ask<HierarchyItem[]>('typeHierarchy', 'textDocument/prepareTypeHierarchy', { textDocument: doc(model), position: pos(position) });
  if (!items?.length) return null;
  const up = async (item: HierarchyItem, depth: number): Promise<TypeNode[]> =>
    depth > 8 ? [] : Promise.all(((await ask<HierarchyItem[]>('typeHierarchy', 'typeHierarchy/supertypes', { item })) ?? []).map(async s => ({ item: s, parents: await up(s, depth + 1) })));
  return { root: items[0], supers: await up(items[0], 0), subs: (await ask<HierarchyItem[]>('typeHierarchy', 'typeHierarchy/subtypes', { item: items[0] })) ?? [] };
}

// No call hierarchy in ruby-lsp: callers are the references grouped by the method that contains each one.
export async function callers(model: M.editor.ITextModel, position: M.IPosition) {
  const refs = await ask<{ uri: string; range: LRange }[]>('references', 'textDocument/references', { textDocument: doc(model), position: pos(position), context: { includeDeclaration: false } });
  const out: { name: string; uri: string; line: number }[] = [];
  for (const [uri, list] of Map.groupBy(refs ?? [], r => r.uri)) {
    const m = await hooks?.ensureModel(monaco.Uri.parse(uri));
    const syms = m ? await documentSymbols(m) : [];
    for (const ref of list) {
      let best: { s: M.languages.DocumentSymbol; path: string[] } | undefined;
      const walk = (ss: M.languages.DocumentSymbol[], path: string[]) => ss.forEach(s => {
        if (!monaco.Range.containsPosition(s.range, { lineNumber: ref.range.start.line + 1, column: ref.range.start.character + 1 })) return;
        if (s.kind === monaco.languages.SymbolKind.Method || s.kind === monaco.languages.SymbolKind.Function || s.kind === monaco.languages.SymbolKind.Constructor) best = { s, path };
        walk(s.children ?? [], [...path, s.name]);
      });
      walk(syms, []);
      // ruby-lsp includes the method's own name in `def` even with includeDeclaration: false.
      if (best && best.s.selectionRange.startLineNumber === ref.range.start.line + 1 && best.s.selectionRange.startColumn === ref.range.start.character + 1) continue;
      out.push({ name: best ? `${best.path.join('::')}${best.path.length ? '#' : ''}${best.s.name}` : '(nível superior)', uri, line: ref.range.start.line + 1 });
    }
  }
  return out;
}

export function stop() {
  clearInterval(keepAlive);
  ready = false;
  rejectPending('Ruby LSP parado');
  progress.clear();
  api.lspStop();
}

const diagTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Ruby LSP uses pull diagnostics (textDocument/diagnostic), not publishDiagnostics, so we request them.
async function pullDiagnostics(model: M.editor.ITextModel) {
  const r = await ask('diagnostics', 'textDocument/diagnostic', { textDocument: doc(model) });
  if (r?.kind === 'full') setDiagnostics(model.uri.toString(), r.items);
}

function scheduleDiagnostics(model: M.editor.ITextModel) {
  const uri = model.uri.toString();
  clearTimeout(diagTimers.get(uri));
  diagTimers.set(uri, setTimeout(() => pullDiagnostics(model), 500));
}

function sendOpen(model: M.editor.ITextModel) {
  if (!ready) return;
  notify('textDocument/didOpen', { textDocument: { ...doc(model), languageId: 'ruby', version: model.getVersionId(), text: model.getValue() } });
  void pullDiagnostics(model);
}

export function didOpen(model: M.editor.ITextModel) {
  const uri = model.uri.toString();
  if (model.getLanguageId() !== 'ruby' || model.uri.scheme !== 'file' || opened.has(uri)) return;
  opened.set(uri, model);
  // Monaco orders changes end-to-start, so they apply in sequence as LSP expects.
  listeners.set(uri, model.onDidChangeContent(e => {
    if (!ready) return;
    notify('textDocument/didChange', {
      textDocument: { ...doc(model), version: model.getVersionId() },
      contentChanges: e.changes.map(c => ({ range: lspRange(c.range), text: c.text })),
    });
    scheduleDiagnostics(model);
  }));
  sendOpen(model);
}

export function didClose(model: M.editor.ITextModel) {
  const uri = model.uri.toString();
  if (!opened.delete(uri)) return;
  listeners.get(uri)?.dispose();
  listeners.delete(uri);
  clearTimeout(diagTimers.get(uri));
  diagTimers.delete(uri);
  if (ready) notify('textDocument/didClose', { textDocument: doc(model) });
}

export const isReady = () => ready;
export const didSave = (model: M.editor.ITextModel) => { if (ready && opened.has(model.uri.toString())) notify('textDocument/didSave', { textDocument: doc(model) }); };
export const workspaceSymbols = (query: string) => ask<any[]>('workspaceSymbols', 'workspace/symbol', { query });
export const documentSymbols = async (model: M.editor.ITextModel) => symbols(await ask('documentSymbols', 'textDocument/documentSymbol', { textDocument: doc(model) }));
// Toggling the flag: pull fresh for open docs when on, clear markers when off.
export const refreshDiagnostics = () => opened.forEach(m => Features.on('diagnostics') ? void pullDiagnostics(m) : setDiagnostics(m.uri.toString(), []));

api.onLspMessage(onMessage);
api.onLspLog(text => hooks?.log(text));
api.onLspExit(code => {
  const message = `O Ruby LSP encerrou (código ${code}). Para instalar: paleta (Ctrl+Shift+P) → "Ruby: Configurar Ambiente", ou gem install ruby-lsp`;
  clearInterval(keepAlive);
  ready = false;
  rejectPending(message); // a pending initialize reports this same message from start()
  progress.clear();
  hooks?.status('error', message);
});
