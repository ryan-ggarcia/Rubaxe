import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { argPaths } from '../src/main/argv.ts';

const cwd = path.resolve('/work/proj');

test('argPaths: packaged exe, user args start at argv[1], flags skipped, relative against cwd', () => {
  assert.deepStrictEqual(argPaths(['Rubaxe.exe'], false, cwd), []);
  assert.deepStrictEqual(argPaths(['Rubaxe.exe', '.'], false, cwd), [cwd]);
  assert.deepStrictEqual(argPaths(['Rubaxe.exe', '--user-data-dir=x', 'app/a.rb', '--updated'], false, cwd), [path.join(cwd, 'app', 'a.rb')]);
  const abs = path.resolve('/other');
  assert.deepStrictEqual(argPaths(['Rubaxe.exe', abs], false, cwd), [abs]);
});

test('argPaths: `electron .` drops the app folder, even after flags', () => {
  assert.deepStrictEqual(argPaths(['electron.exe', '.'], true, cwd), []);
  assert.deepStrictEqual(argPaths(['electron.exe', '--inspect', '.', '--user-data-dir=x', '..'], true, cwd), [path.resolve(cwd, '..')]);
});

test('argPaths: a trailing quote from "dir\\" is dropped', () => {
  assert.deepStrictEqual(argPaths(['Rubaxe.exe', 'my dir"'], false, cwd), [path.join(cwd, 'my dir')]);
});
