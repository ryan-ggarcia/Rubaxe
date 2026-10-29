// Rails: related-file navigation, generators, server and migrations, route helper and i18n key completion.
import { abs, api, basename, notify, ws } from './dom.ts';
import * as Editor from './editor.ts';
import { pluralize } from './paths.ts';
import { moveEntry, refreshWorkspace } from './explorer.ts';
import * as Lsp from './lsp-client.ts';
import * as Features from './features.ts';
import { fixtureAccessor, implCandidates, isTest, localeKeys, needsPluralConfirm, parseRoutes, railsRelated, railsRenamePlan, railsRenameText, railsResource, railsReview, relativeTo, serverPort, testCandidates, underscore } from './paths.ts';
import { prompt, quickPick, type QuickItem } from './quick-input.ts';
import * as Ruby from './ruby.ts';
import * as Panel from './panel.ts';
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

// Right panel: existing candidates grouped as Routing / Controllers / Models / Views for the active file.
export async function relatedFiles(): Promise<[group: string, files: { name: string; path: string }[]][]> {
  const rel = Editor.active?.kind === 'file' && Editor.active.path && relativeTo(ws.root, Editor.active.path);
  if (!rel || !ws.isRails || !Features.on('railsNav')) return [];
  const GROUP: Record<string, string> = { Routes: 'Roteamento', Controller: 'Controladores', Model: 'Modelos', Views: 'Views', Layout: 'Views' };
  const out = new Map<string, { name: string; path: string }[]>();
  for (const c of railsRelated(rel)) {
    const group = GROUP[c.kind];
    if (!group) continue;
    const path = abs(c.path);
    const files = c.kind === 'Views' ? (await api.readDir(path).catch(() => [])).filter(e => !e.dir) : await api.exists(path) ? [{ name: basename(path), path }] : [];
    if (files.length) out.set(group, [...(out.get(group) ?? []), ...files]);
  }
  return Object.values(GROUP).filter((g, i, all) => all.indexOf(g) === i && out.has(g)).map(g => [g, out.get(g)!]);
}

