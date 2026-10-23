// Own flat SVG icons for the explorer and tabs (colors come from --ic-* variables in style.css).
import { fileKind, relativeTo } from './paths.ts';
import { h, ws } from './dom.ts';

const svg = (body: string) => `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">${body}</svg>`;
const page = (cls: string) => `<path class="${cls}" d="M3.5 1.5h6l3 3v9a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" opacity=".22"/><path class="s ${cls}" d="M3.5 1.5h6l3 3v9a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1zM9.5 1.5v3h3"/>`;
const badge = (cls: string, text: string) => `<rect class="${cls}" x="1.5" y="1.5" width="13" height="13" rx="3.5"/><text x="8" y="11.2" text-anchor="middle" font-size="7.5" font-weight="700" font-family="Segoe UI, system-ui, sans-serif" class="ic-ink">${text}</text>`;

// Faceted gem lit from the top left; `t` places it (SVG transform).
const gem = (t = '') => `<g transform="${t}"><path class="ic-ruby-hi" d="M4.5 2 5.5 6H1z"/><path class="ic-ruby-top" d="M4.5 2h7l-1 4h-5z"/><path class="ic-ruby" d="M11.5 2 15 6h-4.5zM1 6h4.5L8 14.5z"/><path class="ic-ruby-hi" d="M5.5 6h5L8 14.5z"/><path class="ic-ruby-lo" d="M10.5 6H15l-7 8.5z"/><path class="ic-shine" d="M5.4 2.7h2.2L6.5 4.6z"/></g>`;
// Small role mark over the gem's lower right corner (controller, helper, model).
const mark = (cls: string, glyph: string) => svg(gem() + `<circle class="${cls}" cx="12.3" cy="12.3" r="3.5"/><path class="ic-ink" d="${glyph}"/>`);
const CUBE = '<path class="ic-ruby-top" d="M8 1.5 14 4.8 8 8.1 2 4.8z"/><path class="ic-ruby" d="M2 4.8 8 8.1v6.4L2 11.2z"/><path class="ic-ruby-lo" d="M14 4.8 8 8.1v6.4l6-3.3z"/>';

const ICONS: Record<ReturnType<typeof fileKind>, string> = {
  ruby: svg(gem()),
  erb: svg(gem('translate(8 8.3) scale(.56) translate(-8 -8.25)') + '<path class="s ic-erb" d="M3.4 4.6 1 8.3l2.4 3.7M12.6 4.6 15 8.3l-2.4 3.7"/>'),
  controller: mark('ic-ts', 'M11.2 10.6v3.4l2.9-1.7z'),
  helper: mark('ic-yaml', 'M11.8 10.5h1v1.3h1.3v1h-1.3v1.3h-1v-1.3h-1.3v-1h1.3z'),
  model: mark('ic-db', 'M10.8 10.8h3v3h-3z'),
  routes: svg('<path class="s ic-ruby" d="M3.5 12.5H9a2 2 0 0 0 0-4H6a2 2 0 0 1 0-4h4.5"/><circle class="ic-ruby" cx="3.5" cy="12.5" r="1.9"/><path class="ic-ruby" d="M12 1a2.8 2.8 0 0 1 2.8 2.8c0 2-2.8 4.4-2.8 4.4S9.2 5.8 9.2 3.8A2.8 2.8 0 0 1 12 1z"/><circle class="ic-shine" cx="12" cy="3.8" r="1"/>'),
  schema: svg('<rect class="ic-db" x="1.5" y="2.5" width="13" height="11" rx="2" opacity=".22"/><path class="ic-db" d="M3.5 2.5h9a2 2 0 0 1 2 2V6h-13V4.5a2 2 0 0 1 2-2z"/><rect class="s ic-db" x="1.5" y="2.5" width="13" height="11" rx="2"/><path class="s ic-db" d="M1.5 9.7h13M6.2 6v7.5"/>'),
  migration: svg('<circle class="ic-ruby" cx="8" cy="8.3" r="5.4" opacity=".2"/><path class="s ic-ruby" d="M2.6 8.3a5.4 5.4 0 1 0 1.6-3.8M3.9 1.9v2.8h2.8M8 5.3v3.2l2.2 1.4"/>'),
  database: svg('<path class="ic-db" opacity=".22" d="M2.5 4v8c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V4"/><path class="s ic-db" d="M2.5 4v8c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V4M2.5 8c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5"/><ellipse class="ic-db" cx="8" cy="4" rx="5.5" ry="2.5"/>'),
  gemfile: svg(CUBE),
  gemlock: svg(`<g transform="scale(.85)">${CUBE}</g><rect class="ic-lock" x="9.5" y="10.3" width="6" height="4.7" rx="1.2"/><path class="s ic-lock" d="M10.9 10.3V9.4a1.6 1.6 0 0 1 3.2 0v.9"/>`),
  rake: svg('<path class="ic-ruby" d="M3.5 2.3 5.2 4 3.5 5.7 1.8 4zM3.5 6.3 5.2 8 3.5 9.7 1.8 8zM3.5 10.3 5.2 12l-1.7 1.7L1.8 12z"/><path class="s ic-ruby-hi" d="M7 4h7M7 8h7M7 12h5"/>'),
  rack: svg('<path class="ic-ruby-lo" d="M8 8.5 14.5 11 8 13.5 1.5 11z"/><path class="ic-ruby" d="M8 5.5 14.5 8 8 10.5 1.5 8z"/><path class="ic-ruby-top" d="M8 2.5 14.5 5 8 7.5 1.5 5z"/>'),
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

// `path`: absolute or a bare name; Rails roles are read from the part under the open folder.
export const fileSvg = (path: string) => h('span', { className: 'ficon', innerHTML: ICONS[fileKind(relativeTo(ws.root, path) ?? path)] });
export const folderSvg = (open: boolean) => h('span', { className: 'ficon', innerHTML: open ? FOLDER_OPEN : FOLDER });
