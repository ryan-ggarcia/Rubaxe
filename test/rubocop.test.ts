import test from 'node:test';
import assert from 'node:assert';
import { rubocopArgs, rubocopOutput } from '../src/main/rubocop.ts';

test('rubocopArgs: layout fix plus syntax check, file passed as one token', () => {
  assert.deepStrictEqual(rubocopArgs('C:\pasta ção\a.rb').slice(-4), ['C:\pasta ção\a.rb', '--stderr', '--format', 'emacs']);
  assert.ok(rubocopArgs('a.rb').join(' ').includes('--only Layout,Lint/Syntax'));
});

test('rubocopOutput: exit 1 with code on stdout is success, line ending follows the input', () => {
  assert.strictEqual(rubocopOutput(1, 'a\r\nb\r\n', 'x.rb:1:1: C: [Corrected] Layout/X: y', 'a\n b\n'), 'a\nb\n');
  assert.strictEqual(rubocopOutput(0, 'ação\nb\n', '', 'ação\r\nb\r\n'), 'ação\r\nb\r\n');
  assert.strictEqual(rubocopOutput(0, '', '', ''), '');
});

test('rubocopOutput: errors', () => {
  assert.throws(() => rubocopOutput(1, '', "'rubocop' no  reconhecido como um comando interno", 'a'), /RuboCop não encontrado\. Instale com: gem install rubocop/);
  assert.throws(() => rubocopOutput(127, '', '', 'a'), /não encontrado/);
  const syntax = 'C:/p ç/bad.rb:2:8: F: Lint/Syntax: expected a matching `)` (Using Ruby 3.4 parser; configure using `TargetRubyVersion` parameter, under `AllCops`)\nC:/p/bad.rb:3:1: F: Lint/Syntax: other';
  assert.throws(() => rubocopOutput(1, 'def f\n', syntax, 'def f\n'), { message: 'Sintaxe inválida (linha 2, coluna 8): expected a matching `)`' });
  const banner = 'The following cops were added to RuboCop, but are not configured.\n\nGemspec/X: # new in 1.65\n  Enabled: true\nFor details: https://docs.rubocop.org/rubocop/versioning.html\n';
  assert.throws(() => rubocopOutput(2, '', banner + 'Error: unrecognized cop Layout/Foo\nDid you mean', 'a'), { message: 'RuboCop falhou (código 2): Error: unrecognized cop Layout/Foo' });
  assert.throws(() => rubocopOutput(1, '', '', 'a'), { message: 'RuboCop falhou (código 1): sem saída' });
});
