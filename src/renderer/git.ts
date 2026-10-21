// Git through the git CLI: Source Control view (stage, unstage, commit), diffs, inline blame and branches.
import type * as M from 'monaco-editor';
import { $, api, basename, h, icon, notify, ws } from './dom.ts';
import * as Editor from './editor.ts';
import { refreshWorkspace } from './explorer.ts';
import { parseBlame, parseGitStatus, relativeTo, type BlameLine, type GitChange } from './paths.ts';
import * as Features from './features.ts';
import { prompt, quickPick } from './quick-input.ts';

let top = ''; // repository root ('' = not a repo)
let branch = '';
let timer: ReturnType<typeof setTimeout> | undefined;
const blames = new Map<M.editor.ITextModel, BlameLine[]>();
let blameIds: string[] = [];
const STATUS: Record<string, [label: string, color: string]> = {
  M: ['Modificado', '#E2C08D'], A: ['Adicionado', '#81B88B'], D: ['Excluído', '#C74E39'], R: ['Renomeado', '#73C991'],
  C: ['Copiado', '#73C991'], U: ['Não rastreado', '#73C991'], T: ['Tipo alterado', '#E2C08D'],
};

// Commands call this first; the Source Control view and refresh handle the disabled state themselves.
function enabled() {
  if (!Features.on('git')) notify('Esta funcionalidade está desativada em Configurações.');
  return Features.on('git');
}

const git = (...args: string[]) => api.exec('git', args, top || ws.root);
const absOf = (p: string) => top + ws.sep + p.split('/').join(ws.sep);

async function gitOk(...args: string[]) {
  const r = await git(...args);
  if (r.code !== 0) notify(`git ${args[0]}: ${r.out.trim().split('\n').slice(-3).join(' ')}`, 'error');
  return r.code === 0;
}

export async function refresh() {
  if (!ws.root) return;
  if (!Features.on('git')) {
    top = branch = '';
    renderStatus();
    return $('#scm-body').replaceChildren(h('div', { className: 'empty' }, 'Git desativado em Configurações.'));
  }
  const root = await api.exec('git', ['rev-parse', '--show-toplevel'], ws.root);
  top = root.code === 0 ? root.out.trim().replace(/\//g, ws.sep) : '';
  if (!top) {
    branch = '';
    renderStatus();
    const init = h('button', { className: 'button' }, icon('repo'), ' Inicializar repositório');
    init.onclick = async () => { if (await gitOk('init')) void refresh(); };
    return $('#scm-body').replaceChildren(h('div', { className: 'empty' }, 'Esta pasta não é um repositório Git.'), h('div', { className: 'empty' }, init));
  }
  const r = await git('status', '--porcelain=v1', '-b', '-z', '-uall'); // -uall: an untracked folder lists its files, not one nameless row
  const s = parseGitStatus(r.out);
  branch = s.branch;
  renderStatus();
  const section = (title: string, list: GitChange[], staged: boolean) => {
    const action = (name: string, tip: string, run: () => unknown) => { const el = icon(name, tip); el.classList.add('row-action'); el.onclick = e => { e.stopPropagation(); void run(); }; return el; };
    const all = action(staged ? 'remove' : 'add', staged ? 'Remover tudo da área de preparação' : 'Preparar tudo', () => stage(list.map(c => c.path), !staged));
    const rows = list.map(c => {
      const [label, color] = STATUS[c.status] ?? [c.status, '#CCCCCC'];
      const letter = h('span', { className: 'scm-letter', title: label }, c.status);
      letter.style.color = color;
      const dir = c.path.includes('/') ? c.path.slice(0, c.path.lastIndexOf('/')) : '';
      const row = h('div', { className: 'tree-row scm-row', title: c.from ? `${c.from} → ${c.path}` : c.path },
        h('span', { className: 'tree-label' }, basename(c.path)), h('span', { className: 'desc' }, dir),
        action('go-to-file', 'Abrir arquivo', () => Editor.openFile(absOf(c.path))),
        action(staged ? 'remove' : 'add', staged ? 'Remover da área de preparação' : 'Preparar', () => stage([c.path], !staged)), letter);
      row.onclick = () => void diff(c, staged);
      return row;
    });
    return [h('div', { className: 'section-header scm-section' }, `${title} `, h('span', { className: 'badge' }, String(list.length)), h('span', { className: 'spacer' }), all), ...rows];
  };
  $('#scm-body').replaceChildren(
    ...(s.staged.length ? section('Preparadas', s.staged, true) : []),
    ...section('Alterações', s.unstaged, false),
  );
}

// Coalesces bursts (save + focus + command exit) into one `git status`.
export const scheduleRefresh = () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 300); };

async function stage(paths: string[], add: boolean) {
  if (!paths.length) return;
  if (await gitOk(...(add ? ['add', '--'] : ['restore', '--staged', '--']), ...paths)) void refresh();
}

async function diff(c: GitChange, staged: boolean) {
  const show = async (spec: string) => { const r = await git('show', spec); return r.code === 0 ? r.out : ''; };
  // Unstaged: index vs working tree. Staged: HEAD vs index. New/deleted files have an empty side.
  const original = c.status === 'U' || (staged && c.status === 'A') ? '' : await show(staged ? `HEAD:${c.from ?? c.path}` : `:${c.path}`);
  const modified = c.status === 'D' ? '' : staged ? await show(`:${c.path}`) : await api.readFile(absOf(c.path)).catch(() => '');
  Editor.openDiff(`git:${staged ? 'staged' : 'work'}:${c.path}`, `${basename(c.path)} (${staged ? 'preparado' : 'alterações'})`, c.path, original, modified);
}

