# GST Keeper — UI/UX Redesign

From a 5-part code audit (2026-07-18), then executed across the whole app.
**Key finding:** the foundation was already strong — HSL semantic tokens in
`src/index.css` wired through `tailwind.config.ts`, a full shadcn/ui kit, and
domain tokens (`success`/`warning`/`info`). The problem was **adoption**: pages
bypassed the system they already owned. ~80% of this work was wiring existing
components to existing tokens.

## Design rules (enforce in review)
- **Colour:** semantic tokens only in app code (`primary`, `muted`, `success`,
  `warning`, `info`, `destructive`, `border`, …). Raw hex / raw Tailwind palette
  (`bg-amber-500`) allowed only inside `src/components/ui/*` and `chart.tsx`.
- **Status semantics, app-wide:** Filed = `success`; Prepared / Pending / Data
  Pending = `warning`; Mismatch / Late = `destructive`; Data Received / Nil = `info`.
- **Typography:** Poppins headings / Inter body. page-title `text-2xl/bold`,
  section `text-lg/semibold`, body `text-sm`, caption `text-xs muted`. Amounts
  use `tabular-nums`.
- **Spacing:** 8px rhythm; page root is always `space-y-6 animate-fade-in`.
- **Icons, one per action:** `FileText`=Export PDF, `FileSpreadsheet`=Export Excel,
  `Trash2`=delete/clear, `Download`=generic download, `Upload`=import,
  `RefreshCw`=pull-from-portal, `Lock`=locked, `Save`=save.
- **Every icon-only button needs an `aria-label`.**
- **Dark mode:** the app is **light-only**. Toasts are pinned light. The `.dark`
  token block is retained but dormant — do not add `dark:` variants to app code.

## Shared kit (use these — don't hand-roll)
| Component | Import |
|---|---|
| `PageHeader` (title/subtitle/icon/actions/embedded) | `@/components/layout/PageHeader` |
| `useConfirm()` — styled confirmation, replaces `confirm()` | `@/components/ui/confirm-dialog` |
| `StatusBadge` | `@/components/ui/status-badge` |
| `TableEmptyState` | `@/components/ui/table-empty-state` |
| `PasswordInput` (built-in reveal) | `@/components/ui/password-input` |
| `NumberInput` (no spinners) | `@/components/ui/number-input` |
| `Badge` variants `success \| warning \| info` | `@/components/ui/badge` |
| Toasts — **sonner only** | `import { toast } from 'sonner'` |

## Status — all phases COMPLETE
- [x] **Phase 1 — Foundation & consistency.** Shared kit built; `PageHeader` adopted
      app-wide; status colour-coding; badge/token migration; **all native `confirm()`
      retired** (incl. the previously *unguarded* employee delete); single toast
      system (sonner); empty/loading states; aria-labels; dead CSS + unused
      `Index.tsx` removed; branded 404.
- [x] **Phase 2 — Navigation & IA.** Clients + Manage Masters added to the sidebar;
      stronger active state; ChevronRight removed from flat links; duplicate tab
      headers removed via `embedded`; QuickActions routes aligned.
- [x] **Phase 3 — Unified tables.** Hardcoded teal (`#4A90A4`/`#2E5A6B`) and the raw
      palette purged across GSTR-1 (11 tabs), Import 2B, reco, ITC/RCM and RCMTable;
      sticky token-based headers; `overflow-x-auto`; right-aligned `tabular-nums`.
- [x] **Phase 4 — Responsive shell.** Below `md` the sidebar becomes a Sheet drawer
      behind a hamburger and `<main>` goes full-width; ≥`md` keeps the fixed rail
      and minimize behaviour.
- [x] **Phase 5 — Forms depth.** Exclusive checkbox groups → `RadioGroup`;
      `PasswordInput` everywhere; consistent required-field asterisks across Add
      and Edit; submit spinners; Rules-of-Hooks fixes in the admin pages.
- [x] **Phase 6 — Dark mode.** Decision: **light-only**; toasts pinned light.

## Deliberately NOT changed
Business logic, Supabase queries, calculations, routes, permissions, the
extension/portal wiring (`__gstk*` bridge, Pull buttons), and the Humonex
"Push to GST Portal" flow — all verified intact after the refactor.

## Known follow-up (not a regression — pre-existing)
`FilingTable` is declared **inside** `FilingStatusPage`, so it remounts on every
realtime refetch and can drop in-progress ARN/Remarks edits. Hoist it to a stable
top-level component taking data/handlers as props.
