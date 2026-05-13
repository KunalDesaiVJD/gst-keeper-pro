// User Roles
export type UserRole = 'superadmin' | 'gst_manager' | 'employee' | 'client';

// Registration Types - ISD added for GSTR-6, IFF for quarterly filing
export type RegistrationType = 'Regular' | 'Composition' | 'Tax Deductor' | 'ISD' | 'IFF';

// Return Types - Including IFF specific returns
export type ReturnType = 'GSTR-1' | 'GSTR-3B' | 'ITC-04' | 'GSTR-6' | 'GSTR-7' | 'CMP-08' | 'GSTR-1 (IFF)' | 'GSTR-3B (Q)';

// Filing Status - Updated to include new options (maintaining backwards compatibility)
export type FilingStatusType = 
  | 'Prepared' 
  | 'Prepared Pending'
  | 'Data Pending' 
  | 'Data Received'
  | 'Mismatch in Data' 
  | 'Not Verified' // Legacy - kept for backwards compatibility
  | 'Filed';

// User interface
export interface User {
  id: string;
  userId: string; // Login ID
  firstName: string;
  role: UserRole;
  email?: string;
  isFirstLogin: boolean;
  createdAt: Date;
}

// Client interface
export interface Client {
  id: string;
  gstin: string;
  name: string;
  registrationType: RegistrationType;
  registrationDate: Date;
  mobile: string;
  email: string;
  selectedReturns: ReturnType[];
  assignedAccountant?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

// 2B Running Sheet - Bills Not in 2B
export interface BillNotIn2B {
  id: string;
  clientId: string;
  date: Date;
  supplierName: string;
  supplierInvoiceNumber: string;
  supplierGstin: string;
  taxableValue: number;
  inputIgst: number;
  inputCgst: number;
  inputSgst: number;
  reversalMonth: string; // MM/YY format
  reclaimMonth: string; // MM/YY format
  periodMonth: string;
  isLocked: boolean;
  isCarriedForward: boolean;
  updatedBy: string;
  updatedAt: Date;
  version: number;
}

// 2B Running Sheet - Bills Not in Books
export interface BillNotInBooks {
  id: string;
  clientId: string;
  date: Date;
  supplierName: string;
  supplierInvoiceNumber: string;
  supplierGstin: string;
  taxableValue: number;
  inputIgst: number;
  inputCgst: number;
  inputSgst: number;
  bookEntryMonth: string; // MM/YY format
  billIn2BMonth: string; // MM/YY format
  periodMonth: string;
  isLocked: boolean;
  isCarriedForward: boolean;
  updatedBy: string;
  updatedAt: Date;
  version: number;
}

// 2B Version History
export interface TwoBVersion {
  id: string;
  clientId: string;
  clientGstin?: string;
  month: string; // MM/YY
  periodMonth?: string;
  tableType?: 'Bills_Not_in_2B' | 'Bills_Not_in_Books';
  versionNumber: number;
  billsNotIn2B: BillNotIn2B[];
  billsNotInBooks: BillNotInBooks[];
  versionData?: (BillNotIn2B | BillNotInBooks)[];
  updatedBy: string;
  updatedByRole?: string;
  updatedAt: Date;
  isCurrent: boolean;
  isCurrentVersion?: boolean;
  actionType?: 'SAVE' | 'RESTORE';
  restoredFromVersionId?: string;
}

// ITC Summary Row
export interface ITCSummaryRow {
  srNo: string;
  particular: string;
  igst: number;
  cgst: number;
  sgst: number;
  total: number;
  isAutoLinked: boolean;
  isLocked: boolean;
}

// ITC Summary
export interface ITCSummary {
  id: string;
  clientId: string;
  clientName: string;
  month: string; // MM/YYYY
  section4A: ITCSummaryRow[];
  section4B: ITCSummaryRow[];
  netITC: ITCSummaryRow; // 4C
  section4D: ITCSummaryRow[];
  totalReclamation: number;
  totalReversal: number;
  isLocked: boolean;
  editHistory: {
    field: string;
    oldValue: number;
    newValue: number;
    editedBy: string;
    editedAt: Date;
  }[];
  updatedBy: string;
  updatedAt: Date;
}

// Filing Status Record
export interface FilingStatusRecord {
  id: string;
  clientId: string;
  clientName: string;
  accountantName: string;
  returnType: ReturnType;
  filingFrequency: 'Monthly' | 'Quarterly' | 'Composition';
  otpDscPerson: string;
  contactNumber: string;
  clientEmail: string;
  status: FilingStatusType;
  targetDate: number; // Day of month
  filedDate?: Date;
  remarks: string;
  month: string; // MM/YYYY
  isLocked: boolean;
  arn?: string | null;
}

// Dashboard Metrics
export interface DashboardMetrics {
  totalClients: number;
  pendingFilings: number;
  lateFilings: number;
  filedThisMonth: number;
  twoBReconciliationCount: number;
}

// Auth Context
export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Return type availability based on registration type
// GSTR-6 moved from Regular to ISD
// IFF has GSTR-1 (IFF) monthly and GSTR-3B (Q) quarterly
export const RETURN_TYPES_BY_REGISTRATION: Record<RegistrationType, ReturnType[]> = {
  'Regular': ['GSTR-1', 'GSTR-3B', 'ITC-04'],
  'Composition': ['CMP-08'],
  'Tax Deductor': ['GSTR-7'],
  'ISD': ['GSTR-6'],
  'IFF': ['GSTR-1 (IFF)', 'GSTR-3B (Q)'],
};

// Quarterly return types - these appear only in last month of quarter (Jun, Sep, Dec, Mar)
export const QUARTERLY_RETURN_TYPES: ReturnType[] = ['CMP-08', 'GSTR-3B (Q)', 'ITC-04'];

// Helper to check if a month is end of quarter (Jun, Sep, Dec, Mar)
export const isQuarterEndMonth = (month: number): boolean => {
  return [3, 6, 9, 12].includes(month); // March, June, September, December
};

// Helper to get quarter end month for a given month
export const getQuarterEndMonth = (month: number): number => {
  if (month <= 3) return 3;
  if (month <= 6) return 6;
  if (month <= 9) return 9;
  return 12;
};
