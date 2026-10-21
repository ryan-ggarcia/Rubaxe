<p align="center">
  <img src="assets/logo.png" alt="Logo do Rubaxe: um rubi e uma picareta" width="220">
</p>

<h1 align="center">Rubaxe</h1>

<p align="center">A IDE para Ruby com o suporte à linguagem do RubyMine e a cara do VS Code.</p>

---

O Rubaxe é um editor feito para quem programa em Ruby e Rails: abre em menos de um segundo, entende o seu código e traz as ferramentas do dia a dia num lugar só. Foi escrito do zero, em processo [clean room](docs/CLEAN_ROOM.md).

- **Inteligência Ruby** (via Ruby LSP): autocompletar, erros ao vivo, ir para definição, renomear, formatar e 12 ações rápidas no `Ctrl+.`.
- **Executar e testar**: rodar arquivo, RSpec e Minitest com ▶ na margem, cobertura de código e profiler.
- **Depurador** com breakpoints, variáveis, pilha de chamadas e console.
- **Rails**: ir para o arquivo relacionado, generators, servidor, console e autocompletar de rotas e i18n.
- **Terminal integrado e Git** (status, diff, commit, blame, branches).

## Instalação pelo instalador (Windows)

1. **Baixe o Rubaxe:** em [Releases](https://github.com/ryan-ggarcia/Rubaxe/releases), pegue o arquivo `Rubaxe-Setup-<versão>.exe`.
2. **Execute o instalador.** Como ele ainda não tem assinatura digital, o Windows pode mostrar "O Windows protegeu o computador": clique em **Mais informações → Executar assim mesmo**.
3. **Deixe o instalador configurar o Ruby.** No fim, ele pergunta se deve configurar o Ruby: responda **Sim** e uma janela mostra o progresso. Ele instala o que faltar (e pula o que você já tem):
   - o Ruby+Devkit (do [RubyInstaller](https://rubyinstaller.org)), se não houver Ruby no computador;
   - o toolchain C (`ridk install`), que algumas gems precisam para compilar;
   - a gem `ruby-lsp`, que dá o autocompletar, os erros ao vivo e a navegação.

   Precisa de internet e pode levar alguns minutos. Se pular ou algo falhar, rode depois no Rubaxe: paleta (`Ctrl+Shift+P`) → **Ruby: Configurar Ambiente**.
4. **Abra um projeto:** `Ctrl+O` e escolha a pasta. A barra de status mostra a versão do Ruby e o Ruby LSP iniciando; na primeira vez, projetos com Gemfile levam alguns segundos para indexar.

Prefere configurar o Ruby à mão? Instale o *Ruby+Devkit* (`winget install RubyInstallerTeam.RubyWithDevKit.4.0`), rode `ridk install` e depois `gem install ruby-lsp`.

## Configuração

- **Configurações:** `Ctrl+,` — fonte, tabulação, framework de teste, estilo de código e as funcionalidades que podem ser ligadas e desligadas.
- **Versão do Ruby:** clique na versão na barra de status para escolher outro interpretador (rbenv, rvm, asdf, chruby, mise ou RubyInstaller).
- **Apps Rails no Windows com Ruby 4.0:** adicione `gem "fiddle"` ao Gemfile para o `rails console` funcionar.
- **Estilo de código:** ajuste em Configurações → Estilo de código e rode *Estilo de Código: Gravar Configuração RuboCop no Projeto* pela paleta (`Ctrl+Shift+P`).

## Linux e macOS (experimental)

Os pacotes `.AppImage` (Linux) e `.dmg` (macOS) também ficam em [Releases](https://github.com/ryan-ggarcia/Rubaxe/releases), gerados automaticamente pelo GitHub Actions. Ainda não foram testados nessas plataformas: relatos de problemas são bem-vindos.

- **Linux:** `chmod +x Rubaxe-*.AppImage` e execute.
- **macOS:** sem assinatura, o primeiro uso pede **botão direito → Abrir**.

Em ambos, instale o Ruby (de preferência por um gerenciador de versões) e rode `gem install ruby-lsp`.

## Instalação pelo código-fonte

Requisitos: Node.js 24 (mínimo 22.18, que roda os testes em TypeScript direto), Git e o Ruby configurado como acima.

```sh
git clone https://github.com/ryan-ggarcia/Rubaxe.git
cd Rubaxe
npm install
npm install-scripts approve electron   # o npm 11 bloqueia scripts de instalação; sem isso o Electron não é baixado
npm start                              # compila e abre o Rubaxe
```

Outros comandos:

```sh
npm test             # testes unitários
npm run typecheck
npm run dist         # gera o instalador Windows em release/
npm run dist:linux   # gera o AppImage (rode numa máquina Linux)
```

Se o Rubaxe abrir como Node puro (erro `Cannot read properties of undefined (reading 'handle')`), a variável `ELECTRON_RUN_AS_NODE` está definida no terminal; remova-a antes do `npm start`.

## Atalhos principais

| Ação | Atalho |
|---|---|
| Ir para arquivo | `Ctrl+P` |
| Paleta de comandos | `Ctrl+Shift+P` |
| Pesquisar no projeto | `Ctrl+Shift+F` |
| Executar arquivo Ruby | `Ctrl+F5` |
| Executar testes do arquivo | `Ctrl+Shift+F10` |
| Depurar / continuar | `F5` |
| Ações rápidas | `Ctrl+.` |
| Arquivo Rails relacionado | `Shift+Alt+R` |
| Terminal | ``Ctrl+` `` |

## Documentos

- [Checklist e stack](docs/CHECKLIST.md)
- [Especificação de comportamento](docs/SPEC.md)
- [Processo clean room](docs/CLEAN_ROOM.md)
- [Resumo do desenvolvimento](docs/RESUMO.md)
