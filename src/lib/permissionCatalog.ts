// Every permission key an employee can hold, grouped as User Control shows
// them. Employees get keys through their role plus any extras given to them
// one by one (staff_positions + staff_user_extra_permissions → user_permissions,
// migrations 20261014120000 and 20261025100000);
// superadmin and gst_manager hold every key by role.
//
// Two kinds of key (26 Nov 2026):
//   - screens (`module_*`): which parts of the software an employee can open.
//     Checked by the sidebar, by MainLayout for every route (moduleForPath) and
//     by the GST Assistant panel. An employee holding NO screen key at all
//     opens every screen, as before screens existed (a role saved before
//     20261126120000_staff_role_screens.sql, which gives every existing role
//     every screen, keeps working unchanged).
//   - actions: what they can do on those screens. An action names the screen
//     it needs (`needs`); ticking it ticks the screen, and taking a screen off
//     takes its actions off (applyKeyChange).
//
// Adding a key: add it here (keep the order key, group, label, description:
// scripts/build-assistant-knowledge.mjs reads it), to UserPermissions /
// DEFAULT_PERMISSIONS and a can*() helper in src/contexts/AuthContext.tsx, then
// check the helper where the action happens. A new screen also needs its
// paths in MODULE_PATHS and its key in ROLE_PRESETS where it belongs. The DB
// has no allow-list of keys.

export type PermissionGroupKey =
  | 'clients' | 'reco' | 'returns' | 'annual' | 'advances' | 'builder' | 'notices'
  | 'reports' | 'emails' | 'assistant' | 'history' | 'staff';

export const PERMISSION_GROUPS: { key: PermissionGroupKey; label: string }[] = [
  { key: 'clients', label: 'Clients' },
  { key: 'reco', label: '2B, ITC, RCM & update sheet' },
  { key: 'returns', label: 'Returns & filing' },
  { key: 'annual', label: 'Annual Return (GSTR-9 / 9C)' },
  { key: 'advances', label: 'Advances' },
  { key: 'builder', label: 'Builder' },
  { key: 'notices', label: 'Notices & litigation' },
  { key: 'reports', label: 'Reports & exports' },
  { key: 'emails', label: 'E-mails to clients' },
  { key: 'assistant', label: 'GST Assistant' },
  { key: 'history', label: 'History & unlocking' },
  { key: 'staff', label: 'Staff' },
];

export type ModuleKey =
  | 'module_clients' | 'module_2b' | 'module_itc' | 'module_rcm' | 'module_update_sheet'
  | 'module_gstr1' | 'module_gstr3b' | 'module_filing_status' | 'module_annual_return'
  | 'module_advances' | 'module_builder' | 'module_notices' | 'module_reports' | 'module_assistant';

export interface PermissionDef {
  key: string;
  group: PermissionGroupKey;
  label: string;
  description: string;
  /** A screen key: what the employee can open. */
  screen?: true;
  /** The screen this action is done on: ticking the action ticks it. */
  needs?: ModuleKey;
}

