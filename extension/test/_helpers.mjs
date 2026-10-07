  const NOTICE_FIELD_KEYS = {
    due: ['replyduedt', 'replyduedate', 'duedt', 'duedate', 'dtofreply', 'replydt', 'replybydt', 'lastdtofreply', 'dtofsubmission'],
    officer: ['issuedby', 'officername', 'issuedbyname', 'empname', 'officerfullname', 'issuername', 'issuer'],
    designation: ['designation', 'issuedbydesignation', 'officerdesignation', 'desgn', 'dsgn', 'desig', 'officerdesg'],
    din: ['din', 'dinno', 'dinnumber', 'docdin', 'dinnum', 'dinid'],
  };
  const normKey = (k) => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const isRealText = (s) => s.length > 1 && !/^(na|n\/a|null|none|-+|0)$/i.test(s);
  function findByKeys(node, keys, accept, seen) {
    if (!node || typeof node !== 'object') return null;
    seen = seen || new Set();
    if (seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const n of node) { const v = findByKeys(n, keys, accept, seen); if (v != null) return v; }
      return null;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v != null && typeof v !== 'object' && keys.indexOf(normKey(k)) !== -1) {
        const s = String(v).trim();
        if (s && accept(s)) return s;
      }
    }
    for (const k of Object.keys(node)) {
      const v = findByKeys(node[k], keys, accept, seen); if (v != null) return v;
    }
    return null;
  }
  // dd/mm/yyyy (the portal's own format everywhere else in this file), plus
  // the ISO and dd-mm-yyyy spellings a few folder sections use.
  function anyDateToIso(s) {
    const t = String(s || '').trim().slice(0, 10);
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/) ? [t, t.slice(8, 10), t.slice(5, 7), t.slice(0, 4)]
      : t.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
    if (!m) return null;
    const [dd, mm, yyyy] = [Number(m[1]), Number(m[2]), Number(m[3])];
    // An impossible day (31/02, 00/00, month 13) must not reach the row:
    // Postgres rejects it and the whole notices upsert fails with it, so the
    // run would lose every notice over one bad folder field. Date() alone is
    // no guard — V8 rolls 2024-02-31 over into March rather than failing —
    // so the parts are checked back against what Date() made of them.
    if (!(yyyy >= 2017 && yyyy <= 2100) || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const d = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== mm - 1 || d.getUTCDate() !== dd) return null;
    return yyyy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
  }
  // What the notice row can take from its folder item. `raw` is the parsed
  // itemJson; everything here is best-effort and null when the item has no
  // such field — a notice never loses a value it already has (see the link
  // pass in pullNotices).
  function noticeFieldsFromItem(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const due = findByKeys(raw, NOTICE_FIELD_KEYS.due, (s) => !!anyDateToIso(s));
    const officer = findByKeys(raw, NOTICE_FIELD_KEYS.officer, isRealText);
    const desig = findByKeys(raw, NOTICE_FIELD_KEYS.designation, isRealText);
    const din = findByKeys(raw, NOTICE_FIELD_KEYS.din, (s) => /^[A-Za-z0-9/-]{8,}$/.test(s));
    return {
      due_date: due ? anyDateToIso(due) : null,
      issued_by: officer ? (desig ? officer + ', ' + desig : officer) : null,
      din: din || null,
    };
  }
  // Which of a folder item's attachments IS the notice (rather than a
  // supporting document the officer attached). The portal names the generated
  // form after the reference number — DOT_NOTICE_<ref>_<ts>.pdf,
  // ADJDT_DRPRC_<ref>_<ts>.pdf, DOT_INTIMATION_SEC74_<ref>_<ts>.pdf — so a
  // label or URL carrying the reference wins; failing that, one whose name
  // looks like the portal's own generated form; failing that, the first.
  function pickNoticeAttachment(attachments, refNo) {
    const list = (attachments || []).filter((a) => a && typeof a.url === 'string' && a.url);
    if (!list.length) return null;
    const ref = String(refNo || '').trim().toUpperCase();
    if (ref) {
      const byRef = list.find((a) => ((a.label || '') + ' ' + a.url).toUpperCase().indexOf(ref) !== -1);
      if (byRef) return byRef.url;
    }
    const generated = list.find((a) => /^(DOT|ADJDT|ADJ|REG|RFD|ASMT|DRC)_/i.test(String(a.label || '')));
    return (generated || list[0]).url;
  }


export {findByKeys, anyDateToIso, noticeFieldsFromItem, pickNoticeAttachment, normKey};
