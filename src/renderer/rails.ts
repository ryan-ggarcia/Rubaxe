// Rails: related-file navigation, generators, server and migrations, route helper and i18n key completion.
import { abs, api, notify, ws } from './dom.ts';
import * as Editor from './editor.ts';
import { refreshWorkspace } from './explorer.ts';
import * as Features from './features.ts';
import { implCandidates, isTest, localeKeys, parseRoutes, railsRelated, railsResource, relativeTo, testCandidates } from './paths.ts';
import { prompt, quickPick, type QuickItem } from './quick-input.ts';
import * as Ruby from './ruby.ts';
import * as Terminal from './terminal.ts';

const GENERATORS: [name: string, example: string][] = [
  ['model', 'Post title:string body:text'], ['controller', 'Posts index show'], ['scaffold', 'Post title:string body:text'],
  ['resource', 'Post title:string'], ['migration', 'AddPublishedToPosts published:boolean'], ['scaffold_controller', 'Post'],
  ['mailer', 'UserMailer welcome'], ['job', 'ImportPosts'], ['channel', 'Chat'], ['helper', 'Posts'],
  ['integration_test', 'PostFlows'], ['system_test', 'Posts'], ['authentication', ''],
];
const ICONS: Record<string, string> = { Model: 'database', Controller: 'server-process', Helper: 'tools', Layout: 'layout', Routes: 'type-hierarchy', Schema: 'table', Teste: 'beaker', View: 'file-code' };

let routes: Promise<ReturnType<typeof parseRoutes>> | undefined;
let i18n: Promise<string[]> | undefined;
const ruby = () => Features.get<string>('ruby.path');

function ready(feature: string) {
  if (!ws.root) notify('Abra uma pasta primeiro (Ctrl+O).');
  else if (!ws.isRails) notify('Esta pasta não é um projeto Rails (falta config/application.rb ou bin/rails).');
  else if (!Features.on(feature)) notify('Esta funcionalidade está desativada em Configurações.');
  else return true;
  return false;
}

async function lineOf(path: string, re: RegExp): Promise<number> {
  const text = await api.readFile(path).catch(() => '');
  return text.split(/\r?\n/).findIndex(l => re.test(l)) + 1 || 1;
}

const enclosingDef = (line: number) => {
  const lines = Editor.editor.getModel()?.getLinesContent().slice(0, line) ?? [];
  for (let i = lines.length - 1; i >= 0; i--) { const m = /^\s*def\s+(\w+)/.exec(lines[i]); if (m) return m[1]; }
};

export async function related() {
  if (!ready('railsNav')) return;
  const rel = Editor.active?.path && relativeTo(ws.root, Editor.active.path);
  if (!rel) return notify('Abra um arquivo do projeto Rails.');
  const res = railsResource(rel);
  const isView = rel.startsWith('app/views/');
  const action = isView ? rel.split('/').pop()!.split('.')[0].replace(/^_/, '') : rel.endsWith('_controller.rb') ? enclosingDef(Editor.editor.getPosition()!.lineNumber) : undefined;
  const items: (QuickItem & { rank: number })[] = [];
  const add = (label: string, path: string, icon: string, line?: () => Promise<number>, rank = 1) =>
    items.push({ label, description: relativeTo(ws.root, path) ?? path, icon, rank, run: async () => Editor.openFile(path, { lineNumber: line ? await line() : 1, column: 1 }) });
  for (const c of railsRelated(rel)) {
    const path = abs(c.path);
    if (c.kind === 'Views') {
      for (const e of await api.readDir(path).catch(() => [])) if (!e.dir) add(`View: ${e.name}`, e.path, ICONS.View, undefined, e.name.split('.')[0] === action ? 0 : 1);
      continue;
    }
    if (!await api.exists(path)) continue;
    if (c.kind === 'Schema') add(c.kind, path, ICONS.Schema, () => lineOf(path, new RegExp(`create_table\\s+["']${res!.plural}["']`)));
    else if (c.kind === 'Controller' && action) add(`Controller#${action}`, path, ICONS.Controller, () => lineOf(path, new RegExp(`^\\s*def\\s+${action}\\b`)), 0);
    else if (c.kind === 'Routes') add(c.kind, path, ICONS.Routes, () => lineOf(path, new RegExp(`\\b${res!.plural}\\b`)));
    else add(c.kind, path, ICONS[c.kind] ?? 'file');
  }
  for (const t of isTest(rel) ? implCandidates(rel) : testCandidates(rel)) if (await api.exists(abs(t))) add(isTest(rel) ? 'Implementação' : 'Teste', abs(t), ICONS.Teste);
  if (!items.length) return notify('Nenhum arquivo Rails relacionado encontrado.');
  items.sort((a, b) => a.rank - b.rank);
  quickPick({ placeholder: 'Ir para arquivo Rails relacionado', items: q => items.filter(i => `${i.label} ${i.description}`.toLowerCase().includes(q.toLowerCase())) });
}

