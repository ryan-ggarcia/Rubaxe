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
| Terminal (futuro) | xterm.js + node-pty | — | Padrão do VS Code. |
| Empacotamento (futuro) | electron-builder | — | Instalador Windows/macOS/Linux. |
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
- [x] Activity Bar: Explorer, Busca, Ruby, Configurações
- [x] Side Bar redimensionável e recolhível (Ctrl+B)
- [x] Abas de editor: ativa/inativa, indicador de "não salvo", fechar (Ctrl+W)
- [x] Panel inferior redimensionável (Ctrl+J): Problemas, Saída
- [x] Status Bar: versão do Ruby, status do Ruby LSP, erros/avisos, Ln/Col, indentação, encoding, linguagem
- [x] Tema Dark Modern (cores oficiais) também no Monaco
- [x] Tela de boas-vindas: "Abrir pasta" + atalhos; reabrir última pasta

### Fase 2 — Arquivos, navegação e busca ★
- [x] Explorer em árvore (carregamento sob demanda), novo arquivo/pasta, atualizar, recolher tudo
- [x] Renomear (F2) e mover para a lixeira (Delete) pelo menu de contexto do explorer; abas abertas acompanham
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
- [x] Bundler: install, update, outdated, lock, clean
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
- [x] Reexecutar só os que falharam (RSpec/Rails por `arquivo:linha`, Minitest por nome)
- [x] Ícone "executar" na margem ao lado de `describe`/`it`/`def test_`/`test "..."`, com cor do último resultado
- [x] Cobertura no editor — módulo `Coverage` do Ruby (o mesmo que o SimpleCov usa), barra verde/vermelha na margem e resumo no painel
- [x] Profiler — por amostragem (sem sobrecarga medível; stackprof no Linux/macOS, thread de amostragem no Windows, onde stackprof/vernier não compilam) e modo "instrumentado, exato" com contagem de chamadas; a lista abre o `def` do método

### Fase 9 — Rails
> **Testado no app real** com um app Rails 8.1 gerado (`rails new --minimal` + scaffold), 14 checagens. Rails 8.1 em Ruby 4.0/Windows: o `rails console` precisa de `gem "fiddle"` no Gemfile do app (exigência do reline, não do Rubaxe).

- [x] Navegar Model ↔ Controller ↔ View ↔ Helper ↔ Layout ↔ Routes ↔ Schema (Ctrl+Shift+R; da view vai para a action, do model para o `create_table`)
- [x] Executar generators (model, controller, scaffold, migration…) e desfazer (`rails destroy`); db:migrate/rollback/seed
- [x] Rails server (painel Saída) e Rails console (terminal integrado)
- [x] Completar rotas (`_path`/`_url` de `bin/rails routes`) e chaves i18n (`t('…')` de `config/locales`); views `.erb` com realce HTML
- [ ] Rename que entende Rails (renomear model/controller/views juntos) — adiado: mexe em muitos arquivos de uma vez; risco alto sem pedido concreto

### Fase 10 — Recursos avançados do RubyMine
> **Testado no app real** (16 checagens) + 13 testes unitários das intentions.

- [x] Intentions (Ctrl+.): `{}`↔`do…end`, hash rocket↔`key:`, `if`↔ternário, modificador↔statement, inverter/juntar/dividir `if`, string↔símbolo, interpolação, heredoc squiggly, `_` em números, ordenar hash
- [x] Geração (Ctrl+.): `attr_accessor`/`reader`/`writer`, `initialize`, `let` do RSpec
- [ ] Inspeções extras além do RuboCop (nil, tipos, Rails, RSpec, YARD) — adiado: exigiria inferência de tipos própria; Rails/RSpec já vêm do RuboCop com `rubocop-rails`/`rubocop-rspec` no projeto
- [x] Inlay hints e realce semântico (do Ruby LSP; ele só marca o que a gramática não distingue)
- [x] Hierarquia de tipos (Ruby LSP) e chamadas do método (Shift+Alt+H; montada a partir dos usos, o Ruby LSP não tem call hierarchy)
- [x] Gerenciadores de versão: seletor de interpretador (rbenv, rvm, asdf, chruby, mise, RubyInstaller, PATH); o escolhido vai na frente do PATH de tudo que o Rubaxe executa
- [x] Lista de gems (view Ruby) com navegação para o código-fonte
- [x] RBS e Steep — `.rbs` com realce Ruby e comando `steep check` (testado com Steep 2.1: aponta o erro de tipo contra a assinatura RBS)
- [x] Console IRB; enviar seleção ao console (Ctrl+Alt+Enter). Pry: rode `pry` no terminal
- [x] Code style configurável: opções da SPEC viram `.rubocop_rubaxe.yml` (herdado pelo `.rubocop.yml`), aplicado pelo formatador via RuboCop

### Fase 11 — Ferramentas
> **Testado no app real** (13 checagens): PowerShell no terminal, IRB, Git completo num repositório de teste.

- [x] Terminal integrado (xterm.js + node-pty com binário pré-compilado; vários terminais)
- [x] Git: status, diff (aba lado a lado), stage/unstage, commit, blame da linha, branches (trocar/criar pela barra de status)
- [ ] Cliente HTTP — adiado: é um produto à parte; sem pedido concreto
- [ ] Ferramentas de banco de dados — adiado: idem; `rails console`/`rails dbconsole` cobrem o básico

### Fase 12 — Qualidade e entrega
- [x] Testes unitários (`npm test`, 31 testes): convenções de teste, fuzzy, LSP framing, rake, relatórios de teste, Rails, Git, intentions, estilo de código
- [x] Meta de desempenho — medido: abre em ~0,7 s (0,93 s reabrindo um projeto); digitando num arquivo de 10.007 linhas, mediana 27 ms e pior caso 43 ms por tecla, contando 2 frames de tela
- [x] Instalador (electron-builder, NSIS) — `npm run dist` gera `release/Rubaxe Setup <versão>.exe`; instalação silenciosa, atalhos, app instalado (pasta com espaços e acentos) e desinstalação testados. Sem assinatura de código (não há certificado nesta máquina): o Windows SmartScreen avisa na primeira execução. Linux: o pacote é gerado, mas o node-pty não tem binário pronto para Linux — gere com `npm run dist:linux` numa máquina Linux (compila o terminal). macOS: só em um Mac (exigência da Apple)
- [x] Atualizar o README com "como rodar"

---

## 5. Fora do escopo (decidido)
- Descompilar ou copiar código, textos ou ícones do RubyMine/VS Code.
- Suporte a JRuby, Puppet, Capistrano, Vagrant e Code With Me (nicho; reavaliar depois).
- Marketplace de extensões (reavaliar após o MVP).
