// Every permission key an employee can hold, grouped as User Control shows
// them. Employees get keys only through their role (staff_positions →
// user_permissions, migration 20261014120000_staff_positions.sql);
// superadmin and gst_manager hold every key by role.
//
// Adding a key: add it here, to UserPermissions / DEFAULT_PERMISSIONS and a
// can*() helper in src/contexts/AuthContext.tsx, then check the helper where
// the action happens. The DB has no allow-list of keys.

export type PermissionGroupKey =
  | 'clients' | 'returns' | 'reco' | 'emails' | 'advances' | 'builder' | 'notices' | 'staff';

export const PERMISSION_GROUPS: { key: PermissionGroupKey; label: string }[] = [
  { key: 'clients', label: 'Clients' },
  { key: 'returns', label: 'Returns & filing' },
  { key: 'reco', label: '2B, ITC, RCM & update sheet' },
  { key: 'emails', label: 'E-mails to clients' },
  { key: 'advances', label: 'Advances' },
  { key: 'builder', label: 'Builder' },
  { key: 'notices', label: 'Notices & litigation' },
  { key: 'staff', label: 'Staff' },
];

export interface PermissionDef {
  key: string;
  group: PermissionGroupKey;
  label: string;
  description: string;
}

export const PERMISSIONS: PermissionDef[] = [
  // Clients
  { key: 'add_edit_clients', group: 'clients', label: 'Add / edit clients', description: 'Add new clients and edit client records (Add Client, Edit Client)' },
  { key: 'delete_clients', group: 'clients', label: 'Delete clients', description: 'Delete client records' },
  { key: 'edit_gstr1_import_mode', group: 'clients', label: 'GSTR-1 import mode', description: "Change how a client's GSTR-1 is prepared: JSON, Manual, or JSON + Manual" },
  { key: 'export_data', group: 'clients', label: 'Export data', description: 'Download Excel / PDF exports from GST, reconciliation and notice pages' },

  // Returns & filing
  { key: 'edit_filing_status', group: 'returns', label: 'Filing status & portal push', description: 'Change filing status, tick NIL, and push GSTR-1 / GSTR-3B to the GST portal' },
  { key: 'delete_return_data', group: 'returns', label: 'Delete return data', description: "Delete a period's GSTR-1 data and rows of the GST Running Update" },
  { key: 'unlock_sheets', group: 'returns', label: 'Unlock sheets', description: 'Unlock locked filing records, RCM and annual return workings' },
  { key: 'view_version_history', group: 'returns', label: 'Version history', description: 'Open saved versions of 2B, ITC, RCM and the GST Running Update' },

  // 2B, ITC, RCM & update sheet
  { key: 'work_2b_import', group: 'reco', label: 'Import 2B & post', description: 'Import 2B / books, pull 2B from the portal and Post to Reconciliation' },
  { key: 'import_excel', group: 'reco', label: 'Import Excel (2B Reconciliation)', description: 'Import Excel into the 2B Reconciliation page (Liberal clients)' },
  { key: 'delete_2b_rows', group: 'reco', label: 'Delete 2B rows', description: 'Delete 2B and books rows on Import 2B and 2B Reconciliation' },
  { key: 'clear_data', group: 'reco', label: 'Clear data', description: "Wipe a period's 2B / ITC / RCM / Suspended Reco data (Clear Data)" },
  { key: 'manage_rcm_masters', group: 'reco', label: 'RCM masters', description: 'Add, edit and delete RCM expense masters' },
  { key: 'edit_update_sheet', group: 'reco', label: 'Edit GST Running Update', description: 'Edit entries on the GST Running Update sheet' },

  // E-mails to clients
  { key: 'send_client_emails', group: 'emails', label: 'Send client e-mails', description: 'Send GST reminders and e-invoice threshold letters to clients' },
  { key: 'manage_email_templates', group: 'emails', label: 'E-mail templates & reminder rules', description: 'Edit e-mail templates and switch reminder rules on or off' },

  // Advances
  { key: 'manage_advance_register', group: 'advances', label: 'Advance register', description: 'Add and edit advance receipt vouchers and their set-off against invoices' },
  { key: 'override_advance_setoff', group: 'advances', label: 'Request set-off override', description: 'Ask to file past a blocked advance set-off check (a GST Manager approves)' },

  // Builder
  { key: 'manage_builder_projects', group: 'builder', label: 'Builder projects', description: 'Create and edit projects, blocks and client-level GST elections' },
  { key: 'manage_builder_units', group: 'builder', label: 'Builder units', description: 'Add and edit units, charge heads and opening balances' },
  { key: 'enter_builder_receipts', group: 'builder', label: 'Bookings & receipts', description: 'Record bookings, advances, receipts and milestone invoices' },
  { key: 'post_bu_event', group: 'builder', label: 'Post BU events', description: 'Create BU events and post the unit-wise differential' },
  { key: 'override_bu_agreement', group: 'builder', label: 'Accept BU agreement value', description: "Accept a unit's agreement value at BU without the client's confirmation (with a reason)" },
  { key: 'post_builder_adjustments', group: 'builder', label: 'Builder adjustments', description: 'Cancellations, conversions, credit notes, refunds and bounce reversals' },
  { key: 'view_builder_reports', group: 'builder', label: 'Builder reports', description: 'Working papers and their Excel / PDF exports' },

  // Notices
  { key: 'edit_notice_status', group: 'notices', label: 'Edit notice status', description: 'Open / close notices, priority, and reply / order / submission details' },

  // Staff
  { key: 'manage_employees', group: 'staff', label: 'Manage employees', description: "Add and remove employee accounts and reset employees' passwords. Roles stay with GST Managers" },
];

export const PERMISSION_LABEL: Record<string, string> = Object.fromEntries(PERMISSIONS.map((p) => [p.key, p.label]));

export const permissionsInGroup = (g: PermissionGroupKey) => PERMISSIONS.filter((p) => p.group === g);

/** Controls held by role only — never given through a role. */
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
