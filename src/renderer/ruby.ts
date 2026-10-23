// Ruby tooling: run files and tests, go to test, Bundler, Rake, interpreters, gems and code style.
import { rubocopStyle, withInherit } from './code-style.ts';
import { abs, api, h, icon, notify, ws } from './dom.ts';
import * as Editor from './editor.ts';
import { refreshWorkspace } from './explorer.ts';
import * as Features from './features.ts';
import * as Panel from './panel.ts';
import { fuzzyScore, implCandidates, isTest, minitestNameAt, parseInspections, parseRakeTasks, relativeTo, specDirs, rspecFolderArgs, testCandidates, testTarget, type Inspection, type TestResult } from './paths.ts';
import { prompt, quickPick } from './quick-input.ts';
import * as Tests from './tests.ts';

let runSeq = 0;
const running = new Set<string>();
const onExit = new Map<string, (code: number | null) => void>();
// How a test/file command is executed: plainly with a report (Tests.run), under the debugger, or profiled.
type Run = (cmd: string, args: string[], fw: Tests.Framework) => unknown;
const ruby = () => Features.get<string>('ruby.path');
const withBundle = (cmd: string, args: string[]): [string, string[]] => ws.hasGemfile ? ['bundle', ['exec', cmd, ...args]] : [cmd, args];

api.onRunData((_id, text) => Panel.append(text));
api.onRunExit((id, code) => {
  running.delete(id);
  onExit.get(id)?.(code);
  onExit.delete(id);
  Panel.append(`\n[${code === 0 ? 'concluído' : `encerrado com código ${code}`}]\n`);
  Panel.setRunning(running.size > 0, running.has(String(runSeq)) ? String(runSeq) : undefined);
});

function enabled(feature: string) {
  if (!ws.root) notify('Abra uma pasta primeiro (Ctrl+O).');
  else if (!Features.on(feature)) notify('Esta funcionalidade está desativada em Configurações.');
  else return true;
  return false;
}

export function runCommand(cmd: string, args: string[], opts: { env?: Record<string, string>; cwd?: string; onExit?: (code: number | null) => void } = {}) {
  const id = String(++runSeq);
  running.add(id);
  if (opts.onExit) onExit.set(id, opts.onExit);
  Panel.show('output');
  Panel.append(`\n> ${[cmd, ...args].join(' ')}\n`);
  Panel.setRunning(true, id);
  void api.run(id, cmd, args, opts.cwd ?? ws.root, opts.env);
}

export const stopAll = () => running.forEach(id => api.stop(id));

// Saves the active file first so the process sees what is on screen.
async function activeFile(): Promise<string | undefined> {
  const tab = Editor.active;
  if (!tab?.path) return void notify('Abra um arquivo Ruby primeiro.');
  if (tab.dirty && !await Editor.save(tab)) return;
  return relativeTo(ws.root, tab.path) ?? tab.path;
}

async function firstExisting(candidates: string[]) {
  for (const c of candidates) if (await api.exists(abs(c))) return c;
}

const framework = (rel: string) => {
  const chosen = Features.get<string>('test.framework');
  return chosen !== 'auto' ? chosen : rel.endsWith('_spec.rb') ? 'rspec' : 'minitest';
};

// `run` lets the debugger reuse the same command lines under rdbg.
export async function runFile(run: (cmd: string, args: string[]) => unknown = runCommand, feature = 'runFile') {
  if (!enabled(feature)) return;
  const rel = await activeFile();
  if (rel) run(...withBundle(ruby(), [rel]));
}

