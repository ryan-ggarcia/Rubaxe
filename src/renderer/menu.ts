// Application menu bar in the title bar (File, Edit, ...): click opens, hover switches, arrows/Enter/Esc drive it.
import { $, h } from './dom.ts';

export interface MenuItem { label: string; key?: string; run: () => void }
export type Menu = [title: string, items: (MenuItem | null)[]]; // null = separator

export function initMenubar(menus: Menu[]) {
  const bar = $('#menubar');
  let openIdx = -1, sel = -1;
  let popup: HTMLElement | undefined;
  let rows: (HTMLElement | undefined)[] = [];
  const titles = menus.map(([title]) => h('div', { className: 'menu-title', role: 'menuitem', textContent: title }));
  titles.forEach(t => t.setAttribute('aria-haspopup', 'true'));

  const close = () => {
    popup?.remove();
    popup = undefined;
    if (openIdx >= 0) titles[openIdx].classList.remove('open');
    titles.forEach(t => t.setAttribute('aria-expanded', 'false'));
    openIdx = sel = -1;
  };
  const select = (i: number) => {
    rows[sel]?.classList.remove('selected');
    sel = i;
    rows[i]?.classList.add('selected');
  };
  const choose = (item: MenuItem) => { close(); item.run(); };
  const open = (i: number) => {
    close();
    openIdx = i;
    titles[i].classList.add('open');
    titles[i].setAttribute('aria-expanded', 'true');
    const items = menus[i][1];
    rows = items.map(item => {
      if (!item) return undefined;
      const row = h('div', { className: 'menu-item', role: 'menuitem' }, h('span', { className: 'label' }, item.label), h('span', { className: 'desc' }, item.key ?? ''));
      row.onmouseenter = () => select(rows.indexOf(row));
      row.onclick = () => choose(item);
      return row;
    });
    popup = h('div', { className: 'menu-popup', role: 'menu' }, ...items.map((_, j) => rows[j] ?? h('div', { className: 'menu-sep', role: 'separator' })));
    const r = titles[i].getBoundingClientRect();
    popup.style.left = `${r.left}px`;
    popup.style.top = `${r.bottom}px`;
    document.body.append(popup);
  };

  titles.forEach((t, i) => {
    t.onclick = () => openIdx === i ? close() : open(i);
    t.onmouseenter = () => { if (openIdx >= 0 && openIdx !== i) open(i); };
  });
  bar.replaceChildren(...titles);

  window.addEventListener('mousedown', e => {
    if (openIdx >= 0 && !bar.contains(e.target as Node) && !popup?.contains(e.target as Node)) close();
  }, true);
  window.addEventListener('blur', close);
  window.addEventListener('keydown', e => {
    if (openIdx < 0) return;
    const items = menus[openIdx][1];
    const step = (d: number) => {
      for (let n = 1; n <= items.length; n++) {
        const j = (((sel < 0 ? (d > 0 ? -1 : 0) : sel) + d * n) % items.length + items.length) % items.length;
        if (items[j]) return select(j);
      }
    };
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown') step(1);
    else if (e.key === 'ArrowUp') step(-1);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') open((openIdx + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length);
    else if (e.key === 'Enter') { const item = items[sel]; if (item) choose(item); else return; }
    else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}
