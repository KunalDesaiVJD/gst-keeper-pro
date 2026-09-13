# Notices Dashboard & Litigation Management — roadmap sources

`../NOTICES_LITIGATION_ROADMAP.pdf` is the partner-facing document (draft v1.0,
13 Sep 2026). This folder holds everything needed to regenerate it.

- `mocks/` — the four HTML mock-ups and their PNG renders: the annotated
  recreation of the current dashboard, the redesigned dashboard, the matter
  drawer and the daily digest email. They use the app's own design tokens
  (navy primary, coral accent, Inter/Poppins) and sample data; client names
  are illustrative.
- `src/` — the document sources: `prose.py` (all narrative sections),
  `sec-*.html` (design, email matrix, lifecycles, data model, sync, roadmap
  fragments), `report.css` (print styles), `build_report.py` (assembler),
  `render.cjs` (Playwright PDF renderer) and `shot.cjs` (mock screenshots).
- `review-record.json` — the full output of the multi-agent review the
  document is built from: eight audit lenses, adversarial verification
  verdicts, the completeness critic, six follow-up reviews, three roadmap
  drafts and two judges' scores. Findings in the PDF cite this record.

## Rebuild

```bash
# from docs/notices-roadmap/src, with Playwright + Chromium available
node shot.cjs ../mocks/mock-dashboard.html ../mocks/mock-dashboard.png 1600 1000 2
python3 build_report.py      # writes report.html and report.pdf next to the sources
```

`build_report.py` expects `audit.json` (copy `review-record.json`) and the
mock PNGs in the same folder; adjust the paths at the top of the script if
you move things. Fonts: the mocks link Google Fonts; the PDF build embeds
Inter/Poppins from a local `fonts/local-fonts.css` (download the woff2 files
first or point the stylesheet at Google Fonts).

The document is a planning draft. Statutory references (CGST Act 2017 and
Rules) must be confirmed against the current text before being encoded as firm
positions, and the security items in §4.2 / §11.4 should be actioned before
any alert emails carry PDF links.
