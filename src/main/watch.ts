// Churn the explorer and the Ctrl+P index never show. Inside .git only HEAD (branch switch) and index (staging) matter to the git status.
const SKIP = new Set(['.git', 'node_modules', 'tmp', 'log', '.ruby-lsp', 'coverage', '.bundle']);

export function watchIgnored(rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  if (parts[0] === '.git' && parts.length === 2 && (parts[1] === 'HEAD' || parts[1] === 'index')) return false;
  return parts.some((p, i) => SKIP.has(p) || (p === 'vendor' && parts[i + 1] === 'bundle'));
}
