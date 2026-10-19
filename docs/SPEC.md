# Especificação de comportamento

Descrição, com palavras nossas, do que cada área faz. É a única entrada da implementação (veja [CLEAN_ROOM.md](CLEAN_ROOM.md)).

## Interface (referência: VS Code)

- Layout: barra de título com caixa de busca central · barra de atividades à esquerda · barra lateral · área de abas e editor · painel inferior · barra de status.
- Cores (tema Dark Modern): barras `#181818`, editor `#1F1F1F`, bordas `#2B2B2B`, destaque `#0078D4`, texto `#CCCCCC`, texto secundário `#9D9D9D`, campos `#313131` com borda `#3C3C3C`.
- Aba ativa: fundo do editor, texto branco, linha de destaque no topo. Aba com alterações: bolinha no lugar do "x".
- Atalhos: Ctrl+P arquivos, Ctrl+Shift+P comandos, Ctrl+Shift+F busca, Ctrl+B barra lateral, Ctrl+J painel, Ctrl+, configurações, Ctrl+S salvar, Ctrl+W fechar aba.
- No VS Code puro, Ruby tem só realce de sintaxe; a inteligência vem de servidores de linguagem.

## Suporte Ruby (referência: RubyMine)

**Áreas e peso relativo** (proporção de código do plugin): linguagem e modelo de símbolos > inteligência de código > inspeções > suporte a Rails > ações > gerenciadores de versão > execução > RSpec > refatoração > depurador > documentação YARD > Bundler > Rake > Minitest > SDK.

**Configurações oferecidas:** interpretador Ruby e gems · Bundler · RuboCop · caminhos do Rails · inteligência de código · RBS · profiler · Docker.

**RuboCop:** usar a configuração do projeto ou a padrão; corrigir automaticamente ao salvar; modo servidor (mais rápido); alternativa com a gem Standard.

**Estilo de código Ruby (opções):** espaços em volta de `=>`, de chaves de hash e de bloco, de operadores (atribuição, comparação, range, potência), de pipes de bloco e dentro de arrays; alinhar o lado direito de atribuições e hashes em sequência; alinhar expressões binárias quebradas (nenhum, indentado, pelo primeiro operando); alinhar cadeias de métodos quebradas (nenhum, pelo receptor, pelos pontos); indentar `when` dentro de `case`; indentar `private`/`protected`/`public` e os métodos depois deles; transformar `{ }` em `do…end` ao apertar Enter dentro do bloco; declarações vazias em uma ou várias linhas. Dois presets: padrão e o estilo "omakase" do Rails.

**Tipos de execução:** script Ruby, servidor Rails, tarefa Rake, RSpec, Minitest/Test::Unit, Cucumber, IRB, aplicação Rack, Capistrano, comando qualquer, conexão de depuração remota.

**RSpec:** rodar todos os specs de uma pasta (com filtro de nome de arquivo), um arquivo, vários arquivos, um exemplo pela linha ou por ID (`arquivo[1:2]`); runner próprio opcional; opção de backtrace completo.

**Versões do Ruby:** detectar rbenv, rvm, asdf, chruby, mise e o Ruby do sistema; respeitar `.ruby-version`.

**Ir para teste:** `app/x.rb` ↔ `spec/x_spec.rb` ou `test/x_test.rb`; `lib/x.rb` ↔ `spec/x_spec.rb` ou `spec/lib/x_spec.rb`; quando o teste não existe, oferecer criá-lo.

**Dicas no editor (inlay hints, a partir de assinaturas RBS):** tipo de atributo, de parâmetro de bloco, do `self` no bloco, de constante, de coleção, de variável global, de parâmetro e de retorno de método.

**Depurador:** breakpoints, watches, console para avaliar expressões, anexar a um processo em execução e seguir subprocessos automaticamente.

**Bundler:** install, update, outdated, lock, clean, pack, init, criar gem; avisar quando uma gem do Gemfile não está instalada.

**Rake:** listar as tarefas do projeto e executá-las; recarregar a lista.

**Rails:** alternar entre model, controller, view, helper, layout, rotas e schema; executar generators; console e servidor; completar rotas e chaves de i18n; renomear em conjunto model/controller/view/migration.

**Ações no código (intentions):** trocar `{}` ↔ `do…end`; hash rocket ↔ sintaxe `chave:`; `if` ↔ ternário; `if` em linha ↔ bloco; inverter `if/else`; juntar e dividir `if`s aninhados ou em sequência; string ↔ símbolo; concatenação → interpolação; heredoc → heredoc indentado; `_` em números longos; parâmetros numerados ↔ nomeados; ordenar hash por chave; mover string para i18n; extrair bloco para método; introduzir e embutir variável local.

**Inspeções (categorias):** prováveis bugs (referência não resolvida, número de argumentos, chave duplicada, `rescue` vazio, chamada a método privado, tipos incompatíveis); fluxo de dados (`nil`, objeto congelado alterado, código inalcançável, variável não usada); fluxo de controle; código redundante; estilo; nomes fora da convenção; métricas (classe grande demais); Rails; RSpec; YARD; gems.
