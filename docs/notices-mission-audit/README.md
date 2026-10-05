# Notices & Litigation — mission audit and build roadmap (Oct 2026)

`../NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf` is the deliverable: a 136-page audit of
every screen, tab, drawer, dialog and link of the Notices & Litigation module, the
Chrome extension and portal sync, and the reply workflow, judged against four goals —
minimum human intervention, the easiest portal fetching, the fastest reply, and a
dashboard readable at a glance plus a page per notice — followed by a seven-phase
build roadmap. It supersedes nothing: it audits the September roadmap
(`../NOTICES_LITIGATION_ROADMAP.pdf`, sources in `../notices-roadmap/`) item by item
and builds on it.

All client names, GSTINs and figures in the screenshots and mock-ups are **fictional**:
the app was run against an in-memory mock of Supabase, never the live project, and the
GST portal was never contacted. Live-database counts quoted in the report come from the
13 Sep 2026 check recorded in `../notices-roadmap/review-record.json`.

## What is here

| Path | What it is |
|---|---|
| `findings/sync.json` | Extension and portal-sync review: coverage map, human touchpoints, S- findings, zero-touch stages |
| `findings/logic.json` | Logic and data review: L- findings, status of all 35 September roadmap items, metric definitions |
| `findings/reply.json` | Reply workflow review: current journey, notice taxonomy, auto-computation recipes, AI pipeline, filing assist, per-notice spec, R- findings, KPIs |
| `findings/ui-a.json`, `ui-b.json`, `ui-c.json`, `ui-cross.json` | Screen reviews (U- findings per screen) and the condensed cross-screen patterns |
| `findings/drilldown-counts.json`, `mock-request-log.json`, `tsc-notices-module.txt` | Evidence: tile vs list counts on the mock, the app's own schema errors, the type-checker output for this module |
| `mocks/target-*.html` / `.png` | Target designs: Command centre, Notice workspace (Reply Factory), Portal Autopilot |
| `roadmap.mjs`, `content.mjs` | Roadmap phases, tasks, acceptance tests and decisions; report narrative |
| `merge.mjs`, `build-report.mjs`, `report.css` | Merges the registers (duplicates folded) and renders the PDF |
| `mock-data.mjs`, `mock-server.mjs`, `capture-notices.mjs`, `render-emails.mjs`, `annotations.mjs`, `build-manifest.mjs`, `build-schema.mjs`, `schema.json`, `manifest.json` | The capture harness: a PostgREST-like mock with fictional data and a Playwright script that shoots every screen at 1440 px and 390 px |

## Re-shoot the screens after a fix (visual regression)

```bash
# from the repo root: build and serve the app
npm run build && npx vite preview --host 127.0.0.1 --port 4173 &
cd docs/notices-mission-audit
node capture-notices.mjs        # writes shots/ and findings/drilldown-counts.json
node build-manifest.mjs         # refreshes manifest.json
```

The scripts import Playwright from `/opt/node22/lib/node_modules/playwright` and launch
`/opt/pw-browsers/chromium` (the Claude Code cloud image); adjust both paths elsewhere.
The mock rejects selects that name columns the schema lacks, exactly as PostgREST does, so
a fixed query shows up as a changed screenshot.

## Rebuild the PDF

```bash
node fetch-fonts.mjs                                   # Inter, Poppins, JetBrains Mono → fonts/
node tojpg.mjs shots-jpg 1100 0.72 shots/*.png          # optional: smaller images
node tojpg.mjs mocks-jpg 1800 0.8 mocks/target-*.png
node build-report.mjs ../NOTICES_MISSION_AUDIT_AND_ROADMAP.pdf
```

Statements of law in the findings are marked **verify** wherever the current text should be
confirmed before a position is encoded.
