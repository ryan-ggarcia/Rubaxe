// Code style settings (docs/SPEC.md) -> RuboCop config: the formatter (Ruby LSP + RuboCop) then applies them. Pure, no DOM.

export const STYLE_SETTINGS: [key: string, desc: string, type: 'boolean' | string[], def: string | boolean][] = [
  ['style.preset', 'Preset base.', ['padrão', 'rails-omakase'], 'padrão'],
  ['style.spaceAroundOperators', 'Espaços em volta de operadores e de =>.', 'boolean', true],
  ['style.spaceInsideHashBraces', 'Espaços dentro das chaves de hash: { a: 1 }.', 'boolean', true],
  ['style.spaceInsideBlockBraces', 'Espaços dentro das chaves de bloco: { |x| x }.', 'boolean', true],
  ['style.spaceBeforeBlockPipes', 'Espaço entre { e os pipes do bloco.', 'boolean', true],
  ['style.spaceInsideArrayBrackets', 'Espaços dentro de colchetes de array: [ 1, 2 ].', 'boolean', false],
  ['style.alignHashes', 'Alinhar o lado direito de hashes em várias linhas.', ['não', 'tabela'], 'não'],
  ['style.alignAssignments', 'Permitir alinhar atribuições em sequência.', 'boolean', true],
  ['style.binaryOperators', 'Expressões binárias quebradas em linhas.', ['nenhum', 'indentado', 'alinhado'], 'alinhado'],
  ['style.methodChains', 'Cadeias de métodos quebradas em linhas.', ['nenhum', 'pelo receptor', 'pelos pontos'], 'pelos pontos'],
  ['style.indentWhen', 'Indentar when dentro de case.', 'boolean', false],
  ['style.indentAfterPrivate', 'Indentar os métodos depois de private/protected.', 'boolean', false],
  ['style.emptyMethods', 'Métodos vazios.', ['uma linha', 'várias linhas'], 'uma linha'],
];

const yes = (v: unknown) => v === true;

export function rubocopStyle(get: (key: string) => unknown): string {
  const cops: Record<string, Record<string, string | boolean>> = {
    'Layout/SpaceAroundOperators': { Enabled: yes(get('style.spaceAroundOperators')) },
    'Layout/SpaceInsideHashLiteralBraces': { EnforcedStyle: yes(get('style.spaceInsideHashBraces')) ? 'space' : 'no_space' },
    'Layout/SpaceInsideBlockBraces': {
      EnforcedStyle: yes(get('style.spaceInsideBlockBraces')) ? 'space' : 'no_space',
      SpaceBeforeBlockParameters: yes(get('style.spaceBeforeBlockPipes')),
    },
    'Layout/SpaceInsideArrayLiteralBrackets': { EnforcedStyle: yes(get('style.spaceInsideArrayBrackets')) ? 'space' : 'no_space' },
    'Layout/HashAlignment': get('style.alignHashes') === 'tabela'
      ? { EnforcedColonStyle: 'table', EnforcedHashRocketStyle: 'table' } : { EnforcedColonStyle: 'key', EnforcedHashRocketStyle: 'key' },
    'Layout/ExtraSpacing': { AllowForAlignment: yes(get('style.alignAssignments')) },
    'Layout/MultilineOperationIndentation': get('style.binaryOperators') === 'nenhum' ? { Enabled: false }
      : { EnforcedStyle: get('style.binaryOperators') === 'indentado' ? 'indented' : 'aligned' },
    'Layout/MultilineMethodCallIndentation': get('style.methodChains') === 'nenhum' ? { Enabled: false }
      : { EnforcedStyle: get('style.methodChains') === 'pelo receptor' ? 'indented_relative_to_receiver' : 'aligned' },
    'Layout/CaseIndentation': { EnforcedStyle: 'case', IndentOneStep: yes(get('style.indentWhen')) },
    'Layout/IndentationConsistency': { EnforcedStyle: yes(get('style.indentAfterPrivate')) ? 'indented_internal_methods' : 'normal' },
    'Style/EmptyMethod': { EnforcedStyle: get('style.emptyMethods') === 'várias linhas' ? 'expanded' : 'compact' },
  };
  const head = ['# Gerado pelo Rubaxe (Configurações > Estilo de código). Regenerar sobrescreve este arquivo.'];
  if (get('style.preset') === 'rails-omakase') head.push('inherit_gem:', '  rubocop-rails-omakase: rubocop.yml');
  const body = Object.entries(cops).flatMap(([cop, opts]) => ['', `${cop}:`, ...Object.entries(opts).map(([k, v]) => `  ${k}: ${v}`)]);
  return [...head, ...body, ''].join('\n');
}

// Makes .rubocop.yml inherit the generated file without touching the user's own rules. undefined = user must add it by hand.
export function withInherit(existing: string | undefined, file: string): string | undefined {
  if (existing === undefined) return `inherit_from: ${file}\n`;
  if (existing.includes(file)) return existing;
  if (/^inherit_from:/m.test(existing)) return undefined;
  return `inherit_from: ${file}\n\n${existing}`;
}