export const PERMISSIONS: PermissionDef[] = [
  // Clients
  { key: 'module_clients', group: 'clients', label: 'Open Clients', description: 'The Clients list, Add Client and Edit Client screens', screen: true },
  { key: 'add_edit_clients', group: 'clients', label: 'Add / edit clients', description: 'Add new clients and edit client records (Add Client, Edit Client)', needs: 'module_clients' },
  { key: 'delete_clients', group: 'clients', label: 'Delete clients', description: 'Delete client records', needs: 'module_clients' },
  { key: 'edit_gstr1_import_mode', group: 'clients', label: 'GSTR-1 import mode', description: "Change how a client's GSTR-1 is prepared: JSON, Manual, or JSON + Manual", needs: 'module_clients' },

  // 2B, ITC, RCM & update sheet
  { key: 'module_2b', group: 'reco', label: 'Open 2B Reconciliation', description: 'Import 2B, 2B Reconciliation, Suspended Reco and GST Receivable Reco', screen: true },
  { key: 'module_itc', group: 'reco', label: 'Open ITC Summary', description: 'The ITC Summary screen', screen: true },
  { key: 'module_rcm', group: 'reco', label: 'Open RCM Summary', description: 'The RCM Summary screen', screen: true },
  { key: 'module_update_sheet', group: 'reco', label: 'Open GST Update Sheet', description: 'The GST Running Update sheet', screen: true },
  { key: 'work_2b_import', group: 'reco', label: 'Import 2B & post', description: 'Import or pull 2B; the Import 2B saves that change the 2B Reconciliation ledger (a 2B document into or out of Not in Books or out of Reclaim, a Not in 2B books row with a date and supplier, deleting a row whose entry leaves the ledger); bring a month\'s ledger up to date. Other Import 2B saves are open to all staff', needs: 'module_2b' },
  { key: 'import_excel', group: 'reco', label: 'Import Excel (2B Reconciliation)', description: 'Import Excel into the 2B Reconciliation page (Liberal clients)', needs: 'module_2b' },
  { key: 'delete_2b_rows', group: 'reco', label: 'Delete 2B rows', description: 'Delete 2B and books rows on Import 2B and 2B Reconciliation', needs: 'module_2b' },
  { key: 'clear_data', group: 'reco', label: 'Clear data', description: "Wipe a period's 2B / ITC / RCM / Suspended Reco data (Clear Data)", needs: 'module_2b' },
  { key: 'manage_rcm_masters', group: 'reco', label: 'RCM masters', description: 'Add, edit and delete RCM expense masters', needs: 'module_rcm' },
  { key: 'edit_update_sheet', group: 'reco', label: 'Edit GST Running Update', description: 'Edit entries on the GST Running Update sheet', needs: 'module_update_sheet' },

  // Returns & filing
  { key: 'module_gstr1', group: 'returns', label: 'Open GSTR-1', description: 'The GSTR-1 screen: import, prepare and upload', screen: true },
  { key: 'module_gstr3b', group: 'returns', label: 'Open GSTR-3B', description: 'The GSTR-3B screen and its push history', screen: true },
  { key: 'module_filing_status', group: 'returns', label: 'Open Filing Status', description: 'The Filing Status screen: who has filed what, ARNs and return PDFs', screen: true },
  { key: 'edit_filing_status', group: 'returns', label: 'Filing status & portal push', description: 'Change filing status, tick NIL, and push GSTR-1 / GSTR-3B to the GST portal', needs: 'module_filing_status' },
  { key: 'delete_return_data', group: 'returns', label: 'Delete return data', description: "Delete a period's GSTR-1 data and rows of the GST Running Update", needs: 'module_gstr1' },

  // Annual Return
  { key: 'module_annual_return', group: 'annual', label: 'Open Annual Return', description: 'GSTR-9 / 9C workings: prepare and verify the workings allotted to them (review and lock stay with GST Managers)', screen: true },

  // Advances
  { key: 'module_advances', group: 'advances', label: 'Open Advances', description: 'The Advances screen: the advance register and set-offs', screen: true },
  { key: 'manage_advance_register', group: 'advances', label: 'Advance register', description: 'Add and edit advance receipt vouchers and their set-off against invoices', needs: 'module_advances' },
  { key: 'override_advance_setoff', group: 'advances', label: 'Request set-off override', description: 'Ask to file past a blocked advance set-off check (a GST Manager approves)', needs: 'module_advances' },

  // Builder
  { key: 'module_builder', group: 'builder', label: 'Open Builder', description: 'The Builder workspace, its projects, returns and Builder Reports', screen: true },
  { key: 'manage_builder_projects', group: 'builder', label: 'Builder projects', description: 'Create and edit projects, blocks and client-level GST elections', needs: 'module_builder' },
  { key: 'manage_builder_units', group: 'builder', label: 'Builder units', description: 'Add and edit units, charge heads and opening balances', needs: 'module_builder' },
  { key: 'enter_builder_receipts', group: 'builder', label: 'Bookings & receipts', description: 'Record bookings, advances, receipts and milestone invoices', needs: 'module_builder' },
  { key: 'post_bu_event', group: 'builder', label: 'Post BU events', description: 'Create BU events and post the unit-wise differential', needs: 'module_builder' },
  { key: 'override_bu_agreement', group: 'builder', label: 'Accept BU agreement value', description: "Accept a unit's agreement value at BU without the client's confirmation (with a reason)", needs: 'module_builder' },
  { key: 'post_builder_adjustments', group: 'builder', label: 'Builder adjustments', description: 'Cancellations, conversions, credit notes, refunds and bounce reversals', needs: 'module_builder' },
  { key: 'view_builder_reports', group: 'builder', label: 'Builder reports', description: 'Working papers and their Excel / PDF exports', needs: 'module_builder' },

  // Notices
  { key: 'module_notices', group: 'notices', label: 'Open Notices & Litigation', description: 'Notices, cases, calendar, refunds, DRC-03 and litigation', screen: true },
  { key: 'edit_notice_status', group: 'notices', label: 'Edit notice status', description: 'Open / close notices, priority, and reply / order / submission details', needs: 'module_notices' },

  // Reports & exports
  { key: 'module_reports', group: 'reports', label: 'Open Reports', description: 'The Reports Hub: every report, pulled from the portal', screen: true },
  { key: 'export_data', group: 'reports', label: 'Export data', description: 'Download Excel / PDF exports from GST, reconciliation and notice pages' },

  // E-mails to clients
  { key: 'send_client_emails', group: 'emails', label: 'Send client e-mails', description: 'Send GST reminders and e-invoice threshold letters to clients' },
  { key: 'manage_email_templates', group: 'emails', label: 'E-mail templates & reminder rules', description: 'Edit e-mail templates and switch reminder rules on or off' },

  // GST Assistant
  { key: 'module_assistant', group: 'assistant', label: 'Use the GST Assistant', description: "The side panel (Ctrl J): answers, guided walks and filling a screen's fields", screen: true },

  // History & unlocking
  { key: 'view_version_history', group: 'history', label: 'Version history', description: 'Open saved versions of 2B, ITC, RCM and the GST Running Update' },
  { key: 'view_change_history', group: 'history', label: 'Change history', description: 'See who changed what on the GST working pages, and when (Change history, History buttons)' },
  { key: 'unlock_sheets', group: 'history', label: 'Unlock sheets', description: 'Unlock locked filing records, RCM and annual return workings' },

  // Staff
  { key: 'manage_employees', group: 'staff', label: 'Manage employees', description: "Add and remove employee accounts and reset employees' passwords. Roles stay with GST Managers" },
];

