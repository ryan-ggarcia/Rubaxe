// Markdown preview tab: marked (GFM) -> DOMPurify -> DOM. Code blocks are colored by Monaco, links handled by the IDE.
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { $, api, basename, h, icon, ws } from './dom.ts';
import * as Editor from './editor.ts';
import { fileUrl, headingSlugs, mdTarget } from './paths.ts';

// The renderer holds window.rubaxe, so this is a security boundary: nothing that runs or loads on its own gets in,
// and no style that could draw over the IDE. HTML only (SVG can load resources by itself). Named ids get a
// user-content- prefix so they never shadow ours (#toasts…).
const PURIFY = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'style', 'button', 'textarea', 'select', 'option'],
  FORBID_ATTR: ['style', 'popover', 'commandfor', 'contenteditable'],
  SANITIZE_NAMED_PROPS: true,
};
// Nothing fetches by itself: CSP 'self' still lets file://host (a UNC share, which leaks Windows credentials) through.
// Image sources are moved aside inside DOMPurify's inert document; render() loads them only after mdTarget resolved them.
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'IMG') node.setAttribute('data-src', node.getAttribute('src') ?? '');
  for (const attr of ['src', 'srcset', 'poster', 'background']) node.removeAttribute(attr);
  // No editable fields: only GFM task checkboxes stay, always disabled.
  if (node.tagName === 'INPUT') {
    if (node.getAttribute('type')?.toLowerCase() === 'checkbox') node.setAttribute('disabled', '');
    else node.remove();
  }
});

const langId = (name: string) => monaco.languages.getLanguages().find(l => l.id === name || l.aliases?.some(a => a.toLowerCase() === name) || l.extensions?.includes('.' + name))?.id;

export async function render(tab: Editor.Tab, page: HTMLElement) {
  const md = tab.path!;
  const text = monaco.editor.getModel(monaco.Uri.file(md))?.getValue() ?? await api.readFile(md).catch(() => '');
  if (Editor.active !== tab) return; // the disk read is async: another tab may own the page by now
  const body = h('div', { className: 'markdown-body' });
  body.innerHTML = DOMPurify.sanitize(marked.parse(text, { gfm: true, async: false }), PURIFY);

  const heads = [...body.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')];
  headingSlugs(heads.map(x => x.textContent ?? '')).forEach((slug, i) => { heads[i].dataset.anchor = slug; });
  for (const img of body.querySelectorAll('img')) {
    const src = img.dataset.src ?? '', target = mdTarget(src, md, ws.root);
    // shortcut: web images stay a placeholder (CSP img-src is 'self' data:), loading them would need the CSP or the main process.
    const missing = () => img.replaceWith(h('span', { className: 'md-img-missing', title: src }, icon('file-media'), basename(src) || img.alt || 'imagem'));
    if (target && 'path' in target) { img.onerror = missing; img.src = fileUrl(target.path); } else missing();
  }
  body.onclick = e => {
    const a = (e.target as Element).closest('a');
    if (!a) return;
    e.preventDefault();
    const target = mdTarget(a.getAttribute('href') ?? '', md, ws.root);
    if (!target) return;
    if ('url' in target) window.open(target.url); // the main process opens http(s) in the browser and denies the window
    else if ('path' in target) void Editor.openFile(target.path);
    else body.querySelector(`[data-anchor="${CSS.escape(target.anchor.toLowerCase())}"], [id="user-content-${CSS.escape(target.anchor)}"]`)?.scrollIntoView();
  };
  page.replaceChildren(body);
  page.scrollTop = tab.scroll ?? 0;

  for (const code of body.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
    const id = langId(/language-(\S+)/.exec(code.className)![1].toLowerCase());
    // colorize escapes the text itself, so its HTML is safe to insert.
    if (id) code.innerHTML = await monaco.editor.colorize((code.textContent ?? '').replace(/\n$/, ''), id, { tabSize: 2 });
  }
}

// Live update: edits (or a reload from disk) of the previewed file re-render it 200 ms after the last change.
let timer: ReturnType<typeof setTimeout> | undefined;
export function initPreview() {
  monaco.editor.onDidCreateModel(model => model.onDidChangeContent(() => {
    const tab = Editor.active;
    if (tab?.kind !== 'preview' || tab.path !== model.uri.fsPath) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (Editor.active !== tab) return;
      tab.scroll = $('#preview-page').scrollTop;
      void render(tab, $('#preview-page'));
    }, 200);
  }));
}
