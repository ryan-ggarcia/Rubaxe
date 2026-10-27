// Application menu behind the title bar's hamburger button: a list of menus (File, Edit, ...); hover/click opens one to the side, arrows/Enter/Esc drive it.
import { $, h } from './dom.ts';

export interface MenuItem { label: string; key?: string; run: () => void }
export type Menu = [title: string, items: (MenuItem | null)[]]; // null = separator

export function initMenubar(menus: Menu[], button: HTMLElement) {
  const bar = $('#menubar');
  let openIdx = -1, sel = -1, inSub = false; // inSub: keyboard focus is in the submenu, not on the menu list
  let popup: HTMLElement | undefined;
  let rows: (HTMLElement | undefined)[] = [];
  const titles = menus.map(([title]) => h('div', { className: 'menu-title', role: 'menuitem', textContent: title }));
  titles.forEach(t => t.setAttribute('aria-haspopup', 'true'));

  const closeAll = () => {
    closeSub();
    bar.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  const closeSub = () => {
    popup?.remove();
    popup = undefined;
    if (openIdx >= 0) titles[openIdx].classList.remove('open');
    titles.forEach(t => t.setAttribute('aria-expanded', 'false'));
    openIdx = sel = -1;
    inSub = false;
  };
  const select = (i: number) => {
    rows[sel]?.classList.remove('selected');
    sel = i;
    rows[i]?.classList.add('selected');
  };
  const choose = (item: MenuItem) => { closeAll(); item.run(); };
  const open = (i: number) => {
    closeSub();
    openIdx = i;
    titles[i].classList.add('open');
    titles[i].setAttribute('aria-expanded', 'true');
    const items = menus[i][1];
    rows = items.map(item => {
      if (!item) return undefined;
      const row = h('div', { className: 'menu-item', role: 'menuitem' }, h('span', { className: 'label' }, item.label), h('span', { className: 'desc' }, item.key ?? ''));
      row.onmouseenter = () => { inSub = true; select(rows.indexOf(row)); };
      row.onclick = () => choose(item);
      return row;
    });
    popup = h('div', { className: 'menu-popup', role: 'menu' }, ...items.map((_, j) => rows[j] ?? h('div', { className: 'menu-sep', role: 'separator' })));
    const r = titles[i].getBoundingClientRect();
    popup.style.left = `${bar.getBoundingClientRect().right + 4}px`;
    document.body.append(popup);
    // Long menus in a short window: shift up to the bottom edge; .menu-popup's max-height scrolls the rest.
    popup.style.top = `${Math.max(4, Math.min(r.top - 6, innerHeight - popup.offsetHeight - 4))}px`;
  };

  titles.forEach((t, i) => {
    t.onclick = () => open(i);
    t.onmouseenter = () => { if (openIdx !== i) open(i); };
  });
  bar.replaceChildren(...titles);
  button.onclick = () => {
    if (!bar.hidden) return closeAll();
    const r = button.getBoundingClientRect();
    bar.style.left = `${r.left}px`;
    bar.style.top = `${r.bottom + 6}px`;
    bar.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    open(0);
  };

  window.addEventListener('mousedown', e => {
    if (!bar.hidden && !bar.contains(e.target as Node) && !popup?.contains(e.target as Node) && !button.contains(e.target as Node)) closeAll();
  }, true);
  window.addEventListener('blur', closeAll);
  window.addEventListener('keydown', e => {
    if (bar.hidden || openIdx < 0) return;
    const items = menus[openIdx][1];
    const step = (d: number) => {
      for (let n = 1; n <= items.length; n++) {
        const j = (((sel < 0 ? (d > 0 ? -1 : 0) : sel) + d * n) % items.length + items.length) % items.length;
        if (items[j]) { select(j); return rows[j]!.scrollIntoView({ block: 'nearest' }); }
      }
    };
    const move = (d: number) => open((openIdx + d + menus.length) % menus.length);
    if (e.key === 'Escape') { closeAll(); button.focus(); }
    else if (!inSub && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) move(e.key === 'ArrowDown' ? 1 : -1);
    else if (!inSub && (e.key === 'ArrowRight' || e.key === 'Enter')) { inSub = true; step(1); }
    else if (inSub && e.key === 'ArrowDown') step(1);
    else if (inSub && e.key === 'ArrowUp') step(-1);
    else if (inSub && e.key === 'ArrowLeft') { inSub = false; rows[sel]?.classList.remove('selected'); sel = -1; }
    else if (inSub && e.key === 'Enter') { const item = items[sel]; if (item) choose(item); else return; }
    else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}
