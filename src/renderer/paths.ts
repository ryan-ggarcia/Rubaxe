// Pure helpers (no DOM, no Monaco) so node tests can import them. Relative paths use '/'.
const RUBY_NAMES = new Set(['Gemfile', 'Rakefile', 'Guardfile', 'Capfile', 'Vagrantfile', 'Brewfile', 'config.ru']);
const RUBY_EXT = /\.(rb|rake|gemspec|ru|builder|jbuilder|thor)$/;

export const isTest = (rel: string) => /(_spec|_test)\.rb$/.test(rel);

// app/models/user.rb -> spec/models/user_spec.rb, test/models/user_test.rb
export function testCandidates(rel: string): string[] {
  if (!rel.endsWith('.rb') || isTest(rel)) return [];
  const base = rel.slice(0, -3);
  const inner = base.replace(/^(app|lib)\//, '');
  const out = [`spec/${inner}_spec.rb`, `test/${inner}_test.rb`];
  if (base.startsWith('lib/')) out.push(`spec/${base}_spec.rb`, `test/${base}_test.rb`);
  return out;
}

export function implCandidates(rel: string): string[] {
  if (!isTest(rel)) return [];
  const inner = rel.replace(/^(spec|test)\//, '').replace(/(_spec|_test)\.rb$/, '');
  return [`app/${inner}.rb`, `lib/${inner}.rb`, `${inner}.rb`];
}

// Subsequence match; contiguous runs and basename hits rank higher. -1 means no match.
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase(), t = text.toLowerCase();
  let score = 0, from = 0, prev = -2;
  for (const c of q) {
    const k = t.indexOf(c, from);
    if (k < 0) return -1;
    score += k === prev + 1 ? 3 : 1;
    prev = k;
    from = k + 1;
  }
  return score + (t.slice(t.lastIndexOf('/') + 1).includes(q) ? 10 : 0) - t.length * 0.01;
}

export function languageFor(file: string): string | undefined {
  const base = file.split(/[\\/]/).pop()!;
  return RUBY_NAMES.has(base) || RUBY_EXT.test(base) ? 'ruby' : undefined;
}

// Windows paths compare case-insensitively; Monaco also lowercases the drive letter.
export function relativeTo(root: string, file: string): string | undefined {
  const norm = (p: string) => p.replace(/\\/g, '/');
  const r = norm(root).replace(/\/$/, ''), f = norm(file);
  return f.toLowerCase().startsWith(r.toLowerCase() + '/') ? f.slice(r.length + 1) : undefined;
}

// rake -AT lines look like: "rake db:migrate   # Migrate the database"
export function parseRakeTasks(out: string): { name: string; desc: string }[] {
  return [...out.matchAll(/^rake (\S+)(?:\s+# (.*))?$/gm)].map(m => ({ name: m[1], desc: m[2] ?? '' }));
}
