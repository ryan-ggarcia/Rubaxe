// Explorer tree (lazy, re-read on expand) and the file outline below it.
import type * as M from 'monaco-editor';
import { $, api, basename, fileIcon, h, icon, notify, ws } from './dom.ts';
import * as Editor from './editor.ts';
import * as Features from './features.ts';
import * as Lsp from './lsp-client.ts';
import { ipcMessage } from './paths.ts';
import { prompt, quickPick } from './quick-input.ts';

const SYMBOL_ICONS = ['file', 'module', 'namespace', 'package', 'class', 'method', 'property', 'field', 'constructor', 'enum', 'interface', 'function', 'variable', 'constant', 'string', 'number', 'boolean', 'array', 'object', 'key', 'null', 'enum-member', 'struct', 'event', 'operator', 'type-parameter'];
const expanded = new Set<string>();
let selected = '';
let selectedIsDir = false;

// A new folder starts with no selection, so "New file" cannot land in the old one.
export function resetExplorer() {
  expanded.clear();
  selected = '';
  selectedIsDir = false;
}

export function initExplorer(openFolder: () => void) {
  const action = (name: string, title: string, run: () => void) => { const el = icon(name, title); el.onclick = run; return el; };
  $('#explorer-actions').replaceChildren(
    action('new-file', 'Novo arquivo', () => newEntry(false)),
    action('new-folder', 'Nova pasta', () => newEntry(true)),
    action('refresh', 'Atualizar', () => void refreshWorkspace()),
    action('collapse-all', 'Recolher tudo', () => { expanded.clear(); renderExplorer(); }),
  );
  $('#explorer-empty-open').onclick = openFolder;
  const tree = $('#explorer-tree');
  tree.tabIndex = 0;
  tree.onkeydown = e => {
    if (!selected || (e.key !== 'F2' && e.key !== 'Delete')) return;
    e.preventDefault();
    void (e.key === 'F2' ? renameEntry(selected) : deleteEntry(selected));
  };
  $('#outline-header').onclick = () => {
    const body = $('#outline');
    body.hidden = !body.hidden;
    $('#outline-header').firstElementChild!.className = `codicon codicon-chevron-${body.hidden ? 'right' : 'down'}`;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  Editor.onDidChange(() => renderOutline());
  monaco.editor.onDidCreateModel(m => m.onDidChangeContent(() => {
    clearTimeout(timer);
    timer = setTimeout(renderOutline, 700);
  }));
}

export async function renderExplorer() {
  $('#explorer-empty').hidden = !!ws.root;
  $('#explorer-actions').hidden = !ws.root;
  $('#explorer-tree').hidden = !ws.root;
  if (!ws.root) return $('#explorer-tree').replaceChildren();
  $('#explorer-title').textContent = basename(ws.root).toUpperCase();
  $('#explorer-tree').replaceChildren(...await nodes(ws.root, 0));
}

async function nodes(dir: string, depth: number): Promise<HTMLElement[]> {
  const entries = await api.readDir(dir).catch(() => []);
  const out: HTMLElement[] = [];
  for (const e of entries) {
    const open = expanded.has(e.path);
    const row = h('div', { className: 'tree-row' + (e.path === selected ? ' selected' : ''), title: e.path },
      h('span', { className: `codicon codicon-${e.dir ? (open ? 'chevron-down' : 'chevron-right') : 'blank'}` }),
      ...(e.dir ? [] : [h('span', { className: `codicon codicon-${fileIcon(e.name)} file-icon` })]),
      h('span', { className: 'tree-label' }, e.name));
    row.style.paddingLeft = `${8 + depth * 12}px`;
    row.onclick = async () => {
      selected = e.path;
      selectedIsDir = e.dir;
      if (e.dir) {
        if (open) expanded.delete(e.path); else expanded.add(e.path);
        await renderExplorer();
      } else {
        document.querySelectorAll('.tree-row.selected').forEach(el => el.classList.remove('selected'));
        row.classList.add('selected');
        await Editor.openFile(e.path);
        $('#explorer-tree').focus(); // like VS Code: single click previews, focus stays for F2/Delete
      }
    };
    if (!e.dir) row.ondblclick = () => Editor.editor.focus();
    row.oncontextmenu = ev => {
      ev.preventDefault();
      selected = e.path;
      selectedIsDir = e.dir;
      document.querySelectorAll('.tree-row.selected').forEach(el => el.classList.remove('selected'));
      row.classList.add('selected');
      quickPick({ placeholder: e.name, items: () => [
        { label: 'Renomear...', description: 'F2', icon: 'edit', run: () => void renameEntry(e.path) },
        { label: 'Mover para a lixeira', description: 'Delete', icon: 'trash', run: () => void deleteEntry(e.path) },
      ] });
    };
    out.push(row);
    if (e.dir && open) out.push(...await nodes(e.path, depth + 1));
  }
  return out;
}

const parentOf = (p: string) => p.slice(0, p.length - basename(p).length - 1);
// Windows paths are case-insensitive, and Monaco's fsPath lowercases the drive letter.
const fold = (p: string) => api.platform === 'win32' ? p.toLowerCase() : p;
const isUnder = (p: string, root: string) => fold(p) === fold(root) || fold(p).startsWith(fold(root) + ws.sep);
const tabsUnder = (root: string) => Editor.tabs.filter(t => t.path && isUnder(t.path, root));

async function renameEntry(from: string) {
  const name = await prompt(`Novo nome para ${basename(from)}`, basename(from));
  if (name && name !== basename(from)) await moveEntry(from, parentOf(from) + ws.sep + name);
}

// Renames/moves a file or folder on disk and keeps tabs, expanded folders and the file index in step.
export async function moveEntry(from: string, to: string): Promise<boolean> {
  // Monaco model URIs are fixed, so open tabs are closed and reopened; dirty ones would lose their edits.
  const affected = tabsUnder(from).sort((a, b) => Number(a === Editor.active) - Number(b === Editor.active));
  if (affected.some(t => t.dirty)) { notify(`Salve os arquivos abertos de ${basename(from)} antes de renomear.`, 'error'); return false; }
  try {
    await api.renamePath(from, to);
  } catch (e) {
    notify(`Não foi possível renomear ${basename(from)}: ${ipcMessage(e)}`, 'error');
    return false;
  }
  for (const p of [...expanded]) if (isUnder(p, from)) { expanded.delete(p); expanded.add(to + p.slice(from.length)); }
  selected = to;
  const reopen = affected.map(t => to + t.path!.slice(from.length));
  affected.forEach(t => Editor.closeTab(t));
  for (const p of reopen) await Editor.openFile(p);
  await refreshFiles();
  await renderExplorer();
  return true;
}

// Re-lists the workspace and tells the Ruby LSP which files appeared or vanished, so its index stays right.
async function refreshFiles() {
  const before = new Set(ws.files);
  ws.files = await api.listFiles(ws.root);
  const after = new Set(ws.files);
  Lsp.filesChanged([...ws.files.filter(f => !before.has(f)).map(f => [f, 1] as const), ...[...before].filter(f => !after.has(f)).map(f => [f, 3] as const)]);
}

// Watcher batch: re-lists files when something appeared or vanished, redraws the folders that are on screen.
export async function syncTree(paths: string[]) {
  if (!ws.root) return;
  const known = new Set(ws.files.map(fold));
  let structural = false;
  for (const p of paths) if (await api.exists(p) !== known.has(fold(p))) { structural = true; break; }
  if (structural) await refreshFiles();
  if (paths.some(p => fold(parentOf(p)) === fold(ws.root) || [...expanded].some(d => fold(d) === fold(parentOf(p))))) await renderExplorer();
}

// After commands that create files (generators): re-list, tell the LSP, redraw.
export async function refreshWorkspace() {
  await refreshFiles();
  await renderExplorer();
}

async function deleteEntry(p: string) {
  if (!confirm(`Mover "${basename(p)}" para a lixeira?`)) return;
  for (const t of tabsUnder(p)) if (!Editor.closeTab(t)) return;
  try {
    await api.trashPath(p);
  } catch (e) {
    return notify(`Não foi possível excluir ${basename(p)}: ${ipcMessage(e)}`, 'error');
  }
  selected = '';
  await refreshFiles();
  await renderExplorer();
}

async function newEntry(isDir: boolean) {
  if (!ws.root) return;
  const base = !selected ? ws.root : selectedIsDir ? selected : parentOf(selected);
  const name = await prompt(`${isDir ? 'Nome da pasta' : 'Nome do arquivo'} em ${basename(base)}/ (use / para subpastas)`);
  if (!name) return;
  const path = base + ws.sep + name.split('/').join(ws.sep);
  try {
    await api.createPath(path, isDir);
  } catch (e) {
    return notify(`Não foi possível criar ${name}: ${ipcMessage(e)}`, 'error');
  }
  expanded.add(base);
  if (isDir) expanded.add(path); else ws.files.push(path);
  await renderExplorer();
  if (!isDir) await Editor.openFile(path);
}

export async function renderOutline() {
  const box = $('#outline');
  const model = Editor.editor?.getModel();
  if (!model || model.getLanguageId() !== 'ruby' || !Features.on('documentSymbols') || !Lsp.isReady()) {
    return box.replaceChildren(h('div', { className: 'empty' }, 'A estrutura aparece para arquivos Ruby com o Ruby LSP ativo.'));
  }
  const symbols = await Lsp.documentSymbols(model);
  if (model !== Editor.editor.getModel()) return; // user switched files while waiting
  const rows: HTMLElement[] = [];
  const walk = (list: M.languages.DocumentSymbol[], depth: number) => list.forEach(s => {
    const row = h('div', { className: 'tree-row' }, h('span', { className: `codicon codicon-symbol-${SYMBOL_ICONS[s.kind] ?? 'misc'}` }), h('span', { className: 'tree-label' }, s.name), h('span', { className: 'desc' }, s.detail));
    row.style.paddingLeft = `${8 + depth * 12}px`;
    row.onclick = () => Editor.reveal(s.selectionRange);
    rows.push(row);
    walk(s.children ?? [], depth + 1);
  });
  walk(symbols, 0);
  box.replaceChildren(...(rows.length ? rows : [h('div', { className: 'empty' }, 'Nenhum símbolo.')]));
}
