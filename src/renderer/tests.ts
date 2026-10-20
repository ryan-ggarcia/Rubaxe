// Test results: test tree view, gutter run icons with the last result, coverage overlay and profiler.
import type * as M from 'monaco-editor';
import { $, abs, api, basename, h, icon, notify, ws } from './dom.ts';
import * as Editor from './editor.ts';
import * as Panel from './panel.ts';
import { isTest, parseTestReport, relativeTo, testLines, type TestResult } from './paths.ts';
import { quickPick } from './quick-input.ts';
import * as Ruby from './ruby.ts';

export type Framework = 'rspec' | 'minitest';

let results: TestResult[] = [];
let withCoverage = false; // consumed by the next run()
const coverage = new Map<string, (number | null)[]>(); // workspace-relative path -> hits per line
const openFiles = new Set<string>(); // collapsed by default; failing files open themselves
const glyphIds = new WeakMap<M.editor.ITextModel, string[]>();
const covIds = new WeakMap<M.editor.ITextModel, string[]>();
let helpers: Promise<string> | undefined;
const helperDir = () => helpers ??= api.rubyHelpers();
const relOf = (model: M.editor.ITextModel) => relativeTo(ws.root, model.uri.fsPath);
const STATUS_ICON = { passed: 'pass-filled', failed: 'error', pending: 'circle-slash' } as const;

// Runs a test command with a machine-readable report next to the normal console output.
export async function run(cmd: string, args: string[], fw: Framework) {
  const dir = await api.mkTemp();
  const report = `${dir}${ws.sep}report.json`;
  const lib = await helperDir();
  const rubyopt: string[] = [];
  const env: Record<string, string> = {};
  if (fw === 'rspec') args = [...args, '--format', 'progress', '--format', 'json', '--out', report];
  else { rubyopt.push('-rrubaxe_minitest'); env.RUBAXE_TEST_REPORT = report; }
  const cov = withCoverage;
  withCoverage = false;
  if (cov) { rubyopt.push('-rrubaxe_coverage'); env.RUBAXE_COVERAGE = dir; }
  if (rubyopt.length) Object.assign(env, { RUBYOPT: rubyopt.join(' '), RUBYLIB: lib });
  const targets = args.filter(a => /_(spec|test)\.rb(:\d+)?$/.test(a));
  const partial = args.some(a => /:\d+$/.test(a)) || args.includes('-n');
  Ruby.runCommand(cmd, args, { env, onExit: () => void finish(report, dir, cov, targets.length === 0 && !partial, partial) });
}

async function finish(report: string, dir: string, cov: boolean, full: boolean, partial: boolean) {
  let fresh: TestResult[] | undefined;
  try {
    fresh = parseTestReport(await api.readFile(report), ws.root);
  } catch {
    // no report: the run crashed before tests ran (load error); the output panel has the reason
  }
  if (fresh) {
    if (full) results = fresh;
    else if (partial) results = [...results.filter(r => !fresh!.some(f => f.file === r.file && f.line === r.line)), ...fresh];
    else { const files = new Set(fresh.map(f => f.file)); results = [...results.filter(r => !files.has(r.file)), ...fresh]; }
    for (const r of fresh) if (r.status === 'failed') openFiles.add(r.file);
    renderTree();
    repaintAll();
  }
  if (cov) await loadCoverage(dir);
}

export function runWithCoverage(start: () => unknown) {
  withCoverage = true;
  void start();
}

export async function rerunFailed() {
  const failed = results.filter(r => r.status === 'failed');
  if (!failed.length) return notify('Nenhum teste falhou na última execução.');
  await Ruby.rerun(failed);
}

// ---------- coverage ----------

