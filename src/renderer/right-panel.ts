// Right panel: three cards (related Rails files, Rails server status, Git), redrawn when their sources change.
import { $, api, basename, h, icon, ws } from './dom.ts';
import * as Editor from './editor.ts';
import { fileSvg } from './file-icons.ts';
import * as Features from './features.ts';
import * as Git from './git.ts';
import * as Rails from './rails.ts';
import * as Terminal from './terminal.ts';

let timer: ReturnType<typeof setTimeout> | undefined;
let token = 0;
let syncing = false;

export const schedule = () => { clearTimeout(timer); timer = setTimeout(() => void render(), 120); };

const card = (title: string, ...kids: (Node | string)[]) => h('section', { className: 'rp-card' }, h('h3', { className: 'rp-title' }, title), ...kids);
const button = (label: string, iconName: string, onclick: () => void, primary = true, disabled = false) => {
  const b = h('button', { className: `button rp-btn${primary ? '' : ' secondary'}`, disabled }, icon(iconName), label);
  b.onclick = onclick;
  return b;
};

async function render() {
  const mine = ++token;
  const host = $('#rightpanel');
  if (host.hidden) return;
  const cards: HTMLElement[] = [];

  if (ws.isRails && Features.on('railsNav')) {
    const groups = await Rails.relatedFiles();
    if (mine !== token) return;
    cards.push(card('Arquivos Rails relacionados', ...(groups.length ? groups.flatMap(([group, files]) => [
      h('div', { className: 'rp-group' }, group),
      ...files.map(f => {
        const row = h('button', { className: 'rp-row', title: f.path }, fileSvg(f.name), h('span', { className: 'tree-label' }, f.name));
        row.onclick = () => void Editor.openFile(f.path);
        return row;
      }),
    ]) : [h('div', { className: 'rp-muted' }, 'Abra um model, controller ou view para ver os arquivos relacionados.')])));
  }

  if (ws.isRails && Features.on('railsGenerators')) {
    const { term, port } = Rails.serverState;
    const running = !!term?.alive;
    const toggle = running ? button('Parar', 'debug-stop', () => Terminal.kill(term), false) : button('Iniciar', 'play', () => void Rails.server());
    cards.push(card('Status do servidor', h('div', { className: 'rp-line' },
      h('span', { className: `rp-dot${running ? ' on' : ''}`, role: 'img', ariaLabel: running ? 'Em execução' : 'Parado' }),
      h('div', { className: 'rp-grow' }, h('div', {}, 'Servidor Rails'), h('div', { className: 'rp-muted' }, running ? (port ? `Rodando · porta ${port}` : 'Iniciando...') : 'Parado')),
      toggle)));
  }

  if (Features.on('git') && Git.branch) {
    const n = Git.changes;
    const sync = button('Sincronizar', 'sync', async () => {
      syncing = true;
      schedule();
      if (await Git.sync('pull')) await Git.sync('push');
      syncing = false;
      schedule();
    }, true, syncing);
    sync.setAttribute('aria-label', 'Sincronizar: pull e depois push');
    cards.push(card('Git',
      h('div', { className: 'rp-line' }, icon('git-branch'), h('div', { className: 'rp-grow' }, h('div', {}, Git.branch), h('div', { className: 'rp-muted' }, n ? `${n} ${n === 1 ? 'alteração' : 'alterações'}` : 'Sem alterações'))),
      sync));
  }

  host.replaceChildren(...(cards.length ? cards : [h('div', { className: 'rp-card rp-muted' }, ws.root ? `${basename(ws.root)}: nada para mostrar aqui.` : 'Abra uma pasta para ver os detalhes do projeto.')]));
}

export function setVisible(visible: boolean, persist = true) {
  $('#rightpanel').hidden = !visible;
  $('#tb-right').classList.toggle('active', visible);
  $('#tb-right').setAttribute('aria-pressed', String(visible));
  if (persist) { Features.set('window.rightPanel', visible); void api.saveSettings(Features.all()); }
  schedule();
}

export const toggle = () => setVisible(!!$('#rightpanel').hidden);

export function initRightPanel() {
  $('#tb-right').onclick = toggle;
  setVisible(Features.on('rightPanel') && Features.get<boolean | undefined>('window.rightPanel') !== false, false);
  Editor.onDidChange(schedule);
  Git.onDidRefresh(schedule);
  Terminal.onDidChange(t => { if (t === Rails.serverState.term) schedule(); });
}
