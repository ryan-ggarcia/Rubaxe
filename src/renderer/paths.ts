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

export interface TestResult { file: string; line: number; name: string; status: 'passed' | 'failed' | 'pending'; message?: string; time?: number; id?: string }

// RSpec `--format json` or Rubaxe's Minitest reporter -> results keyed by workspace-relative '/' paths.
export function parseTestReport(json: string, root: string): TestResult[] {
  const data = JSON.parse(json);
  const rel = (f: string) => relativeTo(root, f) ?? f.replace(/\\/g, '/').replace(/^\.\//, '');
  if (Array.isArray(data)) {
    return data.map((r: any) => ({ file: rel(r.file), line: r.line, name: `${r.group}#${r.name}`, status: r.status, message: r.message ?? undefined, time: r.time }));
  }
  return (data.examples ?? []).map((e: any) => ({
    file: rel(e.file_path), line: e.line_number, name: e.full_description, id: e.id,
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

// ANSI escapes stripped from plain-text output: CSI (colors, cursor moves, `?25l`) and OSC (window titles).
export const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

// "Ctrl+Shift+P" style key of a keydown. Cmd counts as Ctrl on macOS. Backquote and, with Alt held, letters and
// digits come from the physical key: Shift turns e.key into "~" and Option on macOS into "‰" and friends.
export function eventKey(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; key: string; code: string }, platform: string): string {
  const physical = e.code === 'Backquote' ? '`' : e.altKey ? /^(?:Key([A-Z])|Digit(\d))$/.exec(e.code)?.slice(1).find(Boolean)?.toLowerCase() : undefined;
  return [(e.ctrlKey || (platform === 'darwin' && e.metaKey)) && 'ctrl', e.shiftKey && 'shift', e.altKey && 'alt', physical ?? e.key.toLowerCase()].filter(Boolean).join('+');
}

// Read-only git commands run without optional locks (like VS Code): `git status` would otherwise rewrite .git/index,
// and the file watcher would see that as a change and refresh again, forever.
export function gitArgs(args: string[]): string[] {
  const read = ['status', 'show', 'diff', 'blame', 'rev-parse', 'remote'].includes(args[0]) || (args[0] === 'branch' && !!args[1]?.startsWith('--format'));
  return read ? ['--no-optional-locks', ...args] : args;
}

// Repository link typed by the user goes to cmd.exe (shell: true) and quote() leaves % and ! alone: only a plain
// charset passes, never a leading '-' (git would read an option, also as a host), and only the shapes git knows:
// http(s)/ssh/git/file URLs, user@host:path, and absolute local paths (C:\ or C:/, /). The drive needs a separator
// right after the colon, so "C:x" or "host:path" without a user never pass; no shape allows a "xxx::" transport.
// file: needs three slashes and a word char: file://host or file:////host is a UNC share on Windows (SMB, NTLM).
export const isRemoteUrl = (url: string) =>
  /^[\w.@:/\\~+-]+$/.test(url) && !url.startsWith('-') &&
  /^((https?|ssh|git):\/\/\w|file:\/\/\/\w|\w[\w.-]*@\w[\w.-]*:.|[A-Za-z]:[\\/]|\/\w)/.test(url);

// Folder `git clone <url>` creates: last path segment without a trailing separator, a final /.git or .git.
export const cloneDir = (url: string) =>
  url.replace(/[/\\]+$/, '').replace(/[/\\]+\.git$/, '').split(/[/\\:]/).pop()!.replace(/\.git$/, '');

// Multi-select acts on the outermost items: a file inside a selected folder goes with the folder.
export function outermost(paths: string[], sep: string, win: boolean): string[] {
  const f = (p: string) => win ? p.toLowerCase() : p;
  return paths.filter(p => !paths.some(q => q !== p && f(p).startsWith(f(q) + sep)));
}

// Drag and drop into dest: undefined when a folder would land in itself or in its own subfolder, else the items that
// move (those already in dest stay).
export function dropPlan(paths: string[], dest: string, sep: string, win: boolean): string[] | undefined {
  const f = (p: string) => win ? p.toLowerCase() : p;
  const top = outermost(paths, sep, win);
  if (top.some(p => f(dest) === f(p) || f(dest).startsWith(f(p) + sep))) return undefined;
  return top.filter(p => f(p.slice(0, p.lastIndexOf(sep))) !== f(dest));
}

// Shift+click: the visible rows from the anchor to the clicked one, either way; only the clicked one without an anchor.
export function rangeBetween(order: string[], anchor: string, target: string): string[] {
  const a = order.indexOf(anchor), b = order.indexOf(target);
  return a < 0 || b < 0 ? [target] : order.slice(Math.min(a, b), Math.max(a, b) + 1);
}

// Tabs whose files share a name show their folder (like VS Code): relative to the project root, the root's own name
// for files right in it, the absolute folder outside it; '' for unique names and non-file tabs (undefined).
// Only the fewest trailing folder segments that tell the group apart are shown, '…' + sep marking a cut.
export function tabDescriptions(paths: (string | undefined)[], root: string, sep: string): string[] {
  const name = (p: string) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
  const folders = paths.map(p => {
    if (!p) return [];
    const rel = relativeTo(root, p);
    if (rel === undefined) return p.slice(0, -name(p).length - 1).split(/[\\/]/);
    return rel.includes('/') ? rel.split('/').slice(0, -1) : [name(root.replace(/[\\/]$/, ''))];
  });
  const tail = (f: string[], k: number) => f.slice(-k).join(sep);
  return paths.map((p, i) => {
    const group = p ? folders.filter((_, j) => paths[j] && name(paths[j]) === name(p)) : [];
    if (group.length < 2) return '';
    const segs = folders[i];
    let k = 1;
    while (k < segs.length && new Set(group.map(f => tail(f, k))).size < group.length) k++;
    return (k < segs.length ? '…' + sep : '') + tail(segs, k);
  });
}

// Gemfile.lock lists the standard gem as "    standard (1.2.3)".
export const usesStandard = (lock: string) => /^ {4}standard \(/m.test(lock);

export const isGemfile = (path: string, root: string) => /^Gemfile(\.lock)?$/.test(relativeTo(root, path) ?? '');

// Every folder that holds (directly or deeper) a *_spec.rb, workspace-relative.
export function specDirs(files: string[], root: string): string[] {
  const dirs = new Set<string>();
  for (const f of files) {
    const rel = relativeTo(root, f);
    if (!rel?.endsWith('_spec.rb')) continue;
    const parts = rel.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return [...dirs].sort();
}

export const rspecFolderArgs = (dir: string, filter: string) => [dir, ...(filter.trim() ? ['-e', filter.trim()] : [])];

// How to rerun one result: RSpec example id (spec/a_spec.rb[1:2]) when the report had one, else file:line.
export const testTarget = (r: { file: string; line: number; id?: string }) => r.id ? r.id.replace(/^\.\//, '') : `${r.file}:${r.line}`;

// ---------- Rails: rename a resource ----------

export const camelize = (snake: string) => snake.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
export const underscore = (camel: string) => camel.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase();
const simplePlural = (w: string) => /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : /(s|x|z|ch|sh)$/.test(w) ? w + 'es' : w + 's';
// Irregular and uncountable words differ from the simple s/es/ies rule: the user confirms the plural for those.
export const needsPluralConfirm = (snake: string) => pluralize(snake) !== simplePlural(snake);

// `texts`: workspace-relative files (old paths) whose content gets the lowercase renames of railsRenameText.
// `fixtureUsers`: other test/spec files where only the fixture accessor (`posts(:one)`) is renamed.
export interface RenamePlan { files: { from: string; to: string }[]; consts: { from: string; to: string; file: string }[]; texts: string[]; fixtureUsers: string[] }

// What changes when the resource of `rel` (Post -> Article) is renamed. `files` = workspace-relative '/' paths; only
// files/folders that exist are listed. Tables, migrations and routes.rb are deliberately not part of the plan.
export function railsRenamePlan(rel: string, files: string[], newCamel: string, newPlural: string): RenamePlan | undefined {
  const r = railsResource(rel);
  if (!r) return undefined;
  const { ns, singular: os, plural: op } = r;
  const ns2 = underscore(newCamel), np = newPlural;
  const [OS, OP, NS, NP] = [camelize(os), camelize(op), newCamel, camelize(np)];
  type Row = [from: string, to: string, consts: [string, string][]];
  const rows: Row[] = [];
  for (const n of [...new Set([ns, ''])]) {
    rows.push([`app/models/${n}${os}.rb`, `app/models/${n}${ns2}.rb`, [[OS, NS]]]);
    rows.push([`test/models/${n}${os}_test.rb`, `test/models/${n}${ns2}_test.rb`, [[`${OS}Test`, `${NS}Test`]]]);
    rows.push([`spec/models/${n}${os}_spec.rb`, `spec/models/${n}${ns2}_spec.rb`, []]);
  }
  rows.push(
    [`app/controllers/${ns}${op}_controller.rb`, `app/controllers/${ns}${np}_controller.rb`, [[`${OP}Controller`, `${NP}Controller`]]],
    [`app/helpers/${ns}${op}_helper.rb`, `app/helpers/${ns}${np}_helper.rb`, [[`${OP}Helper`, `${NP}Helper`]]],
    [`test/controllers/${ns}${op}_controller_test.rb`, `test/controllers/${ns}${np}_controller_test.rb`, [[`${OP}ControllerTest`, `${NP}ControllerTest`]]],
    [`test/helpers/${ns}${op}_helper_test.rb`, `test/helpers/${ns}${np}_helper_test.rb`, [[`${OP}HelperTest`, `${NP}HelperTest`]]],
    [`test/system/${ns}${op}_test.rb`, `test/system/${ns}${np}_test.rb`, [[`${OP}Test`, `${NP}Test`]]],
    [`spec/controllers/${ns}${op}_controller_spec.rb`, `spec/controllers/${ns}${np}_controller_spec.rb`, []],
    [`spec/requests/${ns}${op}_spec.rb`, `spec/requests/${ns}${np}_spec.rb`, []],
    [`spec/helpers/${ns}${op}_helper_spec.rb`, `spec/helpers/${ns}${np}_helper_spec.rb`, []],
    [`spec/system/${ns}${op}_spec.rb`, `spec/system/${ns}${np}_spec.rb`, []],
    [`test/fixtures/${op}.yml`, `test/fixtures/${np}.yml`, []],
    [`spec/fixtures/${op}.yml`, `spec/fixtures/${np}.yml`, []],
  );
  const plan: RenamePlan = { files: [], consts: [], texts: [], fixtureUsers: [] };
  for (const [from, to, consts] of rows) {
    if (!files.includes(from)) continue;
    plan.files.push({ from, to });
    if (!from.startsWith('app/models/') && !from.endsWith('.yml')) plan.texts.push(from);
    for (const [a, b] of consts) plan.consts.push({ from: a, to: b, file: from });
  }
  for (const base of ['app/views', 'spec/views']) {
    const from = `${base}/${ns}${op}`;
    const inside = files.filter(f => f.startsWith(from + '/'));
    if (!inside.length) continue;
    plan.texts.push(...inside);
    // The partial _post.* is named after the model: rename it inside the old folder, before the folder itself moves.
    for (const f of inside) {
      const m = new RegExp(`^${from}/_${os}(\\..+)$`).exec(f);
      if (m) plan.files.push({ from: f, to: `${from}/_${ns2}${m[1]}` });
    }
    plan.files.push({ from, to: `${base}/${ns}${np}` });
  }
  for (const base of ['test', 'spec']) {
    if (files.includes(`${base}/fixtures/${op}.yml`)) plan.fixtureUsers.push(...files.filter(f => f.startsWith(base + '/') && f.endsWith('.rb') && !plan.texts.includes(f)));
  }
  return plan;
}

// Fixture accessor `posts(:one)` -> `articles(:one)`; the word boundary leaves `user_posts(:one)` alone.
export function fixtureAccessor(text: string, op: string, np: string): { text: string; count: number } {
  let count = 0;
  text = text.replace(new RegExp(`\\b${op}\\(:`, 'g'), () => { count++; return `${np}(:`; });
  return { text, count };
}

// Lowercase names left behind by a resource rename (post -> article), whole words only. Ruby files get the helper/ivar/param
// forms; views also get the bare local (`render post`). The HTTP verb `post` (tests) and `method: :post` are never touched.
export function railsRenameText(text: string, view: boolean, os: string, op: string, ns: string, np: string): { text: string; count: number } {
  let count = 0;
  const sub = (re: RegExp, to: string) => { text = text.replace(re, (...m) => { count++; return to.replace(/\$(\d)/g, (_, i) => m[+i]); }); };
  const notMethod = '(?<!method\\s*[=:]\\s*[:"\'])';
  sub(new RegExp(`\\b((?:new_|edit_)?)${op}_(path|url)\\b`, 'g'), `$1${np}_$2`);
  sub(new RegExp(`\\b((?:new_|edit_)?)${os}_(path|url)\\b`, 'g'), `$1${ns}_$2`);
  sub(new RegExp(`@${op}\\b`, 'g'), `@${np}`);
  sub(new RegExp(`@${os}\\b`, 'g'), `@${ns}`);
  sub(new RegExp(`\\bset_${os}\\b`, 'g'), `set_${ns}`);
  sub(new RegExp(`\\b${os}_params\\b`, 'g'), `${ns}_params`);
  sub(new RegExp(`\\b${op}/${os}\\b`, 'g'), `${np}/${ns}`);
  sub(new RegExp(`\\b${os}:(?!:)`, 'g'), `${ns}:`);
  sub(new RegExp(`(?<!method\\s*[=:]\\s*):${os}\\b`, 'g'), `:${ns}`);
  sub(new RegExp(`\\b${camelize(os)}\\b`, 'g'), camelize(ns));
  const f = fixtureAccessor(text, op, np);
  text = f.text;
  count += f.count;
  text = text.split('\n').map(l => /^\s*#/.test(l) ? l.replace(new RegExp(`/${op}\\b`, 'g'), () => { count++; return `/${np}`; }) : l).join('\n');
  if (view) {
    sub(new RegExp(`${notMethod}\\b${os}\\b`, 'g'), ns);
    sub(new RegExp(`\\b${op}\\b`, 'g'), np);
    sub(new RegExp(`\\b${camelize(op)}\\b`, 'g'), camelize(np));
  }
  return { text, count };
}

// Lines of config/routes.rb that mention the resource, and migrations about it: listed for manual review, never edited.
export function railsReview(routes: string, files: string[], singular: string, plural: string): string[] {
  const re = new RegExp(`:(?:${plural}|${singular})\\b`);
  const lines = routes.split(/\r?\n/).flatMap((l, i) => re.test(l) ? [`config/routes.rb:${i + 1}: ${l.trim()}`] : []);
  const mig = new RegExp(`(^|_)(?:${plural}|${singular})(_|\\.rb$)`);
  return [...lines, ...files.filter(f => f.startsWith('db/migrate/') && mig.test(f.slice(11)))];
}

export interface Inspection { rule: string; message: string; severity: 'warning' | 'info'; line: number; column: number; endLine: number; endColumn: number }

// rubaxe_inspect.rb prints a JSON array, but `exec` merges stderr in: anything unparseable means "no findings".
export function parseInspections(out: string): Inspection[] {
  try {
    const list = JSON.parse(out.trim());
    return Array.isArray(list) ? list.filter(i => i && typeof i.message === 'string' && Number.isInteger(i.line) && Number.isInteger(i.column) && Number.isInteger(i.endLine) && Number.isInteger(i.endColumn)) : [];
  } catch {
    return [];
  }
}

type FileKind = 'ruby' | 'erb' | 'yaml' | 'json' | 'lock' | 'md' | 'js' | 'ts' | 'css' | 'html' | 'file'
  | 'routes' | 'schema' | 'migration' | 'database' | 'gemfile' | 'gemlock' | 'rake' | 'rack' | 'controller' | 'helper' | 'model';
// Rails role of a path relative to the project root (first match wins).
const RAILS_KINDS: [RegExp, FileKind][] = [
  [/^config\/routes\.rb$/, 'routes'], [/^db\/schema\.rb$/, 'schema'], [/^db\/migrate\/[^/]+\.rb$/, 'migration'], [/^config\/database\.yml$/, 'database'],
  [/^config\.ru$/, 'rack'], [/^app\/models\/.+\.rb$/, 'model'], [/_controller\.rb$/, 'controller'], [/_helper\.rb$/, 'helper'],
];

// Icon family of a file (explorer, tabs, right panel); `path` is relative to the project root, or just a name.
export function fileKind(path: string): FileKind {
  const rel = path.replace(/\\/g, '/'), name = rel.slice(rel.lastIndexOf('/') + 1);
  const rails = RAILS_KINDS.find(([re]) => re.test(rel))?.[1];
  if (rails) return rails;
  if (name === 'Gemfile') return 'gemfile';
  if (name === 'Gemfile.lock') return 'gemlock';
  if (name === 'Rakefile') return 'rake';
  if (/\.html?\.erb$|\.erb$/i.test(name)) return 'erb';
  if (/\.(rb|rake|gemspec|ru)$/.test(name)) return 'ruby';
  const ext = /\.([^.]+)$/.exec(name)?.[1].toLowerCase();
  const byExt: Record<string, FileKind> = { yml: 'yaml', yaml: 'yaml', json: 'json', lock: 'lock', md: 'md', js: 'js', mjs: 'js', ts: 'ts', css: 'css', scss: 'css', html: 'html', htm: 'html' };
  return (ext && byExt[ext]) || 'file';
}

// "* Listening on http://127.0.0.1:3000" from Puma's output; '' while the server has not announced a port.
export const serverPort = (text: string): string => /Listening on (?:https?|tcp|ssl):\/\/(?:\[[^\]]+\]|[^\s:/]+):(\d+)/.exec(text)?.[1] ?? '';

// ---------- Markdown preview ----------

// What a link or image in `md` (absolute path) points to: a web URL, an #anchor, or a local file, relative to the
// .md's folder (a leading / is the project root). Other schemes (javascript:, file:, data:) and //host or \\host
// (UNC, which leaks Windows credentials) give undefined.
export function mdTarget(href: string, md: string, root: string): { url: string } | { anchor: string } | { path: string } | undefined {
  const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return undefined; } };
  const t = href.trim();
  if (/^https?:\/\//i.test(t)) return { url: t };
  if (t.startsWith('#')) return { anchor: decode(t.slice(1)) ?? t.slice(1) };
  const rel = decode(t.replace(/[?#][^]*$/, ''))?.replace(/\\/g, '/');
  if (!rel || /^[a-z][a-z\d+.-]*:/i.test(rel) || rel.startsWith('//')) return undefined;
  const sep = md.includes('\\') ? '\\' : '/';
  const parts = (rel.startsWith('/') && root ? root : md.slice(0, Math.max(md.lastIndexOf('/'), md.lastIndexOf('\\')))).split(/[\\/]/);
  for (const seg of rel.split('/')) {
    if (seg === '..') { if (parts.length > 1) parts.pop(); } else if (seg && seg !== '.') parts.push(seg);
  }
  return { path: parts.join(sep) };
}

// Absolute path -> file: URL for <img src>; # and ? in a name would otherwise cut the URL.
export const fileUrl = (path: string) => 'file://' + (path.startsWith('/') ? '' : '/') + encodeURI(path.replace(/\\/g, '/')).replace(/[?#]/g, c => encodeURIComponent(c));

// GitHub-style heading anchors: lowercase, punctuation dropped, spaces to '-', repeats get -1, -2…
export function headingSlugs(texts: string[]): string[] {
  const seen = new Map<string, number>();
  return texts.map(text => {
    const base = text.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
    let slug = base;
    while (seen.has(slug)) { const n = seen.get(base)! + 1; seen.set(base, n); slug = `${base}-${n}`; }
    seen.set(slug, 0);
    return slug;
  });
}
