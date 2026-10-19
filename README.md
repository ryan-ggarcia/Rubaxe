# Rubaxe
<img width="600" height="600" style="border-radius: 30px;" alt="Logo Rubaxe com Rubi e Picareta (1)" src="https://github.com/user-attachments/assets/7bbb7d40-ad9c-48ed-b478-4d3c24fc50af" />

IDE dedicada ao ruby

Suporte à linguagem inspirado no RubyMine, interface no estilo VS Code. Feito do zero, em processo [clean room](docs/CLEAN_ROOM.md).

## Como rodar

Requisitos: Node.js 22+, Ruby 3.4+ e o servidor de linguagem (`gem install ruby-lsp`).

```sh
npm install
npm start        # compila (esbuild) e abre o Rubaxe
npm test         # testes unitários
npm run typecheck
```

Se o Rubaxe abrir como Node puro (erro `Cannot read properties of undefined (reading 'handle')`), a variável
`ELECTRON_RUN_AS_NODE` está definida no seu terminal; remova-a antes do `npm start`.

## Documentos

- [Checklist e stack](docs/CHECKLIST.md)
- [Especificação de comportamento](docs/SPEC.md)
- [Processo clean room](docs/CLEAN_ROOM.md)
