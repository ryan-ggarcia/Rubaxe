// `rubocop --autocorrect --only Layout,Lint/Syntax --stdin <file> --stderr --format emacs`: the fixed code on stdout,
// offenses on stderr. Plain --fix-layout (= --only Layout) would hide Lint/Syntax and hand back broken code as success.
export const rubocopArgs = (file: string) =>
  ['--autocorrect', '--only', 'Layout,Lint/Syntax', '--stdin', file, '--stderr', '--format', 'emacs'];

// Exit 0 = clean, 1 = offenses (corrected or not), 2 = RuboCop error. Not found: sh exits 127; cmd.exe /c exits 1 with
// "'rubocop' is not recognized..." in the system language (9009 in other cmd setups).
export function rubocopOutput(code: number | null, stdout: string, stderr: string, input: string): string {
  if (code === 127 || code === 9009 || stderr.startsWith("'rubocop'")) throw new Error('RuboCop não encontrado. Instale com: gem install rubocop');
  const syntax = stderr.match(/:(\d+):(\d+): F: Lint\/Syntax: (.+?)(?: \(Using Ruby .*)?$/m);
  if (syntax) throw new Error(`Sintaxe inválida (linha ${syntax[1]}, coluna ${syntax[2]}): ${syntax[3]}`);
  if ((code === 0 || code === 1) && (stdout || !input.trim())) { // an empty file formats to nothing
    // Ruby on Windows writes stdout in text mode (LF becomes CRLF): give back the line ending the editor sent.
    return input.includes('\r\n') ? stdout.replace(/\r?\n/g, '\r\n') : stdout.replace(/\r\n/g, '\n');
  }
  // Skip the "new cops not configured" banner RuboCop prints when the config lacks NewCops.
  const useful = stderr.replace(/^The following cops were added[\s\S]*?versioning\.html$/m, '')
    .split(/\r?\n/).map(l => l.trim()).find(l => l && !/^=+$/.test(l));
  throw new Error(`RuboCop falhou${code === null ? '' : ` (código ${code})`}: ${useful ?? 'sem saída'}`);
}