// atLine: true = cursor line, a number = that line (gutter ▶), false = whole file.
export async function runTests(atLine: boolean | number = false, run: Run = Tests.run, feature = 'runTests') {
  if (!enabled(feature)) return;
  const rel = await activeFile();
  if (!rel) return;
  const target = isTest(rel) ? rel : await firstExisting(testCandidates(rel));
  if (!target) return notify('Nenhum teste encontrado para este arquivo. Use Ctrl+Shift+T para criar um.');
  const lineNo = target !== rel ? 0 : typeof atLine === 'number' ? atLine : atLine ? Editor.editor.getPosition()!.lineNumber : 0;
  const line = lineNo ? `:${lineNo}` : '';
  if (framework(target) === 'rspec') run(...withBundle('rspec', [target + line]), 'rspec');
  else if (await api.exists(abs('bin/rails'))) run(ruby(), ['bin/rails', 'test', target + line], 'minitest');
  else {
    const name = lineNo ? minitestNameAt(Editor.editor.getModel()!.getValue(), lineNo) : undefined;
    if (lineNo && !name) notify('Nenhum teste Minitest nesta linha; executando o arquivo inteiro.');
    run(...withBundle(ruby(), ['-Itest', target, ...(name ? ['-n', name] : [])]), 'minitest');
  }
}

// Reruns exactly the given examples: RSpec/Rails by file:line, plain Minitest by test name.
export async function rerun(list: TestResult[], run: Run = Tests.run) {
  const specs = list.filter(r => framework(r.file) === 'rspec');
  const units = list.filter(r => framework(r.file) !== 'rspec');
  if (specs.length) run(...withBundle('rspec', specs.map(testTarget)), 'rspec');
  if (!units.length) return;
  if (await api.exists(abs('bin/rails'))) return run(ruby(), ['bin/rails', 'test', ...units.map(r => `${r.file}:${r.line}`)], 'minitest');
  const files = [...new Set(units.map(r => r.file))];
  const names = [...new Set(units.map(r => r.name.slice(r.name.lastIndexOf('#') + 1)))];
  run(...withBundle(ruby(), ['-Itest', ...files.flatMap(f => ['-r', `./${f}`]), '-e', 'nil', '--', '-n', `/^(${names.join('|')})$/`]), 'minitest');
}

export async function runAllTests(run: Run = Tests.run) {
  if (!enabled('runTests')) return;
  const chosen = Features.get<string>('test.framework');
  const rspec = chosen === 'rspec' || (chosen === 'auto' && await api.exists(abs('spec')));
  if (rspec) run(...withBundle('rspec', []), 'rspec');
  else if (await api.exists(abs('bin/rails'))) run(ruby(), ['bin/rails', 'test'], 'minitest');
  else run(...withBundle('rake', ['test']), 'minitest');
}

export async function gotoTest() {
  if (!enabled('gotoTest')) return;
  const rel = await activeFile();
  if (!rel) return;
  const candidates = isTest(rel) ? implCandidates(rel) : testCandidates(rel);
  if (!candidates.length) return notify('Este arquivo não segue uma convenção de teste Ruby.');
  const found = await firstExisting(candidates);
  if (found) return Editor.openFile(abs(found));
  if (isTest(rel)) return notify('Implementação não encontrada.');
  quickPick({
    placeholder: 'Nenhum teste encontrado. Escolha onde criar:',
    items: () => candidates.map(c => ({
      label: c, icon: 'new-file',
      run: async () => {
        await api.createPath(abs(c), false);
        await refreshWorkspace();
        await Editor.openFile(abs(c));
      },
    })),
  });
}

export function bundle(sub: string) {
  if (enabled('bundler')) runCommand('bundle', [sub]);
}

export async function runSpecFolder() {
  if (!enabled('runTests')) return;
  const dirs = specDirs(ws.files, ws.root);
  if (!dirs.length) return notify('Nenhum arquivo *_spec.rb neste projeto.');
  quickPick({
    placeholder: 'RSpec: escolha a pasta de specs',
    items: q => dirs.filter(d => fuzzyScore(q, d) >= 0).map(d => ({
      label: d, icon: 'folder',
      run: async () => {
        const filter = await prompt('Filtro pelo nome do exemplo (-e), opcional; Enter executa tudo', '');
        if (filter !== undefined) void Tests.run(...withBundle('rspec', rspecFolderArgs(d, filter)), 'rspec');
      },
    })),
  });
}

export function bundleInit() {
  if (enabled('bundler')) runCommand('bundle', ['init']);
}

// Runs in the parent folder, so the new gem becomes a sibling of the open project.
export async function bundleGem() {
  if (!enabled('bundler')) return;
  const name = await prompt('Nome da nova gem (criada ao lado da pasta aberta)');
  if (name) runCommand('bundle', ['gem', name], { cwd: dirOf(ws.root) });
}

