// Feature registry (see docs/CHECKLIST.md) and the settings editor.
// 'ok' = implemented and can be toggled; 'planned' = shown disabled until it is built.
import { STYLE_SETTINGS } from './code-style.ts';
import { h } from './dom.ts';

type Status = 'ok' | 'planned';
type Setting = [group: string, key: string, desc: string, type: 'string' | 'number' | 'boolean' | string[], def: string | number | boolean];
export type Settings = Record<string, unknown> & { features: Record<string, boolean> };

const LIST: [string, [id: string, label: string, status: Status][]][] = [
  ['Inteligência de código', [
    ['completion', 'Autocompletar (métodos, constantes, require)', 'ok'],
    ['hover', 'Documentação ao passar o mouse', 'ok'],
    ['signatureHelp', 'Assinatura do método ao digitar argumentos', 'ok'],
    ['definition', 'Ir para definição (Ctrl+Clique / F12)', 'ok'],
    ['references', 'Encontrar usos (Shift+F12)', 'ok'],
    ['documentHighlight', 'Destacar ocorrências do símbolo', 'ok'],
    ['documentSymbols', 'Estrutura do arquivo e Ctrl+Shift+O', 'ok'],
    ['workspaceSymbols', 'Buscar símbolo no projeto (Ctrl+T)', 'ok'],
    ['inlayHints', 'Inlay hints (rescue implícito, valores de hash)', 'ok'],
    ['semanticHighlighting', 'Realce semântico', 'ok'],
    ['typeHierarchy', 'Hierarquia de tipos e chamadas', 'ok'],
  ]],
  ['Qualidade e refatoração', [
    ['diagnostics', 'Diagnósticos em tempo real (sintaxe + RuboCop)', 'ok'],
    ['codeActions', 'Quick-fixes e refatorações (Ctrl+.)', 'ok'],
    ['formatting', 'Formatar documento (Shift+Alt+F)', 'ok'],
    ['autoEnd', 'Fechar blocos com end ao apertar Enter', 'ok'],
    ['rename', 'Renomear símbolo (F2)', 'ok'],
    ['intentions', 'Ações no código: do↔{}, hash rocket, ternário…', 'ok'],
    ['inspections', 'Inspeções próprias: YARD, nil e aridade', 'ok'],
    ['generate', 'Gerar attr_accessor, construtor, let do RSpec', 'ok'],
    ['railsRename', 'Rename que entende Rails (model/controller/view)', 'ok'],
  ]],
  ['Executar e testar', [
    ['runFile', 'Executar arquivo Ruby (Ctrl+F5)', 'ok'],
    ['runTests', 'Executar testes RSpec / Minitest do arquivo ou da linha', 'ok'],
    ['gotoTest', 'Ir para teste ↔ implementação (Ctrl+Shift+T)', 'ok'],
    ['debugger', 'Depurador (rdbg / DAP) com breakpoints', 'ok'],
    ['testTree', 'Árvore de testes com rerun de falhas', 'ok'],
    ['coverage', 'Cobertura de código', 'ok'],
    ['profiler', 'Profiler', 'ok'],
    ['console', 'Console IRB / Rails e enviar seleção ao console', 'ok'],
    ['terminal', 'Terminal integrado', 'ok'],
  ]],
  ['Ecossistema Ruby', [
    ['bundler', 'Bundler: install, update, outdated, lock, clean', 'ok'],
    ['rake', 'Listar e executar tarefas Rake', 'ok'],
    ['sdk', 'Detectar versão do Ruby e .ruby-version', 'ok'],
    ['versionManagers', 'Escolher interpretador (rbenv / rvm / asdf / chruby / mise / RubyInstaller)', 'ok'],
    ['gemsView', 'Lista de gems com navegação para o código', 'ok'],
    ['rbs', 'Steep check (tipos RBS)', 'ok'],
  ]],
  ['Rails', [
    ['railsNav', 'Navegar Model ↔ Controller ↔ View ↔ Helper', 'ok'],
    ['railsGenerators', 'Generators, servidor e migrations', 'ok'],
    ['railsRoutes', 'Completar rotas (_path/_url) e chaves i18n', 'ok'],
  ]],
  ['Ferramentas', [
    ['git', 'Git: status, diff, stage, commit, blame, branches', 'ok'],
    ['markdownPreview', 'Prévia de Markdown (Ctrl+Shift+V)', 'ok'],
    ['httpClient', 'Cliente HTTP', 'planned'],
    ['database', 'Ferramentas de banco de dados', 'planned'],
    ['rightPanel', 'Painel direito: arquivos Rails relacionados, servidor e Git (Ctrl+Alt+B)', 'ok'],
  ]],
];

