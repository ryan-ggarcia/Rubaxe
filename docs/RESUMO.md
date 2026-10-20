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

Verificação: typecheck limpo, testes `node:test` passando, clean room 0 ocorrências, e testes de ponta a ponta do app via CDP.

## Bugs encontrados e corrigidos

1. **Segurança:** links externos abriam dentro da janela (que tem acesso a arquivos/processos) — agora abrem no navegador do sistema; `will-navigate` bloqueado.
2. **Spawn no Windows:** citar todo argumento fazia os shims `.bat` (bundle/rake) re-executarem `ruby` como `<cwd>\ruby.exe` e falharem — agora só tokens com espaço levam aspas ([src/main/shell.ts](../src/main/shell.ts), com teste).
3. **Diagnósticos:** o ruby-lsp usa *pull diagnostics* (`textDocument/diagnostic`), não `publishDiagnostics` — o Rubaxe agora puxa os diagnósticos.
4. Mais 9 achados de uma revisão (perda de dados ao fechar, progresso do LSP, abas fantasmas, etc.), todos corrigidos.

## Organização em agentes (Claude Code)

Papéis em [`.claude/agents/`](../.claude/agents): **frontend** (`src/renderer`), **backend** (`src/main`), **tester** (`test`/validação), **pesquisa** (clean room), **security-audit** e **security-fix** (segurança do próprio código). O [CTO](../.claude/agents/cto.md) delega e valida. Os agentes de pesquisa e segurança só rodam com palavra-chave (hook `.claude/hooks/gate-agents.js`): **Buscar** para pesquisa, **Banana** para os de segurança.

## Pendências

- **Ambiente:** o toolchain C do Ruby está incompleto (rode `ridk install`); sem ele, o ruby-lsp não monta o bundle de projetos **com Gemfile** (a inteligência foi validada em projeto sem Gemfile).
- **Melhorias** (sem risco de dados): detectar mudanças de arquivo externas, renomear/apagar no explorer, abrir arquivo solto, tema claro.
- **Fases 7–12:** depurador, testes avançados (árvore, cobertura, profiler), Rails, recursos avançados do RubyMine (intentions, inspeções extras, inlay hints, gerenciadores de versão, RBS), terminal/Git, instalador.
- **Logo:** a pasta `logo/` está vazia; falta a imagem para colocar na IDE.

Detalhe completo das fases em [CHECKLIST.md](CHECKLIST.md).
