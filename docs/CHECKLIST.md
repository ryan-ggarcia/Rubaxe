# Rubaxe — Checklist de desenvolvimento

IDE para Ruby com o **suporte à linguagem do RubyMine** e o **layout, navegação e estilo do VS Code**.
Tudo é implementado do zero, em processo clean room: a pesquisa coletou apenas *o que* cada funcionalidade faz, nunca código.

> Status: **fases 1–6 (MVP) implementadas** em TypeScript + Electron. Próximo passo: resolver a seção 2 e validar a fase 3 com o Ruby LSP real.
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

- [ ] **Reinstalar o Node.js** — `npm` está corrompido (`node_modules/npm/node_modules/which/lib/index.js` contém bytes binários).
- [ ] **Reinstalar o Ruby 4.0** — `lib/ruby/4.0.0/rubygems/defaults/operating_system.rb` está corrompido; `ruby -e`, `gem` e `bundle` falham.
- [ ] `gem install ruby-lsp` (depois de reinstalar o Ruby).

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
- [x] Abrir, editar e salvar (Ctrl+S)
- [x] Quick Open de arquivos com busca fuzzy (Ctrl+P)
- [x] Paleta de comandos (Ctrl+Shift+P / F1) com comandos do Rubaxe e do editor
- [x] Prefixos do Quick Open: `>` comandos, `:` ir para linha, `#` símbolo no projeto
- [x] Busca no projeto com regex e case-sensitive (Ctrl+Shift+F)
- [x] Visão "Estrutura" do arquivo (outline)

### Fase 3 — Inteligência Ruby via Ruby LSP ★
> Implementado, mas **não testado com o Ruby LSP real**: o Ruby desta máquina está corrompido (seção 2). Testado: mensagem de erro quando o LSP não sobe.

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
> Testado: execução com saída em streaming e código de saída, ir para teste ↔ implementação. RSpec/Minitest/Bundler/Rake dependem do Ruby funcionando.

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
- [ ] Cliente DAP + `rdbg`
- [ ] Breakpoints (linha, condicional), step over/into/out, continuar
- [ ] Variáveis, watches, pilha de chamadas, console de avaliação
- [ ] Depurar testes; attach a processo; debug remoto

### Fase 8 — Testes avançados
- [ ] Árvore de testes com resultado por exemplo
- [ ] Reexecutar só os que falharam
- [ ] Ícone "executar" na margem ao lado de `describe`/`it`/`def test_`
- [ ] Cobertura (SimpleCov) no editor
- [ ] Profiler (stackprof / vernier)

### Fase 9 — Rails
- [ ] Navegar Model ↔ Controller ↔ View ↔ Helper ↔ Layout ↔ Routes ↔ Schema
- [ ] Executar generators (model, controller, scaffold, migration…)
- [ ] Rails server e Rails console como configurações de execução
- [ ] Completar rotas e chaves i18n; rename que entende Rails

### Fase 10 — Recursos avançados do RubyMine
- [ ] Intentions: `{}`↔`do…end`, hash rocket↔`key:`, `if`↔ternário, modificador↔statement, inverter/juntar/dividir `if`, string↔símbolo, interpolação, heredoc squiggly, `_` em números, ordenar hash
- [ ] Geração: `attr_accessor`/`reader`/`writer`, construtor, `let` do RSpec
- [ ] Inspeções extras além do RuboCop (nil, tipos, Rails, RSpec, YARD)
- [ ] Inlay hints e realce semântico
- [ ] Hierarquia de tipos e de chamadas
- [ ] Gerenciadores de versão (rbenv, rvm, asdf, chruby, mise)
- [ ] Lista de gems com navegação para o código-fonte
- [ ] RBS e Steep
- [ ] Console IRB / Pry; carregar seleção no console
- [ ] Code style configurável (opções da seção 3)

### Fase 11 — Ferramentas
- [ ] Terminal integrado (xterm.js + node-pty)
- [ ] Git: status, diff, stage, commit, blame, branches
- [ ] Cliente HTTP
- [ ] Ferramentas de banco de dados

### Fase 12 — Qualidade e entrega
- [x] Testes unitários (`npm test`) para lógica não trivial (convenções de teste, fuzzy, LSP framing, rake)
- [ ] Meta de desempenho: abrir em < 1,5 s e digitar sem atraso em arquivos de 10 mil linhas
- [ ] Instalador (electron-builder)
- [x] Atualizar o README com "como rodar"

---

## 5. Fora do escopo (decidido)
- Descompilar ou copiar código, textos ou ícones do RubyMine/VS Code.
- Suporte a JRuby, Puppet, Capistrano, Vagrant e Code With Me (nicho; reavaliar depois).
- Marketplace de extensões (reavaliar após o MVP).