// Lowest window.zoomLevel: 1.2^level = 80% (user request; Chromium itself goes down to 25%).
export const MIN_ZOOM = Math.log(0.8) / Math.log(1.2);

const SETTINGS: Setting[] = [
  ['Aparência', 'workbench.theme', 'Tema de cores da interface, do editor e do terminal.', ['escuro', 'claro'], 'escuro'],
  ['Aparência', 'window.zoomLevel', 'Nível de zoom da janela: 0 = 100%, cada passo multiplica por 1,2 (1 = 120%, -1 ≈ 83%). Mínimo 80% (≈ -1,22), máximo 8. Atalhos: Ctrl+= / Ctrl+- / Ctrl+0.', 'number', 0],
  ['Aparência', 'window.controls', 'Botões da janela (fora do macOS): "nativos" usa os do sistema; "mac" desenha círculos coloridos à esquerda. Reinicia o Rubaxe ao mudar.', ['nativos', 'mac'], 'nativos'],
  ['Aparência', 'window.transparent', 'Janela transparente (só Linux): mostra a área de trabalho atrás da janela. O Linux não desfoca sozinho: para o desfoque estilo macOS, instale a extensão Blur my Shell, coloque rubaxe na lista de Aplicativos e desligue a Opacidade dinâmica (senão o desfoque some quando a janela está em foco). Usa os botões coloridos do Rubaxe. Sem sombra; para redimensionar, arraste bem rente à borda (ou use Super + arrastar com o botão do meio). Reinicia o Rubaxe ao mudar.', 'boolean', false],
  ['Ruby', 'ruby.path', 'Comando ou caminho do interpretador Ruby.', 'string', 'ruby'],
  ['Ruby', 'ruby.lspPath', 'Comando do servidor Ruby LSP (gem install ruby-lsp).', 'string', 'ruby-lsp'],
  ['Ruby', 'test.framework', 'Framework de testes.', ['auto', 'rspec', 'minitest'], 'auto'],
  ['Ruby', 'rspec.fullBacktrace', 'RSpec: mostrar o backtrace completo (-b) nas falhas.', 'boolean', false],
  ['Estilo de código (RuboCop)', 'rubocop.config', 'Configuração do RuboCop: "Rubaxe" permite gravar o estilo configurado aqui no projeto; "projeto" só usa o .rubocop.yml existente.', ['Rubaxe', 'projeto'], 'Rubaxe'],
  ['Estilo de código (RuboCop)', 'rubocop.standard', 'Usar Standard em vez de RuboCop para formatar e analisar (só se a gem standard estiver no Gemfile.lock).', 'boolean', false],
  ['Terminal', 'terminal.shell', 'Perfil do terminal integrado: nome (ex.: Git Bash) ou caminho do shell. Padrão: PowerShell no Windows, $SHELL no Linux/macOS.', 'string', ''],
  ['Editor', 'files.autoSave', 'Salvar automaticamente 1 s depois de editar, ao sair do editor e ao trocar de aba.', 'boolean', true],
  ['Editor', 'editor.fontSize', 'Tamanho da fonte.', 'number', 14],
  ['Editor', 'editor.fontFamily', 'Fonte do editor. Padrão: JetBrains Mono, a mesma do RubyMine.', 'string', "'JetBrains Mono', Consolas, 'Courier New', monospace"],
  ['Editor', 'editor.tabSize', 'Espaços por indentação.', 'number', 2],
  ['Editor', 'editor.formatOnSave', 'Formatar ao salvar.', 'boolean', false],
  ['Editor', 'editor.minimap', 'Mostrar minimapa.', 'boolean', true],
  ['Editor', 'editor.wordWrap', 'Quebrar linhas longas.', 'boolean', false],
  ...STYLE_SETTINGS.map(([key, desc, type, def]): Setting => ['Estilo de código (RuboCop)', key, desc, type, def]),
];

function defaults(): Settings {
  const s: Settings = { features: {} };
  for (const [, key, , , def] of SETTINGS) s[key] = def;
  for (const [, items] of LIST) for (const [id, , status] of items) s.features[id] = status === 'ok';
  return s;
}

