"""Save the text of a source so quotes can be checked against it, and register it in sources.json.

Usage: python3 -I fetch_source.py <run-dir> <source-id> <url> [--publisher P] [--title T]
                                  [--published YYYY-MM-DD] [--file saved-copy]

--file reads a copy you already have (for example a PDF in a research folder) of the document at <url>.
Without it the url is downloaded. Nothing is rewritten or summarised: HTML tags are removed and PDFs go
through pdftotext. A blocked, failed or image-only source exits with a message; do not work around a block.
"""
import argparse, datetime, hashlib, html, ipaddress, json, os, re, shutil, socket, subprocess, sys, urllib.parse, urllib.request

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('run'); ap.add_argument('id'); ap.add_argument('url')
for flag in ['--publisher', '--title', '--published', '--file']:
    ap.add_argument(flag)
a = ap.parse_args()
MAX = 20_000_000

def fail(msg):
    sys.exit(f'NOT SAVED {a.id}: {msg}')

def check_public(url):
    """Source urls come from untrusted material, so refuse anything that is not a public web address."""
    p = urllib.parse.urlparse(url)
    if p.scheme not in ('http', 'https') or not p.hostname:
        fail('only public http(s) urls are accepted')
    try:
        addresses = {i[4][0] for i in socket.getaddrinfo(p.hostname, None)}
    except OSError:
        fail(f'cannot resolve {p.hostname}')
    if any(not ipaddress.ip_address(x.split('%')[0]).is_global for x in addresses):
        fail('the address is local or private')

class Checked(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_public(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)

if not re.fullmatch(r'[A-Za-z0-9._-]{1,60}', a.id):
    fail('source id may use letters, digits, dot, dash and underscore')
if a.published:
    try: datetime.date.fromisoformat(a.published)
    except ValueError: fail('--published must be YYYY-MM-DD')
charset, final_url = None, a.url
if a.file:
    if urllib.parse.urlparse(a.url).scheme not in ('http', 'https'):
        fail('<url> must be the public http(s) address of the document')
    data = open(a.file, 'rb').read(MAX + 1)
else:
    check_public(a.url)
    quoted = urllib.parse.quote(a.url, safe=":/?#[]@!$&'()*+,;=%")
    req = urllib.request.Request(quoted, headers={'User-Agent': 'goodmind-refine source check', 'Accept-Language': 'zh-TW,en;q=0.8'})
    try:
        with urllib.request.build_opener(Checked).open(req, timeout=30) as r:
            data, charset, final_url = r.read(MAX + 1), r.headers.get_content_charset(), r.geturl()
    except Exception as e:
        fail(f'download failed ({getattr(e, "code", None) or type(e).__name__}). If the site refuses, use another source or a copy the user provides')
if len(data) > MAX:
    fail('larger than 20 MB')

if data[:4] == b'%PDF':
    if not shutil.which('pdftotext'):
        fail('PDF needs pdftotext, which is not installed')
    r = subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', '-', '-'], input=data, capture_output=True, timeout=120)
    if r.returncode:
        fail('pdftotext could not read this PDF')
    text, kind = r.stdout.decode('utf-8', 'replace'), 'pdf'
elif b'\0' in data[:4096]:
    fail('binary or image file: there is no source text to quote. Do not substitute your own transcription')
else:
    head = data[:3000].decode('ascii', 'ignore')
    m = re.search(r'charset=["\']?([\w-]+)', head)
    try: raw = data.decode(charset or (m.group(1) if m else 'utf-8'))
    except (UnicodeDecodeError, LookupError): raw = data.decode('utf-8', 'replace')
    if re.search(r'(?i)<(html|body|div|p)[\s>]', raw):
        body = re.sub(r'(?is)<(script|style|noscript|template)\b.*?</\1\s*>|<!--.*?-->', ' ', raw)
        body = re.sub(r'(?i)</?(p|div|br|li|tr|h[1-6]|section|article|table|ul|ol)\b[^>]*>', '\n', body)
        text, kind = html.unescape(re.sub(r'<[^>]+>', '', body)), 'html'
    else:
        text, kind = raw, 'text'
    text = re.sub(r'\n\s*\n+', '\n', re.sub(r'[ \t\r\xa0]+', ' ', text)).strip()
if len(re.sub(r'\s', '', text)) < 100:
    fail('almost no text (image-only PDF, a script-rendered page or a block page). Quotes cannot be checked against it')

os.makedirs(os.path.join(a.run, 'sources'), exist_ok=True)
rel = f'sources/{a.id}.txt'
open(os.path.join(a.run, rel), 'w').write(text + '\n')
index = os.path.join(a.run, 'sources.json')
rows = json.load(open(index)) if os.path.exists(index) else []
row = {'id': a.id, 'url': a.url, 'publisher': a.publisher, 'title': a.title, 'published_at': a.published, 'text_file': rel, 'public': True,
       'captured': {'on': datetime.date.today().isoformat(), 'from': 'local copy' if a.file else 'download', 'kind': kind,
                    'sha256': hashlib.sha256(data).hexdigest(), **({'final_url': final_url} if final_url != a.url and not a.file else {})}}
rows = [r for r in rows if r['id'] != a.id] + [{k: v for k, v in row.items() if v is not None}]
json.dump(rows, open(index, 'w'), ensure_ascii=False, indent=1)
print(f'saved {rel}: {len(text)} characters from {kind}. Read it: a short or menu-only page can still be a block page.')
