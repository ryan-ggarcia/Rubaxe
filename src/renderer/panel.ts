// Bottom panel: Problems (Monaco markers) and Output (process output).
import { $, api, basename, h } from './dom.ts';
import * as Editor from './editor.ts';
import { ANSI } from './paths.ts';

const MAX_OUTPUT = 200_000; // long-running servers would otherwise grow the DOM forever
let output = '';
type Which = 'problems' | 'output' | 'debug' | 'terminal';
export let current: Which = 'problems';

// onTerminal creates a terminal when none exists (passed in to avoid a panel <-> terminal import cycle).
export function initPanel(onStop: () => void, onTerminal: () => void) {
  document.querySelectorAll<HTMLElement>('.panel-tab').forEach(el => { el.onclick = () => el.dataset.panel === 'terminal' ? onTerminal() : show(el.dataset.panel as Which); });
  $('#panel-stop').onclick = onStop;
  $('#panel-clear').onclick = () => { output = ''; $('#panel-output').textContent = ''; };
  const input = $('#output-input') as HTMLInputElement;
  input.onkeydown = e => {
    if (e.key !== 'Enter' || !stdinId) return;
    api.runWrite(stdinId, input.value + '\n');
    append(input.value + '\n');
    input.value = '';
  };
  $('#panel-close').onclick = () => toggle(false);
  monaco.editor.onDidChangeMarkers(refreshProblems);
}

export function toggle(visible = $('#panel').hidden) {
  $('#panel').hidden = !visible;
  $('#sash-panel').hidden = !visible;
}

export function show(which: Which) {
  current = which;
  toggle(true);
  document.querySelectorAll<HTMLElement>('.panel-tab').forEach(el => el.classList.toggle('active', el.dataset.panel === which));
  $('#panel-problems').hidden = which !== 'problems';
  $('#panel-output').hidden = which !== 'output';
  $('#panel-debug').hidden = which !== 'debug';
  $('#panel-terminal').hidden = which !== 'terminal';
  $('#terminal-actions').hidden = which !== 'terminal';
  syncInput();
  $('#panel-stop').hidden = which !== 'output';
  $('#panel-clear').hidden = which !== 'output';
}

export function append(text: string) {
  output = (output + text.replace(ANSI, '')).slice(-MAX_OUTPUT);
  const pre = $('#panel-output');
  const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
  pre.textContent = output;
  if (atBottom) pre.scrollTop = pre.scrollHeight;
}

let stdinId: string | undefined;

// `stdin` = id of the newest run still alive: its input line shows under the output.
export function setRunning(running: boolean, stdin?: string) {
  $('#panel-stop').classList.toggle('disabled', !running);
  stdinId = stdin;
  syncInput();
}

const syncInput = () => { $('#output-input').hidden = current !== 'output' || !stdinId; };

export function refreshProblems() {
  const markers = monaco.editor.getModelMarkers({});
  const errors = markers.filter(m => m.severity === monaco.MarkerSeverity.Error).length;
  const warnings = markers.filter(m => m.severity === monaco.MarkerSeverity.Warning).length;
  $('#problems-count').textContent = markers.length ? String(markers.length) : '';
  $('#sb-errors').textContent = String(errors);
  $('#sb-warnings').textContent = String(warnings);

  const byFile = Map.groupBy(markers, m => m.resource.toString());
  const rows: HTMLElement[] = [];
  for (const list of byFile.values()) {
    const uri = list[0].resource;
    rows.push(h('div', { className: 'problem-file' }, h('span', { className: 'codicon codicon-ruby' }), basename(uri.fsPath), h('span', { className: 'badge' }, String(list.length))));
    for (const m of list) {
      const sev = m.severity === monaco.MarkerSeverity.Error ? 'error' : m.severity === monaco.MarkerSeverity.Warning ? 'warning' : 'info';
      const row = h('div', { className: 'problem' }, h('span', { className: `codicon codicon-${sev}` }),
        h('span', {}, m.message), h('span', { className: 'desc' }, `${m.source ?? ''}${m.code ? `(${typeof m.code === 'string' ? m.code : m.code.value})` : ''} [Ln ${m.startLineNumber}, Col ${m.startColumn}]`));
      row.onclick = () => Editor.openUri(uri, { lineNumber: m.startLineNumber, column: m.startColumn });
      rows.push(row);
    }
  }
  $('#panel-problems').replaceChildren(...(rows.length ? rows : [h('div', { className: 'empty' }, 'Nenhum problema detectado no workspace.')]));
}
