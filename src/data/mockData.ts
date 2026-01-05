import { User, Client, FilingStatusRecord, DashboardMetrics, BillNotIn2B } from '@/types';

// Mock Users with default credentials
export const mockUsers: User[] = [
  {
    id: '1',
    userId: 'superadmin',
    firstName: 'Admin',
    role: 'superadmin',
    email: 'admin@vjdesai.com',
    isFirstLogin: true,
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '2',
    userId: 'Kunal',
    firstName: 'Kunal',
    role: 'gst_manager',
    email: 'kunal@vjdesai.com',
    isFirstLogin: true,
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '3',
    userId: 'Amit',
    firstName: 'Amit',
    role: 'employee',
    email: 'amit@vjdesai.com',
    isFirstLogin: true,
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '4',
    userId: 'Priya',
    firstName: 'Priya',
    role: 'employee',
    email: 'priya@vjdesai.com',
    isFirstLogin: true,
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '5',
    userId: 'Karan',
    firstName: 'Karan',
    role: 'gst_manager',
    email: 'karan@staff.local',
    isFirstLogin: true,
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '6',
    userId: 'Umang',
    firstName: 'Umang',
    role: 'employee',
    email: 'umang@staff.local',
    isFirstLogin: true,
    createdAt: new Date('2024-01-01'),
  },
  // Client users (PAN-based)
  {
    id: '5',
    userId: 'AAQCS2345D',
    firstName: 'CROWNGLOBE',
    role: 'client',
    email: 'info.crownglobe@gmail.com',
    isFirstLogin: false,
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '6',
    userId: 'ABCDE1234F',
    firstName: 'Test Client 1',
    role: 'client',
    email: 'testclient1@example.com',
    isFirstLogin: false,
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '7',
    userId: 'PANDE7890K',
    firstName: 'Test Client 2',
    role: 'client',
    email: 'testclient2@example.com',
    isFirstLogin: false,
    createdAt: new Date('2024-01-01'),
  },
  {
    id: '8',
    userId: 'XYZZZ9999Z',
    firstName: 'Test Client 3',
    role: 'client',
    email: 'testclient3@example.com',
    isFirstLogin: false,
    createdAt: new Date('2024-01-01'),
  },
];

// Mock password store (in real app, this would be hashed in DB)
export const mockPasswords: Record<string, string> = {
  'superadmin': '123',
  'Kunal': '2026',
  'Amit': '2026',
  'Priya': '2026',
  'Karan': '2026',
  'Umang': '2026',
  'AAQCS2345D': 'AAQCS2345D',
  'ABCDE1234F': 'ABCDE1234F',
  'PANDE7890K': 'PANDE7890K',
  'XYZZZ9999Z': 'XYZZZ9999Z',
};

