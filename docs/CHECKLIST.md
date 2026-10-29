# Rubaxe — Checklist de desenvolvimento

IDE para Ruby com o **suporte à linguagem do RubyMine** e o **layout, navegação e estilo do VS Code**.
Tudo é implementado do zero, em processo clean room: a pesquisa coletou apenas *o que* cada funcionalidade faz, nunca código.

> Status: **fases 1–11 implementadas e testadas** em TypeScript + Electron (itens adiados marcados com o motivo).
> ★ = fundamental (entra no MVP). Demais itens ficam visíveis em Configurações como "planejado".

---

## 1. Stack

| Camada | Escolha | Versão | Por quê |
|---|---|---|---|
| Shell desktop | **Electron** | 44.5.1 | Mesma base do VS Code; layout idêntico é direto. |
| Editor | **Monaco Editor** (MIT) | 0.57.0 | É o editor do VS Code: multicursor, folding, minimap, find/replace, paleta de ações. |
| Ícones | **@vscode/codicons** (MIT) | 0.0.45 | Ícones oficiais do VS Code. |
| Linguagem | **TypeScript** (checagem estrita) | 7.0.2 | Tipos evitam bugs num projeto do tamanho de uma IDE. |
| Build | **esbuild** | 0.28.2 | Compila e empacota em milissegundos. |
| Interface | HTML + CSS + TypeScript, sem framework | — | Inicialização rápida e menos código. |
| Inteligência Ruby | **Ruby LSP** (Shopify, MIT) via LSP/stdio | gem `ruby-lsp` | Completar, definição, usos, símbolos, diagnósticos, formatação, rename, refatorações. |
| Parser | **Prism** | embutido no Ruby ≥ 3.4 | Parser oficial do Ruby, usado pelo Ruby LSP. |
| Lint / formatação | **RuboCop** ou **Standard** (via Ruby LSP) | gem do projeto | Cobre a maior parte das 115 inspeções do RubyMine. |
| Depurador | gem **debug** (`rdbg`) via **DAP** | gem `debug` | Depurador oficial do Ruby; fala o protocolo DAP. |
| Testes / tarefas | CLIs `rspec`, `ruby -Itest`, `bin/rails test`, `bundle`, `rake` | — | Mesmo comportamento do terminal. |
| Terminal | xterm.js + node-pty | 6.0 / 1.1 | Padrão do VS Code; node-pty com binário pronto no Windows/macOS. |
| Empacotamento | electron-builder | 26.17 | Instalador Windows; Linux/macOS pelo GitHub Actions. |
| Testes do Rubaxe | `node:test` (embutido no Node) | — | Zero dependências. |

**Descartados:** Tauri (mais leve, mas exige Rust, que não está instalado); parser/indexador próprio (o RubyMine tem ~1.000 classes só de linguagem — anos de trabalho que o Ruby LSP já resolve).

---

## 2. Bloqueios no ambiente atual (resolver antes de começar)

- [x] **Reinstalar o Node.js** — resolvido (Node 26.10, npm 11.19).
- [x] **Reinstalar o Ruby 4.0** — resolvido (Ruby 4.0.5, gem e bundle funcionando).
- [x] `gem install ruby-lsp` — instalado (0.26.11).
- [x] `ridk install 2 3` (toolchain C do RubyInstaller) — instalado; o ruby-lsp agora monta o bundle de projetos com Gemfile.

---

## 3. Pesquisa e clean room

- Especificação de comportamento (única entrada da implementação): [SPEC.md](SPEC.md)
- Processo, registro da pesquisa e verificação de contaminação: [CLEAN_ROOM.md](CLEAN_ROOM.md)

---

## 4. Checklist

