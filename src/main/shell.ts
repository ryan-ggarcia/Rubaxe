// Quote one token for the platform shell (commands run via shell:true for .bat shims like bundle/rake).
// Windows: quote only when needed — quoting every token makes cmd.exe's .bat shims re-exec ruby as
// "<cwd>\ruby.exe" and fail. shortcut: a spaced interpreter path AND a spaced file arg in the same
// command still break (cmd /s strips the outer quote pair); move to a cmd.exe verbatim-args spawn then.
export function quote(a: string): string {
  if (process.platform !== 'win32') return `'${a.replace(/'/g, `'\\''`)}'`;
  return /[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a;
}
