// Ruby tooling: run files and tests, go to test, Bundler, Rake, interpreter detection.
import { abs, api, notify, ws } from './dom.ts';
import * as Editor from './editor.ts';
import * as Features from './features.ts';
import * as Panel from './panel.ts';
import { fuzzyScore, implCandidates, isTest, parseRakeTasks, relativeTo, testCandidates } from './paths.ts';
import { quickPick } from './quick-input.ts';

let runSeq = 0;
const running = new Set<string>();
const ruby = () => Features.get<string>('ruby.path');
const withBundle = (cmd: string, args: string[]): [string, string[]] => ws.hasGemfile ? ['bundle', ['exec', cmd, ...args]] : [cmd, args];

api.onRunData((_id, text) => Panel.append(text));
api.onRunExit((id, code) => {
  running.delete(id);
  Panel.append(`\n[${code === 0 ? 'concluído' : `encerrado com código ${code}`}]\n`);
  Panel.setRunning(running.size > 0);
});

function enabled(feature: string) {
  if (!ws.root) notify('Abra uma pasta primeiro (Ctrl+O).');
  else if (!Features.on(feature)) notify('Esta funcionalidade está desativada em Configurações.');
  else return true;
  return false;
}

export function runCommand(cmd: string, args: string[]) {
  const id = String(++runSeq);
  running.add(id);
  Panel.show('output');
  Panel.append(`\n> ${[cmd, ...args].join(' ')}\n`);
  Panel.setRunning(true);
  void api.run(id, cmd, args, ws.root);
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

export async function runFile() {
  if (!enabled('runFile')) return;
  const rel = await activeFile();
  if (rel) runCommand(ruby(), [rel]);
}

export async function runTests(atLine = false) {
  if (!enabled('runTests')) return;
  const rel = await activeFile();
  if (!rel) return;
  const target = isTest(rel) ? rel : await firstExisting(testCandidates(rel));
  if (!target) return notify('Nenhum teste encontrado para este arquivo. Use Ctrl+Shift+T para criar um.');
  const line = atLine && target === rel ? `:${Editor.editor.getPosition()!.lineNumber}` : '';
  if (framework(target) === 'rspec') runCommand(...withBundle('rspec', [target + line]));
  else if (await api.exists(abs('bin/rails'))) runCommand(ruby(), ['bin/rails', 'test', target + line]);
  else {
    if (line) notify('Minitest sem Rails não filtra por linha; executando o arquivo inteiro.');
    runCommand(...withBundle(ruby(), ['-Itest', target]));
  }
}

export async function runAllTests() {
  if (!enabled('runTests')) return;
  const chosen = Features.get<string>('test.framework');
  const rspec = chosen === 'rspec' || (chosen === 'auto' && await api.exists(abs('spec')));
  if (rspec) runCommand(...withBundle('rspec', []));
  else if (await api.exists(abs('bin/rails'))) runCommand(ruby(), ['bin/rails', 'test']);
  else runCommand(...withBundle('rake', ['test']));
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
        ws.files.push(abs(c));
        await Editor.openFile(abs(c));
      },
    })),
  });
}

export function bundle(sub: string) {
  if (enabled('bundler')) runCommand('bundle', [sub]);
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
