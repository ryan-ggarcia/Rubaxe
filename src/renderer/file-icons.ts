// Own flat SVG icons for the explorer and tabs (colors come from --ic-* variables in style.css).
import { fileKind } from './paths.ts';
import { h } from './dom.ts';

const svg = (body: string) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${body}</svg>`;
const page = (cls: string) => `<path class="${cls}" d="M3.5 1.5h6l3 3v9a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" opacity=".22"/><path class="s ${cls}" d="M3.5 1.5h6l3 3v9a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM9.5 1.5v3h3"/>`;
const badge = (cls: string, text: string) => `<rect class="${cls}" x="1.5" y="1.5" width="13" height="13" rx="3.5"/><text x="8" y="11.2" text-anchor="middle" font-size="7.5" font-weight="700" font-family="Segoe UI, system-ui, sans-serif" class="ic-ink">${text}</text>`;

const ICONS: Record<ReturnType<typeof fileKind>, string> = {
  ruby: svg('<path class="ic-ruby" d="M5 2h6l3 4-6 8-6-8z"/><path class="ic-ink-soft" d="M2 6h12M5 2l3 4 3-4M8 6v8" fill="none" stroke-width=".8"/>'),
  erb: svg(page('ic-erb') + '<path class="s ic-erb" d="M6.2 7 4.8 8.5 6.2 10M9.8 7l1.4 1.5L9.8 10"/>'),
  yaml: svg(page('ic-yaml') + '<path class="s ic-yaml" d="M5.5 7h.01M5.5 9.5h.01M5.5 12h.01M7.5 7h3M7.5 9.5h3M7.5 12h2"/>'),
  json: svg(page('ic-json') + '<path class="s ic-json" d="M6.3 6.5c-.8 0-.8.6-.8 1.2s-.4.8-.8.8c.4 0 .8.2.8.8s0 1.2.8 1.2M9.7 6.5c.8 0 .8.6.8 1.2s.4.8.8.8c-.4 0-.8.2-.8.8s0 1.2-.8 1.2"/>'),
  lock: svg('<rect class="ic-lock" x="3" y="7" width="10" height="7" rx="2"/><path class="s ic-lock" d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/><circle class="ic-ink" cx="8" cy="10.4" r="1"/>'),
  md: svg('<rect class="s ic-md" x="1.5" y="3" width="13" height="10" rx="2.5"/><path class="s ic-md" d="M4 10.5v-5l2 2.5 2-2.5v5M11 5.5v5M9.5 9l1.5 1.5L12.5 9"/>'),
  js: svg(badge('ic-js', 'JS')),
  ts: svg(badge('ic-ts', 'TS')),
  css: svg(badge('ic-css', '#')),
  html: svg(page('ic-html') + '<path class="s ic-html" d="M6.2 7 4.8 8.5 6.2 10M9.8 7l1.4 1.5L9.8 10M8.6 6.5 7.4 10.5"/>'),
  file: svg(page('ic-file')),
};

const FOLDER = svg('<path class="fd-back" d="M1.5 4.5a1.8 1.8 0 0 1 1.8-1.8h2.7l1.5 1.6h4.7a1.8 1.8 0 0 1 1.8 1.8v6.2a1.8 1.8 0 0 1-1.8 1.8H3.3a1.8 1.8 0 0 1-1.8-1.8z"/><path class="fd-front" d="M1.5 6.6a1.5 1.5 0 0 1 1.5-1.5h10a1.5 1.5 0 0 1 1.5 1.5v5.7a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5z"/>');
const FOLDER_OPEN = svg('<path class="fd-back" d="M1.5 4.5a1.8 1.8 0 0 1 1.8-1.8h2.7l1.5 1.6h4.7a1.8 1.8 0 0 1 1.8 1.8v1H1.5z"/><path class="fd-front" d="M3.2 6.8a1.5 1.5 0 0 1 1.4-1h9.2c1 0 1.7 1 1.4 1.9l-1.2 4.9a1.5 1.5 0 0 1-1.4 1.1H3.3a1.8 1.8 0 0 1-1.8-1.8z"/>');

export const fileSvg = (name: string) => h('span', { className: 'ficon', innerHTML: ICONS[fileKind(name)] });
export const folderSvg = (open: boolean) => h('span', { className: 'ficon', innerHTML: open ? FOLDER_OPEN : FOLDER });
