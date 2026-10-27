// Explorer tree (lazy, re-read on expand) and the file outline below it.
import type * as M from 'monaco-editor';
import { $, api, basename, h, icon, notify, ws } from './dom.ts';
import * as Editor from './editor.ts';
import * as Features from './features.ts';
import { fileSvg, folderSvg } from './file-icons.ts';
import * as Lsp from './lsp-client.ts';
import { dropPlan, ipcMessage, outermost, rangeBetween } from './paths.ts';
import { prompt, quickPick } from './quick-input.ts';

const SYMBOL_ICONS = ['file', 'module', 'namespace', 'package', 'class', 'method', 'property', 'field', 'constructor', 'enum', 'interface', 'function', 'variable', 'constant', 'string', 'number', 'boolean', 'array', 'object', 'key', 'null', 'enum-member', 'struct', 'event', 'operator', 'type-parameter'];
const expanded = new Set<string>();
let selected = ''; // last clicked: anchor of Shift+click and base of "New file"
let selectedIsDir = false;
const picked = new Set<string>(); // the highlighted rows (Ctrl/Shift+click select many)
let dragged: string[] = [];

// A new folder starts with no selection, so "New file" cannot land in the old one.
export function resetExplorer() {
  expanded.clear();
  picked.clear();
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
  // Click on the empty area clears the selection, so "New file/folder" targets the project root again.
  tree.onclick = ev => {
    if ((ev.target as HTMLElement).closest('.tree-row')) return;
    selected = '';
    selectedIsDir = false;
    picked.clear();
    paintSelection();
  };
  tree.onkeydown = e => {
    const many = chosen();
    if (!many.length || (e.key !== 'F2' && e.key !== 'Delete')) return;
    e.preventDefault();
    if (e.key === 'Delete') void deleteEntries(many);
    else if (many.length === 1) void renameEntry(many[0]);
  };
  // Drop on a folder moves into it, on a file into its folder, on the empty area into the project root.
  const destOf = (ev: DragEvent) => {
    const row = (ev.target as HTMLElement).closest<HTMLElement>('.tree-row');
    return !row ? ws.root : row.dataset.dir ? row.dataset.path! : parentOf(row.dataset.path!);
  };
  const mark = (dest?: string) => {
    tree.classList.remove('drop-target');
    tree.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
    if (dest !== undefined) (fold(dest) === fold(ws.root) ? tree : rows().find(r => r.dataset.path === dest))?.classList.add('drop-target');
  };
  const planOf = (ev: DragEvent) => dragged.length ? dropPlan(dragged, destOf(ev), ws.sep, api.platform === 'win32') : undefined;
  tree.ondragover = ev => {
    if (!dragged.length) return; // files dragged in from outside the app
    if (!planOf(ev)) { ev.dataTransfer!.dropEffect = 'none'; return mark(); }
    ev.preventDefault();
    ev.dataTransfer!.dropEffect = 'move';
    mark(destOf(ev));
  };
  tree.ondragleave = ev => { if (!tree.contains(ev.relatedTarget as Node)) mark(); };
  tree.ondragend = () => { mark(); dragged = []; };
  tree.ondrop = ev => {
    ev.preventDefault();
    mark();
    const plan = planOf(ev);
    dragged = [];
    if (plan) void moveInto(plan, destOf(ev));
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
    const row = h('div', { className: 'tree-row' + (picked.has(e.path) ? ' selected' : ''), title: e.path, draggable: true },
      h('span', { className: `codicon codicon-${e.dir ? (open ? 'chevron-down' : 'chevron-right') : 'blank'}` }),
      e.dir ? folderSvg(open) : fileSvg(e.path),
      h('span', { className: 'tree-label' }, e.name));
    row.style.paddingLeft = `${6 + depth * 14}px`;
    row.setAttribute('role', 'treeitem');
    row.dataset.path = e.path;
    if (e.dir) row.dataset.dir = '1';
    row.onclick = async ev => {
      const toggle = api.platform === 'darwin' ? ev.metaKey : ev.ctrlKey;
      if (ev.shiftKey) {
        if (!toggle) picked.clear();
        rangeBetween(rows().map(r => r.dataset.path!), selected, e.path).forEach(p => picked.add(p));
        return paintSelection();
      }
      selected = e.path;
      selectedIsDir = e.dir;
      if (toggle) {
        if (!picked.delete(e.path)) picked.add(e.path);
        return paintSelection();
      }
      picked.clear();
      picked.add(e.path);
      if (e.dir) {
        if (open) expanded.delete(e.path); else expanded.add(e.path);
        await renderExplorer();
      } else {
        paintSelection();
        await Editor.openFile(e.path);
        $('#explorer-tree').focus(); // like VS Code: single click previews, focus stays for F2/Delete
      }
    };
    if (!e.dir) row.ondblclick = () => Editor.editor.focus();
    row.oncontextmenu = ev => {
      ev.preventDefault();
      if (!picked.has(e.path)) {
        selected = e.path;
        selectedIsDir = e.dir;
        picked.clear();
        picked.add(e.path);
        paintSelection();
      }
      const many = chosen();
      quickPick({ placeholder: many.length > 1 ? `${many.length} itens selecionados` : e.name, items: () => [
        { label: 'Renomear...', description: many.length > 1 ? 'um item por vez' : 'F2', icon: 'edit', disabled: many.length > 1, run: () => void renameEntry(e.path) },
        { label: many.length > 1 ? `Mover ${many.length} itens para a lixeira` : 'Mover para a lixeira', description: 'Delete', icon: 'trash', run: () => void deleteEntries(many) },
      ] });
    };
    row.ondragstart = ev => {
      if (!picked.has(e.path)) { selected = e.path; selectedIsDir = e.dir; picked.clear(); picked.add(e.path); paintSelection(); }
      dragged = chosen();
      ev.dataTransfer!.effectAllowed = 'move';
      ev.dataTransfer!.setData('text/plain', dragged.join('\n'));
    };
    out.push(row);
    if (e.dir && open) out.push(...await nodes(e.path, depth + 1));
  }
  return out;
}

