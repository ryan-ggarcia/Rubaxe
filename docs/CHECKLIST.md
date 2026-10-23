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
- [x] Side Bar redimensionável e recolhível (Ctrl+B)
- [x] Abas de editor: ativa/inativa, indicador de "não salvo", fechar (Ctrl+W)
- [x] Panel inferior redimensionável (Ctrl+J abre já com terminal): Problemas, Saída, Console de Depuração, Terminal
- [x] Status Bar: versão do Ruby, status do Ruby LSP, erros/avisos, Ln/Col, indentação, fim de linha (LF/CRLF), linguagem
- [x] Tema escuro e claro (`workbench.theme`) com destaque vermelho Ruby (#CC342D) e cantos arredondados, também no Monaco, xterm e barra de título
- [x] Auto save: 1 s após a última edição e ao trocar de aba/perder o foco; não formata (só Ctrl+S) e não sobrescreve edição externa (com aba suja + edição externa o auto save fica suspenso; Ctrl+S grava)
- [x] Tela de boas-vindas: "Abrir pasta" + atalhos; reabrir última pasta

### Fase 2 — Arquivos, navegação e busca ★
- [x] Explorer em árvore (carregamento sob demanda), novo arquivo/pasta, atualizar, recolher tudo
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
- [x] Formatar documento e "formatar ao salvar"
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
- [x] Gerais: caminho do Ruby, comando do Ruby LSP, framework de teste, fonte, tab, minimapa, quebra de linha, formatar ao salvar
- [x] **Registro de funcionalidades**: cada função do RubyMine aparece com interruptor; implementadas podem ser ligadas/desligadas, as demais aparecem como "planejado"
- [x] Persistência em JSON no diretório do usuário

### Fase 7 — Depurador
> **Testado no app real** (CDP, 22 checagens). rdbg abre uma porta TCP e fala DAP; o Rubaxe conecta com `attach { localfs: true }` e pula a parada automática no carregamento. O rdbg para no `end` do método ao "Sair" (Shift+F11); o Rubaxe mostra a linha do chamador, como no VS Code.

- [x] Cliente DAP + `rdbg` (`rdbg --open -c -- <comando>`; F5 depura o arquivo atual)
- [x] Breakpoints (linha, condicional), step over/into/out, continuar — clique na margem ou F9; Shift+clique ou paleta para condição
- [x] Variáveis, watches, pilha de chamadas, console de avaliação (painel "Console de Depuração")
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
- [x] Completar rotas (`_path`/`_url` de `bin/rails routes`) e chaves i18n (`t('…')` de `config/locales`); views `.erb` com realce HTML
- [x] Rename que entende Rails ("Rails: Renomear Recurso..."): model, controller, helper, pasta de views e testes/specs + constantes via Ruby LSP; pré-visualização com confirmação; `routes.rb` e migrations só listados para revisão manual

### Fase 10 — Recursos avançados do RubyMine
> **Testado no app real** (16 checagens) + 13 testes unitários das intentions.

- [x] Intentions (Ctrl+.): parâmetros nomeados↔numerados (`it`/`_1`), mover string para i18n, embutir variável local, juntar ifs em sequência (só com saída de fluxo), `{}`↔`do…end`, hash rocket↔`key:`, `if`↔ternário, modificador↔statement, inverter/juntar/dividir `if`, string↔símbolo, interpolação, heredoc squiggly, `_` em números, ordenar hash
- [x] Geração (Ctrl+.): `attr_accessor`/`reader`/`writer`, `initialize`, `let` do RSpec
- [x] Inspeções próprias (`src/ruby/rubaxe_inspect.rb`, Prism): YARD (`@param` desconhecido/faltando, `@return` em `initialize`), chamada em nil certo, aridade de métodos do mesmo arquivo. Só regras determinísticas; inferência de tipos completa segue fora
- [x] Inlay hints e realce semântico (do Ruby LSP; ele só marca o que a gramática não distingue)
- [x] Hierarquia de tipos (Ruby LSP) e chamadas do método (Shift+Alt+H; montada a partir dos usos, o Ruby LSP não tem call hierarchy)
- [x] Gerenciadores de versão: seletor de interpretador (rbenv, rvm, asdf, chruby, mise, RubyInstaller, PATH); o escolhido vai na frente do PATH de tudo que o Rubaxe executa
- [x] Lista de gems (view Ruby) com navegação para o código-fonte
- [x] RBS e Steep — `.rbs` com realce Ruby e comando `steep check` (testado com Steep 2.1: aponta o erro de tipo contra a assinatura RBS)
- [x] Console IRB; enviar seleção ao console (Shift+Alt+Enter). Pry: rode `pry` no terminal
- [x] Code style configurável: opções da SPEC viram `.rubocop_rubaxe.yml` (herdado pelo `.rubocop.yml`), aplicado pelo formatador via RuboCop

### Fase 11 — Ferramentas
> **Testado no app real** (13 checagens): PowerShell no terminal, IRB, Git completo num repositório de teste.

- [x] Terminal integrado (xterm.js + node-pty com binário pré-compilado; vários terminais; perfis PowerShell/PowerShell 7/Prompt de Comando/Git Bash/WSL e perfil padrão)
- [x] Git: status, diff (aba lado a lado), stage/unstage, commit, blame da linha, branches (trocar/criar pela barra de status), push/pull/fetch
- [x] Aba Git numa pasta sem repositório (como no VS Code): Inicializar, Clonar (link validado, pasta de destino, abrir a pasta clonada) e Conectar a um remoto (init + origin); Push/Sincronizar sem remote pede o link e faz push -u
- [x] Prévia de Markdown (`Ctrl+Shift+V`, botão na aba do `.md`, menu Exibir): aba própria ao lado do arquivo (o editor não divide a tela), atualiza ao vivo; GFM (tabelas, tarefas, tachado, autolinks), código colorido pelo Monaco, links relativos abrem no Rubaxe, `#âncora` rola, `http(s)` vai para o navegador; HTML passa pelo DOMPurify e nada carrega sozinho (imagens só locais, resolvidas a partir da pasta do `.md`; da web viram um marcador)
- [x] Mensagens (toasts) e barras de entrada no estilo macOS: entrada e saída suaves, fundo translúcido com desfoque, pausa ao passar o mouse; sem animação com prefers-reduced-motion
- [x] Redesign: cards flutuantes com cantos arredondados, acrílico/vibrancy (sólido sem material), topo limpo com menu ☰, ícones SVG próprios por tipo de arquivo, painel direito (Rails relacionados, servidor, Git; Ctrl+Alt+B) e botões de janela estilo macOS (`window.controls`)
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

## 7. Próximas funcionalidades (pedidas, ainda não feitas)
- [ ] **Comando `rubaxe .` no terminal** (como o `code .` do VS Code):
  - O app aceita pasta ou arquivo na linha de comando: `Rubaxe.exe <pasta>` abre a pasta; `Rubaxe.exe <arquivo>` abre o arquivo.
  - Instância única: com o Rubaxe já aberto, a mesma janela troca para a pasta nova (perguntando antes se houver aba não salva).
  - Windows: o instalador (`build/installer.nsh`) cria `rubaxe.cmd` numa pasta própria e a põe no PATH do usuário; o desinstalador remove os dois. Só vale após reinstalar; terminais já abertos precisam ser reabertos.
  - macOS/Linux: depois, por um comando da paleta ("Instalar comando rubaxe no PATH").

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
- [ ] Navegação por Tab com teclado real nos botões do cabeçalho do terminal (só a ordem no DOM foi conferida).

**Ruby, RuboCop e Rails**
- [ ] Formatar ao salvar (Ctrl+S) com RuboCop no bundle do projeto, e com Standard (`rubocop.standard`, `linters: ['standard']` no Ruby LSP).
- [ ] Opção `rubocop.config` = `projeto` × `Rubaxe` num projeto real.
- [ ] Rename Rails: recursos com namespace (`admin/posts`), fixtures (`posts(:one)`, `test/fixtures/posts.yml`) e app com testes de controller reais (`bin/rails test`).
- [ ] Debug de projeto com Gemfile (`bundle exec`) e de testes Rails.
- [ ] Bundler "Criar Gem…" respondendo os prompts do `bundle gem` pela linha de entrada da Saída.
- [ ] Saída do profiler em tempo real (hoje aparece só no fim, de propósito).

**Visual**
- [ ] Acrílico com a janela sem foco e maximizada.
- [ ] Contraste medido na tela, após o último ajuste, da pílula da busca (escuro) e dos ícones inativos da activity bar (claro). Hoje só calculado.
- [ ] Hover e estado ativo do thumb das scrollbars; scrollbars dentro do menu ☰ e de Configurações.
- [ ] Ícones em 100% de zoom: os selos de controller/helper/model e a gema do `.erb` têm ~7 px.
- [ ] Barra de seleção do painel direito com um projeto Rails real (após a correção da seleção que sumia).

**Arquivos**
- [ ] Exclusão em OneDrive, pendrive FAT e nas unidades de rede reais (Y:/Z:). Testado só com `subst`.
- [ ] Risco conhecido, não testado a fundo: um arquivo maior que a capacidade da Lixeira é apagado de vez pelo Windows sem aviso.

**Markdown**
- [ ] Link `http(s)` da prévia abrindo o navegador de verdade (testado só até o `window.open`; o `setWindowOpenHandler` do main é o mesmo de antes).

**Qualidade**
- [ ] Rodar o clean room (`tools/cleanroom_check.py`) antes do próximo Release. Última execução com 0 hits: no redesign. Update, ajustes visuais e ícones vieram depois.

## 9. Limites conhecidos (ajustar um dia)
**Prévia de Markdown**
- [ ] Não fica lado a lado com o arquivo: o editor não divide a tela. Precisa de divisão de editor (grupos) para "Abrir prévia ao lado".
- [ ] Imagens da web (`https://…`) viram um marcador com o nome: o CSP (`img-src 'self' data:`) bloqueia. Caminho sugerido: IPC no main `readImage(url): Promise<string>` que baixa e devolve uma data URL, mantendo o CSP fechado.
- [ ] Imagens de um projeto aberto por caminho de rede (`\servidor\pasta`) não aparecem: o main bloqueia todo `file:` UNC para não vazar credencial NTLM. Unidades mapeadas (`Y:`) funcionam.
- [ ] Vídeo, áudio, SVG inline e imagens `data:` dentro do `.md` não são exibidos (removidos pela sanitização).
- [ ] Com muitas abas abertas, o botão de prévia (fixo à direita da barra de abas) cobre o fim da última aba. Não se reproduziu com 19 abas em 23/10/2026: com a barra rolada até o fim, o botão (1080–1102 px) fica depois da última aba (1078 px). Fica aberto até ser conferido com outros tamanhos de janela e nomes de aba.
- [ ] No tema claro, as checkboxes de tarefa usam o visual padrão do Chromium (apagadas).

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