// Rename Post -> Article across models, controllers, helpers, views, tests and fixtures. Constants go through the Ruby LSP
// (so references elsewhere follow); files are moved with the explorer's rename. Tables, migrations and routes are only listed.
export async function renameResource() {
  if (!ready('railsRename')) return;
  const rel = Editor.active?.path && relativeTo(ws.root, Editor.active.path);
  const res = rel ? railsResource(rel) : undefined;
  if (!rel || !res) return notify('Abra um model, controller, helper, view ou teste de um recurso Rails.');
  // shortcut: namespaced resources are refused, upgrade when someone needs admin/... renames
  if (res.ns) return notify(`Renomear recurso com namespace (${res.ns}${res.plural}) ainda não é suportado.`, 'error');
  if (Editor.tabs.some(t => t.dirty)) return notify('Salve os arquivos abertos antes de renomear o recurso.', 'error');
  const camel = await prompt('Novo nome do recurso, no singular e em CamelCase (ex.: Article)');
  if (!camel) return;
  if (!/^[A-Z][A-Za-z0-9]*$/.test(camel)) return notify('Use CamelCase sem espaços ou "::" (ex.: Article, BlogPost).', 'error');
  const snake = underscore(camel);
  const plural = needsPluralConfirm(snake) ? await prompt(`"${snake}" tem plural irregular? Confirme o plural`, pluralize(snake)) : pluralize(snake);
  if (!plural) return;
  const files = ws.files.map(f => relativeTo(ws.root, f) ?? f);
  const plan = railsRenamePlan(rel, files, camel, plural);
  if (!plan?.files.length) return notify('Nenhum arquivo do recurso encontrado.');
  const review = railsReview(await api.readFile(abs('config/routes.rb')).catch(() => ''), files, res.singular, res.plural);
  // Lowercase leftovers (helpers, ivars, params, partials) are rewritten only in the resource's own files.
  const rewrite = (file: string, text: string) => plan.texts.includes(file)
    ? railsRenameText(text, file.includes('/views/'), res.singular, res.plural, snake, plural) : fixtureAccessor(text, res.plural, plural);
  const texts: { file: string; count: number }[] = [];
  for (const file of [...plan.texts, ...plan.fixtureUsers]) {
    const r = rewrite(file, await api.readFile(abs(file)).catch(() => ''));
    if (r.count) texts.push({ file, count: r.count });
  }
  const apply = async () => {
    const failed: typeof plan.consts = [];
    for (const c of plan.consts) {
      const model = await Editor.ensureModel(monaco.Uri.file(abs(c.file)));
      const at = model?.findMatches(`(?:class|module)\\s+(?:\\w+::)*${c.from}\\b`, false, true, true, null, false)[0];
      const touched = model && at ? await Lsp.renameSymbol(model, { lineNumber: at.range.endLineNumber, column: at.range.endColumn - c.from.length }, c.to) : undefined;
      if (!touched) { failed.push(c); continue; }
      for (const u of touched) { const tab = Editor.tabs.find(t => t.path && monaco.Uri.file(t.path).toString() === u.toString()); if (tab) await Editor.save(tab); }
      await new Promise(r => setTimeout(r, 300)); // let the server reindex the edited files before the next rename
    }
    // shortcut: without a Ruby LSP answer only the renamed file itself is rewritten (whole-word), references elsewhere are not; upgrade by retrying after the LSP is ready.
    for (const c of failed) {
      const path = abs(c.file);
      const text = await api.readFile(path).catch(() => undefined);
      if (text !== undefined) await api.writeFile(path, text.replace(new RegExp(`\\b${c.from}\\b`, 'g'), c.to));
    }
    for (const { file } of texts) {
      const path = abs(file);
      const text = await api.readFile(path).catch(() => undefined);
      if (text !== undefined) await api.writeFile(path, rewrite(file, text).text);
    }
    for (const f of plan.files) if (!await moveEntry(abs(f.from), abs(f.to))) return notify(`Parou em ${f.from}; revise o que já foi renomeado.`, 'error');
    await Editor.syncFromDisk();
    notify(`Recurso renomeado para ${camel}.${failed.length ? ` Sem resposta do Ruby LSP para ${failed.map(c => c.from).join(', ')}: só o arquivo foi ajustado.` : ''} Revise manualmente: tabela, migrations e config/routes.rb.`);
    if (review.length) { Panel.show('output'); Panel.append(`\nRevise manualmente (não alterado):\n${review.map(l => '  ' + l).join('\n')}\n`); }
  };
  quickPick({
    placeholder: `Renomear ${res.singular} -> ${snake}: ${plan.files.length} arquivos/pastas, ${plan.consts.length} constantes, ${texts.reduce((n, t) => n + t.count, 0)} substituições`,
    items: () => [
      { label: 'Cancelar', icon: 'close', run: () => {} },
      { label: `Aplicar renomeação (${plan.files.length} arquivos, ${plan.consts.length} constantes)`, icon: 'check', run: () => void apply() },
      ...plan.files.map(f => ({ label: `${f.from}  ->  ${f.to}`, icon: 'file', run: () => {} })),
      ...plan.consts.map(c => ({ label: `${c.from}  ->  ${c.to}`, description: c.file, icon: 'symbol-class', run: () => {} })),
      ...texts.map(t => ({ label: `${t.file}: ${t.count} substituições`, icon: 'replace', run: () => {} })),
      ...review.map(l => ({ label: l, description: 'revisar manualmente', icon: 'warning', run: () => {} })),
    ],
  });
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
// Runs in a terminal: Ctrl+C stops it, while the Output "Stop" (taskkill /F) would leave Puma's pid file behind.
// A fresh --pid per run avoids "A server is already running" from a stale tmp/pids/server.pid.
export const serverState = { term: undefined as Terminal.Term | undefined, port: '' };
export async function server() {
  if (!ready('railsGenerators')) return;
  if (serverState.term?.alive) return Terminal.show();
  serverState.port = '';
  serverState.term = await Terminal.create('rails server', `${ruby()} bin/rails server --pid "${await api.mkTemp()}${ws.sep}server.pid"`);
  if (serverState.term) Terminal.touch(serverState.term);
}
export const db = (task: string) => ready('railsGenerators') && Ruby.runCommand(ruby(), ['bin/rails', `db:${task}`], { onExit: () => { routes = undefined; } });

// ---------- completion ----------

const loadRoutes = () => routes ??= api.exec(ruby(), ['bin/rails', 'routes'], ws.root).then(r => parseRoutes(r.out));
const loadI18n = () => i18n ??= Promise.all(ws.files.filter(f => /[\\/]config[\\/]locales[\\/].+\.ya?ml$/.test(f)).map(f => api.readFile(f).catch(() => '')))
  .then(texts => [...new Set(texts.flatMap(localeKeys))].sort());

export function initRails() {
  Terminal.onDidChange(t => { if (t === serverState.term && !serverState.port) serverState.port = serverPort(t.tail); });
  // `bin/rails routes` and locale files are read once; saving them drops the cache.
  Editor.onDidSave(path => {
    if (/[\\/]config[\\/]routes\.rb$/.test(path)) routes = undefined;
    if (/[\\/]config[\\/]locales[\\/]/.test(path)) i18n = undefined;
  });
  for (const lang of ['ruby', 'erb']) monaco.languages.registerCompletionItemProvider(lang, {
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
