# GST Keeper — UI/UX Redesign Roadmap

From a 5-part code audit (2026-07-18). **Key finding:** the app has a strong
foundation already — HSL semantic tokens in `src/index.css` wired through
`tailwind.config.ts`, a full shadcn/ui kit, and domain tokens
(`success`/`warning`/`info` + `--gst-filed/pending/late/nil`). ~80% of the work
is **adopting** what already exists, not building new. Implement incrementally,
`npm run build` green per commit.

## Design direction (the rules)
- **Colour:** semantic tokens only in app code; raw hex / raw Tailwind palette
  (`bg-amber-500`) allowed only inside `src/components/ui/*` + `chart.tsx`.
  Status is fixed app-wide: Filed = `success`, Pending/Prepared = `warning`,
  Late/Mismatch = `destructive`, Nil/received = `info`. Accent coral = one CTA, never status.
- **Typography:** Poppins headings / Inter body. page-title `text-2xl/bold`,
  section `text-lg/semibold`, card-title `text-base/semibold`, body `text-sm`,
  caption `text-xs muted`, metric `text-3xl tabular-nums`. Amounts use `tabular-nums`.
- **Spacing:** 8px rhythm; every page root = `space-y-6`, full-bleed.
- **Icons:** one icon+label per action — FileText=Export PDF, FileSpreadsheet=Export Excel,
  Trash2=delete/clear, Download=generic download, Upload=import, Lock=locked, RefreshCw=portal pull.
- **Dark mode:** light-only for now (a11y toasts pinned light); dark is a later project.

## Phases

### Phase 1 — Foundation & consistency (SAFE, additive) — IN PROGRESS
- [x] Force sonner toasts to light (`ui/sonner.tsx`)
- [x] Add `success`/`warning`/`info` variants to `ui/badge.tsx`
- [x] Colour-code Filing Status (status control accent + frequency badge on tokens)
- [x] ITC "Clear Data" icon → Trash2 (match RCM/Suspended)
- [~] `<PageHeader>` built (`src/components/layout/PageHeader.tsx`) + adopted on Filing Status. ROLLOUT IN PROGRESS — remaining pages: Dashboard, Clients, Add/Edit Client, Import 2B, 2B Reco, Suspended/Receivable Reco, ITC, RCM, GSTR-01, GST Update Sheet, Manage Masters, Reports, Manage Employees, User Control, Settings.
- [ ] `<StatusBadge>` for read-only status displays
- [ ] Unify toasts on sonner: migrate `useToast` callers, remove shadcn `<Toaster>`
- [x] `useConfirm()`/`<ConfirmDialog>` built + mounted; **employee-delete now guarded**; replaced confirm() on ClientsPage, GSTR1DataPage, Import 2B. _Remaining: dashboard-section duplicates (ClientManagement/EmployeeManagement/UserManagement/PasswordResetRequests) — convert or remove in Phase 2 (they may be redundant)._
- [ ] Shared `<TableEmptyState>`, skeleton rows, `<PasswordInput>`, `<NumberInput>`
- [ ] aria-label + focus ring on every icon-only button
- [ ] Fold real `.metric-card`/`.gst-table` usages into Card/Table variants; delete dead `@layer components` + `.status-*`
- [ ] Delete `Index.tsx` scaffold; brand the 404

### Phase 2 — Navigation & IA (Medium)
- [ ] Add Clients + Manage Masters to sidebar; kill orphan routes (`/manage-employees` etc.)
- [ ] `embedded` header flag on tab bodies; lift Client/Month bar above the tab bar
- [ ] Stronger active nav (left accent + semibold + brighter bg); drop misleading ChevronRight
- [ ] Remove FilingStatusPage local-month fork → use MonthContext directly

### Phase 3 — Unified table system (Med-High)
- [ ] One token-driven `<PortalTable>`; migrate GSTR-1 (11 tabs), Import 2B, reco pages
- [ ] Replace `#4A90A4`/`#2E5A6B` teal literals with tokens (`--table-export`)
- [ ] Sticky header + sticky-left identity col + ScrollArea everywhere; one number formatter

### Phase 4 — Responsive shell (Medium)
- [ ] Sidebar → Sheet drawer below `md` (reuse `ui/sidebar` + `useIsMobile`); `<main>` full-width
- [ ] Sticky-left client column; column-priority hiding on narrow widths

### Phase 5 — Forms depth (Medium)
- [ ] RadioGroup for exclusive choices; inline validation + scroll-to-first-error
- [ ] One required-field contract (Add == Edit); isSubmitting on Add Employee
- [ ] Adopt `<PasswordInput>`/`<NumberInput>` everywhere; Rules-of-Hooks fixes

### Phase 6 — Dark mode decision (deferred)
- [ ] Ship it (next-themes + toggle + full colour audit) OR delete `.dark` + `dark:` variants

## Known bug to fix in Phase 1/2
`FilingTable` is declared **inside** `FilingStatusPage`, so it remounts on every
realtime refetch and **drops in-progress ARN/Remarks edits**. Hoist it to a
stable top-level component taking data/handlers as props.