let settings = defaults();

export function load(saved: Record<string, unknown>): Settings {
  const d = defaults();
  settings = { ...d, ...saved, features: { ...d.features, ...(saved.features as Record<string, boolean> | undefined) } };
  return settings;
}

export const get = <T>(key: string) => settings[key] as T;
export const set = (key: string, value: unknown) => { settings[key] = value; };
export const on = (id: string) => !!settings.features[id];
export const all = () => settings;

function controlFor(key: string, type: Setting[3], changed: (key: string, value: unknown) => void): HTMLElement {
  if (type === 'boolean') {
    const box = h('input', { type: 'checkbox', checked: settings[key] as boolean });
    box.onchange = () => { changed(key, box.checked); };
    return box;
  }
  if (Array.isArray(type)) {
    const select = h('select', { className: 'input' }, ...type.map(o => h('option', { value: o, selected: settings[key] === o }, o)));
    select.onchange = () => { changed(key, select.value); };
    return select;
  }
  const input = h('input', { className: 'input', name: key, type: type === 'number' ? 'number' : 'text', value: String(settings[key]) });
  input.onchange = () => {
    const v = type === 'number' ? Number(input.value) : input.value.trim();
    // Empty or zero would make the editor unusable (font size 0); keep the last good value.
    // (empty text is fine when the default is empty: it means "use the default"; the zoom level is 0 = 100% and may be negative)
    const bad = key === 'window.zoomLevel' ? !(input.value.trim() && Number(v) >= MIN_ZOOM && Number(v) <= 8) : type === 'number' ? !(Number(v) > 0) : !v && SETTINGS.find(s => s[1] === key)![4] !== '';
    if (bad) { input.value = String(settings[key]); return; }
    changed(key, v);
  };
  return input;
}

export function render(container: HTMLElement, onChange: (key: string) => void) {
  const filter = h('input', { className: 'input settings-search', placeholder: 'Pesquisar configurações' });
  const body = h('div', { className: 'settings-body' });
  const row = (title: string, desc: string, control: HTMLElement, extra = '') => {
    const el = h('div', { className: 'setting ' + extra }, h('div', { className: 'setting-title' }, title), h('div', { className: 'setting-desc' }, desc), control);
    el.dataset.text = (title + ' ' + desc).toLowerCase();
    return el;
  };
  const changed = (key: string, value: unknown) => { settings[key] = value; onChange(key); };

  let lastGroup = '';
  for (const [group, key, desc, type] of SETTINGS) {
    if (group !== lastGroup) body.append(h('h2', {}, group));
    lastGroup = group;
    body.append(row(key, desc, controlFor(key, type, changed)));
  }

  body.append(h('h2', {}, 'Funcionalidades'));
  body.append(h('p', { className: 'setting-desc' }, 'Suporte Ruby inspirado no RubyMine. Itens "planejado" estão no checklist e serão habilitados conforme forem implementados.'));
  for (const [group, items] of LIST) {
    body.append(h('h3', {}, group));
    for (const [id, label, status] of items) {
      const box = h('input', { type: 'checkbox', checked: on(id), disabled: status !== 'ok' });
      box.onchange = () => { settings.features[id] = box.checked; onChange('features.' + id); };
      const kids: (Node | string)[] = [box, ' Habilitado'];
      if (status !== 'ok') kids.push(' ', h('span', { className: 'pill' }, 'planejado'));
      body.append(row(label, `features.${id}`, h('label', { className: 'feature' }, ...kids), status));
    }
  }

  filter.oninput = () => {
    const q = filter.value.toLowerCase();
    body.querySelectorAll<HTMLElement>('.setting').forEach(el => { el.hidden = !el.dataset.text!.includes(q); });
    // A heading stays only while something under it (up to the next heading of its level or higher) matches.
    const kids = [...body.children] as HTMLElement[];
    kids.forEach((el, i) => {
      if (!/^H[23]$/.test(el.tagName)) return;
      const end = kids.findIndex((k, j) => j > i && /^H[23]$/.test(k.tagName) && k.tagName <= el.tagName);
      el.hidden = !kids.slice(i + 1, end < 0 ? undefined : end).some(k => k.classList.contains('setting') && !k.hidden);
    });
  };
  container.replaceChildren(h('div', { className: 'settings-page' }, filter, body));
  filter.focus();
}
