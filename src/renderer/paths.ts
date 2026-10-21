// Pure helpers (no DOM, no Monaco) so node tests can import them. Relative paths use '/'.
const RUBY_NAMES = new Set(['Gemfile', 'Rakefile', 'Guardfile', 'Capfile', 'Vagrantfile', 'Brewfile', 'config.ru']);
const RUBY_EXT = /\.(rb|rake|gemspec|ru|builder|jbuilder|thor|rbs)$/; // .rbs: Ruby highlighting is close enough for signatures

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
  if (base.endsWith('.erb')) return 'html'; // Rails views: HTML highlighting is closer than plain text
  return RUBY_NAMES.has(base) || RUBY_EXT.test(base) ? 'ruby' : undefined;
}

// Windows paths compare case-insensitively; Monaco also lowercases the drive letter.
export function relativeTo(root: string, file: string): string | undefined {
  const norm = (p: string) => p.replace(/\\/g, '/');
  const r = norm(root).replace(/\/$/, ''), f = norm(file);
  return f.toLowerCase().startsWith(r.toLowerCase() + '/') ? f.slice(r.length + 1) : undefined;
}

// Lines (1-based) that start a test: RSpec blocks, Minitest `def test_*`, Rails `test "..." do`.
const TEST_LINE = /^\s*(?:(?:RSpec\.)?(?:describe|context|feature)\b|(?:it|specify|example|scenario)\b(?!\s*[.=])|def test_\w+|test\s+["'])/;
export const testLines = (text: string) => text.split(/\r?\n/).flatMap((l, i) => TEST_LINE.test(l) ? [i + 1] : []);

// Minitest method name for the test enclosing `line` (Rails `test "a b"` becomes test_a_b), for `-n`.
export function minitestNameAt(text: string, line: number): string | undefined {
  const lines = text.split(/\r?\n/);
  for (let i = Math.min(line, lines.length) - 1; i >= 0; i--) {
    const m = /^\s*def (test_\w+)|^\s*test\s+(["'])(.+?)\2/.exec(lines[i]);
    if (m) return m[1] ?? `test_${m[3].replace(/\s+/g, '_')}`;
  }
}

export interface TestResult { file: string; line: number; name: string; status: 'passed' | 'failed' | 'pending'; message?: string; time?: number }

// RSpec `--format json` or Rubaxe's Minitest reporter -> results keyed by workspace-relative '/' paths.
export function parseTestReport(json: string, root: string): TestResult[] {
  const data = JSON.parse(json);
  const rel = (f: string) => relativeTo(root, f) ?? f.replace(/\\/g, '/').replace(/^\.\//, '');
  if (Array.isArray(data)) {
    return data.map((r: any) => ({ file: rel(r.file), line: r.line, name: `${r.group}#${r.name}`, status: r.status, message: r.message ?? undefined, time: r.time }));
  }
  return (data.examples ?? []).map((e: any) => ({
    file: rel(e.file_path), line: e.line_number, name: e.full_description,
    status: e.status === 'passed' || e.status === 'failed' ? e.status : 'pending',
    message: e.exception ? `${e.exception.class}: ${e.exception.message}` : e.pending_message ?? undefined, time: e.run_time,
  }));
}

// ---------- Rails ----------

// shortcut: regular English rules plus a few irregulars; apps with custom inflections may get a wrong guess, upgrade by asking `rails runner` for ActiveSupport's inflector.
const IRREGULAR: Record<string, string> = { person: 'people', man: 'men', woman: 'women', child: 'children', mouse: 'mice', ox: 'oxen', foot: 'feet', tooth: 'teeth', goose: 'geese' };
const UNCOUNTABLE = new Set(['equipment', 'information', 'rice', 'money', 'species', 'series', 'fish', 'sheep', 'news']);
export function pluralize(w: string): string {
  if (UNCOUNTABLE.has(w)) return w;
  if (IRREGULAR[w]) return IRREGULAR[w];
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
  if (/(s|x|z|ch|sh)$/.test(w)) return w + 'es';
  return w + 's';
}
export function singularize(w: string): string {
  if (UNCOUNTABLE.has(w)) return w;
  const irr = Object.entries(IRREGULAR).find(([, p]) => p === w);
  if (irr) return irr[0];
  if (/ies$/.test(w)) return w.slice(0, -3) + 'y';
  if (/(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (/s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
  return w;
}

// The resource a Rails file belongs to: app/controllers/admin/posts_controller.rb -> { ns: 'admin/', singular: 'post', plural: 'posts' }.
export function railsResource(rel: string): { ns: string; singular: string; plural: string } | undefined {
  const m = /^app\/models\/(.*\/)?(\w+)\.rb$/.exec(rel)
    ?? /^app\/(?:controllers|helpers)\/(.*\/)?(\w+?)_(?:controller|helper)\.rb$/.exec(rel)
    ?? /^app\/views\/(?!layouts\/)(.*\/)?(\w+)\/[^/]+$/.exec(rel)
    ?? /^(?:spec|test)\/(?:models|controllers|requests|helpers|system|integration)\/(.*\/)?(\w+?)(?:_controller|_helper)?_(?:spec|test)\.rb$/.exec(rel);
  if (!m) return undefined;
  const ns = m[1] ?? '', name = m[2];
  const isModel = rel.startsWith('app/models/') || /\/models\//.test(rel);
  return isModel ? { ns, singular: name, plural: pluralize(name) } : { ns, singular: singularize(name), plural: name };
}

// Candidate related files (the caller keeps the ones that exist). Namespaced controllers usually use un-namespaced models.
export function railsRelated(rel: string): { kind: string; path: string }[] {
  const r = railsResource(rel);
  if (!r) return [];
  const { ns, singular, plural } = r;
  return [
    { kind: 'Model', path: `app/models/${ns}${singular}.rb` },
    ...(ns ? [{ kind: 'Model', path: `app/models/${singular}.rb` }] : []),
    { kind: 'Controller', path: `app/controllers/${ns}${plural}_controller.rb` },
    { kind: 'Helper', path: `app/helpers/${ns}${plural}_helper.rb` },
    { kind: 'Views', path: `app/views/${ns}${plural}` },
    { kind: 'Layout', path: `app/views/layouts/${plural}.html.erb` },
    { kind: 'Layout', path: 'app/views/layouts/application.html.erb' },
    { kind: 'Routes', path: 'config/routes.rb' },
    { kind: 'Schema', path: 'db/schema.rb' },
  ].filter(c => c.path !== rel);
}

// `bin/rails routes` table -> URL helpers. Continuation rows (no prefix) belong to the previous named route.
export function parseRoutes(out: string): { helper: string; verb: string; path: string; action: string }[] {
  const routes: { helper: string; verb: string; path: string; action: string }[] = [];
  for (const line of out.split(/\r?\n/)) {
    // Route names are snake_case, so an all-caps first word is the verb of a continuation row.
    const m = /^\s*([a-z_][a-z0-9_]*)?\s+([A-Z|]+)?\s+(\/\S*)\s+(\S+)/.exec(line);
    if (!m || !m[1] || m[1] === 'Prefix') continue;
    routes.push({ helper: m[1], verb: m[2] ?? '', path: m[3], action: m[4] });
  }
  return routes;
}

// Flattens the keys of a Rails locale YAML file (indentation only, values ignored): en: { posts: { title: } } -> ['posts.title'].
export function localeKeys(yaml: string): string[] {
  const stack: { indent: number; key: string }[] = [];
  const keys: string[] = [];
  for (const line of yaml.split(/\r?\n/)) {
    const m = /^(\s*)(["']?)([\w-]+)\2:(.*)$/.exec(line);
    if (!m || line.trimStart().startsWith('#')) continue;
    const indent = m[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    stack.push({ indent, key: m[3] });
    if (m[4].trim() && !m[4].trim().startsWith('#') && stack.length > 1) keys.push(stack.slice(1).map(s => s.key).join('.'));
  }
  return keys;
}

// ---------- Git ----------

export interface GitChange { path: string; status: string; from?: string }

// `git status --porcelain=v1 -b -z`: "## branch...upstream", then "XY path\0" (renames add "\0orig"). X = index, Y = worktree.
export function parseGitStatus(out: string): { branch: string; staged: GitChange[]; unstaged: GitChange[] } {
  const parts = out.split('\0');
  let branch = '';
  const staged: GitChange[] = [], unstaged: GitChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.startsWith('## ')) { branch = p.slice(3).replace(/^No commits yet on /, '').split('...')[0]; continue; }
    if (p.length < 4) continue;
    const x = p[0], y = p[1], path = p.slice(3);
    const from = x === 'R' || x === 'C' ? parts[++i] : undefined;
    if (x === '?' && y === '?') { unstaged.push({ path, status: 'U' }); continue; }
    if (x !== ' ') staged.push({ path, status: x, from });
    if (y !== ' ') unstaged.push({ path, status: y });
  }
  return { branch, staged, unstaged };
}

export interface BlameLine { hash: string; author: string; time: number; summary: string }

// `git blame --porcelain`: header "<hash> <orig> <final> [<count>]", commit fields only the first time a hash appears, then "\t<line>".
export function parseBlame(out: string): BlameLine[] {
  const commits = new Map<string, BlameLine>();
  const lines: BlameLine[] = [];
  let cur: BlameLine | undefined;
  for (const l of out.split('\n')) {
    const head = /^([0-9a-f]{40}) \d+ \d+/.exec(l);
    if (head) {
      cur = commits.get(head[1]) ?? { hash: head[1], author: '', time: 0, summary: '' };
      commits.set(head[1], cur);
    } else if (cur && l.startsWith('author ')) cur.author = l.slice(7);
    else if (cur && l.startsWith('author-time ')) cur.time = Number(l.slice(12));
    else if (cur && l.startsWith('summary ')) cur.summary = l.slice(8);
    else if (cur && l.startsWith('\t')) lines.push(cur);
  }
  return lines;
}

// rake -AT lines look like: "rake db:migrate   # Migrate the database"
export function parseRakeTasks(out: string): { name: string; desc: string }[] {
  return [...out.matchAll(/^rake (\S+)(?:\s+# (.*))?$/gm)].map(m => ({ name: m[1], desc: m[2] ?? '' }));
}

// Electron prefixes IPC rejections with "Error invoking remote method 'x': Error: "; users only need the reason.
export const ipcMessage = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '\w+': (\w*Error: )?/, '');