### Fase 1 — Interface no estilo VS Code ★
- [x] Barra de título customizada com Command Center (clique abre o Quick Open)
- [x] Barra de menus (Arquivo, Editar, Seleção, Exibir, Ir, Executar, Terminal, Ajuda) ligada aos comandos existentes
- [x] Activity Bar: Explorer, Busca, Controle de Código, Executar e Depurar, Testes, Ruby, Configurações
- [x] Side Bar redimensionável e recolhível (Ctrl+B ou botão na barra de título)
- [x] Abas de editor: ativa/inativa, indicador de "não salvo", fechar (Ctrl+W), arrastar para reordenar; abas com o mesmo nome mostram o menor trecho da pasta que as diferencia (`…\articles`), como no VS Code
- [x] Panel inferior redimensionável (Ctrl+J abre já com terminal): Problemas, Saída, Console de Depuração, Terminal
- [x] Status Bar: versão do Ruby, status do Ruby LSP, erros/avisos, Ln/Col, indentação, fim de linha (LF/CRLF), linguagem
- [x] Tema escuro e claro (`workbench.theme`) com destaque vermelho Ruby (#CC342D) e cantos arredondados, também no Monaco, xterm e barra de título
- [x] Fundo em gradiente (`workbench.background`, padrão `gradiente`; `liso` = visual anterior): vermelho Ruby e preto (claro: vermelho e branco) atrás dos painéis a 75%, menus/paleta/notificações com desfoque de 40 px; com acrílico o gradiente fica a 60%; `prefers-reduced-transparency` deixa os painéis como no liso; troca na hora (não conferido no app)
- [x] Auto save: 1 s após a última edição e ao trocar de aba/perder o foco; não formata (só Ctrl+S) e não sobrescreve edição externa (com aba suja + edição externa o auto save fica suspenso; Ctrl+S grava)
- [x] Zoom da janela como no VS Code (`window.zoomLevel`, fator 1,2^nível, mínimo 80% (≈ -1,22) até 8): Ctrl+= / Ctrl++ / Ctrl+-, Ctrl+0 redefine; item na Status Bar com −/+/Redefinir enquanto ≠ 100%
- [x] Tela de boas-vindas: "Abrir pasta" + atalhos; reabrir última pasta
- [x] Abrir Pasta.../Abrir Arquivo... com projeto aberto pergunta "Nesta janela" ou "Nova janela" (Esc cancela); explorer, Ctrl+P, links, clone e `rubaxe <caminho>` não perguntam (não conferido no app)

### Fase 2 — Arquivos, navegação e busca ★
- [x] Explorer em árvore (carregamento sob demanda), novo arquivo/pasta, atualizar, recolher tudo; clique na área vazia limpa a seleção e "Novo arquivo/pasta" volta a criar na raiz
- [x] Renomear (F2) e mover para a lixeira (Delete) pelo menu de contexto do explorer; abas abertas acompanham
- [x] Seleção múltipla no explorer (Ctrl/Cmd+clique, Shift+clique, Shift+Ctrl soma o intervalo); excluir vários com uma confirmação e resumo no fim; arrastar e soltar um ou vários itens numa pasta ou na raiz (pede confirmação antes de substituir; recusa pasta dentro dela mesma)
- [x] Recarregar abas quando o arquivo muda fora do Rubaxe (ao focar a janela); aba com alterações não salvas é mantida e avisada
- [x] Abrir arquivo solto (paleta: "Arquivo: Abrir Arquivo...")
- [x] Abrir, editar e salvar (Ctrl+S)
- [x] Avisar sobre alterações não salvas ao fechar a janela
- [x] Quick Open de arquivos com busca fuzzy (Ctrl+P)
- [x] Paleta de comandos (Ctrl+Shift+P / F1) com comandos do Rubaxe e do editor
- [x] Prefixos do Quick Open: `>` comandos, `:` ir para linha, `#` símbolo no projeto
- [x] Busca no projeto com regex e case-sensitive (Ctrl+Shift+F)
- [x] Visão "Estrutura" do arquivo (outline)

### Fase 3 — Inteligência Ruby via Ruby LSP ★
> **Testado com o Ruby LSP real** (projeto sem Gemfile): estrutura/símbolos, autocompletar, diagnósticos ao vivo (Prism) e recuperação. Hover, definição, rename e formatação usam o mesmo round-trip. Correção: o ruby-lsp usa *pull diagnostics* (`textDocument/diagnostic`), não `publishDiagnostics` — o Rubaxe agora puxa os diagnósticos. **Projetos com Gemfile (app Rails real) testados** depois do `ridk install`: estrutura, definição, autocompletar e diagnósticos. Correção: no Windows o add-on ruby-lsp-rails travava o servidor inteiro (deadlock do `CreateProcess` com a leitura pendente do stdin) — o Rubaxe envia uma notificação a cada 500 ms para nunca deixar essa leitura parada.

- [x] Iniciar/reiniciar o Ruby LSP por projeto; progresso de indexação na Status Bar
- [x] Sincronização incremental de documentos
- [x] Autocompletar (+ documentação no item)
- [x] Hover com documentação
- [x] Ajuda de assinatura
- [x] Ir para definição (inclusive em gems), encontrar usos
- [x] Destacar ocorrências
- [x] Símbolos do documento e do workspace
- [x] Diagnósticos (sintaxe + RuboCop) no editor e no painel Problemas
- [x] Quick-fixes e refatorações (extrair variável/método) — Ctrl+.
- [x] Formatar documento e "formatar ao salvar" — Shift+Alt+F, também em Editar e na paleta; sem formatador no Gemfile (o Ruby LSP só usa RuboCop/Syntax Tree do projeto) ou com o LSP fora do ar, usa o RuboCop do PATH (uma edição desfazível; descartada se o texto mudar no meio; erro vira aviso e não impede o salvamento)
- [ ] ~~Formatar ao parar de digitar~~ — removido a pedido do usuário em 29/10/2026; fica só o atalho `Shift+Alt+F` (e formatar ao salvar, se ligado). Histórico: (`editor.formatOnIdle`, 28/10/2026): arquivo Ruby, 2 s sem edição, editor com foco, sem sugestão/parameter hints/IME abertos, só se o texto mudou desde a última formatação; erros silenciosos (RuboCop ausente avisa uma vez por sessão). Conferido no app: ~65 s de digitação real sem cursor pulando nem texto perdido, digitar durante o format não perde nada, Ctrl+Z fica valendo, Ruby LSP no projeto com rubocop no Gemfile, auto save sem loop. Na prática formata 3,5–4 s depois da última tecla (2 s + RuboCop); digitar, mover o cursor ou Delete nesse meio-tempo descarta o resultado. Não verificado: IME. A auto-indentação por digitação (estilo VS Code: `else`/`end` recuando na hora) ficou para depois, a pedido do usuário; o Monaco 0.57 já tem regras de Ruby, desligadas com `autoIndent: 'advanced'`.
- [x] `end` automático só quando o bloco ainda não está fechado (o Ruby LSP insere sempre que o arquivo tem qualquer erro de sintaxe)
- [x] Renomear símbolo
- [x] Mensagem clara quando o Ruby LSP não está instalado

### Fase 4 — Executar e testar ★
> **Testado com Ruby real**: executar arquivo (`ruby` → saída `5`), RSpec via `bundle exec rspec` (1 example, 0 failures), Bundler install e Rake (`bundle exec rake hello`). Correção: no Windows o spawn passava cada argumento entre aspas, o que fazia os shims `.bat` (bundle/rake) re-executarem `ruby` como `<cwd>\ruby.exe` e falharem — agora só os tokens com espaço são citados (`src/main/shell.ts`, com teste).

- [x] Executar arquivo Ruby atual (Ctrl+F5) com saída em streaming e botão parar
- [x] Executar testes do arquivo: RSpec (`bundle exec rspec`), Minitest (`ruby -Itest` / `bin/rails test`)
- [x] Executar teste na linha do cursor
- [x] Executar todos os testes
- [x] Ir para teste ↔ implementação (Ctrl+Shift+T), oferecendo criar o teste se não existir
- [x] Usar `bundle exec` automaticamente quando houver Gemfile

### Fase 5 — Ecossistema Ruby ★
- [x] Detectar Ruby (`ruby -v`) e comparar com `.ruby-version`
- [x] Bundler: install, update, outdated, lock, clean, init, pack, criar gem; aviso "Gems faltando" na barra de status
- [x] Rake: listar tarefas (`rake -AT`) e executar

### Fase 6 — Configurações ★
- [x] Editor de configurações no estilo VS Code (aba própria, busca, Ctrl+,)
- [x] Gerais: caminho do Ruby, comando do Ruby LSP, framework de teste, fonte (`editor.fontFamily`, padrão JetBrains Mono embutida, OFL 1.1), tamanho da fonte, tab, minimapa, quebra de linha, formatar ao salvar
- [x] **Registro de funcionalidades**: cada função do RubyMine aparece com interruptor; implementadas podem ser ligadas/desligadas, as demais aparecem como "planejado"
- [x] Persistência em JSON no diretório do usuário

### Fase 7 — Depurador
> **Testado no app real** (CDP, 22 checagens). rdbg abre uma porta TCP e fala DAP; o Rubaxe conecta com `attach { localfs: true }` e pula a parada automática no carregamento. O rdbg para no `end` do método ao "Sair" (Shift+F11); o Rubaxe mostra a linha do chamador, como no VS Code.

- [x] Cliente DAP + `rdbg` (`rdbg --open -c -- <comando>`; F5 depura o arquivo atual)
- [x] Breakpoints (linha, condicional), step over/into/out, continuar — clique na margem ou F9; Shift+clique ou paleta para condição
- [x] Barra flutuante de depuração sobre o editor durante a sessão (continuar, passar por cima, entrar, sair, parar; habilitados só quando parado, exceto parar)
- [x] Variáveis, watches, pilha de chamadas, console de avaliação (painel "Console de Depuração")
- [x] Entrada do programa durante a depuração lançada (linha "Entrada do programa" no Console de Depuração, acima da de avaliação; some no attach) (não conferido no app)
- [x] Depurar testes; attach a processo; debug remoto — `host:porta [pasta no servidor]`; o Rubaxe traduz os caminhos servidor ↔ workspace (testado com o processo rodando em outra pasta)

### Fase 8 — Testes avançados
> **Testado no app real** (CDP, 17 checagens) com RSpec e Minitest 6. Sem gems extras: RSpec usa `--format json`; Minitest, cobertura e profiler usam helpers Ruby em `src/ruby/` carregados por `RUBYOPT`.

- [x] Árvore de testes com resultado por exemplo (view "Testes", mensagem da falha abaixo do teste)
- [x] Reexecutar só os que falharam (RSpec por id `arquivo[1:2]` ou `arquivo:linha`, Minitest por nome); RSpec por pasta com filtro `-e`; backtrace completo (`rspec.fullBacktrace`)
- [x] Ícone "executar" na margem ao lado de `describe`/`it`/`def test_`/`test "..."`, com cor do último resultado
- [x] Cobertura no editor — módulo `Coverage` do Ruby (o mesmo que o SimpleCov usa), barra verde/vermelha na margem e resumo no painel
- [x] Profiler — por amostragem (sem sobrecarga medível; stackprof no Linux/macOS, thread de amostragem no Windows, onde stackprof/vernier não compilam) e modo "instrumentado, exato" com contagem de chamadas; a lista abre o `def` do método

### Fase 9 — Rails
> **Testado no app real** com um app Rails 8.1 gerado (`rails new --minimal` + scaffold), 14 checagens. Rails 8.1 em Ruby 4.0/Windows: o `rails console` precisa de `gem "fiddle"` no Gemfile do app (exigência do reline, não do Rubaxe).

- [x] Navegar Model ↔ Controller ↔ View ↔ Helper ↔ Layout ↔ Routes ↔ Schema (Shift+Alt+R; da view vai para a action, do model para o `create_table`)
- [x] Executar generators (model, controller, scaffold, migration…) e desfazer (`rails destroy`); db:migrate/rollback/seed
- [x] Rails server (terminal integrado; Ctrl+C para, Shift+F2 não mata) e Rails console (terminal integrado)
- [x] Completar rotas (`_path`/`_url` de `bin/rails routes`) e chaves i18n (`t('…')` de `config/locales`), também nas views `.erb`
- [x] Views ERB (`erb`, 28/10/2026): linguagem própria no Monaco, realce HTML com Ruby dentro de `<% %>`/`<%= %>`/`<%- -%>` e comentário `<%# %>`; completar/documentação de HTML pelo serviço HTML do Monaco (worker HTML) e, dentro das tags, completar, documentação, assinatura, definição, destaque e realce semântico do Ruby LSP (`languageId: erb`). Sem formatação, RuboCop, `end` automático nem diagnósticos em `.erb`. Limite: Ruby dentro de valor de atributo (`class="<%= x %>"`) completa, mas fica com a cor do atributo.
- [x] Emmet em `.html` e `.erb` (`emmet`, 29/10/2026, biblioteca `emmet-monaco-es`, MIT): `h1`, `table`, `ul>li*3`, `div.card` aparecem no completar e Tab/Enter expandem com o cursor dentro, como no VS Code (inclusive a lista de tags pelo prefixo). Nunca dentro de `<% %>`/`<%= %>`/`<%# %>`, de tag, atributo, `<script>` ou `<style>`; nem em `.rb`. Entra junto com as palavras do arquivo (`tab` → `tabela` e `table`); tags após `<` e Ruby LSP não mudam. No `.erb`, rotas e chaves i18n só aparecem dentro de `<% %>`: no HTML elas escondiam o Emmet e as palavras (`ul` virava `update_rails_disk_service_path`). Continua funcionando depois de trocar o tema e de a gramática Ruby carregar (antes sumia, com erro "reading 'depth'" no console). Conferido no app dev (perfil isolado), também no app Rails SuperMercado sem salvar nada.
- [x] Fechar tag ao digitar `>` (`autoCloseTags`, 29/10/2026, como o `html.autoClosingTags` do VS Code; o Monaco não tem): `<h1>` e `<div class="x">` ganham `</h1>`/`</div>` depois do cursor, que não sai do lugar; Ctrl+Z tira só o fechamento. Não fecha tags void (`br`, `img`, `input`…), `/>`, `</p>`, `<!DOCTYPE>`, `<!-- -->`, `%>`, `>` dentro de `<% %>` (`<%= a > b %>`) ou de valor de atributo, nem quando o fechamento já vem logo depois; só digitação de um `>` com um cursor (colar e várias seleções não disparam). Conferido no app dev (perfil isolado) em `.html` e `.erb`. Limite: dentro de `<script>`/`<style>` um `<b>` digitado também fecha.
- [x] HTML, CSS/SCSS/LESS, JavaScript/TypeScript e JSON: completar, documentação, erros e Shift+Alt+F pelos serviços nativos do Monaco (já funcionavam; conferido no app em 28/10/2026). Formatar ao salvar continua só para Ruby: os formatadores de HTML/CSS/JSON do Monaco removem a quebra de linha final.
- [x] Rename que entende Rails ("Rails: Renomear Recurso..."): model, controller, helper, pasta de views e testes/specs + constantes via Ruby LSP; pré-visualização com confirmação; `routes.rb` e migrations só listados para revisão manual

### Fase 10 — Recursos avançados do RubyMine
> **Testado no app real** (16 checagens) + 13 testes unitários das intentions.

- [x] Intentions (Ctrl+.): parâmetros nomeados↔numerados (`it`/`_1`), mover string para i18n, embutir variável local, juntar ifs em sequência (só com saída de fluxo), `{}`↔`do…end`, hash rocket↔`key:`, `if`↔ternário, modificador↔statement, inverter/juntar/dividir `if`, string↔símbolo, interpolação, heredoc squiggly, `_` em números, ordenar hash
- [x] Geração (Ctrl+.): `attr_accessor`/`reader`/`writer`, `initialize`, `let` do RSpec
- [x] Inspeções próprias (`src/ruby/rubaxe_inspect.rb`, Prism): YARD (`@param` desconhecido/faltando, `@return` em `initialize`), chamada em nil certo, aridade de métodos do mesmo arquivo. Só regras determinísticas; inferência de tipos completa segue fora
- [x] Inlay hints e realce semântico (do Ruby LSP; ele só marca o que a gramática não distingue)
- [x] Hierarquia de tipos (Ruby LSP) e chamadas do método (Shift+Alt+H; montada a partir dos usos, o Ruby LSP não tem call hierarchy)
- [x] Gerenciadores de versão: seletor de interpretador (rbenv, rvm, asdf, chruby, mise, RubyInstaller, PATH); o escolhido vai na frente do PATH de tudo que o Rubaxe executa
- [x] Linux sem `ruby` no PATH (aberto pelo menu): o primeiro Ruby dos gerenciadores entra no PATH de LSP, execução e terminal; `ruby.path` absoluto vence (macOS: não verificado)
- [x] Lista de gems (view Ruby) com navegação para o código-fonte
- [x] RBS e Steep — `.rbs` com realce Ruby e comando `steep check` (testado com Steep 2.1: aponta o erro de tipo contra a assinatura RBS)
- [x] Console IRB; enviar seleção ao console (Shift+Alt+Enter). Pry: rode `pry` no terminal
- [x] Code style configurável: opções da SPEC viram `.rubocop_rubaxe.yml` (herdado pelo `.rubocop.yml`), aplicado pelo formatador via RuboCop

### Fase 11 — Ferramentas
> **Testado no app real** (13 checagens): PowerShell no terminal, IRB, Git completo num repositório de teste.

- [x] Terminal integrado (xterm.js + node-pty com binário pré-compilado; vários terminais; perfis PowerShell/PowerShell 7/Prompt de Comando/Git Bash/WSL e perfil padrão); depois de trocar de pasta, abrir o terminal mostra um iniciado na pasta atual (ou cria um), sem fechar os antigos
- [x] Git: status, diff (aba lado a lado), stage/unstage, commit, blame da linha, branches (trocar/criar pela barra de status), push/pull/fetch
- [x] Aba Git numa pasta sem repositório (como no VS Code): Inicializar, Clonar (link validado, pasta de destino, abrir a pasta clonada) e Conectar a um remoto (init + origin); Push/Sincronizar sem remote pede o link e faz push -u
- [x] Prévia de Markdown (`Ctrl+Shift+V`, botão na aba do `.md`, menu Exibir): aba própria ao lado do arquivo (o editor não divide a tela), atualiza ao vivo; GFM (tabelas, tarefas, tachado, autolinks), código colorido pelo Monaco, links relativos abrem no Rubaxe, `#âncora` rola, `http(s)` vai para o navegador; HTML passa pelo DOMPurify e nada carrega sozinho (imagens só locais, resolvidas a partir da pasta do `.md`; da web viram um marcador)
- [x] Mensagens (toasts) e barras de entrada no estilo macOS: entrada e saída suaves, fundo translúcido com desfoque, pausa ao passar o mouse; sem animação com prefers-reduced-motion
- [x] Redesign: cards flutuantes com cantos arredondados, acrílico/vibrancy (sólido sem material), topo limpo com menu ☰, ícones SVG próprios por tipo de arquivo, painel direito (Rails relacionados, servidor, Git; Ctrl+Alt+B) e botões de janela estilo macOS (`window.controls`)
- [x] Linux: janela transparente opcional (`window.transparent`), desfoque só pela extensão Blur my Shell (lista de Aplicativos com rubaxe e Opacidade dinâmica desligada; conferido em captura real); superfícies a 92% e espaços com tinta do tema — conferido em GNOME Wayland (captura real): com a opção ligada usa os círculos do Rubaxe (com `window.controls` nativos ou mac), sem overlay nativo, e fechar/minimizar/maximizar funcionam; sem sombra; redimensiona só por uma faixa de ~5 px dentro da borda
- [ ] Cliente HTTP — adiado: é um produto à parte; sem pedido concreto
- [ ] Ferramentas de banco de dados — adiado: idem; `rails console`/`rails dbconsole` cobrem o básico

### Fase 12 — Qualidade e entrega
- [x] Testes unitários (`npm test`, 50 testes): convenções de teste, fuzzy, LSP framing, rake, shell (aspas no Windows), relatórios de teste, Rails, Git, intentions, estilo de código
- [x] Meta de desempenho — medido: abre em ~0,7 s (0,93 s reabrindo um projeto); digitando num arquivo de 10.007 linhas, mediana 27 ms e pior caso 43 ms por tecla, contando 2 frames de tela
- [x] Instalador (electron-builder, NSIS) — `npm run dist` gera `release/Rubaxe-Setup-<versão>.exe`; instalação silenciosa, atalhos, app instalado (pasta com espaços e acentos) e desinstalação testados. Sem assinatura de código (não há certificado nesta máquina): o Windows SmartScreen avisa na primeira execução. Linux: o pacote é gerado, mas o node-pty não tem binário pronto para Linux — gere com `npm run dist:linux` numa máquina Linux (compila o terminal). macOS: só em um Mac (exigência da Apple)
- [x] Atualizar o README com apresentação, instalação pelo instalador e pelo código-fonte
- [x] GitHub Actions (`.github/workflows/build.yml`): gera Linux (AppImage), macOS (dmg x64 e arm64, assinatura ad-hoc) e Windows; uma tag `v*` publica tudo num Release

---

## 5. Fora do escopo (decidido)
- Descompilar ou copiar código, textos ou ícones do RubyMine/VS Code.
- Suporte a JRuby, Puppet, Capistrano, Vagrant e Code With Me (nicho; reavaliar depois).
- Marketplace de extensões (reavaliar após o MVP).

## 6. Adiados (descritos na SPEC, sem pedido concreto ainda)
- Inferência de tipos própria (inspeções de tipo além de nil/aridade/YARD).
- Cliente HTTP e ferramentas de banco de dados.
- Tipos de execução Cucumber, aplicação Rack e "comando qualquer"; relatório de Test::Unit.
- Inlay hints a partir de assinaturas RBS (tipos de atributo, parâmetro, retorno).
- Depurador: seguir subprocessos automaticamente.
- Estilo de código: espaços separados para atribuição/comparação/range e declarações vazias de classe/módulo (o RuboCop não tem cop separado); RuboCop em modo servidor (o Rubaxe só usa o RuboCop via Ruby LSP).
- Exclusão em OneDrive, pendrive FAT e nas unidades de rede reais (Y:/Z:): adiado a pedido do usuário (27/10/2026). Testado só com `subst`.

## 7. Próximas funcionalidades (pedidas, ainda não feitas)
- [x] **Comando `rubaxe .` no terminal** (como o `code .` do VS Code), conferido no app dev em 27/10/2026:
  - O app aceita pasta ou arquivo na linha de comando (`src/main/argv.ts`); caminho relativo resolve contra o cwd de quem chamou. Arquivo dentro da pasta aberta só abre a aba; fora dela, abre a pasta-mãe e depois o arquivo. A mesma pasta já aberta (inclusive com outra caixa) não faz nada; caixa errada vira a caixa real do disco (`realpath`), mas unidade mapeada, `subst`, junction e symlink ficam como digitados.
  - Uma janela por processo (28/10/2026, a pedido do usuário; substitui a instância única de 27/10): cada `rubaxe <caminho>` abre uma janela nova. Abrir Arquivo…/Abrir Pasta… com um projeto aberto pergunta "Nesta janela" / "Nova janela" (`openInNewWindow`, repassa `--user-data-dir`). `settings.json` gravado de forma atômica (temporário + rename, com nova tentativa em EPERM/EBUSY); entre janelas, a última que salvar vence.
  - Windows: o instalador (`build/installer.nsh`) cria `$INSTDIR\bin\rubaxe.cmd` e põe a pasta no PATH do usuário via PowerShell (sem limite de string do NSIS, mantém REG_EXPAND_SZ, sem duplicar); o desinstalador tira só essa entrada. Scripts de PATH testados contra uma chave de registro de teste (PATH de 11.900 caracteres idêntico na ida e volta).
  - [ ] Não testado: instalar/desinstalar/atualizar de verdade e abrir um terminal novo com `rubaxe` (precisa de autorização do usuário, mexe no PATH real).
  - [ ] macOS/Linux: depois, por um comando da paleta ("Instalar comando rubaxe no PATH").
  - Risco: com o Rubaxe instalado aberto, `npm start` sem `--user-data-dir` entrega o caminho ao app instalado e sai (os dois usam `%APPDATA%\rubaxe`).

## 8. Testes ainda não executados
Tudo abaixo ficou de fora dos testes de ponta a ponta (CDP, teclas reais e app empacotado no Windows 11) até a versão 0.2.2.

**Plataformas**
- [ ] macOS: o app inteiro, incluindo vibrancy, traffic lights nativos, menu nativo (Cmd+C/V/X/A/Q), atalhos com Option, Cmd+C/V no terminal e update em modo "Baixar vX" (abre a página do Release).
- [ ] Linux: o app inteiro, incluindo AppImage, terminal (node-pty compilado no build), perfis via `/etc/shells`, watcher recursivo, modo `mac` sem moldura e update do AppImage.
- [ ] Windows 10: fundo sólido no lugar do acrílico (`windowMaterial` = `none`).
- [ ] GitHub Actions (`.github/workflows/build.yml`): o workflow nunca rodou (builds Linux/macOS e Release com `latest*.yml` e `.blockmap`).

**Instalador e atualização**
- [ ] Atualização real pelo botão "Atualizar para vX" a partir de um Release publicado (só foi testada com um Release falso servido localmente). A primeira será a 0.2.1 instalada atualizando para a v0.2.2.
- [ ] Update sem rede e com o instalador falhando ao iniciar.
- [ ] Instalador: "Configurar o Ruby agora? → Sim" numa máquina sem Ruby (Windows limpo/VM).

**Terminal e teclado**
- [ ] Perfil WSL com uma distro instalada (deve aparecer e abrir). Sem distro ele fica oculto, e isso foi testado.
- [ ] Teclado ABNT físico (Ctrl+' para o terminal, Ctrl+Shift+").
- [x] Navegação por Tab com teclado real nos botões do cabeçalho do terminal: + → perfis → seletor → lixeira → fechar → xterm, com anel de foco; Enter/Espaço acionam (27/10/2026).

**Ruby, RuboCop e Rails** (27/10/2026, app dev + CDP; ver seção 11)
- [x] Formatar ao salvar (Ctrl+S) com RuboCop no bundle do projeto (respeita o `.rubocop.yml`), e com Standard (diagnósticos "Standard Ruby", aspas trocadas no Ctrl+S).
- [x] Opção `rubocop.config` = `projeto` × `Rubaxe` num projeto real. Por design: voltar para "projeto" mantém o `inherit_from` já gravado.
- [x] Rename Rails: fixtures (`test/fixtures/posts.yml` e `posts(:one)`) renomeadas; `bin/rails test` passa depois de ajustar à mão rotas, migração e associações. Recurso com namespace (`admin/posts`) é recusado (ver seção 9).
- [x] Debug de projeto com Gemfile e de testes Rails: usa `bundle exec rdbg` quando o `Gemfile.lock` tem a gem `debug`; para no breakpoint.
- [x] Bundler "Criar Gem…" respondendo os prompts do `bundle gem` pela linha de entrada da Saída (sem ANSI cru).
- [ ] Saída do profiler em tempo real (hoje aparece só no fim, de propósito).
- [ ] `rails console`: bloqueado nesta máquina (o `gem "fiddle"` não compila: banco do pacman/MSYS2 com assinatura PGP inválida).

**Visual**
- [ ] Acrílico com a janela sem foco e maximizada. Bloqueado: a captura da tela do Windows foi negada pela permissão.
- [ ] Contraste medido na tela, após o último ajuste, da pílula da busca (escuro) e dos ícones inativos da activity bar (claro). Na página, sem o acrílico real: 11:1 e 7,9:1. Bloqueado pelo mesmo motivo.
- [x] Hover e estado ativo do thumb das scrollbars (explorer e Configurações, nos dois temas); o menu ☰ ganhou rolagem (era bug: itens de "Exibir" ficavam fora da tela com ~576 px de altura).
- [x] Ícones em 100% de zoom: selos de controller/helper/model distintos pela cor (a forma não se lê a ~7 px); gema do `.erb` reconhecível.
- [ ] Barra de seleção do painel direito com um projeto Rails real (após a correção da seleção que sumia).

**Arquivos**
- [ ] Risco conhecido, não testado a fundo: um arquivo maior que a capacidade da Lixeira é apagado de vez pelo Windows sem aviso.

**Markdown**
- [x] Link `http(s)` da prévia abre o navegador padrão de verdade (servidor local recebeu o GET do Chrome; nenhuma janela Electron extra).

**Qualidade**
- [x] Clean room (`tools/cleanroom_check.py`) com o RubyMine 2026.2.1 instalado: 2.238 textos e 4.999 classes conferidos, 0 ocorrências, incluindo as mudanças de 27/10/2026. Rodar de novo antes de cada Release.

## 9. Limites conhecidos (ajustar um dia)
**Prévia de Markdown**
- [ ] Não fica lado a lado com o arquivo: o editor não divide a tela. Precisa de divisão de editor (grupos) para "Abrir prévia ao lado".
- [ ] Imagens da web (`https://…`) viram um marcador com o nome: o CSP (`img-src 'self' data:`) bloqueia. Caminho sugerido: IPC no main `readImage(url): Promise<string>` que baixa e devolve uma data URL, mantendo o CSP fechado.
- [ ] Imagens de um projeto aberto por caminho de rede (`\servidor\pasta`) não aparecem: o main bloqueia todo `file:` UNC para não vazar credencial NTLM. Unidades mapeadas (`Y:`) funcionam.
- [ ] Vídeo, áudio, SVG inline e imagens `data:` dentro do `.md` não são exibidos (removidos pela sanitização).
- [ ] Com muitas abas abertas, o botão de prévia (fixo à direita da barra de abas) cobre o fim da última aba. Não se reproduziu com 19 abas em 23/10/2026: com a barra rolada até o fim, o botão (1080–1102 px) fica depois da última aba (1078 px). Fica aberto até ser conferido com outros tamanhos de janela e nomes de aba.
- [ ] No tema claro, as checkboxes de tarefa usam o visual padrão do Chromium (apagadas): medido 1,5:1 (marcada) e 1,4:1 (desmarcada).

**Rails, testes e depurador**
- [ ] Rename Rails de recurso com namespace (`admin/posts`) é recusado com uma mensagem, sem alterar arquivos: o rename perdia o `Admin::` e deixava `@admin_post`/`admin_posts_path` para trás.
- [ ] Rename Rails não troca a chave `post: one` em outras fixtures, `fixtures :posts`, nem `belongs_to :post`/`has_many` de outros models, e a lista "Revise manualmente" não os cita. Ela também lista falsos positivos como `create_user_posts.rb`.
- [ ] Helper do Minitest (`src/ruby/rubaxe_minitest.rb`) validado com Minitest 6 e com o Minitest do Rails 8.1; Minitest 5.x não foi validado (instalação inconsistente nesta máquina).
- [ ] Linux/macOS: o profiler ainda faz `require 'stackprof'` antes do Bundler; um Gemfile com outra versão de stackprof volta a dar "already activated".
- [ ] Caixa errada dentro de unidade mapeada ou `subst` (`Q:\APP`) não é corrigida pelo `rubaxe <caminho>`.
- [x] O terminal continuava no cwd da pasta anterior depois de trocar de pasta. Corrigido em 28/10/2026: abrir o terminal cria um na pasta atual; os antigos ficam no seletor.
- [ ] `end` automático: em código sem indentação dentro de um método (`def a` / `if x` / `end` tudo na coluna 0), o `end` do `def` é tomado como o do `if` novo e o `end` não é inserido. Heredocs, %-literais e `x = if y` não são reconhecidos (o `end` é inserido como antes).
- [ ] `else`, `when` e `end` digitados à mão não recuam sozinhos (o VS Code recua).
- [ ] Formatação pelo RuboCop (projeto sem rubocop no Gemfile): leva ~2 s; mover o cursor ou digitar nesse meio-tempo descarta o resultado sem aviso (comportamento do Monaco). Usa `RUBOCOP_TARGET_RUBY_VERSION=3.4`, que passa por cima do `TargetRubyVersion` do projeto (indiferente para layout).
- [ ] Entrada do programa no debug é um pipe, não um TTY: `gets` funciona, `io/console` (`noecho`, `getch`) não.
- [ ] Caminho com `%NOME%` (ex.: pasta `pct%PATH%dir`) é expandido pelo cmd.exe em todo comando que passa por `shellSpawn`/`quote()`.

**Visual e janelas**
- [ ] Modo liso: o botão ativo da barra de título (`.tb-btn.active`) fica entre 3,95 e 4,40:1 (abaixo de 4,5). Com gradiente: 4,6–5,6.
- [ ] Editor e terminal continuam opacos sobre o gradiente; o terminal destoa um pouco do cabeçalho translúcido do painel.
- [ ] Várias janelas são processos separados com o mesmo perfil: a última janela que salvar as configurações vence; o Chromium avisa no console que não conseguiu mover o cache (inofensivo).

## 10. Validação parcial: Git estilo VS Code, toasts e seleção múltipla (23/10/2026, interrompida)
Rodada E2E encerrada a pedido do usuário antes do fim. App com `--user-data-dir` isolado; o `settings.json` real ficou intacto (mesmo SHA256 antes e depois). typecheck ok, 59/59 testes, build ok.

**Passou**
- Git, pasta sem repositório: tela com Inicializar / Clonar… / Conectar…, sem a caixa de commit.
- Inicializar: vira a tela de commit.
- Clonar… (`octocat/Hello-World`, pasta escolhida no diálogo nativo): clona e "Abrir a pasta clonada?" abre a pasta.
- Conectar…: links inválidos são recusados (espaço, aspas, `-oProxyCommand`, `ext::`, `&`); um link válido faz `git init` + origin e mostra a tela de commit.
- Push num repo sem remote pede o link e segue até o push.
- Toasts:
  - animação de entrada (0,22 s) e de saída;
  - cantos de 14 px e blur;
  - o hover pausa e retoma o tempo;
  - contraste 9,2:1 no escuro e 7,4:1 no claro;
  - sem animação com `prefers-reduced-motion`.
- Quick-input e busca: entrada suave e cantos de 12/10 px. "Renomear…" reabre o quick-input sem piscar.
- Seleção com mouse real: Ctrl+clique, Shift+clique e Shift+Ctrl+clique.
- Arrastar 2 arquivos + 1 pasta: destaca a pasta-alvo, move os itens e as abas acompanham.
  - Pasta dentro dela mesma: recusado.
  - "Substituir?": cancelar pula o item; OK manda o antigo para a Lixeira.
  - Soltar na área vazia: move para a raiz.
- Excluir vários com Delete: uma única confirmação e o resumo "3 excluídos, 1 em uso". O arquivo travado responde em menos de 1 s; os ~49 s vistos antes não se repetiram.
- Regressão: Ctrl+J, auto save, `end` automático, breakpoint/F5, Git no painel direito.

**Bugs encontrados (a corrigir)**
- [x] Push/Conectar recusam qualquer repositório local (`C:\…\repo.git`, `C:/…`, `file:///…`), porque `isRemoteUrl` (`src/renderer/paths.ts`) só aceita `http(s)://`, `ssh://`, `git://` e `usuario@host:caminho`. Corrigido e conferido no app (ver "Fechamento").
- [x] A saída do `git clone` vai para o painel Saída, mas o painel só abre sozinho em caso de erro (`src/renderer/git.ts`, `clone`). Corrigido e conferido no app.
- [x] `file://host/repo` é aceito por `isRemoteUrl`, e o git no Windows o abre como caminho UNC (`git upload-pack //host/repo`, visto com `GIT_TRACE`; `file://localhost/C$/…` clonou via SMB). Isso pode mandar a credencial NTLM para o host, e `\\servidor\pasta` é recusado. Corrigido: agora só passa `file:///` (ver "Fechamento, 3ª rodada").
- [x] Clonar pelo `.git` de um repositório (`C:\…\proj\.git`): o git cria `proj`, mas `cloneDir` devolve `''`. O app diz "clonado em `<pasta>\.`" e, no OK, abre a pasta-mãe (`src/renderer/paths.ts`, `cloneDir`). Corrigido e conferido no app.
- [x] Prévia de Markdown: `<input>` solto (de um `<form>` removido) continua como caixa de texto editável; DOMPurify só tira o `<form>`. Risco baixo (nada é enviado), mas permite um campo falso na prévia (`src/renderer/markdown.ts`, `PURIFY`). Corrigido e conferido no app.
- [x] Prévia de Markdown: `contenteditable` (HTML colado no `.md`) deixava editar o texto da prévia (`src/renderer/markdown.ts`, `PURIFY`). Corrigido e conferido no app.

**Fechamento (23/10/2026, 2ª rodada)**
App de desenvolvimento com `--user-data-dir` isolado. O `userData` do processo foi conferido pelo main. O `settings.json` real mudou às 18:30, mas a mudança veio do Rubaxe instalado que o usuário tinha aberto: o `lastFolder` aponta para `Downloads\test`, não para uma pasta do teste. typecheck ok, 61/61 testes, build ok. O diálogo de pasta foi respondido por um patch no `dialog.showOpenDialog` do main; o `confirm` foi respondido pela CDP.
- [x] Clone de repo bare local com `C:\…\r.git`, `C:/…/r.git` e `file:///C:/…/r.git`: a Saída já aparece com `> git clone …` antes do git responder, depois mostra a saída do git; "Abrir a pasta clonada?" abre `<pasta>\r`.
- [x] Conectar numa pasta sem Git com caminho local: `git init` + `remote add origin C:\…\r.git`; `git remote -v` confere.
- [x] Commit (mensagem com aspas, `&` e `%` preservados) + Push: `git push -u origin master` e a branch chega no bare. Push sem remote com `C:/…/r2.git`: pede o link, conecta e faz o push de `main`.
- [x] Clone de caminho inexistente: Saída aberta com o `fatal:` do git e a notificação "git clone falhou".
- [x] Recusas na tela (Clonar e Conectar): `C:\My Repos\r.git`, `ext::calc`, `-oProxyCommand=calc`, `C:\r.git&calc`, `C:repo` dão "Link inválido…". Nenhum processo é iniciado (spawn do main monitorado) e nenhum diálogo de pasta abre.
- [x] Prévia de Markdown renderizada: h1/h2 com âncora, negrito/itálico/código inline, listas (inclusive aninhada) e numerada, bloco Ruby colorido pelo Monaco e tabela. Link `#âncora` rola até o título, link `app.rb` abre a aba e link `https` chega ao `window.open`. A imagem local carrega (8×8) e as checkboxes aparecem marcada/desmarcada, desabilitadas. Removidos: `<script>`, `onerror`, `javascript:`, `<iframe>`, `<form>`, `style`, `onclick` e `<svg>`; nada executou.
- [x] 19 abas: uma linha só, rolagem horizontal, editor e janela sem estouro, e a aba ativada pelo explorador entra na área visível. Com a barra rolada até o fim, o botão de prévia (1080–1102 px) fica depois do fim da última aba (1078 px), então o item da seção 9 não se reproduziu.
- [x] Material glass com toasts (Windows 11 22631, tema escuro): toast `rgba(34,34,34,.8)` com `blur(20px)` e cantos de 14 px. Sobre o acrílico claro, o contraste medido em pixels reais da tela foi 5,97:1. Tema claro com glass: não verificado.
- [x] Regressão: Ctrl+J, auto save (salvou em ~1 s e a aba deixou de ficar suja), Git no painel direito (branch + "1 alteração"), F9 + F5 (para em `app.rb:2` com `a=2`, `b=3` e a pilha de chamadas) e `end` automático com o Ruby LSP ativo.
- [ ] Clean room: não verificado. O RubyMine não está instalado nesta máquina (`C:/Program Files/JetBrains` só tem IntelliJ e PyCharm), e o script sai com "no RubyMine strings found". Continua bloqueando o Release.
- [ ] Cmd+clique no macOS: não verificado (máquina Windows).

**Fechamento (23/10/2026, 3ª rodada)**
Integridade antes de começar: os 67 arquivos versionados não modificados batem com o índice (`git hash-object`), os 5 modificados não têm bytes nulos, `npm ls` sem pacote inválido ou ausente, nenhum arquivo de `node_modules` com bytes nulos, e Electron 44.5.1 + node-pty carregam. typecheck ok, 61/61 testes, build ok. App de desenvolvimento com `--user-data-dir` isolado (conferido pelo main), diálogo de pasta e `confirm` respondidos como na 2ª rodada.
- [x] Testes de unidade: `file:///C:/repo` e `file:///home/u/repo.git` aceitos; `file://host/repo`, `file://localhost/C$/x`, `file:////server/share` e `file://C:/x` recusados; `cloneDir` dá `conn` para `C:\a\conn\.git`, `C:/a/conn/.git/`, `/srv/conn/.git`, `C:\a\conn\.git\` e `file:///home/u/conn/.git`, e os casos de `proj` continuam iguais.
- [x] Clonar colando `C:\…\conn\.git`: o git cria `conn`, a notificação e o confirm dizem "clonado em `<pasta>\conn`", e o OK abre `<pasta>\conn` (título "conn — Rubaxe"). Com Cancelar, a pasta atual continua aberta.
- [x] Regressão Git: o clone do bare local por `file:///C:/…/r.git` funciona (`<pasta>\r` com o commit). `file://localhost/C$/…`, `file://host/repo`, `file:////server/share` e `file://C:/x` dão "Link inválido. Use https://, ssh://, git://, file:///, …". Nenhum processo é iniciado (spawn do main monitorado), nenhum diálogo de pasta abre, e a pasta de destino continua vazia.
- [x] Prévia real com `<form action="https://example.com"><input name="q"></form>`, `<button>`, `<textarea>`, `<select><option>`, `<input type="hidden">` e `<input type="text">`: nenhum controle no DOM nem na tela. O texto de dentro de `button`, `textarea` e `option` fica como texto simples (o DOMPurify mantém o conteúdo por padrão).
- [x] `- [x] feito` e `- [ ] pendente` aparecem marcada e desmarcada, `disabled`. Um clique real do mouse (CDP `Input.dispatchMouseEvent`) não muda nenhuma das duas. `<input type="checkbox">` e `<input type="CHECKBOX" checked>` colados aparecem desabilitados.
- [x] `<div contenteditable>x</div>`, `contenteditable="true"` e `contenteditable="plaintext-only"`: aparecem como texto, sem o atributo e com `isContentEditable` falso. Depois de um clique real sobre o "x", o foco fica no `body`, e digitar "ABC" + Delete + Enter não muda nada.
- [ ] Clean room: não verificado. O RubyMine continua ausente nesta máquina e o script sai com "no RubyMine strings found" (código 1). Continua bloqueando o Release.
- Perfil real: o `settings.json` real mudou às 18:52:33 durante a rodada. Uma instância de desenvolvimento sem `--user-data-dir` abriu `%APPDATA%\rubaxe` (nome do `package.json`, em minúsculas) por cerca de 3 s. O processo do teste usava o perfil isolado. Repetindo todo o fluxo (abrir pasta, clonar, OK/Cancelar, prévia, `saveSettings({})`, fechar) com um retrato do perfil real, nenhum arquivo dele mudou. A mudança não veio deste teste; a origem não foi identificada (outra execução de `electron .` na máquina).

**Ambiente desta máquina (não é bug do Rubaxe)**
- Os 5 testes `inspect:` com 0xC000012F e o Ruby LSP morrendo vieram do Ruby corrompido antes da reinstalação das 18:40 (arquivos `.rb` com bytes nulos e trechos de outros arquivos; `cgi/escape.rb` dava SyntaxError). Depois da reinstalação: 0 arquivos corrompidos e 5/5 `inspect:`.
- A mesma corrupção estava em 290 arquivos de `node_modules` (`@electron/get/dist/types.js` impedia o download do Electron) e em `tools/cleanroom_check.py`, que tinha registros do diário USN do NTFS. O `git status` não acusou porque tamanho e data batiam. O script foi restaurado do git; o `npm ci` limpo zerou os arquivos corrompidos, e o próprio npm acusou um tarball corrompido no cache. O Windows registra desligamentos inesperados quase todo dia (evento 6008), o que combina com escrita sem flush.
- Sem `user.name`/`user.email` globais no git, o commit falha com "unable to auto-detect email address". No teste foi configurado só no repositório.

## 11. Validação: abas, explorer, `rubaxe .` e seção 8 (27/10/2026)
App de desenvolvimento com `--user-data-dir` isolado (conferido pelo main), em três rodadas. Diálogos nativos, `trashItem` e `openExternal` respondidos por patch/CDP; nada foi para a Lixeira. `settings.json` real com o mesmo SHA256 antes e depois. Nenhuma gem global nem Ruby instalado (bundles só em `vendor/bundle` de projetos temporários). typecheck ok, 67/67 testes, build ok, clean room 0 ocorrências.
- [x] Abas: arrastar reordena (antes/depois pela metade), a ativa não muda; abas e explorer recusam o arrasto um do outro; o botão de prévia não arrasta.
- [x] Abas com o mesmo nome: `…\articles`, `…\comments`, `…\users` visíveis por inteiro; nome longo encolhe a descrição primeiro (só o tooltip diferencia quando ela some); fechando as outras, a descrição some; contraste 6,1–7,6:1.
- [x] Explorer: clique na área vazia (inclusive com a árvore longa rolada) limpa a seleção e "Nova pasta" cria na raiz; Ctrl/Shift+clique, F2, Delete e soltar na área vazia continuam funcionando.
- [x] `rubaxe <caminho>` em todos os casos da seção 7 (boot com e sem argv, `.`/relativo/`..`, minimizado, arquivo dentro e fora, mesma pasta com outra caixa, inexistente, espaço e `\` final, aba suja com Cancelar/OK, dois comandos seguidos, caixa errada, `subst`).
- [x] Bugs achados e corrigidos na rodada: ANSI cru na Saída e no Console de Depuração; helpers de teste/cobertura/profiler ativando `json`/`minitest` antes do Bundler ("already activated"); debug com Gemfile usando o `rdbg` global; rename Rails perdendo o namespace (agora recusa) e ignorando fixtures; menu ☰ sem rolagem; contraste da descrição das abas; descrição das abas cortada; view Testes mantendo resultados e cobertura do projeto anterior.
- [x] Teste por linha (▶ na margem) roda 1 teste; o "Running 3 tests" do Rails é a contagem dos carregados. No Windows o Rails quebra com caminho absoluto + linha (divide no `:`); o Rubaxe passa caminho relativo e não é afetado.
- [x] Regressão: Ctrl+J, auto save, Git no painel direito, F9+F5, prévia de Markdown.
- Observado, cosmético: na Saída, cada prompt respondido do `bundle gem` aparece duas vezes (o Thor reescreve a linha com `\r`).

## 12. Validação: correções relatadas pelo usuário (28/10/2026)
App de desenvolvimento com `--user-data-dir` isolado (conferido pelo main e na linha de comando das janelas novas), diálogos/`confirm`/`trashItem`/`openExternal` por patch, `settings.json` real com o mesmo SHA256 antes e depois, nada instalado globalmente. typecheck ok, 71/71 testes, build ok, clean room 0 ocorrências (escopo `plugins/ruby/lib`, cópia sem `node_modules`).
- [x] `end` duplicado: a causa é o Ruby LSP (com qualquer erro de sintaxe no arquivo ele insere `end` sem ver se o bloco já fecha); o Rubaxe descarta o `end` quando o bloco já está fechado (`blockClosed`), inclusive com o corpo na coluna 0. `if`, `def`, `do |x|`, `while`, `case` e comentários conferidos.
- [x] Formatação: Shift+Alt+F (atalho, menu Editar, paleta, foco fora do editor) e formatar ao salvar. Sem rubocop no Gemfile, formata pelo RuboCop do Ruby escolhido (`formatRuby`); com ele, pelo Ruby LSP. Ctrl+Z desfaz em um passo; sintaxe inválida avisa com linha/coluna e salva mesmo assim; `.rubocop.yml` respeitado nos dois caminhos. ~50 s de digitação sem mexida indevida.
- [x] Debug: barra flutuante no topo do editor ao parar (com a lateral em qualquer view ou fechada); F5/F10/F11/Shift+F11/Shift+F5 inclusive com foco no terminal. "Entrada do programa" no Console de Depuração: `gets.chomp` recebe o texto, com e sem `bundle exec rdbg`.
- [x] Fundo em gradiente (padrão) vermelho/preto no escuro e branco/vermelho no claro, `workbench.background` = gradiente/liso aplicando na hora; painéis a 75% e desfoque de 40 px. Contraste medido na tela: `--fg` 7,9–11, `--muted` 5,85–7, texto vermelho 5–7,7.
- [x] Várias janelas: um processo por janela; `rubaxe <caminho>` sempre abre uma nova; Abrir Arquivo…/Abrir Pasta… com projeto aberto perguntam "Nesta janela"/"Nova janela". 80 gravações simultâneas de duas janelas deixaram o `settings.json` válido.
- [x] Terminal novo segue a pasta aberta.
- [x] Achados e corrigidos na rodada: desfoque de 40 px vencido pela regra do acrílico; `end` com corpo na coluna 0; cancelar "descartar alterações" ao abrir pasta fechava as abas limpas (agora pergunta antes de fechar qualquer uma); "Model is disposed!" nas intentions ao fechar abas.
- [ ] Não testado: instalador real (`rubaxe.cmd` no PATH), material `none` real (foi simulado), Linux/macOS.

## 13. ERB e linguagens web (28–29/10/2026)
Diagnóstico: só o ERB estava quebrado (tratado como HTML puro e nunca enviado ao Ruby LSP); HTML/CSS/JS/JSON já funcionavam (workers do Monaco 0.57 já vêm configurados). App dev e empacotado com perfil isolado, `settings.json` real intacto, nada instalado. typecheck ok, 72/72 testes, build ok, clean room 0 ocorrências.
- [x] App Rails real: `posts_path`/`posts_url`, chaves i18n em `t("`, `Post.fi` (Ruby LSP), tags HTML, hover com schema (ruby-lsp-rails), F12 em model e helper; sem `end` automático, Ctrl+S com formatar ao salvar e a espera de 4 s não alteram o `.erb`; "Views ERB" liga/desliga o Ruby LSP no ERB.
- [x] App empacotado (`--dir`): worker HTML carrega do `app.asar` (tags no `.erb`, propriedades no `.css`), Ruby LSP e rotas no `.erb`.
- [x] Não é regressão: `u = User.new` + `u.` num `.rb` dá o mesmo na v0.2.9. O Ruby LSP não deduz tipo por atribuição, parâmetro de bloco (`post.` no `each`) nem variável de instância (`@post.`); só adivinha pelo nome (`user.` → `User`).
- [x] `<% end %>` (e `-%>`, `<%-`) sem cor e com "trying to pop an empty stack" no console: corrigido com regra própria em `erbMonarch`.
- [x] `<% end.join %>`/`<% end; x %>`: o `end` inicial vira palavra-chave e o resto da tag vai para o Ruby. `{`/`}` de bloco dividido entre tags não ficam mais vermelhos (o ERB não tem o par `<` `>`, que fechava o `<%` no `%>`). Hover vazio do ruby-lsp (helper): mostra a linha `def` do destino da definição, comentários `#` acima e `caminho:linha`.
- [ ] Limites: `<% x.end %>` ainda dá o erro de tokenização (gramática Ruby do Monaco); Ruby dentro de atributo fica com a cor do atributo; `.js.erb`/`.yml.erb` usam o realce de HTML; aviso repetido "[suggest] did IGNORE invalid completion item" no console ao digitar `<%= x.`. SCSS e TypeScript não testados (mesmos workers do CSS/JS).
- [ ] Commit e Release v0.2.10.
