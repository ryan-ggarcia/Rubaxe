import path from 'node:path';

// Paths the user put on the command line (`Rubaxe.exe <path>`, `rubaxe .`), absolute against the caller's cwd.
// Flags (Electron/Chromium switches) are skipped; with defaultApp (`electron .`) the first positional is the app folder.
export function argPaths(argv: string[], defaultApp: boolean, cwd: string): string[] {
  const positional = argv.slice(1).filter(a => !a.startsWith('-')).slice(defaultApp ? 1 : 0);
  // "C:\my dir\" reaches us as C:\my dir" (the backslash escapes the quote); no Windows path holds a ".
  return positional.map(a => path.resolve(cwd, a.replace(/"+$/, '')));
}
