import test from 'node:test';
import assert from 'node:assert';
import { rubocopStyle, withInherit, STYLE_SETTINGS } from '../src/renderer/code-style.ts';

const defaults = Object.fromEntries(STYLE_SETTINGS.map(([k, , , d]) => [k, d]));

test('style settings map to RuboCop cops', () => {
  const yml = rubocopStyle(k => ({ ...defaults, 'style.spaceInsideHashBraces': false, 'style.methodChains': 'nenhum', 'style.indentWhen': true })[k]);
  assert.match(yml, /Layout\/SpaceInsideHashLiteralBraces:\n {2}EnforcedStyle: no_space/);
  assert.match(yml, /Layout\/MultilineMethodCallIndentation:\n {2}Enabled: false/);
  assert.match(yml, /Layout\/CaseIndentation:\n {2}EnforcedStyle: case\n {2}IndentOneStep: true/);
  assert.doesNotMatch(yml, /inherit_gem/);
  assert.match(rubocopStyle(k => ({ ...defaults, 'style.preset': 'rails-omakase' })[k]), /inherit_gem:\n {2}rubocop-rails-omakase: rubocop.yml/);
});

test('.rubocop.yml gets inherit_from without losing user rules', () => {
  assert.strictEqual(withInherit(undefined, '.rubocop_rubaxe.yml'), 'inherit_from: .rubocop_rubaxe.yml\n');
  assert.strictEqual(withInherit('Style/X:\n  Enabled: false\n', '.rubocop_rubaxe.yml'), 'inherit_from: .rubocop_rubaxe.yml\n\nStyle/X:\n  Enabled: false\n');
  assert.strictEqual(withInherit('inherit_from: .rubocop_rubaxe.yml\n', '.rubocop_rubaxe.yml'), 'inherit_from: .rubocop_rubaxe.yml\n');
  assert.strictEqual(withInherit('inherit_from: base.yml\n', '.rubocop_rubaxe.yml'), undefined);
});