export function generate(destroy = false) {
  if (!ready('railsGenerators')) return;
  quickPick({
    placeholder: destroy ? 'Desfazer generator (rails destroy)' : 'Executar generator do Rails',
    items: q => GENERATORS.filter(([g]) => g.includes(q.trim())).map(([g, example]) => ({
      label: g, description: example, icon: destroy ? 'trash' : 'wand',
      run: async () => {
        const args = g === 'authentication' ? '' : await prompt(`rails ${destroy ? 'destroy' : 'generate'} ${g} — argumentos (ex.: ${example})`);
        if (args === undefined || (!args && g !== 'authentication')) return;
        Ruby.runCommand(ruby(), ['bin/rails', destroy ? 'destroy' : 'generate', g, ...args.split(/\s+/).filter(Boolean)], { onExit: () => void refreshWorkspace() });
      },
    })),
  });
}

export const openConsole = () => ready('console') && Terminal.create('rails console', `${ruby()} bin/rails console`, true);
// Stopping kills the process tree (taskkill /F on Windows), so Puma never removes its pid file; a stale
// tmp/pids/server.pid would make the next start fail with "A server is already running". Use a fresh one per run.
export async function server() {
  if (!ready('railsGenerators')) return;
  Ruby.runCommand(ruby(), ['bin/rails', 'server', '--pid', `${await api.mkTemp()}${ws.sep}server.pid`]);
}
export const db = (task: string) => ready('railsGenerators') && Ruby.runCommand(ruby(), ['bin/rails', `db:${task}`], { onExit: () => { routes = undefined; } });

// ---------- completion ----------

const loadRoutes = () => routes ??= api.exec(ruby(), ['bin/rails', 'routes'], ws.root).then(r => parseRoutes(r.out));
const loadI18n = () => i18n ??= Promise.all(ws.files.filter(f => /[\\/]config[\\/]locales[\\/].+\.ya?ml$/.test(f)).map(f => api.readFile(f).catch(() => '')))
  .then(texts => [...new Set(texts.flatMap(localeKeys))].sort());

export function initRails() {
  // `bin/rails routes` and locale files are read once; saving them drops the cache.
  Editor.onDidSave(path => {
    if (/[\\/]config[\\/]routes\.rb$/.test(path)) routes = undefined;
    if (/[\\/]config[\\/]locales[\\/]/.test(path)) i18n = undefined;
  });
  for (const lang of ['ruby', 'html']) monaco.languages.registerCompletionItemProvider(lang, {
    triggerCharacters: ["'", '"', '.'],
    async provideCompletionItems(model, position) {
      if (!ws.isRails || !Features.on('railsRoutes')) return { suggestions: [] };
      const line = position.lineNumber;
      const before = model.getValueInRange(new monaco.Range(line, 1, line, position.column));
      const key = /\b(?:I18n\.)?t\(?\s*["']([\w.]*)$/.exec(before);
      if (key) {
        const range = new monaco.Range(line, position.column - key[1].length, line, position.column);
        return { suggestions: (await loadI18n()).map(k => ({ label: k, kind: monaco.languages.CompletionItemKind.Value, insertText: k, range, detail: 'chave i18n' })) };
      }
      const word = model.getWordUntilPosition(position);
      if (!word.word || /["']/.test(before.slice(-word.word.length - 1, -word.word.length))) return { suggestions: [] };
      const range = new monaco.Range(line, word.startColumn, line, word.endColumn);
      return {
        suggestions: (await loadRoutes()).flatMap(r => ['_path', '_url'].map(suffix => ({
          label: r.helper + suffix, kind: monaco.languages.CompletionItemKind.Function, insertText: r.helper + suffix, range,
          detail: `${r.verb} ${r.path}`, documentation: r.action,
        }))),
      };
    },
  });
}

export function resetRails() {
  routes = undefined;
  i18n = undefined;
}
