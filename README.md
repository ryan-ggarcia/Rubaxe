# Rubaxe
<img width="600" height="600" style="border-radius: 30px;" alt="Logo Rubaxe com Rubi e Picareta" src="assets/logo.png" />

IDE dedicada ao ruby

Suporte à linguagem inspirado no RubyMine, interface no estilo VS Code. Feito do zero, em processo [clean room](docs/CLEAN_ROOM.md).

## Como rodar

Requisitos: Node.js 22+, Ruby 3.4+, o servidor de linguagem (`gem install ruby-lsp`) e, para o depurador, a gem `debug` (vem com o Ruby).

```sh
npm install
npm install-scripts approve electron   # npm 11 bloqueia scripts de instalação; sem isso o binário do Electron não é baixado
npm start        # compila (esbuild) e abre o Rubaxe
npm test         # testes unitários
npm run typecheck
npm run dist     # instalador Windows em release/
npm run dist:linux   # AppImage — rode numa máquina Linux (compila o terminal nativo)
```

Se o Rubaxe abrir como Node puro (erro `Cannot read properties of undefined (reading 'handle')`), a variável
`ELECTRON_RUN_AS_NODE` está definida no seu terminal; remova-a antes do `npm start`.

## Documentos

- [Checklist e stack](docs/CHECKLIST.md)
- [Especificação de comportamento](docs/SPEC.md)
- [Processo clean room](docs/CLEAN_ROOM.md)
