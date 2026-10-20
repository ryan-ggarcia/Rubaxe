// Ruby intentions and code generation as pure text transforms (no Monaco), offered through Ctrl+. in the editor.
// Lines and columns are 1-based. Block structure is found by indentation, so code formatted the usual Ruby way is assumed.

export interface TextEdit { range: [startLine: number, startCol: number, endLine: number, endCol: number]; text: string }
export interface Intention { title: string; edits: TextEdit[] }
export interface Sel { sl: number; sc: number; el: number; ec: number }

const indentOf = (l: string) => /^\s*/.exec(l)![0];
const replaceLines = (lines: string[], from: number, to: number, text: string): TextEdit => ({ range: [from, 1, to, lines[to - 1].length + 1], text });
const insertBefore = (line: number, text: string): TextEdit => ({ range: [line, 1, line, 1], text: text + '\n' });

// The `end`/`else`/`elsif` lines that close the block opened at index i (0-based), matched by indentation.
function blockAt(lines: string[], i: number): { elseIdx?: number; endIdx: number } | undefined {
  const ind = indentOf(lines[i]).length;
  let elseIdx: number | undefined;
  for (let k = i + 1; k < lines.length; k++) {
    const t = lines[k].trim();
    if (!t) continue;
    const kind = indentOf(lines[k]).length;
    if (kind < ind) return undefined;
    if (kind > ind) continue;
    if (t === 'end') return { elseIdx, endIdx: k };
    if (t === 'else' && elseIdx === undefined) { elseIdx = k; continue; }
    return undefined; // elsif, rescue or a sibling statement: not a simple block
  }
}

// ---------- blocks ----------

function braceToDoEnd(lines: string[], i: number): Intention | undefined {
  const m = /^(\s*)(.*?(?:[\w)?!\]]|->))\s*\{\s*(\|[^|]*\|)?\s*(.*?)\s*\}\s*$/.exec(lines[i]);
  if (!m || !m[4] || /^\s*\w+:|=>/.test(m[4]) && !m[3]) return undefined; // `{ a: 1 }` after a call is a hash argument
  const [, ind, head, params, body] = m;
  return { title: 'Converter { } em do…end', edits: [replaceLines(lines, i + 1, i + 1, `${ind}${head} do${params ? ' ' + params : ''}\n${ind}  ${body}\n${ind}end`)] };
}

function doEndToBrace(lines: string[], i: number): Intention | undefined {
  const m = /^(\s*)(.*?)\s+do(\s*\|[^|]*\|)?\s*$/.exec(lines[i]);
  if (!m || i + 2 >= lines.length || lines[i + 2].trim() !== 'end' || indentOf(lines[i + 2]) !== m[1]) return undefined;
  const body = lines[i + 1].trim();
  if (!body || /\b(do|if|unless|while|case|begin|def|class|module)\b\s*$/.test(body)) return undefined;
  return { title: 'Converter do…end em { }', edits: [replaceLines(lines, i + 1, i + 3, `${m[1]}${m[2]} {${m[3] ? ' ' + m[3].trim() : ''} ${body} }`)] };
}

// ---------- hashes ----------

function hashRocketToColon(lines: string[], i: number): Intention | undefined {
  const re = /:(\w+[?!]?)\s*=>\s*/g;
  if (!re.test(lines[i])) return undefined;
  return { title: 'Converter :chave => em chave:', edits: [replaceLines(lines, i + 1, i + 1, lines[i].replace(re, '$1: '))] };
}