export const PERMISSION_LABEL: Record<string, string> = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.label]));

export const permissionsInGroup = (g: PermissionGroupKey) => PERMISSIONS.filter((p) => p.group === g);

export const SCREEN_KEYS: ModuleKey[] = PERMISSIONS.filter((p) => p.screen).map((p) => p.key as ModuleKey);
export const ACTION_KEYS: string[] = PERMISSIONS.filter((p) => !p.screen).map((p) => p.key);
export const isScreenKey = (k: string): k is ModuleKey => k.startsWith('module_');
const NEEDS = new Map(PERMISSIONS.filter((p) => p.needs).map((p) => [p.key, p.needs as ModuleKey]));
/** The actions done on a screen. */
export const actionsOn = (m: ModuleKey) => PERMISSIONS.filter((p) => p.needs === m).map((p) => p.key);

/** True while a set of keys names no screen: its holder opens every screen (as before screens). */
export const opensEveryScreen = (keys: Iterable<string>) => ![...keys].some(isScreenKey);

/**
 * Turn keys on or off with their links: an action brings its screen, and a
 * screen taken off takes its actions with it. `withScreens` false leaves
 * screens alone (an extra for a person whose role names no screen, who would
 * otherwise be limited to that one screen).
 */
export function applyKeyChange(
  current: Set<string>, keys: string[], on: boolean, withScreens = true,
): { next: Set<string>; alsoOn: string[]; alsoOff: string[] } {
  const next = new Set(current);
  const alsoOn: string[] = [];
  const alsoOff: string[] = [];
  for (const k of keys) {
    if (on) {
      next.add(k);
      const m = NEEDS.get(k);
      if (withScreens && m && !next.has(m) && !keys.includes(m)) { next.add(m); alsoOn.push(m); }
    } else {
      next.delete(k);
      if (isScreenKey(k)) {
        for (const a of actionsOn(k)) if (next.has(a) && !keys.includes(a)) { next.delete(a); alsoOff.push(a); }
      }
    }
  }
  return { next, alsoOn: [...new Set(alsoOn)], alsoOff: [...new Set(alsoOff)] };
}