// Mock Clients
export const mockClients: Client[] = [
  {
    id: '1',
    gstin: '24AAQCS2345D1Z5',
    name: 'CROWNGLOBE PRIVATE LIMITED',
    registrationType: 'Regular',
    registrationDate: new Date('2021-10-17'),
    mobile: '9876543210',
    email: 'info.crownglobe@gmail.com',
    selectedReturns: ['GSTR-1', 'GSTR-3B', 'ITC-04'],
    assignedAccountant: 'Priya',
    createdBy: 'superadmin',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: '2',
    gstin: '24ABCDE1234F1Z5',
    name: 'ACCURATE PMS PVT. LTD',
    registrationType: 'Regular',
    registrationDate: new Date('2022-04-01'),
    mobile: '9876543211',
    email: 'account@accuratepms.in',
    selectedReturns: ['GSTR-1', 'GSTR-3B'],
    assignedAccountant: 'Amit',
    createdBy: 'superadmin',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
  {
    id: '3',
    gstin: '24PANDE7890K1Z5',
    name: 'AMBER GUM INDUSTRIES',
    registrationType: 'Regular',
    registrationDate: new Date('2020-07-15'),
    mobile: '9876543212',
    email: 'ambergum@hotmail.com',
    selectedReturns: ['GSTR-1', 'GSTR-3B', 'GSTR-6'],
    assignedAccountant: 'Rakesh',
    createdBy: 'Kunal',
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-01'),
  },
  {
    id: '4',
    gstin: '24XYZZZ9999Z1Z5',
    name: 'SHREE TRADERS',
    registrationType: 'Composition',
    registrationDate: new Date('2023-01-01'),
    mobile: '9876543213',
    email: 'shreetraders@gmail.com',
    selectedReturns: ['CMP-08'],
    assignedAccountant: 'Amit',
    createdBy: 'Kunal',
    createdAt: new Date('2024-03-01'),
    updatedAt: new Date('2024-03-01'),
  },
  {
    id: '5',
    gstin: '24TAXDD1234A1Z5',
    name: 'INCOME TAX DEPARTMENT - DDO',
    registrationType: 'Tax Deductor',
    registrationDate: new Date('2022-08-01'),
    mobile: '8320718348',
    email: 'ahmedabad.ddo.pcit.audit@incometax.gov.in',
    selectedReturns: ['GSTR-7'],
    assignedAccountant: 'Hetal',
    createdBy: 'superadmin',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
];

// Mock Filing Status Records - Updated with new status types
export const mockFilingStatus: FilingStatusRecord[] = [
  {
    id: '1',
    clientId: '1',
    clientName: 'CROWNGLOBE PRIVATE LIMITED',
    accountantName: 'Priya',
    returnType: 'GSTR-1',
    filingFrequency: 'Monthly',
    otpDscPerson: 'Kunal-100003',
    contactNumber: 'DSC-DIXITA/KARAN',
    clientEmail: 'info.crownglobe@gmail.com',
    status: 'Filed',
    targetDate: 11,
    filedDate: new Date('2025-12-11'),
    remarks: '',
    month: '12/2025',
    isLocked: true,
  },
  {
    id: '2',
    clientId: '1',
    clientName: 'CROWNGLOBE PRIVATE LIMITED',
    accountantName: 'Priya',
    returnType: 'GSTR-3B',
    filingFrequency: 'Monthly',
    otpDscPerson: 'Kunal-100003',
    contactNumber: 'DSC-DIXITA/KARAN',
    clientEmail: 'info.crownglobe@gmail.com',
    status: 'Filed',
    targetDate: 20,
    filedDate: new Date('2025-12-16'),
    remarks: '',
    month: '12/2025',
    isLocked: true,
  },
  {
    id: '3',
    clientId: '1',
    clientName: 'CROWNGLOBE PRIVATE LIMITED',
    accountantName: 'Priya',
    returnType: 'GSTR-1',
    filingFrequency: 'Monthly',
    otpDscPerson: 'Kunal-100003',
    contactNumber: 'DSC-DIXITA/KARAN',
    clientEmail: 'info.crownglobe@gmail.com',
    status: 'Prepared',
    targetDate: 11,
    remarks: '',
    month: '01/2026',
    isLocked: false,
  },
  {
    id: '4',
    clientId: '2',
    clientName: 'ACCURATE PMS PVT. LTD',
    accountantName: 'Amit',
    returnType: 'GSTR-1',
    filingFrequency: 'Monthly',
    otpDscPerson: 'Dinesh Padshala',
    contactNumber: '34',
    clientEmail: 'account@accuratepms.in',
    status: 'Not Verified',
    targetDate: 11,
    remarks: '',
    month: '01/2026',
    isLocked: false,
  },
  {
    id: '5',
    clientId: '3',
    clientName: 'AMBER GUM INDUSTRIES',
    accountantName: 'Rakesh',
    returnType: 'GSTR-3B',
    filingFrequency: 'Monthly',
    otpDscPerson: 'Miteshbhai',
    contactNumber: '22',
    clientEmail: 'ambergum@hotmail.com',
    status: 'Data Pending',
    targetDate: 20,
    remarks: '',
    month: '01/2026',
    isLocked: false,
  },
];

// Mock 2B Running Sheet Data
export const mock2BNotIn2B: BillNotIn2B[] = [
  {
    id: '1',
    clientId: '1',
    date: new Date('2025-11-15'),
    supplierName: 'ABC Suppliers Pvt Ltd',
    supplierInvoiceNumber: 'INV-2025-001',
    supplierGstin: '24AABCT1234A1Z5',
    taxableValue: 50000,
    inputIgst: 0,
    inputCgst: 4500,
    inputSgst: 4500,
    reversalMonth: '12/25',
    reclaimMonth: '',
    periodMonth: '12/2025',
    isLocked: false,
    isCarriedForward: false,
    updatedBy: 'Priya',
    updatedAt: new Date('2025-12-20'),
    version: 1,
  },
  {
    id: '2',
    clientId: '1',
    date: new Date('2025-11-20'),
    supplierName: 'XYZ Traders',
    supplierInvoiceNumber: 'INV-2025-102',
    supplierGstin: '24AABCT5678B1Z5',
    taxableValue: 25000,
    inputIgst: 4500,
    inputCgst: 0,
    inputSgst: 0,
    reversalMonth: '12/25',
    reclaimMonth: '01/26',
    periodMonth: '12/2025',
    isLocked: false,
    isCarriedForward: false,
    updatedBy: 'Priya',
    updatedAt: new Date('2025-12-22'),
    version: 2,
  },
];

// Dashboard Metrics Calculator - Updated with new status types
export const calculateDashboardMetrics = (month?: string): DashboardMetrics => {
  const currentMonth = month || `${String(new Date().getMonth() + 1).padStart(2, '0')}/${new Date().getFullYear()}`;
  
  const monthFilings = mockFilingStatus.filter(f => f.month === currentMonth);
  
  const pendingFilings = monthFilings.filter(
    f => f.status === 'Prepared' || f.status === 'Data Pending' || f.status === 'Mismatch in Data' || f.status === 'Not Verified'
  ).length;
  
  const filedThisMonth = monthFilings.filter(
    f => f.status === 'Filed'
  ).length;
  
  const lateFilings = monthFilings.filter(f => {
    if (!f.filedDate) return false;
    const filedDay = f.filedDate.getDate();
    return filedDay > f.targetDate;
  }).length;

  return {
    totalClients: mockClients.length,
    pendingFilings: pendingFilings || 12, // Default for demo
    lateFilings,
    filedThisMonth: filedThisMonth || 3, // Default for demo
    twoBReconciliationCount: mockClients.length,
  };
};
