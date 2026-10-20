# Clean-room contamination check: does any RubyMine UI string or class name appear verbatim in the Rubaxe repo?
import sys, re, zipfile, glob, os

rm_root, repo = sys.argv[1], sys.argv[2]
strings, classes = set(), set()
for j in glob.glob(os.path.join(rm_root, '**', '*.jar'), recursive=True):
    z = zipfile.ZipFile(j)
    for n in z.namelist():
        if n.endswith('.properties'):
            for line in z.read(n).decode('latin-1').splitlines():
                m = re.match(r'\s*[\w.\-]+\s*=\s*(.+)', line)
                if m and len(m.group(1).strip()) >= 15:
                    strings.add(m.group(1).strip().lower())
        elif n.endswith('.class') and '$' not in n:
            name = n.rsplit('/', 1)[-1][:-6]
            if len(name) >= 12:
                classes.add(name)

# A wrong RubyMine path finds no jars and would report a meaningless "hits: 0".
if not strings: sys.exit(f"no RubyMine strings found under {rm_root}")

hits = []
for path in glob.glob(os.path.join(repo, '**', '*'), recursive=True):
    # Build outputs (dist, release) hold bundled third-party code and binaries, not our sources.
    parts = path.split(os.sep)
    if 'node_modules' in path or {'.git', 'dist', 'release'} & set(parts) or not os.path.isfile(path):
        continue
    text = open(path, encoding='utf-8', errors='ignore').read()
    low = text.lower()
    hits += [(path, 'string', s) for s in strings if s in low]
    hits += [(path, 'class', c) for c in classes if re.search(r'\b' + re.escape(c) + r'\b', text)]

print(f'checked {len(strings)} strings, {len(classes)} class names')
for h in hits:
    print(*h, sep=' | ')
print('hits:', len(hits))
