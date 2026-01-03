// User Roles
export type UserRole = 'superadmin' | 'gst_manager' | 'employee' | 'client';

// Registration Types
export type RegistrationType = 'Regular' | 'Composition' | 'Tax Deductor';

// Return Types
export type ReturnType = 'GSTR-1' | 'GSTR-3B' | 'ITC-04' | 'GSTR-6' | 'GSTR-7' | 'CMP-08';

// Filing Status
export type FilingStatusType = 
  | 'Prepared' 
  | 'Prepared - NIL' 
  | 'Ready to Verify' 
  | 'Filed' 
  | 'Filed - NIL' 
  | 'Not to be Filed';

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
  isLocked: boolean;
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
  isLocked: boolean;
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
  updatedAt: Date;
  isCurrent: boolean;
  isCurrentVersion?: boolean;
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
export const RETURN_TYPES_BY_REGISTRATION: Record<RegistrationType, ReturnType[]> = {
  'Regular': ['GSTR-1', 'GSTR-3B', 'ITC-04', 'GSTR-6'],
  'Composition': ['CMP-08'],
  'Tax Deductor': ['GSTR-7'],
};