async function loadCoverage(dir: string) {
  const files = (await api.readDir(dir).catch(() => [])).filter(e => /^\d+\.json$/.test(e.name));
  coverage.clear();
  for (const f of files) {
    const data: Record<string, (number | null)[]> = JSON.parse(await api.readFile(f.path).catch(() => '{}'));
    for (const [file, lines] of Object.entries(data)) {
      const rel = relativeTo(ws.root, file) ?? file;
      const prev = coverage.get(rel) ?? [];
      // Forked workers each report their own counts; add them up line by line.
      coverage.set(rel, lines.map((c, i) => c === null && prev[i] == null ? null : (c ?? 0) + (prev[i] ?? 0)));
    }
  }
  if (!coverage.size) return notify('A execução não gerou dados de cobertura.', 'error');
  let hit = 0, total = 0;
  const rows = [...coverage].sort(([a], [b]) => a.localeCompare(b)).map(([file, lines]) => {
    const code = lines.filter(c => c !== null) as number[];
    const covered = code.filter(c => c > 0).length;
    hit += covered;
    total += code.length;
    return `  ${pct(covered, code.length).padStart(5)}  ${file}`;
  });
  Panel.append(`\nCobertura de linhas: ${pct(hit, total)} (${hit}/${total})\n${rows.join('\n')}\n`);
  repaintAll();
}

const pct = (a: number, b: number) => `${b ? Math.round((a / b) * 100) : 100}%`;

export function hideCoverage() {
  coverage.clear();
  repaintAll();
}

function paintCoverage(model: M.editor.ITextModel) {
  const rel = relOf(model);
  const lines = rel ? coverage.get(rel) : undefined;
  const decos: M.editor.IModelDeltaDecoration[] = [];
  lines?.forEach((c, i) => {
    if (c !== null && i < model.getLineCount()) decos.push({ range: new monaco.Range(i + 1, 1, i + 1, 1), options: { linesDecorationsClassName: c > 0 ? 'cov-hit' : 'cov-miss' } });
  });
  covIds.set(model, model.deltaDecorations(covIds.get(model) ?? [], decos));
}

// ---------- gutter ----------

function paintGlyphs(model: M.editor.ITextModel) {
  const rel = relOf(model);
  const lines = rel && isTest(rel) ? testLines(model.getValue()) : [];
  glyphIds.set(model, model.deltaDecorations(glyphIds.get(model) ?? [], lines.map(line => {
    const status = results.find(r => r.file === rel && r.line === line)?.status;
    return {
      range: new monaco.Range(line, 1, line, 1),
      options: {
        glyphMarginClassName: `codicon codicon-${status ? STATUS_ICON[status] : 'run'} test-glyph ${status ?? ''}`,
        glyphMarginHoverMessage: { value: 'Executar este teste' },
        glyphMargin: { position: monaco.editor.GlyphMarginLane.Left },
      },
    };
  })));
}

function repaintAll() {
  for (const t of Editor.tabs) if (t.model && !t.model.isDisposed()) { paintGlyphs(t.model); paintCoverage(t.model); }
}

// ---------- tree view ----------

function renderTree() {
  const counts = { passed: 0, failed: 0, pending: 0 };
  results.forEach(r => counts[r.status]++);
  const rows: HTMLElement[] = [h('div', { className: 'empty' }, results.length
    ? `${counts.passed} passaram, ${counts.failed} falharam, ${counts.pending} pendentes`
    : 'Execute os testes (Ctrl+Shift+F10 ou ▶ na margem) para ver os resultados.')];
  const byFile = Map.groupBy([...results].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line), r => r.file);
  for (const [file, list] of byFile) {
    const failed = list.some(r => r.status === 'failed');
    const open = openFiles.has(file);
    const fileRow = h('div', { className: 'tree-row', title: file },
      icon(open ? 'chevron-down' : 'chevron-right'), icon(failed ? 'error' : list.every(r => r.status === 'pending') ? 'circle-slash' : 'pass-filled'),
      h('span', { className: 'tree-label' }, basename(file)), h('span', { className: 'desc' }, file), h('span', { className: 'badge' }, String(list.length)));
    fileRow.onclick = () => { if (open) openFiles.delete(file); else openFiles.add(file); renderTree(); };
    rows.push(fileRow);
    if (!open) continue;
    for (const r of list) {
      const row = h('div', { className: 'tree-row test-row' }, icon(STATUS_ICON[r.status]), h('span', { className: 'tree-label' }, r.name),
        h('span', { className: 'desc' }, r.time !== undefined ? `${Math.round(r.time * 1000)} ms` : ''));
      row.title = r.message ? `${r.name}\n\n${r.message}` : r.name;
      row.onclick = () => void Editor.openFile(abs(r.file), { lineNumber: r.line, column: 1 });
      rows.push(row);
      if (r.status === 'failed' && r.message) rows.push(h('div', { className: 'test-message' }, r.message));
    }
  }
  $('#tests-tree').replaceChildren(...rows);
}

