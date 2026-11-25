"""Fetch publication dates for Evidence nodes. Writes data/curation/evidence_dates.json (review before applying).
Order of trust: page metadata (article:published_time, datePublished, <time datetime>) > date in URL path.
Usage: python3 -I scripts/fetch_evidence_dates.py"""
import json, re, sys, os, concurrent.futures as cf, urllib.request, urllib.parse, datetime, html as htmllib
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
g = json.load(open(os.path.join(ROOT, 'data/seed.json')))
ev = [n for n in g['nodes'] if n['type'] == 'Evidence' and str(n.get('url', '')).startswith('http')]
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36'
META = [r'property=["\'](?:article:published_time|og:published_time|og:article:published_time)["\'][^>]*content=["\']([^"\']+)',
        r'content=["\']([^"\']+)["\'][^>]*property=["\'](?:article:published_time|og:published_time)["\']',
        r'name=["\'](?:pubdate|publishdate|publish-date|date|DC\.date\.issued|dcterms\.created)["\'][^>]*content=["\']([^"\']+)',
        r'"datePublished"\s*:\s*"([^"]+)"', r'<time[^>]*datetime=["\']([^"\']+)']
def norm(s):
    m = re.search(r'(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})', s)
    if not m: return None
    y, mo, d = map(int, m.groups())
    try: return datetime.date(y, mo, d).isoformat()
    except ValueError: return None
def from_url(u):
    m = re.search(r'/(20\d{2})[/-](\d{2})[/-](\d{2})/', u) or re.search(r'(20\d{2})(\d{2})(\d{2})', u)
    if not m: return None
    try: return datetime.date(*map(int, m.groups())).isoformat()
    except ValueError: return None
MONTHS = {m: i + 1 for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}
def text_date(html):
    """First full date in the visible text of the page head/body (skips scripts, styles, copyright lines)."""
    body = re.sub(r'(?is)<(script|style|noscript|footer)[^>]*>.*?</\1>', ' ', html)
    text = htmllib.unescape(re.sub(r'(?s)<[^>]+>', ' ', body))
    text = re.sub(r'(?i)(©|copyright)[^\n]{0,80}', ' ', text)[:20000]
    pats = [(r'(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})', lambda m: (m[1], m[2], m[3])),
            (r'(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日', lambda m: (m[1], m[2], m[3])),
            (r'(?i)\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})', lambda m: (m[3], MONTHS[m[1].lower()[:3]], m[2])),
            (r'(?i)\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(20\d{2})', lambda m: (m[3], MONTHS[m[2].lower()[:3]], m[1]))]
    best = None
    for pat, f in pats:
        m = re.search(pat, text)
        if m:
            try: d = datetime.date(*map(int, f(m)))
            except ValueError: continue
            if d <= datetime.date.today() and (best is None or m.start() < best[0]): best = (m.start(), d.isoformat())
    return best[1] if best else None
def probe(n):
    u = urllib.parse.quote(n['url'], safe=':/?#[]@!$&\'()*+,;=%'); res = {'id': n['id'], 'url': u, 'status': None, 'date': None, 'method': None}
    try:
        req = urllib.request.Request(u, headers={'User-Agent': UA, 'Accept-Language': 'en,zh-TW;q=0.8'})
        with urllib.request.urlopen(req, timeout=20) as r:
            res['status'] = r.status
            html = r.read(600_000).decode('utf-8', 'ignore')
        for pat in META:
            m = re.search(pat, html, re.I)
            if m and norm(m.group(1)): res['date'], res['method'] = norm(m.group(1)), 'page_metadata'; break
        if not res['date'] and from_url(u): res['date'], res['method'] = from_url(u), 'url_path'   # explicit URL dates beat body text
        if not res['date'] and text_date(html): res['date'], res['method'] = text_date(html), 'page_text'
    except Exception as e:
        res['status'] = getattr(e, 'code', None) or type(e).__name__
    if not res['date'] and from_url(u): res['date'], res['method'] = from_url(u), 'url_path'
    if not res['date']:   # a dated statement in the notes of a record citing this evidence
        for r in g['nodes'] + g['edges']:
            if n['id'] in (r.get('evidence_ids') or []) and r.get('notes'):
                d = norm(str(r['notes'])) or text_date(str(r['notes']))
                if d: res['date'], res['method'], res['from_record'] = d, 'record_note', r['id']; break
    return res
with cf.ThreadPoolExecutor(12) as ex: results = list(ex.map(probe, ev))
os.makedirs(os.path.join(ROOT, 'data/curation'), exist_ok=True)
json.dump({'checked_at': datetime.date.today().isoformat(), 'results': results}, open(os.path.join(ROOT, 'data/curation/evidence_dates.json'), 'w'), ensure_ascii=False, indent=2)
ok = sum(1 for r in results if r['status'] == 200)
print(f'{len(results)} evidence urls · reachable {ok} · dated {sum(1 for r in results if r["date"])}')
from collections import Counter
for r in results:
    if r['status'] != 200: print('  unreachable:', r['status'], r['url'][:90])
print('methods:', Counter(r['method'] for r in results)); print('status:', Counter(str(r['status']) for r in results))