/** Route prefixes of each screen. A path not listed (Dashboard, Settings, ...) is open to all staff. */
export const MODULE_PATHS: Record<ModuleKey, string[]> = {
  module_clients: ['/clients', '/add-client', '/edit-client'],
  module_2b: ['/2b-and-rcm', '/2b-reconciliation', '/suspended-reco'],
  module_itc: ['/itc-summary'],
  module_rcm: ['/rcm-summary'],
  module_update_sheet: ['/gst-running-update'],
  module_gstr1: ['/gstr1-data'],
  module_gstr3b: ['/gstr3b', '/gstr3b-adjustments'],
  module_filing_status: ['/filing-status'],
  module_annual_return: ['/annual-return'],
  module_advances: ['/advances'],
  module_builder: ['/builder', '/builder-setup', '/builder-projects', '/builder-returns', '/builder-dastavej', '/builder-reports'],
  module_notices: [
    '/notices-dashboard', '/notices-queue', '/notices-all', '/notices', '/notices-hearings', '/notices-calendar',
    '/notices-cases', '/notices-case', '/notices-open', '/notices-portal-sync', '/notices-settings', '/notices-company-list',
    '/notices-company', '/notices-case-folder', '/notices-autopilot', '/notices-reply-factory', '/notices-report',
    '/notices-gstin-wise-count', '/refunds', '/refunds-all', '/drc03-all', '/litigation', '/litigation-mis',
  ],
  module_reports: ['/reports'],
  module_assistant: [],
};

