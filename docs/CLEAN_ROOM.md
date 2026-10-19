# Processo clean room do Rubaxe

O Rubaxe implementa do zero funcionalidades inspiradas no RubyMine (proprietário, JetBrains) e no VS Code.
Este documento define como a pesquisa é feita e como ela chega ao código sem cópia.

## Princípio

A informação só atravessa da pesquisa para o código **através de [SPEC.md](SPEC.md)**: uma descrição de
*comportamento*, escrita com palavras nossas. Quem implementa trabalha a partir da SPEC e da documentação pública,
nunca a partir dos arquivos do produto analisado.

## Regras

**Permitido na pesquisa**
- Usar o produto e observar o comportamento (menus, diálogos, resultados).
- Ler documentação pública (sites de ajuda, changelogs).
- Ler metadados declarativos: nomes e quantidades de ações, opções e tipos de configuração, estrutura de pacotes.

**Proibido**
- Descompilar ou desassemblar bytecode/binários do RubyMine (a licença da JetBrains proíbe).
- Copiar código, textos de interface, mensagens, descrições de inspeções, ícones ou outros assets.
- Commitar extrações brutas (dumps de JARs, listas de strings, nomes de classes) no repositório.

**No código**
- Textos de interface, nomes de classes e mensagens são escritos por nós, em português.
- Dependências de terceiros só com licença permissiva (MIT, Apache-2.0, BSD) e declaradas no `package.json`.
- Código do VS Code só via pacotes MIT publicados (Monaco Editor, Codicons). Cores do tema Dark Modern são usadas como valores.

## Papéis

| Papel | Faz | Não faz |
|---|---|---|
| Pesquisa | Observa, coleta metadados e escreve a SPEC | Escrever código do Rubaxe a partir de dumps |
| Implementação | Implementa a partir da SPEC e da documentação pública | Abrir os JARs/binários do RubyMine |

Ressalva: na primeira rodada, a pesquisa e a implementação foram feitas pelo mesmo agente (Claude). O risco ficou
limitado porque nenhum código foi descompilado ou lido: só metadados declarativos e textos de interface, que
não foram copiados (veja a verificação abaixo). Em pesquisas futuras que envolvam ler o funcionamento interno,
os dois papéis devem ser pessoas (ou agentes) diferentes.

## Registro da pesquisa

| Data | Alvo | Versão | Método | O que foi lido |
|---|---|---|---|---|
| 2026-10-19 | RubyMine | 2026.2.3 | Inventário ZIP via REA (`inspect_artifact`), sem descompilação | Lista de entradas de `intellij.ruby.backend.jar` (4.834) |
| 2026-10-19 | RubyMine | 2026.2.3 | Script Python lendo `plugin.xml` e `.properties` dos JARs do plugin Ruby | Ações (115), inspeções (115), intentions (53), extension points, páginas de configuração, chaves de opções |
| 2026-10-19 | VS Code | 1.142.0 | REA `analyze_javascript_application` + regex no bundle; leitura dos `package.json` das extensões | IDs de comandos (1.228 do núcleo, 520 das extensões), contribuições, cores do tema Dark Modern |

As extrações brutas ficaram fora do repositório e não são versionadas.

## Verificação de contaminação

[`tools/cleanroom_check.py`](../tools/cleanroom_check.py) compara o repositório com todos os textos de interface
(≥ 15 caracteres) e nomes de classes (≥ 12 caracteres) do plugin Ruby do RubyMine. Exige o RubyMine instalado:

```sh
python tools/cleanroom_check.py "C:/Program Files/JetBrains/RubyMine 2026.2.3/plugins/ruby/lib" .
```

| Data | Strings | Classes | Ocorrências | Controle positivo |
|---|---|---|---|---|
| 2026-10-19 | 2.238 | 4.999 | **0** | 1.034 ocorrências num dump de pesquisa (o verificador detecta) |

Rode antes de cada release. Qualquer ocorrência precisa ser reescrita antes do merge.
