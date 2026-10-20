// Type hierarchy and callers of the symbol under the cursor, shown in the quick pick.
import { notify, ws } from './dom.ts';
import * as Editor from './editor.ts';
import * as Lsp from './lsp-client.ts';
import { relativeTo } from './paths.ts';
import { quickPick, type QuickItem } from './quick-input.ts';

const where = (uri: string, line: number) => `${relativeTo(ws.root, monaco.Uri.parse(uri).fsPath) ?? monaco.Uri.parse(uri).fsPath}:${line}`;
const open = (uri: string, line: number) => () => void Editor.openUri(monaco.Uri.parse(uri), { lineNumber: line, column: 1 });

function target() {
  const model = Editor.editor.getModel();
  const position = Editor.editor.getPosition();
  if (!model || !position || model.getLanguageId() !== 'ruby') return void notify('Posicione o cursor em uma classe, módulo ou método Ruby.');
  if (!Lsp.isReady()) return void notify('O Ruby LSP ainda não está pronto.');
  return { model, position };
}

export async function showTypeHierarchy() {
  const t = target();
  if (!t) return;
  const h = await Lsp.typeHierarchy(t.model, t.position);
  if (!h) return notify('Nenhuma classe ou módulo sob o cursor.');
  const items: QuickItem[] = [];
  const line = (i: { range: { start: { line: number } }; selectionRange?: { start: { line: number } } }) => (i.selectionRange ?? i.range).start.line + 1;
  // Ancestors first, farthest at the top, each level indented one step closer to the class.
  const flat: { name: string; uri: string; line: number; depth: number }[] = [];
  const seen = new Set<string>(); // Kernel and friends are reached through several ancestors; list each once
  const walk = (nodes: Lsp.TypeNode[], depth: number) => nodes.forEach(n => {
    walk(n.parents, depth + 1);
    if (!seen.has(n.item.name)) { seen.add(n.item.name); flat.push({ name: n.item.name, uri: n.item.uri, line: line(n.item), depth }); }
  });
  walk(h.supers, 1);
  const maxDepth = Math.max(0, ...flat.map(f => f.depth));
  for (const f of flat) items.push({ label: `${'  '.repeat(maxDepth - f.depth)}${f.name}`, description: `superior · ${where(f.uri, f.line)}`, icon: 'arrow-up', run: open(f.uri, f.line) });
  items.push({ label: `${'  '.repeat(maxDepth)}${h.root.name}`, description: `selecionado · ${where(h.root.uri, line(h.root))}`, icon: 'symbol-class', run: open(h.root.uri, line(h.root)) });
  for (const s of h.subs) items.push({ label: `${'  '.repeat(maxDepth + 1)}${s.name}`, description: `subtipo · ${where(s.uri, line(s))}`, icon: 'arrow-down', run: open(s.uri, line(s)) });
  quickPick({ placeholder: `Hierarquia de tipos de ${h.root.name}`, items: q => items.filter(i => i.label.toLowerCase().includes(q.toLowerCase())) });
}

export async function showCallers() {
  const t = target();
  if (!t) return;
  notify('Procurando chamadas…');
  const list = await Lsp.callers(t.model, t.position);
  if (!list.length) return notify('Nenhuma chamada encontrada no projeto.');
  const word = t.model.getWordAtPosition(t.position)?.word ?? '';
  quickPick({
    placeholder: `${list.length} chamada(s) de ${word}`,
    items: q => list.filter(c => `${c.name} ${where(c.uri, c.line)}`.toLowerCase().includes(q.toLowerCase()))
      .map(c => ({ label: c.name, description: where(c.uri, c.line), icon: 'symbol-method', run: open(c.uri, c.line) })),
  });
}
