// Update button in the title bar, driven by the main process' updater (see onUpdateStatus in preload).
import { $, api, h, icon, notify } from './dom.ts';

let manual = false; // the user asked from the menu: also answer when there is nothing to install

export async function check() {
  manual = true;
  try { await api.checkForUpdates(); } catch (e) { manual = false; notify(`Não foi possível verificar atualizações: ${e instanceof Error ? e.message : e}`, 'error'); }
}

export function initUpdate() {
  const btn = $('#tb-update') as HTMLButtonElement;
  btn.onclick = () => api.installUpdate();
  api.onUpdateStatus(s => {
    const v = s.version?.replace(/^v/, '');
    const text = s.state === 'downloading' ? `Baixando ${Math.round(s.percent ?? 0)}%` : s.state === 'ready' ? (v ? `Atualizar para v${v}` : 'Atualizar e reiniciar') : (v ? `Baixar v${v}` : 'Baixar atualização');
    btn.hidden = s.state !== 'downloading' && s.state !== 'ready' && s.state !== 'manual';
    btn.disabled = s.state === 'downloading';
    btn.replaceChildren(icon(s.state === 'downloading' ? 'sync' : 'cloud-download'), h('span', {}, text));
    if (s.state === 'none' || s.state === 'error') { if (manual) notify(s.state === 'none' ? s.message ?? 'Você já está na versão mais recente.' : `Falha ao verificar atualizações${s.message ? `: ${s.message}` : '.'}`, s.state === 'error' ? 'error' : 'info'); }
    if (s.state !== 'available') manual = false;
  });
}
