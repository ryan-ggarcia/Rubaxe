import type { RubaxeApi } from '../main/preload.ts';

export const api = (window as unknown as { rubaxe: RubaxeApi }).rubaxe;

// Explicit return type: Object.assign's Element & Partial<Element> intersection blows up type narrowing in TS 7.
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const el: HTMLElementTagNameMap[K] = Object.assign(document.createElement(tag), props);
  el.append(...kids);
  return el;
}

export const icon = (name: string, title = '') => h('span', { className: `codicon codicon-${name}`, title });

export function fileIcon(name: string): string {
  if (/\.(rb|rake|gemspec|ru)$|^(Gemfile|Rakefile)$/.test(name)) return 'ruby';
  if (/\.json$/.test(name)) return 'json';
  if (/\.md$/.test(name)) return 'markdown';
  if (/\.ya?ml$/.test(name)) return 'settings';
  return 'file';
}

export const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

export function $(selector: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing element ${selector}`);
  return el;
}

export function notify(message: string, kind: 'info' | 'error' = 'info') {
  const toast = h('div', { className: `toast ${kind}` }, icon(kind === 'error' ? 'error' : 'info'), h('span', {}, message));
  $('#toasts').append(toast);
  setTimeout(() => toast.remove(), kind === 'error' ? 8000 : 4000);
}

// Shared workspace state; root is '' until a folder is open.
export const ws = { root: '', files: [] as string[], hasGemfile: false, sep: api.platform === 'win32' ? '\\' : '/' };
export const abs = (rel: string) => ws.root + ws.sep + rel.split('/').join(ws.sep);
