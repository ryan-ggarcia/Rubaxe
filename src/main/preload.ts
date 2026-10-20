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
  exists: invoke<boolean, [path: string]>('exists'),
  listFiles: invoke<string[], [root: string]>('listFiles'),
  search: invoke<SearchHit[], [root: string, query: string, opts: { regex: boolean; caseSensitive: boolean }]>('search'),
  exec: invoke<ExecResult, [cmd: string, args: string[], cwd: string]>('exec'),
  run: invoke<void, [id: string, cmd: string, args: string[], cwd: string]>('run'),
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
};

export type RubaxeApi = typeof api;

contextBridge.exposeInMainWorld('rubaxe', api);