export async function rakeTasks() {
  if (!enabled('rake')) return;
  notify('Carregando tarefas Rake…');
  const r = await api.exec(...withBundle('rake', ['-AT']), ws.root);
  const tasks = parseRakeTasks(r.out);
  if (!tasks.length) return notify(`Nenhuma tarefa Rake encontrada. ${r.out.slice(0, 300)}`, 'error');
  quickPick({
    placeholder: 'Executar tarefa Rake',
    items: q => tasks.filter(t => fuzzyScore(q, t.name) >= 0)
      .sort((a, b) => fuzzyScore(q, b.name) - fuzzyScore(q, a.name))
      .map(t => ({ label: t.name, description: t.desc, icon: 'tools', run: () => runCommand(...withBundle('rake', [t.name])) })),
  });
}

export async function interpreterInfo(): Promise<{ text: string; tooltip: string; ok: boolean }> {
  const r = await api.exec(ruby(), ['-v'], ws.root || '.');
  const version = /ruby (\d[^\s]*)/.exec(r.out)?.[1];
  if (!version) return { text: 'Ruby não encontrado', tooltip: r.out.trim() || `Comando "${ruby()}" falhou`, ok: false };
  const pinned = ws.root && await api.exists(abs('.ruby-version')) ? (await api.readFile(abs('.ruby-version'))).trim().replace(/^ruby-/, '') : '';
  if (pinned && !version.startsWith(pinned)) return { text: `Ruby ${version}`, tooltip: `.ruby-version pede ${pinned}, mas o interpretador é ${version}`, ok: false };
  return { text: `Ruby ${version}`, tooltip: r.out.trim(), ok: true };
}

// ---------- interpreters, gems, code style ----------

const isPath = (p: string) => /[\\/]/.test(p);
export const dirOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')));

// A chosen interpreter path also decides which bundle/rake/rspec/ruby-lsp run: its bin dir goes first on PATH.
export const applyRubyBin = () => api.setRubyBin(isPath(ruby()) ? dirOf(ruby()) : '');

export async function selectInterpreter(onChange: () => void) {
  if (!Features.on('versionManagers')) return notify('Esta funcionalidade está desativada em Configurações.');
  notify('Procurando interpretadores Ruby…');
  const found = await api.findRubies();
  const pinned = ws.root && await api.exists(abs('.ruby-version')) ? (await api.readFile(abs('.ruby-version'))).trim().replace(/^ruby-/, '') : '';
  const rows = await Promise.all(found.map(async r => ({ ...r, version: /ruby (\S+)/.exec((await api.exec(r.path, ['-v'], ws.root || '.')).out)?.[1] })));
  const pick = (path: string) => { Features.set('ruby.path', path); onChange(); };
  quickPick({
    placeholder: `Interpretador atual: ${ruby()}${pinned ? ` · .ruby-version pede ${pinned}` : ''}`,
    items: q => [
      { label: 'ruby (o primeiro do PATH)', icon: 'terminal', description: 'padrão', run: () => pick('ruby') },
      ...rows.filter(r => r.version && `${r.version} ${r.path}`.toLowerCase().includes(q.toLowerCase())).map(r => ({
        label: `Ruby ${r.version}`, icon: r.path === ruby() ? 'check' : 'ruby',
        description: `${r.manager}${pinned && r.version!.startsWith(pinned) ? ' · .ruby-version' : ''} · ${r.path}`,
        run: () => pick(r.path),
      })),
    ],
  });
}

