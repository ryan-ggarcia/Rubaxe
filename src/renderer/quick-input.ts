import { $, h, icon } from './dom.ts';

export interface QuickItem { label: string; description?: string; icon?: string; run: () => void }

interface Options {
  placeholder: string;
  value?: string;
  items: (query: string) => QuickItem[] | Promise<QuickItem[]>;
  onAccept?: (value: string) => void; // Enter with no matching item (free-text prompts)
  onDismiss?: () => void;
}

const MAX_ROWS = 200;
let onClose: () => void = () => {};

export function setCloseHandler(fn: () => void) { onClose = fn; }

export function quickPick(opts: Options) {
  const box = $('#quick-input');
  const input = h('input', { className: 'input', placeholder: opts.placeholder, value: opts.value ?? '', spellcheck: false });
  const list = h('div', { className: 'quick-list' });
  let items: QuickItem[] = [], selected = 0, seq = 0;

  let open = true;
  const close = (accepted = false) => {
    if (!open) return;
    open = false;
    box.hidden = true;
    box.replaceChildren();
    onClose();
    if (!accepted) opts.onDismiss?.();
  };
  const pick = (item?: QuickItem) => {
    close(true);
    if (item) item.run(); else opts.onAccept?.(input.value);
  };
  const paint = () => {
    list.replaceChildren(...items.slice(0, MAX_ROWS).map((it, i) => {
      const row = h('div', { className: 'quick-row' + (i === selected ? ' selected' : ''), onmousedown: e => { e.preventDefault(); pick(it); } },
        icon(it.icon ?? 'blank'), h('span', { className: 'label' }, it.label), h('span', { className: 'desc' }, it.description ?? ''));
      return row;
    }));
    list.children[selected]?.scrollIntoView({ block: 'nearest' });
  };
  const refresh = async () => {
    const mine = ++seq;
    const result = await opts.items(input.value);
    if (mine !== seq) return; // a newer keystroke already rendered
    items = result;
    selected = 0;
    paint();
  };

  input.oninput = refresh;
  input.onblur = () => close();
  input.onkeydown = e => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter') pick(items[selected]);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      selected = Math.max(0, Math.min(Math.min(items.length, MAX_ROWS) - 1, selected + (e.key === 'ArrowDown' ? 1 : -1)));
      paint();
    } else return;
    e.preventDefault();
  };

  box.replaceChildren(input, list);
  box.hidden = false;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  refresh();
}

export function prompt(placeholder: string, value = ''): Promise<string | undefined> {
  return new Promise(resolve => quickPick({ placeholder, value, items: () => [], onAccept: v => resolve(v.trim() || undefined), onDismiss: () => resolve(undefined) }));
}
