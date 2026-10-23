import { contextBridge, ipcRenderer } from 'electron';

export interface DirEntry { name: string; path: string; dir: boolean }
export interface SearchHit { file: string; line: number; col: number; len: number; text: string }
export interface ExecResult { code: number | null; out: string }

const invoke = <R, A extends unknown[] = []>(ch: string) => (...args: A) => ipcRenderer.invoke(ch, ...args) as Promise<R>;
const on = <A extends unknown[]>(ch: string) => (cb: (...args: A) => void) => { ipcRenderer.on(ch, (_e, ...args) => cb(...(args as A))); };

const api = {
  platform: process.platform,
  openFolder: invoke<string | null>('openFolder'),
  readDir: invoke<DirEntry[], [dir: string]>('readDir'),
  readFile: invoke<string, [path: string]>('readFile'),
  writeFile: invoke<void, [path: string, text: string]>('writeFile'),
  createPath: invoke<void, [path: string, isDir: boolean]>('createPath'),
  openFileDialog: invoke<string | null>('openFileDialog'),
  renamePath: invoke<void, [from: string, to: string]>('renamePath'),
  trashPath: invoke<void, [path: string]>('trashPath'),
  exists: invoke<boolean, [path: string]>('exists'),
  listFiles: invoke<string[], [root: string]>('listFiles'),
  search: invoke<SearchHit[], [root: string, query: string, opts: { regex: boolean; caseSensitive: boolean }]>('search'),
  exec: invoke<ExecResult, [cmd: string, args: string[], cwd: string]>('exec'),
  run: invoke<void, [id: string, cmd: string, args: string[], cwd: string, env?: Record<string, string>]>('run'),
  mkTemp: invoke<string>('mkTemp'),
  rubyHelpers: invoke<string>('rubyHelpers'),
  findRubies: invoke<{ path: string; manager: string }[]>('findRubies'),
  setRubyBin: invoke<void, [dir: string]>('setRubyBin'),
  stop: invoke<void, [id: string]>('stop'),
  loadSettings: invoke<Record<string, unknown>>('loadSettings'),
  saveSettings: invoke<void, [settings: unknown]>('saveSettings'),
  lspStart: invoke<void, [cmd: string, cwd: string]>('lspStart'),
  lspStop: invoke<void>('lspStop'),
  confirmClose: invoke<void>('confirmClose'),
  onCloseRequest: on<[]>('closeRequest'),
  lspSend: (msg: unknown) => ipcRenderer.send('lspSend', msg),
  onLspMessage: on<[msg: any]>('lspMessage'),
  onLspLog: on<[text: string]>('lspLog'),
  onLspExit: on<[code: number | null]>('lspExit'),
  onRunData: on<[id: string, text: string]>('runData'),
  onRunExit: on<[id: string, code: number | null]>('runExit'),
  runWrite: (id: string, data: string) => ipcRenderer.send('runWrite', id, data),
  debugLaunch: invoke<void, [cmd: string, args: string[], cwd: string]>('debugLaunch'),
  debugAttach: invoke<void, [host: string, port: number]>('debugAttach'),
  debugStop: invoke<void>('debugStop'),
  dapSend: (msg: unknown) => ipcRenderer.send('dapSend', msg),
  onDapConnected: on<[]>('dapConnected'),
  onDapMessage: on<[msg: any]>('dapMessage'),
  onDebugOutput: on<[text: string]>('debugOutput'),
  onDebugEnd: on<[]>('debugEnd'),
  ptySpawn: invoke<void, [id: string, cwd: string, cols: number, rows: number, shell: string, args?: string[]]>('ptySpawn'),
  listShells: invoke<{ name: string; path: string; args: string[] }[]>('listShells'),
  ptyWrite: (id: string, data: string) => ipcRenderer.send('ptyWrite', id, data),
  ptyResize: (id: string, cols: number, rows: number) => ipcRenderer.send('ptyResize', id, cols, rows),
  ptyKill: invoke<void, [id: string]>('ptyKill'),
  onPtyData: on<[id: string, data: string]>('ptyData'),
  onPtyExit: on<[id: string, code: number]>('ptyExit'),
  watchFolder: invoke<void, [root: string]>('watchFolder'),
  onFsChange: on<[paths: string[]]>('fsChange'),
  setTitleBarOverlay: (color: string, symbolColor: string) => ipcRenderer.send('setTitleBarOverlay', color, symbolColor),
};

export type RubaxeApi = typeof api;

contextBridge.exposeInMainWorld('rubaxe', api);
