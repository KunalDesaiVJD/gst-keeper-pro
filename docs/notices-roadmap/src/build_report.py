#!/usr/bin/env python3
"""Assemble report.html from prose (prose.py), section fragments and audit.json."""
import base64, html, json, os, sys
from pathlib import Path

HERE = Path(__file__).parent
FONTS_CSS = (HERE.parent / 'fonts' / 'local-fonts.css').read_text()
CSS = (HERE / 'report.css').read_text()

def esc(s):
    return html.escape(str(s if s is not None else ''))

def img(path):
    b = (HERE / path).read_bytes()
    return 'data:image/png;base64,' + base64.b64encode(b).decode()

def frag(name):
    return (HERE / name).read_text()

SEV_ORDER = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}

def sev_cell(sev):
    sev = (sev or 'low').lower()
    return f'<span class="sev {sev}"></span>{sev.capitalize()}'

def trunc(s, n):
    s = (s or '').strip()
    if len(s) <= n:
        return s
    cut = s[:n].rsplit(' ', 1)[0]
    return cut + ' …'

def loc(f):
    fp = (f.get('file') or '').replace('/home/user/gst-keeper-pro/', '')
    ln = f.get('line')
    return esc(fp) + (f':{ln}' if ln else '')

def broken_table(items, start=1):
    rows = []
    for i, f in enumerate(items, start):
        sev = (f.get('verification') or {}).get('corrected_severity') or f.get('severity')
        rows.append(
            f'<tr><td class="c"><b>B{i}</b></td><td>{sev_cell(sev)}</td>'
            f'<td><b>{esc(f["title"])}</b><div class="small mono" style="margin-top:2pt">{loc(f)}</div>'
            f'<div style="margin-top:3pt">{esc(trunc(f.get("why_it_matters",""), 330))}</div></td>'
            f'<td>{esc(trunc(f.get("proposed_fix",""), 330))}</td><td class="c">{esc(f.get("effort",""))}</td></tr>'
        )
    return ('<table class="compact"><thead><tr><th style="width:6%">#</th><th style="width:11%">Severity</th>'
            '<th style="width:43%">Defect and impact</th><th style="width:33%">Fix</th><th style="width:7%">Eff.</th></tr></thead>'
            '<tbody>' + ''.join(rows) + '</tbody></table>')

def gap_table(items, start=1):
    rows = []
    for i, f in enumerate(items, start):
        rows.append(
            f'<tr><td class="c"><b>G{i}</b></td><td>{sev_cell(f.get("severity"))}</td><td>{esc(f.get("category",""))}</td>'
            f'<td><b>{esc(f["title"])}</b><div style="margin-top:2pt">{esc(trunc(f.get("why_it_matters",""), 220))}</div></td>'
            f'<td>{esc(trunc(f.get("proposed_fix",""), 240))}</td><td class="c">{esc(f.get("effort",""))}</td></tr>'
        )
    return ('<table class="compact"><thead><tr><th style="width:6%">#</th><th style="width:11%">Priority</th><th style="width:11%">Area</th>'
            '<th style="width:37%">Gap and why it matters</th><th style="width:28%">Proposal</th><th style="width:7%">Eff.</th></tr></thead>'
            '<tbody>' + ''.join(rows) + '</tbody></table>')

import re
CANON = [
    (r'wipe|delete.{0,25}re-?insert|deletes all|delete-then-insert|delete-all|manually added notices', 'wipe'),
    (r'pull failed', 'pullfailed'),
    (r'last 24 hours', 'last24'),
    (r'over ?due.*(closed|replied|extended)|7 days due.*closed', 'overdue'),
    (r'gstin.?wise.*(1000|cap|truncat)', 'gstinwise'),
    (r'top.?nav|noticestopnav', 'topnav'),
    (r'failed logins', 'failedlogins'),
    (r'05:30|utc parse', 'utc'),
    (r'gst_password|plaintext gst portal passwords|passwords are copied', 'passwords'),
    (r"additional_notices|source semantics", 'source'),
    (r'no .*needs attention|what needs (my )?attention', 'queue'),
    (r'assign(ment|_to| to) is (a )?free.?text|free-text (box|name|field)', 'assignee'),
    (r'no (email|e-mail).*(notice|alert)|nothing emails|no .*notification of any kind|no hook to e-?mail|no email alert when', 'noemail'),
    (r'no matter|matter entity|case grouping|litigation lifecycle stages', 'matter'),
    (r'hearing.?(date|calendar)|hearings/adjournments', 'hearing'),
    (r'activity log|audit trail', 'audit'),
    (r'demand.{0,40}(single number|one numeric|breakdown|exposure)|amount at stake|demand-at-risk', 'demand'),
    (r'pre-?deposit', 'predeposit'),
    (r'client.?facing|clients cannot see|client-facing', 'clientview'),
    (r'ageing|trend|charts', 'charts'),
    (r'document (repository|store)|documents are scattered', 'documents'),
    (r'due-?date (escalation )?ladder|escalation ladder', 'ladder'),
    (r'daily digest', 'digest'),
    (r'whatsapp', 'whatsapp'),
    (r'unattended|headless|no schedule|scheduled', 'unattended'),
    (r'reply.?(templates|drafting|workspace)', 'replywork'),
    (r'partner review|approval workflow|approver', 'review'),
    (r'permission key', 'perms'),
    (r'stage.?(machine|based)|status vocabulary|only open/closed|open/closed in the ui', 'stages'),
    (r'first_seen|new-vs-updated|change log for notices', 'changedetect'),
    (r'last successful sync|freshness', 'freshness'),
    (r'mis (absent|reports)|no ageing, exposure|win-rate', 'mis'),
    (r'in-app notification bell', 'bell'),
]
SEV_RANK = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}