export async function commit() {
  if (!enabled()) return;
  if (!top) return notify('Esta pasta não é um repositório Git.');
  const box = $('#scm-message') as HTMLTextAreaElement;
  const message = box.value.trim();
  if (!message) { box.focus(); return notify('Escreva a mensagem do commit.'); }
  const s = parseGitStatus((await git('status', '--porcelain=v1', '-b', '-z')).out);
  if (!s.staged.length) return notify('Nada preparado para o commit. Use + nas alterações para preparar.');
  // The message goes through a file: any quotes or newlines survive the Windows shell untouched.
  const file = `${await api.mkTemp()}${ws.sep}COMMIT_MSG`;
  await api.writeFile(file, message + '\n');
  if (await gitOk('commit', '-F', file)) { box.value = ''; notify(`Commit feito em ${branch}.`); }
  void refresh();
}

export async function switchBranch() {
  if (!enabled()) return;
  if (!top) return notify('Esta pasta não é um repositório Git.');
  const list = (await git('branch', '--format=%(refname:short)')).out.split(/\r?\n/).filter(Boolean);
  const go = async (args: string[]) => {
    if (!await gitOk('switch', ...args)) return;
    await Editor.syncFromDisk();
    await refreshWorkspace();
    void refresh();
  };
  quickPick({
    placeholder: `Branch atual: ${branch}. Trocar para…`,
    items: q => [
      { label: 'Criar nova branch…', icon: 'add', run: async () => { const name = await prompt('Nome da nova branch'); if (name) await go(['-c', name]); } },
      ...list.filter(b => b.toLowerCase().includes(q.toLowerCase())).map(b => ({ label: b, icon: b === branch ? 'check' : 'git-branch', description: b === branch ? 'atual' : '', run: () => { if (b !== branch) void go([b]); } })),
    ],
  });
}

// ---------- blame ----------

const ago = (t: number) => {
  const s = Date.now() / 1000 - t;
  const [n, unit] = s < 3600 ? [s / 60, 'min'] : s < 86400 ? [s / 3600, 'h'] : s < 2592000 ? [s / 86400, 'dias'] : s < 31536000 ? [s / 2592000, 'meses'] : [s / 31536000, 'anos'];
  return `há ${Math.max(1, Math.floor(n))} ${unit}`;
};

function paintBlame() {
  const model = Editor.editor.getModel();
  const lines = model && blames.get(model);
  const pos = Editor.editor.getPosition();
  const b = lines && pos ? lines[pos.lineNumber - 1] : undefined;
  blameIds = Editor.editor.deltaDecorations(blameIds, !b || !pos ? [] : [{
    range: new monaco.Range(pos.lineNumber, 1, pos.lineNumber, 1),
    options: {
      isWholeLine: true,
      after: { content: /^0+$/.test(b.hash) ? '   Ainda sem commit' : `   ${b.author}, ${ago(b.time)} • ${b.summary}`, inlineClassName: 'blame-text' },
      hoverMessage: { value: `**${b.summary}**\n\n${b.author} — ${new Date(b.time * 1000).toLocaleString()}\n\n\`${b.hash.slice(0, 8)}\`` },
    },
  }]);
}

export async function toggleBlame() {
  if (!enabled()) return;
  const model = Editor.editor.getModel();
  const path = Editor.active?.path;
  if (!model || !path || Editor.active?.kind !== 'file') return notify('Abra um arquivo para ver o blame.');
  if (blames.delete(model)) return paintBlame();
  if (!top) return notify('Esta pasta não é um repositório Git.');
  const r = await git('blame', '--porcelain', '--', relativeTo(top, path) ?? path);
  if (r.code !== 0) return notify(`Sem blame para ${basename(path)} (arquivo novo ou fora do Git).`, 'error');
  blames.set(model, parseBlame(r.out));
  // Editing shifts lines away from what git blamed; drop the annotations until toggled again.
  const sub = model.onDidChangeContent(() => { blames.delete(model); sub.dispose(); paintBlame(); });
  paintBlame();
}

// ---------- status bar ----------

function renderStatus() {
  const el = $('#sb-branch');
  el.hidden = !branch;
  el.replaceChildren(icon('git-branch'), h('span', {}, branch));
  el.title = 'Trocar branch';
}

export function initGit() {
  $('#scm-actions').replaceChildren(...[
    icon('check', 'Commit (Ctrl+Enter)'), icon('refresh', 'Atualizar'), icon('git-branch', 'Trocar branch'),
  ].map((el, i) => { el.onclick = () => void [commit, refresh, switchBranch][i](); return el; }));
  ($('#scm-message') as HTMLTextAreaElement).onkeydown = e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); void commit(); } };
  Editor.editor.onDidChangeCursorPosition(() => { if (blames.size) paintBlame(); });
  Editor.onDidChange(() => { if (blames.size) paintBlame(); });
  Editor.onDidSave(scheduleRefresh);
  window.addEventListener('focus', scheduleRefresh);
}
