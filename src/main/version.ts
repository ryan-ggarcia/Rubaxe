// a > b comparing major.minor.patch; a release beats its own prereleases (1.0.0 > 1.0.0-beta.1). Garbage reads as 0.
// shortcut: two prereleases of the same version compare equal; fine while only releases/latest (never a prerelease) is compared.
export function isNewer(a: string, b: string): boolean {
  const [pa, pb] = [a, b].map(v => v.split('-')[0].split('.').map(n => Number(n) || 0));
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return !a.includes('-') && b.includes('-');
}