export async function loadGems(container: HTMLElement) {
  if (!ws.root || !Features.on('gemsView')) return container.replaceChildren();
  container.replaceChildren(h('div', { className: 'empty' }, 'Carregando gems…'));
  const list = 'sort_by(&:name).each { |s| puts [s.name, s.version, s.full_gem_path].join(9.chr) }';
  const r = ws.hasGemfile
    ? await api.exec('bundle', ['exec', ruby(), '-e', `Bundler.load.specs.${list}`], ws.root)
    : await api.exec(ruby(), ['-e', `Gem::Specification.latest_specs(true).${list}`], ws.root);
  const gems = r.out.split(/\r?\n/).map(l => l.split('\t')).filter(p => p.length === 3);
  if (!gems.length) return container.replaceChildren(h('div', { className: 'empty error' }, r.out.trim().split('\n').slice(-2).join(' ') || 'Nenhuma gem encontrada.'));
  container.replaceChildren(h('div', { className: 'empty' }, ws.hasGemfile ? `${gems.length} gems do Gemfile.lock` : `${gems.length} gems instaladas (sem Gemfile)`),
    ...gems.map(([name, version, dir]) => {
      const row = h('div', { className: 'tree-row' }, icon('package'), h('span', { className: 'tree-label' }, name), h('span', { className: 'desc' }, version));
      row.title = dir;
      row.onclick = () => void browseGem(name, dir);
      return row;
    }));
}

async function browseGem(name: string, dir: string) {
  const files = (await api.listFiles(dir)).filter(f => /\.(rb|rbs|md|gemspec)$/.test(f));
  const rel = (f: string) => relativeTo(dir, f) ?? f;
  quickPick({
    placeholder: `${name}: abrir arquivo do código-fonte`,
    items: q => files.map(f => ({ f, r: rel(f) })).filter(x => fuzzyScore(q, x.r) >= 0).sort((a, b) => fuzzyScore(q, b.r) - fuzzyScore(q, a.r) || a.r.localeCompare(b.r))
      .slice(0, 300).map(x => ({ label: x.r.split('/').pop()!, description: x.r, icon: 'file-code', run: () => Editor.openFile(x.f) })),
  });
}

export async function writeCodeStyle(onWritten: () => void) {
  if (!ws.root) return notify('Abra uma pasta primeiro (Ctrl+O).');
  if (Features.get('rubocop.config') !== 'Rubaxe') return notify('A configuração do RuboCop está em "projeto": o Rubaxe não altera esses arquivos. Mude em Configurações.');
  const file = '.rubocop_rubaxe.yml';
  await api.writeFile(abs(file), rubocopStyle(Features.get));
  const main = abs('.rubocop.yml');
  const existing = await api.exists(main) ? await api.readFile(main) : undefined;
  const merged = withInherit(existing, file);
  if (merged === undefined) notify(`.rubocop.yml já tem inherit_from: adicione ${file} à lista manualmente.`, 'error');
  else if (merged !== existing) await api.writeFile(main, merged);
  notify(`Estilo gravado em ${file}. Formatar (Shift+Alt+F) aplica as regras via RuboCop.`);
  onWritten();
}

// Own inspections (rubaxe_inspect.rb, run on the file on disk): on open and after every save.
async function inspect(model: import('monaco-editor').editor.ITextModel) {
  if (model.isDisposed() || model.uri.scheme !== 'file' || model.getLanguageId() !== 'ruby') return;
  let list: Inspection[] = [];
  if (Features.on('inspections')) {
    const r = await api.exec(ruby(), ['--disable-gems', `${await api.rubyHelpers()}${ws.sep}rubaxe_inspect.rb`, model.uri.fsPath], ws.root || '.').catch(() => undefined);
    list = r ? parseInspections(r.out) : [];
  }
  if (model.isDisposed()) return;
  const sev = { warning: monaco.MarkerSeverity.Warning, info: monaco.MarkerSeverity.Info };
  monaco.editor.setModelMarkers(model, 'rubaxe-inspect', list.map(i => ({
    startLineNumber: i.line, startColumn: i.column, endLineNumber: i.endLine, endColumn: i.endColumn,
    severity: sev[i.severity] ?? sev.info, message: i.message, source: 'Rubaxe', code: i.rule,
  })));
}

export function inspectAll() {
  monaco.editor.getModels().forEach(m => void inspect(m));
}

export function initInspect() {
  monaco.editor.onDidCreateModel(m => {
    void inspect(m);
    m.onWillDispose(() => monaco.editor.setModelMarkers(m, 'rubaxe-inspect', []));
  });
  Editor.onDidSave(path => { const m = monaco.editor.getModel(monaco.Uri.file(path)); if (m) void inspect(m); });
}

export function steepCheck() {
  if (enabled('rbs')) runCommand(...withBundle('steep', ['check']));
}
