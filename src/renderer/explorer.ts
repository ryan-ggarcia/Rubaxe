// Explorer tree (lazy, re-read on expand) and the file outline below it.
import type * as M from 'monaco-editor';
import { $, api, basename, fileIcon, h, icon, notify, ws } from './dom.ts';
import * as Editor from './editor.ts';
import * as Features from './features.ts';
import * as Lsp from './lsp-client.ts';
import { prompt } from './quick-input.ts';

const SYMBOL_ICONS = ['file', 'module', 'namespace', 'package', 'class', 'method', 'property', 'field', 'constructor', 'enum', 'interface', 'function', 'variable', 'constant', 'string', 'number', 'boolean', 'array', 'object', 'key', 'null', 'enum-member', 'struct', 'event', 'operator', 'type-parameter'];
const expanded = new Set<string>();
let selected = '';
let selectedIsDir = false;

export function initExplorer(openFolder: () => void) {
  const action = (name: string, title: string, run: () => void) => { const el = icon(name, title); el.onclick = run; return el; };
  $('#explorer-actions').replaceChildren(
    action('new-file', 'Novo arquivo', () => newEntry(false)),
    action('new-folder', 'Nova pasta', () => newEntry(true)),
    action('refresh', 'Atualizar', () => renderExplorer()),
    action('collapse-all', 'Recolher tudo', () => { expanded.clear(); renderExplorer(); }),
  );
  $('#explorer-empty-open').onclick = openFolder;
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
      }
    };
    out.push(row);
    if (e.dir && open) out.push(...await nodes(e.path, depth + 1));
  }
  return out;
}

async function newEntry(isDir: boolean) {
  if (!ws.root) return;
  const base = !selected ? ws.root : selectedIsDir ? selected : selected.slice(0, selected.length - basename(selected).length - 1);
  const name = await prompt(`${isDir ? 'Nome da pasta' : 'Nome do arquivo'} em ${basename(base)}/ (use / para subpastas)`);
  if (!name) return;
  const path = base + ws.sep + name.split('/').join(ws.sep);
  try {
    await api.createPath(path, isDir);
  } catch (e) {
    return notify(`Não foi possível criar ${name}: ${(e as Error).message}`, 'error');
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