/** The screen a route belongs to, or null when it is open to all staff. */
export function moduleForPath(pathname: string): ModuleKey | null {
  for (const m of SCREEN_KEYS) {
    if (MODULE_PATHS[m].some((p) => pathname === p || pathname.startsWith(`${p}/`))) return m;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ready-made roles. A superadmin starts a role from one of these (or copies
// another role) and adjusts, instead of ticking every box.

export interface RolePreset {
  id: string;
  name: string;
  /** One line on the job, shown on the card. */
  description: string;
  keys: string[];
  /** Words in a role's name that suggest this preset (lower case). */
  hints: string[];
}

const WORKING_SCREENS: ModuleKey[] = ['module_2b', 'module_itc', 'module_rcm', 'module_update_sheet', 'module_gstr1', 'module_gstr3b', 'module_filing_status'];

export const ROLE_PRESETS: RolePreset[] = [
  {
    id: 'viewer',
    name: 'View only',
    description: 'Opens the GST working screens and reports, changes nothing',
    keys: ['module_clients', ...WORKING_SCREENS, 'module_annual_return', 'module_advances', 'module_reports', 'module_assistant'],
    hints: ['view', 'read', 'observer', 'auditor', 'partner'],
  },
  {
    id: 'trainee',
    name: 'Article / Trainee',
    description: 'Monthly working: imports 2B and keeps the update sheet',
    keys: [...WORKING_SCREENS, 'module_reports', 'module_assistant', 'work_2b_import', 'edit_update_sheet'],
    hints: ['article', 'trainee', 'intern', 'junior', 'fresher', 'apprentice'],
  },
  {
    id: 'executive',
    name: 'GST Executive',
    description: 'Runs clients’ monthly returns end to end and files them',
    keys: [
      'module_clients', ...WORKING_SCREENS, 'module_advances', 'module_annual_return', 'module_notices', 'module_reports', 'module_assistant',
      'add_edit_clients', 'work_2b_import', 'import_excel', 'delete_2b_rows', 'manage_rcm_masters', 'edit_update_sheet',
      'edit_filing_status', 'manage_advance_register', 'override_advance_setoff', 'export_data', 'send_client_emails',
      'view_version_history',
    ],
    hints: ['executive', 'assistant', 'associate', 'accountant', 'staff', 'gst'],
  },
  {
    id: 'senior',
    name: 'Senior / Team Lead',
    description: 'Everything an executive does, plus deleting, unlocking and history',
    keys: [
      ...SCREEN_KEYS.filter((m) => m !== 'module_builder'),
      'add_edit_clients', 'edit_gstr1_import_mode', 'work_2b_import', 'import_excel', 'delete_2b_rows', 'clear_data',
      'manage_rcm_masters', 'edit_update_sheet', 'edit_filing_status', 'delete_return_data', 'manage_advance_register',
      'override_advance_setoff', 'edit_notice_status', 'export_data', 'send_client_emails', 'manage_email_templates',
      'view_version_history', 'view_change_history', 'unlock_sheets',
    ],
    hints: ['senior', 'lead', 'supervisor', 'head', 'incharge', 'in-charge', 'manager', 'team'],
  },
  {
    id: 'annual',
    name: 'Annual Return team',
    description: 'GSTR-9 / 9C workings, with the returns and 2B they draw on',
    keys: ['module_clients', ...WORKING_SCREENS, 'module_annual_return', 'module_advances', 'module_reports', 'module_assistant', 'export_data', 'view_version_history'],
    hints: ['annual', 'gstr-9', 'gstr9', '9c', 'audit', 'reco'],
  },
  {
    id: 'builder',
    name: 'Builder specialist',
    description: 'Real estate promoters: projects, units, receipts, BU and reports',
    keys: [
      'module_clients', 'module_builder', 'module_gstr1', 'module_gstr3b', 'module_filing_status', 'module_reports', 'module_assistant',
      ...actionsOn('module_builder'), 'export_data',
    ],
    hints: ['builder', 'real estate', 'realty', 'promoter', 'construction'],
  },
  {
    id: 'notices',
    name: 'Notices & litigation',
    description: 'Works notices, replies and appeals; reads the returns behind them',
    keys: ['module_clients', 'module_notices', 'module_gstr1', 'module_gstr3b', 'module_filing_status', 'module_reports', 'module_assistant', 'edit_notice_status', 'export_data'],
    hints: ['notice', 'litigation', 'legal', 'appeal', 'reply', 'refund'],
  },
];

/** The preset a role's name points to, if any (e.g. "Article Assistant" → Article / Trainee). */
export function suggestPreset(roleName: string): RolePreset | null {
  const n = roleName.toLowerCase();
  if (!n.trim()) return null;
  let best: { p: RolePreset; at: number } | null = null;
  for (const p of ROLE_PRESETS) {
    for (const h of p.hints) {
      const at = n.indexOf(h);
      // The first word to match wins ("Senior Article" is a senior), then the list's order.
      if (at >= 0 && (!best || at < best.at)) best = { p, at };
    }
  }
  return best?.p ?? null;
}

/** What a set of keys adds and takes away, against another. */
export function keyDiff(from: Set<string>, to: Iterable<string>): { add: string[]; remove: string[] } {
  const t = new Set(to);
  return { add: [...t].filter((k) => !from.has(k)), remove: [...from].filter((k) => !t.has(k)) };
}

/** Controls held by level only — never given to an employee, by role or as an extra. */
export const ROLE_ONLY_CONTROLS = [
  'roles and who holds them',
  'promoting staff to GST Manager',
  'approving direct filing, advance set-off overrides and FSI consent',
  'approving notice replies and switching notice alerts live',
  'manual override of opening balances (Suspended Reco, GST Receivable Reco)',
  'restoring or deleting saved versions',
  'exporting client portal credentials',
  'GSTR-9 / 9C review and lock',
];