// ---------- profiler ----------

// Sampling by default (near-zero overhead); exact = TracePoint, every call counted but much slower on call-heavy code.
export async function profile(cmd: string, args: string[], exact = false) {
  const dir = await api.mkTemp();
  const out = `${dir}${ws.sep}profile.json`;
  Ruby.runCommand(cmd, args, {
    // A 1 ms thread time slice lets the sampler thread take the GVL between the program's own slices.
    env: { RUBYOPT: '-rrubaxe_profile', RUBYLIB: await helperDir(), RUBAXE_PROFILE: out, RUBAXE_PROFILE_MODE: exact ? 'trace' : 'sample', RUBY_THREAD_TIMESLICE: '1' },
    onExit: () => void showProfile(out),
  });
}

interface ProfileRow { name: string; file: string; line: number; calls: number | null; total_ms: number; self_ms: number }

async function showProfile(out: string) {
  let rows: ProfileRow[], mode: string, samples: number | null;
  try {
    ({ rows, mode, samples } = JSON.parse(await api.readFile(out)));
  } catch {
    return notify('O profiler não gerou resultados (o programa falhou ao iniciar?).', 'error');
  }
  const where = (r: ProfileRow) => `${relativeTo(ws.root, r.file) ?? r.file}:${r.line}`;
  const calls = (r: ProfileRow) => r.calls === null ? '' : `${r.calls}x`; // sampling does not count calls
  const how = mode === 'trace' ? 'instrumentado: contagem exata, tempos inflados pela medição' : `amostragem${mode === 'stackprof' ? ' com stackprof' : ''}, ${samples} amostras`;
  if (mode !== 'trace' && (samples ?? 0) < 50) notify('Poucas amostras (programa curto): use "Perfilar Arquivo (instrumentado, exato)" para resultados mais precisos.');
  Panel.append(`\nProfiler (tempo próprio, top 20 — ${how}):\n${rows.slice(0, 20).map(r =>
    `  ${r.self_ms.toFixed(1).padStart(9)} ms  ${r.total_ms.toFixed(1).padStart(9)} ms total  ${calls(r).padStart(7)}  ${r.name}  ${where(r)}`).join('\n')}\n`);
  quickPick({
    placeholder: 'Profiler: métodos por tempo próprio (Enter abre o código)',
    items: q => rows.filter(r => r.name.toLowerCase().includes(q.toLowerCase())).map(r => ({
      label: r.name, icon: 'flame',
      description: [`${r.self_ms.toFixed(1)} ms próprio`, `${r.total_ms.toFixed(1)} ms total`, calls(r), where(r)].filter(Boolean).join(' · '),
      // <internal:...> frames have no file to open
      run: () => { if (!r.file.startsWith('<')) void Editor.openFile(/^([A-Za-z]:|\/)/.test(r.file) ? r.file : abs(r.file), { lineNumber: r.line, column: 1 }); },
    })),
  });
}

export function initTests() {
  const action = (name: string, title: string, run: () => unknown) => { const el = icon(name, title); el.onclick = () => void run(); return el; };
  $('#tests-actions').replaceChildren(
    action('run-all', 'Executar todos os testes', () => Ruby.runAllTests()),
    action('debug-rerun', 'Reexecutar falhas', rerunFailed),
    action('run-coverage', 'Executar todos com cobertura', () => runWithCoverage(() => Ruby.runAllTests())),
    action('clear-all', 'Limpar resultados e cobertura', () => { results = []; hideCoverage(); renderTree(); }),
  );
  Editor.editor.onMouseDown(e => {
    const el = e.target.element as HTMLElement | null;
    if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && el?.classList.contains('test-glyph') && e.target.position) {
      void Ruby.runTests(e.target.position.lineNumber);
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  Editor.onDidChange(() => { const m = Editor.editor.getModel(); if (m) { paintGlyphs(m); paintCoverage(m); } });
  monaco.editor.onDidCreateModel(m => m.onDidChangeContent(() => { clearTimeout(timer); timer = setTimeout(() => !m.isDisposed() && paintGlyphs(m), 500); }));
  renderTree();
}