def canon_key(f):
    t = (f.get('title') or '').lower()
    for pat, key in CANON:
        if re.search(pat, t):
            return key
    return t.strip()[:70]

def dedupe(items):
    groups = {}
    order = []
    for f in items:
        k = canon_key(f)
        if k not in groups:
            groups[k] = dict(f); groups[k]['also'] = []
            order.append(k)
        else:
            g = groups[k]
            g['also'].append(f.get('dimension'))
            fs = ((f.get('verification') or {}).get('corrected_severity') or f.get('severity') or 'low').lower()
            gs = ((g.get('verification') or {}).get('corrected_severity') or g.get('severity') or 'low').lower()
            if SEV_RANK.get(fs, 9) < SEV_RANK.get(gs, 9):
                g['severity'] = fs
                if g.get('verification'): g['verification']['corrected_severity'] = fs
            # keep the longer fix text when the duplicate is more specific
            if len(f.get('proposed_fix') or '') > len(g.get('proposed_fix') or '') + 80:
                g['proposed_fix'] = f['proposed_fix']
    return [groups[k] for k in order]

def main():
    audit = json.loads((HERE / 'audit.json').read_text())
    import prose  # noqa
    broken = sorted(audit['confirmed_broken'], key=lambda f: (SEV_ORDER.get(((f.get('verification') or {}).get('corrected_severity') or f.get('severity') or 'low').lower(), 9), f.get('file','')))
    broken = dedupe(broken)
    mi = audit['missing_and_improvements']
    # The gap round runs after adversarial verification, so its 'broken' items are
    # reported separately and marked as not independently refuted.
    followup = [f for f in mi if f.get('kind') == 'broken' and str(f.get('dimension','')).startswith('gap:')]
    followup = dedupe(sorted(followup, key=lambda f: (SEV_ORDER.get((f.get('severity') or 'low').lower(), 9), f.get('file',''))))
    known = {canon_key(f) for f in broken}
    followup_new = [f for f in followup if canon_key(f) not in known]
    gaps = dedupe(sorted([f for f in mi if f.get('kind') != 'broken'], key=lambda f: (SEV_ORDER.get((f.get('severity') or 'low').lower(), 9), f.get('category',''))))
    sev_of = lambda f: ((f.get('verification') or {}).get('corrected_severity') or f.get('severity') or 'low').lower()
    top = lambda lst: [f for f in lst if sev_of(f) in ('critical', 'high')]
    rest = lambda lst: [f for f in lst if sev_of(f) not in ('critical', 'high')]
    b_main, b_rest = top(broken), rest(broken)
    f_main, f_rest = top(followup_new), rest(followup_new)
    ctx = {
        'broken_table': broken_table(b_main),
        'broken_table_rest': broken_table(b_rest, start=len(b_main) + 1),
        'n_broken_main': len(b_main), 'n_broken_rest': len(b_rest),
        'followup_table': broken_table(f_main, start=len(broken) + 1),
        'followup_table_rest': broken_table(f_rest, start=len(broken) + len(f_main) + 1),
        'n_followup_main': len(f_main), 'n_followup_rest': len(f_rest),
        'n_followup': len(followup_new), 'followup': followup_new,
        'gap_table': gap_table(gaps),
        'n_broken': len(broken), 'n_gaps': len(gaps),
        'n_refuted': len(audit.get('refuted_broken', [])),
        'img_current': img('mock-current.png'), 'img_dash': img('mock-dashboard.png'),
        'img_drawer': img('mock-drawer.png'), 'img_email': img('mock-email.png'),
        'sec_design': frag('sec-design.html'), 'sec_email': frag('sec-email.html'),
        'sec_lifecycle': frag('sec-lifecycle.html'), 'sec_datamodel': frag('sec-datamodel.html'),
        'sec_sync': frag('sec-sync.html'), 'sec_roadmap': frag('sec-roadmap.html'),
        'broken': broken, 'gaps': gaps, 'audit': audit,
    }
    import subprocess
    def write(ctx):
        body = prose.render(ctx)
        doc = f'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Notices &amp; Litigation — Roadmap and Blueprint</title><style>{FONTS_CSS}\n{CSS}</style></head><body>{body}</body></html>'
        (HERE / 'report.html').write_text(doc)
        return len(doc)
    write(ctx)
    # pass 1: render to find the page of each heading, then re-render with numbers
    subprocess.run(['node', str(HERE / 'render.cjs'), str(HERE / 'report.html'), str(HERE / 'report.pdf')], check=True, capture_output=True)
    import pymupdf
    d = pymupdf.open(str(HERE / 'report.pdf'))
    pages = {}
    # headings are the only 16pt text on a page: match titles against large spans
    big = {}
    for i in range(2, d.page_count):
        texts = []
        for b in d[i].get_text('dict')['blocks']:
            for l in b.get('lines', []):
                t = ''.join(sp['text'] for sp in l['spans'] if sp['size'] >= 14)
                if t.strip(): texts.append(t)
        big[i] = ' '.join(texts)
    for num, title in prose._toc(ctx):
        key = title[:28]
        for i in range(2, d.page_count):
            if key in big[i]:
                pages[title] = i + 1; break
    ctx['toc_pages'] = pages
    n = write(ctx)
    subprocess.run(['node', str(HERE / 'render.cjs'), str(HERE / 'report.html'), str(HERE / 'report.pdf')], check=True, capture_output=True)
    d = pymupdf.open(str(HERE / 'report.pdf'))
    print('report.html written', n, 'bytes;', len(broken), 'broken;', len(gaps), 'gaps;', d.page_count, 'pages; toc', pages)

if __name__ == '__main__':
    main()