// Only inside `{ }` on the line: outside braces `key:` is usually a kwarg (Ruby 3), where `:key =>` changes meaning.
function colonToHashRocket(lines: string[], i: number): Intention | undefined {
  const line = lines[i];
  const open = line.indexOf('{'), close = line.lastIndexOf('}');
  if (open < 0 || close < open) return undefined;
  const inner = line.slice(open, close + 1);
  const re = /([{,]\s*)(\w+[?!]?):\s+/g;
  if (!re.test(inner)) return undefined;
  return { title: 'Converter chave: em :chave =>', edits: [replaceLines(lines, i + 1, i + 1, line.slice(0, open) + inner.replace(re, '$1:$2 => ') + line.slice(close + 1))] };
}

// Splits on commas that are not inside brackets or strings.
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = '', cur = '';
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (quote) { cur += c; if (c === '\\') cur += s[++k] ?? ''; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const pairKey = (p: string) => p.replace(/^:/, '').replace(/^["']/, '').toLowerCase();

function sortHash(lines: string[], i: number): Intention | undefined {
  const one = /^(.*?\{\s*)(.+?)(\s*\}.*)$/.exec(lines[i]);
  if (one) {
    const pairs = splitTop(one[2]);
    if (pairs.length < 2 || !pairs.every(p => /^(:?\w+[?!]?:?|["'][^"']+["'])\s*(=>|:)?\s*\S/.test(p))) return undefined;
    const sorted = [...pairs].sort((a, b) => pairKey(a).localeCompare(pairKey(b)));
    if (sorted.join() === pairs.join()) return undefined;
    return { title: 'Ordenar chaves do hash', edits: [replaceLines(lines, i + 1, i + 1, one[1] + sorted.join(', ') + one[3])] };
  }
  // Multi-line hash: cursor on the line that opens it, one pair per line until the closing brace.
  if (!/\{\s*$/.test(lines[i])) return undefined;
  const end = lines.findIndex((l, k) => k > i && /^\s*\}/.test(l));
  if (end < i + 3) return undefined;
  const body = lines.slice(i + 1, end);
  if (!body.every(l => /^\s*(:?\w+[?!]?:?|["'][^"']+["'])\s*(=>|:)?\s*\S/.test(l))) return undefined;
  const lastComma = /,\s*$/.test(body[body.length - 1]);
  const bare = body.map(l => l.replace(/,\s*$/, ''));
  const sorted = [...bare].sort((a, b) => pairKey(a.trim()).localeCompare(pairKey(b.trim())));
  if (sorted.join() === bare.join()) return undefined;
  const text = sorted.map((l, k) => k < sorted.length - 1 || lastComma ? l + ',' : l).join('\n');
  return { title: 'Ordenar chaves do hash', edits: [replaceLines(lines, i + 2, end, text)] };
}

// ---------- conditionals ----------

function ifElseToTernary(lines: string[], i: number): Intention | undefined {
  const m = /^(\s*)if\s+(.+?)\s*$/.exec(lines[i]);
  const b = m && blockAt(lines, i);
  if (!m || !b || b.elseIdx !== i + 2 || b.endIdx !== i + 4) return undefined;
  const yes = lines[i + 1].trim(), no = lines[i + 3].trim();
  const ay = /^(\w+)\s*=\s*(.+)$/.exec(yes), an = /^(\w+)\s*=\s*(.+)$/.exec(no);
  const text = ay && an && ay[1] === an[1] ? `${m[1]}${ay[1]} = ${m[2]} ? ${ay[2]} : ${an[2]}` : `${m[1]}${m[2]} ? ${yes} : ${no}`;
  return { title: 'Converter if/else em ternário', edits: [replaceLines(lines, i + 1, i + 5, text)] };
}

function ternaryToIf(lines: string[], i: number): Intention | undefined {
  const m = /^(\s*)(?:(\w+)\s*=\s*)?(.+?)\s+\?\s+(.+?)\s+:\s+(.+?)\s*$/.exec(lines[i]);
  if (!m || /^(if|unless|return|puts)\b/.test(m[3])) return undefined;
  const [, ind, target, cond, yes, no] = m;
  const set = (v: string) => target ? `${target} = ${v}` : v;
  return { title: 'Converter ternário em if/else', edits: [replaceLines(lines, i + 1, i + 1, `${ind}if ${cond}\n${ind}  ${set(yes)}\n${ind}else\n${ind}  ${set(no)}\n${ind}end`)] };
}

function modifierToStatement(lines: string[], i: number): Intention | undefined {
  const m = /^(\s*)(?!(?:if|unless|while|until|elsif|end)\b|\})(\S.*?)\s+(if|unless|while|until)\s+(.+?)\s*$/.exec(lines[i]);
  if (!m || /["'`]/.test(m[2] + m[4]) && /\s(if|unless|while|until)\s/.test(m[4])) return undefined;
  return { title: `Converter modificador ${m[3]} em bloco`, edits: [replaceLines(lines, i + 1, i + 1, `${m[1]}${m[3]} ${m[4]}\n${m[1]}  ${m[2]}\n${m[1]}end`)] };
}

function statementToModifier(lines: string[], i: number): Intention | undefined {
  const m = /^(\s*)(if|unless|while|until)\s+(.+?)\s*$/.exec(lines[i]);
  const b = m && blockAt(lines, i);
  if (!m || !b || b.elseIdx !== undefined || b.endIdx !== i + 2) return undefined;
  const body = lines[i + 1].trim();
  if (`${m[1]}${body} ${m[2]} ${m[3]}`.length > 120) return undefined;
  return { title: `Converter bloco ${m[2]} em modificador`, edits: [replaceLines(lines, i + 1, i + 3, `${m[1]}${body} ${m[2]} ${m[3]}`)] };
}

const negate = (c: string) => /^!\((.*)\)$/.exec(c)?.[1] ?? (/^!\w[\w.?!]*$/.test(c) ? c.slice(1) : /^[\w.@?!]+$/.test(c) ? `!${c}` : `!(${c})`);

function invertIf(lines: string[], i: number): Intention | undefined {
  const m = /^(\s*)(if|unless)\s+(.+?)\s*$/.exec(lines[i]);
  const b = m && blockAt(lines, i);
  if (!m || !b) return undefined;
  if (b.elseIdx === undefined) {
    return { title: `Inverter: ${m[2]} → ${m[2] === 'if' ? 'unless' : 'if'}`, edits: [replaceLines(lines, i + 1, i + 1, `${m[1]}${m[2] === 'if' ? 'unless' : 'if'} ${m[3]}`)] };
  }
  const yes = lines.slice(i + 1, b.elseIdx), no = lines.slice(b.elseIdx + 1, b.endIdx);
  const cond = m[2] === 'if' ? negate(m[3]) : m[3];
  return { title: 'Inverter condição e trocar os ramos', edits: [replaceLines(lines, i + 1, b.endIdx + 1, [`${m[1]}if ${cond}`, ...no, `${m[1]}else`, ...yes, `${m[1]}end`].join('\n'))] };
}

function mergeNestedIf(lines: string[], i: number): Intention | undefined {
  const outer = /^(\s*)if\s+(.+?)\s*$/.exec(lines[i]);
  const ob = outer && blockAt(lines, i);
  const inner = /^(\s*)if\s+(.+?)\s*$/.exec(lines[i + 1] ?? '');
  const ib = inner && blockAt(lines, i + 1);
  if (!outer || !ob || ob.elseIdx !== undefined || !inner || !ib || ib.elseIdx !== undefined || ib.endIdx !== ob.endIdx - 1) return undefined;
  const wrap = (c: string) => /\|\||\bor\b|\band\b/.test(c) ? `(${c})` : c;
  const body = lines.slice(i + 2, ib.endIdx).map(l => l.replace(/^ {2}/, ''));
  return { title: 'Juntar ifs aninhados', edits: [replaceLines(lines, i + 1, ob.endIdx + 1, [`${outer[1]}if ${wrap(outer[2])} && ${wrap(inner[2])}`, ...body, `${outer[1]}end`].join('\n'))] };
}

function splitIf(lines: string[], i: number): Intention | undefined {
  const m = /^(\s*)if\s+(.+?)\s+&&\s+(.+?)\s*$/.exec(lines[i]);
  const b = m && blockAt(lines, i);
  if (!m || !b || b.elseIdx !== undefined || /\|\||\bor\b/.test(lines[i]) || (m[2].match(/\(/g)?.length ?? 0) !== (m[2].match(/\)/g)?.length ?? 0)) return undefined;
  const body = lines.slice(i + 1, b.endIdx).map(l => '  ' + l);
  return { title: 'Dividir if com && em ifs aninhados', edits: [replaceLines(lines, i + 1, b.endIdx + 1, [`${m[1]}if ${m[2]}`, `${m[1]}  if ${m[3]}`, ...body, `${m[1]}  end`, `${m[1]}end`].join('\n'))] };
}

// ---------- literals ----------

// The token of `re` (global) that contains column `col`, as [start, end) 0-based.
function tokenAt(line: string, col: number, re: RegExp): RegExpExecArray | undefined {
  for (const m of line.matchAll(re)) if (m.index! <= col - 1 && col - 1 <= m.index! + m[0].length) return m as RegExpExecArray;
}

function stringSymbol(lines: string[], i: number, col: number): Intention | undefined {
  const line = lines[i];
  const str = tokenAt(line, col, /(["'])([A-Za-z_]\w*[?!]?)\1/g);
  if (str && line[str.index! - 1] !== ':') {
    return { title: `Converter "${str[2]}" em símbolo`, edits: [{ range: [i + 1, str.index! + 1, i + 1, str.index! + str[0].length + 1], text: `:${str[2]}` }] };
  }
  const sym = tokenAt(line, col, /(?<![:\w]):([A-Za-z_]\w*[?!]?)(?![:\w])/g);
  if (sym) return { title: `Converter :${sym[1]} em string`, edits: [{ range: [i + 1, sym.index! + 1, i + 1, sym.index! + sym[0].length + 1], text: `'${sym[1]}'` }] };
}

const STR = `"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'`;
const OPERAND = `(?:${STR}|[@$]?[\\w.:!?]+(?:\\([^()]*\\))?)`;
const CHAIN = new RegExp(`${OPERAND}(?:\\s*\\+\\s*${OPERAND})+`, 'g');

function toInterpolation(lines: string[], i: number, col: number): Intention | undefined {
  const m = tokenAt(lines[i], col, CHAIN);
  if (!m || !/["']/.test(m[0])) return undefined;
  const parts = m[0].split(new RegExp(`\\s*\\+\\s*(?=${OPERAND})`)).filter(Boolean);
  let out = '';
  for (const p of parts) {
    if (p.startsWith('"')) out += p.slice(1, -1);
    else if (p.startsWith("'")) out += p.slice(1, -1).replace(/\\'/g, "'").replace(/\\(?!\\)/g, '\\\\').replace(/"/g, '\\"').replace(/#\{/g, '\\#{');
    else out += `#{${p}}`;
  }
  return { title: 'Converter concatenação em interpolação', edits: [{ range: [i + 1, m.index! + 1, i + 1, m.index! + m[0].length + 1], text: `"${out}"` }] };
}

function squigglyHeredoc(lines: string[], i: number): Intention | undefined {
  const m = /<<(-?)(['"`]?)([A-Z_][A-Z0-9_]*)\2/.exec(lines[i]);
  if (!m) return undefined;
  const end = lines.findIndex((l, k) => k > i && l.trim() === m[3]);
  if (end < 0) return undefined;
  const ind = indentOf(lines[i]);
  const body = lines.slice(i + 1, end).map(l => l.trim() ? `${ind}  ${l}` : l);
  const head = lines[i].slice(0, m.index) + `<<~${m[2]}${m[3]}${m[2]}` + lines[i].slice(m.index + m[0].length);
  return { title: 'Converter em heredoc <<~ (remove a indentação comum)', edits: [replaceLines(lines, i + 1, end + 1, [head, ...body, `${ind}${m[3]}`].join('\n'))] };
}

function numberUnderscores(lines: string[], i: number, col: number): Intention | undefined {
  const m = tokenAt(lines[i], col, /(?<![\w.])\d[\d_]*(?:\.\d+)?(?![\w.])/g);
  if (!m) return undefined;
  const [int, frac = ''] = m[0].split('.');
  const digits = int.replace(/_/g, '');
  const range: TextEdit['range'] = [i + 1, m.index! + 1, i + 1, m.index! + m[0].length + 1];
  const dot = frac ? '.' + frac : '';
  if (int.includes('_')) return { title: 'Remover _ do número', edits: [{ range, text: digits + dot }] };
  if (digits.length < 5) return undefined;
  return { title: 'Separar milhares com _', edits: [{ range, text: digits.replace(/\B(?=(\d{3})+$)/g, '_') + dot }] };
}

// ---------- generation ----------

function classAt(lines: string[], i: number): { start: number; end: number; ind: string } | undefined {
  for (let k = i; k >= 0; k--) {
    const m = /^(\s*)class\s+\w/.exec(lines[k]);
    if (!m) continue;
    const b = blockAt(lines, k);
    if (b && b.endIdx >= i) return { start: k, end: b.endIdx, ind: m[1] };
  }
}

function generateMembers(lines: string[], i: number): Intention[] {
  const cls = classAt(lines, i);
  if (!cls) return [];
  const body = lines.slice(cls.start + 1, cls.end);
  const ivars = [...new Set(body.join('\n').match(/@(?!@)\w+/g) ?? [])].map(v => v.slice(1));
  const declared = new Set(body.flatMap(l => /^\s*attr_(?:reader|writer|accessor)\s+(.*)$/.exec(l)?.[1].match(/\w+/g) ?? []));
  const missing = ivars.filter(v => !declared.has(v));
  const inner = cls.ind + '  ';
  const after = body.reduce((last, l, k) => /^\s*(attr_|include|extend)\b/.test(l) ? k + 1 : last, 0); // keep attrs below includes
  const at = cls.start + 2 + after;
  const out: Intention[] = [];
  if (missing.length) for (const kind of ['reader', 'writer', 'accessor']) {
    out.push({ title: `Gerar attr_${kind} :${missing.join(', :')}`, edits: [insertBefore(at, `${inner}attr_${kind} ${missing.map(v => ':' + v).join(', ')}`)] });
  }
  if (ivars.length && !body.some(l => /^\s*def\s+initialize\b/.test(l))) {
    const ctor = [`${inner}def initialize(${ivars.join(', ')})`, ...ivars.map(v => `${inner}  @${v} = ${v}`), `${inner}end`];
    out.push({ title: `Gerar initialize(${ivars.join(', ')})`, edits: [insertBefore(at, (after ? '\n' : '') + ctor.join('\n') + '\n')] });
  }
  return out;
}

// RSpec: `user = build(:user)` inside an example becomes `let(:user) { build(:user) }` before that example.
function introduceLet(lines: string[], i: number): Intention | undefined {
  const m = /^\s*([a-z_]\w*)\s*=\s*(?!=)(.+?)\s*$/.exec(lines[i]);
  if (!m) return undefined;
  for (let k = i - 1; k >= 0; k--) {
    const it = /^(\s*)(it|specify|example|scenario|before)\b.*\bdo\b/.exec(lines[k]);
    if (!it) continue;
    if (indentOf(lines[i]).length <= it[1].length) return undefined;
    return { title: `Introduzir let(:${m[1]})`, edits: [insertBefore(k + 1, `${it[1]}let(:${m[1]}) { ${m[2]} }\n`), { range: [i + 1, 1, i + 2, 1], text: '' }] };
  }
}

export function intentionsAt(lines: string[], sel: Sel, opts: { spec?: boolean } = {}): Intention[] {
  const i = sel.sl - 1;
  if (i < 0 || i >= lines.length) return [];
  const found: (Intention | undefined)[] = [
    braceToDoEnd(lines, i), doEndToBrace(lines, i), hashRocketToColon(lines, i), colonToHashRocket(lines, i), sortHash(lines, i),
    ifElseToTernary(lines, i), ternaryToIf(lines, i), modifierToStatement(lines, i), statementToModifier(lines, i),
    invertIf(lines, i), mergeNestedIf(lines, i), splitIf(lines, i),
    stringSymbol(lines, i, sel.sc), toInterpolation(lines, i, sel.sc), squigglyHeredoc(lines, i), numberUnderscores(lines, i, sel.sc),
    opts.spec ? introduceLet(lines, i) : undefined,
  ];
  return [...found.filter((x): x is Intention => !!x), ...generateMembers(lines, i)];
}

// The only Monaco-facing part: offers the intentions in the Ctrl+. menu next to the Ruby LSP's code actions.
export function registerIntentions(enabled: (feature: 'intentions' | 'generate') => boolean) {
  monaco.languages.registerCodeActionProvider('ruby', {
    provideCodeActions(model, r) {
      const all = intentionsAt(model.getLinesContent(), { sl: r.startLineNumber, sc: r.startColumn, el: r.endLineNumber, ec: r.endColumn }, { spec: /_spec\.rb$/.test(model.uri.path) });
      const actions = all.filter(x => enabled(/^(Gerar|Introduzir)/.test(x.title) ? 'generate' : 'intentions')).map(x => ({
        title: x.title, kind: 'refactor.rewrite',
        edit: { edits: x.edits.map(e => ({ resource: model.uri, versionId: model.getVersionId(), textEdit: { range: new monaco.Range(...e.range), text: e.text } })) },
      }));
      return { actions, dispose() {} };
    },
  });
}

// Applies edits to text (used by tests; Monaco applies them in the editor).
export function applyEdits(text: string, edits: TextEdit[]): string {
  const lines = text.split('\n');
  const offset = (l: number, c: number) => lines.slice(0, l - 1).reduce((n, x) => n + x.length + 1, 0) + c - 1;
  return [...edits].sort((a, b) => offset(b.range[0], b.range[1]) - offset(a.range[0], a.range[1]))
    .reduce((t, e) => t.slice(0, offset(e.range[0], e.range[1])) + e.text + t.slice(offset(e.range[2], e.range[3])), text);
}