const rows = () => [...$('#explorer-tree').querySelectorAll<HTMLElement>('.tree-row')];
// What is on screen and highlighted: a selection hidden by collapsing its folder is never deleted or moved.
const chosen = () => rows().map(r => r.dataset.path!).filter(p => picked.has(p));
const paintSelection = () => rows().forEach(r => r.classList.toggle('selected', picked.has(r.dataset.path!)));

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
  for (const set of [expanded, picked]) for (const p of [...set]) if (isUnder(p, from)) { set.delete(p); set.add(to + p.slice(from.length)); }
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

// Drag and drop: a name already in dest is replaced only on an explicit yes, and the old item goes to the Recycle Bin.
async function moveInto(paths: string[], dest: string) {
  for (const p of paths) {
    const to = dest + ws.sep + basename(p);
    if (await api.exists(to)) {
      if (!confirm(`"${basename(p)}" já existe em ${basename(dest)}. Substituir?`)) continue;
      if (tabsUnder(to).some(t => t.dirty)) { notify(`Salve os arquivos abertos de ${basename(to)} antes de substituí-lo.`, 'error'); continue; }
      try {
        if (!await api.trashPath(to)) { notify(`A Lixeira não aceita "${basename(to)}" neste local. Nada foi substituído.`, 'error'); continue; }
      } catch (e) {
        notify(`Não foi possível substituir ${basename(to)}: ${ipcMessage(e)}`, 'error');
        continue;
      }
      for (const t of tabsUnder(to)) Editor.closeTab(t, true);
    }
    await moveEntry(p, to);
  }
}

async function deleteEntries(list: string[]) {
  const paths = outermost(list, ws.sep, api.platform === 'win32');
  if (!paths.length || !confirm(paths.length === 1 ? `Mover "${basename(paths[0])}" para a lixeira?` : `Mover ${paths.length} itens para a Lixeira?`)) return;
  const dirty = paths.flatMap(tabsUnder).filter(t => t.dirty);
  if (dirty.length && !confirm(`${dirty.map(t => `"${t.title}"`).join(', ')} tem alterações não salvas. Excluir e descartar as alterações?`)) return;
  let done = 0, busy = 0, failed = 0, kept = 0;
  for (const p of paths) {
    try {
      // The Recycle Bin refused (network drive, disabled): permanent delete only on explicit yes; Cancel is the first item.
      if (!await api.trashPath(p)) {
        if (!await new Promise<boolean>(ok => quickPick({
          placeholder: `A Lixeira não aceita "${basename(p)}" neste local (unidade de rede ou Lixeira desativada). Excluir definitivamente? Isso não pode ser desfeito.`,
          items: () => [{ label: 'Cancelar', icon: 'close', run: () => ok(false) }, { label: 'Excluir definitivamente', icon: 'trash', run: () => ok(true) }],
          onDismiss: () => ok(false),
        }))) { kept++; continue; }
        await api.deletePath(p);
      }
      for (const t of tabsUnder(p)) Editor.closeTab(t, true); // only now: a refused or failed delete keeps unsaved text
      done++;
    } catch (e) {
      const message = ipcMessage(e);
      if (message.includes('em uso')) busy++; else failed++;
      notify(`Não foi possível excluir ${basename(p)}: ${message}`, 'error');
    }
  }
  picked.clear();
  selected = '';
  await refreshFiles();
  await renderExplorer();
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (paths.length > 1) notify([plural(done, 'excluído'), busy && `${busy} em uso`, failed && `${failed} com erro`, kept && plural(kept, 'mantido')].filter(Boolean).join(', '), done === paths.length ? 'success' : 'info');
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
