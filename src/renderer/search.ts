// Project-wide text search view (Ctrl+Shift+F).
import { $, api, fileIcon, h, ws } from './dom.ts';
import * as Editor from './editor.ts';
import { ipcMessage, relativeTo } from './paths.ts';

const opts = { regex: false, caseSensitive: false };

export function initSearch() {
  const input = $('#search-input') as HTMLInputElement;
  input.onkeydown = e => { if (e.key === 'Enter') run(); };
  const toggle = (id: string, key: keyof typeof opts) => {
    const el = $(id);
    el.onclick = () => { opts[key] = !opts[key]; el.classList.toggle('on', opts[key]); run(); };
  };
  toggle('#search-regex', 'regex');
  toggle('#search-case', 'caseSensitive');
}

export function focusSearch() {
  const input = $('#search-input') as HTMLInputElement;
  const selection = Editor.editor?.getModel() && Editor.editor.getModel()!.getValueInRange(Editor.editor.getSelection()!);
  if (selection && !selection.includes('\n')) input.value = selection;
  input.focus();
  input.select();
}

async function run() {
  const query = ($('#search-input') as HTMLInputElement).value;
  const results = $('#search-results');
  if (!ws.root || !query) return results.replaceChildren();
  results.replaceChildren(h('div', { className: 'empty' }, 'Pesquisando…'));
  let hits;
  try {
    hits = await api.search(ws.root, query, opts);
  } catch (e) {
    return results.replaceChildren(h('div', { className: 'empty error' }, ipcMessage(e)));
  }
  const byFile = Map.groupBy(hits, hit => hit.file);
  const rows: HTMLElement[] = [h('div', { className: 'empty' }, `${hits.length}${hits.length >= 2000 ? '+' : ''} resultado(s) em ${byFile.size} arquivo(s)`)];
  for (const [file, list] of byFile) {
    const rel = relativeTo(ws.root, file) ?? file;
    rows.push(h('div', { className: 'tree-row search-file', title: file }, h('span', { className: `codicon codicon-${fileIcon(rel)}` }),
      h('span', { className: 'tree-label' }, rel.split('/').pop()!), h('span', { className: 'desc' }, rel), h('span', { className: 'badge' }, String(list.length))));
    for (const hit of list) {
      const start = hit.col - 1, text = hit.text;
      const pre = text.slice(Math.max(0, start - 30), start).trimStart();
      const row = h('div', { className: 'tree-row search-hit' },
        h('span', { className: 'tree-label' }, pre, h('mark', {}, text.slice(start, start + hit.len)), text.slice(start + hit.len)));
      row.onclick = () => Editor.openFile(file, { startLineNumber: hit.line, startColumn: hit.col, endLineNumber: hit.line, endColumn: hit.col + hit.len });
      rows.push(row);
    }
  }
  results.replaceChildren(...rows);
}
