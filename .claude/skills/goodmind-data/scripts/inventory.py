"""Records what was received. Usage: python3 -I inventory.py <run-dir> <file-or-folder> ...
Writes <run-dir>/inventory.json. Inputs are only read."""
import hashlib, json, os, sys

if len(sys.argv) < 3:
    sys.exit(__doc__)
run, rows = sys.argv[1], []
SKIP_DIRS = {'.git', 'node_modules', '__pycache__', '.venv', '.build', 'build', 'dist', 'DerivedData'}

def add(path):
    row = {'path': os.path.abspath(path)}
    name = os.path.basename(path)
    if os.path.islink(path):
        row['status'] = 'skipped: link'
    elif name.startswith('.env') or name.endswith(('.pem', '.key')):
        row['status'] = 'skipped: may hold secrets'
    else:
        try:
            data = open(path, 'rb').read()
            row.update(bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
            if b'\0' in data[:4096] or data[:4] == b'%PDF':
                row['status'] = 'needs conversion: not plain text'
            else:
                data.decode('utf-8')
                row['status'] = 'text'
        except UnicodeDecodeError:
            row['status'] = 'needs conversion: not UTF-8'
        except OSError as e:
            row['status'] = f'unreadable: {e.strerror}'
    rows.append(row)

for arg in sys.argv[2:]:
    if os.path.isdir(arg):
        for base, dirs, files in os.walk(arg):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.lower().endswith('cache'))
            for f in sorted(files):
                if f != '.DS_Store':
                    add(os.path.join(base, f))
    elif os.path.exists(arg):
        add(arg)
    else:
        rows.append({'path': arg, 'status': 'unreadable: not found'})

os.makedirs(os.path.join(run, 'sources'), exist_ok=True)
json.dump(rows, open(os.path.join(run, 'inventory.json'), 'w'), ensure_ascii=False, indent=1)
count = {}
for r in rows:
    count[r['status']] = count.get(r['status'], 0) + 1
print(f'{len(rows)} inputs:', ', '.join(f'{k} {v}' for k, v in sorted(count.items())))
