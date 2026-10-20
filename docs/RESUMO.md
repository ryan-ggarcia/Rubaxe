# Resumo do desenvolvimento do Rubaxe

IDE para Ruby com o **suporte à linguagem do RubyMine** e o **layout/estilo do VS Code**, feita do zero em processo [clean room](CLEAN_ROOM.md). Este arquivo resume as decisões e o andamento.

## Decisões

- **Stack:** Electron + Monaco (editor do VS Code) + Codicons para a interface; TypeScript com esbuild; HTML/CSS/TS puros, sem framework. Inteligência Ruby via **Ruby LSP** (Prism, RuboCop); depurador futuro via `rdbg`/DAP. Descartados: Tauri (exige Rust), C++/Qt (editor teria de ser reescrito), reimplementar o motor do RubyMine (anos de trabalho que o Ruby LSP já cobre).
- **Pesquisa sem cópia:** o REA inventariou os JARs do RubyMine e scripts leram apenas descritores (`plugin.xml`, `.properties`) e nomes de classe — nunca bytecode. Tudo virou [SPEC.md](SPEC.md) com palavras nossas. O verificador [`tools/cleanroom_check.py`](../tools/cleanroom_check.py) confirma 0 ocorrências de texto/classe do RubyMine no repositório.
- **Escopo:** o VS Code puro só tem gramática de Ruby; todo o "suporte" vem de extensões. Logo, o diferencial do Rubaxe é trazer o suporte do RubyMine com a cara do VS Code.

## O que está pronto (MVP, fases 1–6) e testado

- **Interface** no tema Dark Modern: activity bar, explorer, abas (com "não salvo"), painel inferior, barra de status.
- **Arquivos e navegação:** abrir pasta, editar/salvar, **aviso de não salvo ao fechar**, Ctrl+P (fuzzy), paleta de comandos (comandos do Rubaxe + ações do Monaco), busca no projeto, estrutura do arquivo.
- **Inteligência Ruby (Ruby LSP):** estrutura/símbolos, autocompletar, **diagnósticos ao vivo** (Prism), hover, definição, usos, rename, formatação, quick-fixes.
- **Executar e testar:** executar arquivo (Ctrl+F5), RSpec/Minitest, ir para teste ↔ implementação; Bundler (install/update/...), Rake.
- **Configurações:** editor no estilo VS Code com busca e um **registro de funcionalidades** (cada função do RubyMine com interruptor; as não implementadas aparecem como "planejado").

## Fases 7–12 (prontas e testadas no app real)

- **Depurador:** rdbg via DAP — breakpoints (linha e condicional), passos, variáveis, inspeção, pilha, console de avaliação, depurar testes, anexar a processo.
- **Testes avançados:** view "Testes" com resultado por exemplo, ▶ na margem, reexecutar falhas, cobertura e profiler sem gems extras (helpers Ruby em `src/ruby/`).
- **Rails:** arquivo relacionado (Ctrl+Shift+R), generators/destroy, servidor, console, migrations, completar rotas e chaves i18n.
- **Recursos do RubyMine:** 12 intentions e 3 gerações no Ctrl+., inlay hints, realce semântico, hierarquia de tipos, chamadas do método, seletor de interpretador, lista de gems, estilo de código → RuboCop, `.rbs`.
- **Ferramentas:** terminal integrado (PowerShell, IRB, Rails console, enviar seleção), Git (status, diff, stage, commit, blame, branches).
- **Entrega:** abre em ~0,7 s; instalador Windows com `npm run dist`; logo na tela inicial e ícone da janela/instalador.

Verificação: typecheck limpo, 31 testes unitários, clean room 0 ocorrências (2.238 textos e 4.999 classes do RubyMine conferidos) e ~95 checagens de ponta a ponta no app via CDP, incluindo o app empacotado.

## Bugs encontrados e corrigidos

1. **Segurança:** links externos abriam dentro da janela (que tem acesso a arquivos/processos) — agora abrem no navegador do sistema; `will-navigate` bloqueado.
2. **Spawn no Windows:** citar todo argumento fazia os shims `.bat` (bundle/rake) re-executarem `ruby` como `<cwd>\ruby.exe` e falharem — agora só tokens com espaço levam aspas ([src/main/shell.ts](../src/main/shell.ts), com teste).
3. **Diagnósticos:** o ruby-lsp usa *pull diagnostics* (`textDocument/diagnostic`), não `publishDiagnostics` — o Rubaxe agora puxa os diagnósticos.
4. **Caminhos no Windows:** o `fsPath` do Monaco põe a letra do drive em minúscula (`c:\`), o explorer não (`C:\`) — comparações de caminho agora ignoram caixa no Windows.
5. **Clean room vazio:** o verificador apontava para uma versão do RubyMine que não existe nesta máquina e dizia "0 ocorrências" sem ter lido nada — agora falha quando não acha os JARs.
6. **Enviar ao console:** o código digitado antes do IRB terminar de iniciar era perdido — agora espera o prompt.
7. Mais 9 achados de uma revisão (perda de dados ao fechar, progresso do LSP, abas fantasmas, etc.), todos corrigidos.

## Organização em agentes (Claude Code)

Papéis em [`.claude/agents/`](../.claude/agents): **frontend** (`src/renderer`), **backend** (`src/main`), **tester** (`test`/validação), **pesquisa** (clean room), **security-audit** e **security-fix** (segurança do próprio código). O [CTO](../.claude/agents/cto.md) delega e valida. Os agentes de pesquisa e segurança só rodam com palavra-chave (hook `.claude/hooks/gate-agents.js`): **Buscar** para pesquisa, **Banana** para os de segurança.

## Pendências

- **Ambiente:** o toolchain C do Ruby está incompleto (rode `ridk install`); sem ele, o ruby-lsp não monta o bundle de projetos **com Gemfile**. Apps Rails 8.1 em Ruby 4.0/Windows precisam de `gem "fiddle"` no Gemfile para o `rails console`.
- **Adiados de propósito (sem pedido concreto, custo alto):** inspeções próprias além do RuboCop, rename que entende Rails, cliente HTTP, ferramentas de banco de dados, tema claro.
- **Entrega:** assinatura de código do instalador; builds para macOS/Linux não testados.

Detalhe completo das fases em [CHECKLIST.md](CHECKLIST.md).
