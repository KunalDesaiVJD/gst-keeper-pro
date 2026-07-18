import React, { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, Download, CheckCircle2, XCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { RegistrationType, ReturnType, RETURN_TYPES_BY_REGISTRATION } from '@/types';
import { mockPasswords } from '@/data/mockData';

interface ValidationResult {
  row: number;
  data: any;
  errors: string[];
  isValid: boolean;
}

interface BulkAddClientsDialogProps {
  onSuccess?: () => void;
}

const BulkAddClientsDialog: React.FC<BulkAddClientsDialogProps> = ({ onSuccess }) => {
  const [open, setOpen] = useState(false);
  const [validationResults, setValidationResults] = useState<ValidationResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () => {
    const workbook = XLSX.utils.book_new();
    
    // Template data with headers and example
    const templateData = [
      ['Bulk Client Import Template'],
      ['Instructions: Fill in the details below. GSTIN must be exactly 15 characters. Registration Type must be: Regular, Composition, Tax Deductor, or ISD.'],
      ['Selected Returns: For Regular - GSTR-1,GSTR-3B,ITC-04 | For Composition - CMP-08 | For Tax Deductor - GSTR-7 | For ISD - GSTR-6'],
      [],
      ['GSTIN*', 'Client Name*', 'Registration Type*', 'Registration Date (DD/MM/YYYY)', 'Mobile (10 digits)', 'Email', 'Assigned Accountant', 'Target Date (GSTR-1, GSTR-7)', 'Target Date (GSTR-3B, ITC-04)', 'Selected Returns (comma-separated)'],
      ['24AAQCS2345D1Z5', 'Sample Company Pvt Ltd', 'Regular', '15/01/2024', '9876543210', 'sample@example.com', 'John Doe', '11', '20', 'GSTR-1,GSTR-3B'],
      ['24BBRCS9876E2Z6', 'Another Business', 'Composition', '01/02/2024', '9123456789', 'another@example.com', 'Jane Smith', '', '15', 'CMP-08'],
    ];

    const sheet = XLSX.utils.aoa_to_sheet(templateData);
    
    // Set column widths
    sheet['!cols'] = [
      { wch: 18 }, // GSTIN
      { wch: 30 }, // Name
      { wch: 15 }, // Reg Type
      { wch: 22 }, // Reg Date
      { wch: 15 }, // Mobile
      { wch: 25 }, // Email
      { wch: 20 }, // Accountant
      { wch: 26 }, // Target Date (GSTR-1, GSTR-7)
      { wch: 26 }, // Target Date (GSTR-3B, ITC-04)
      { wch: 30 }, // Returns
    ];

    XLSX.utils.book_append_sheet(workbook, sheet, 'Clients');
    XLSX.writeFile(workbook, 'Bulk_Client_Import_Template.xlsx');
    toast.success('Template downloaded successfully');
  };

  const validateGSTIN = (gstin: string): boolean => {
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    return gstinRegex.test(gstin);
  };

  const validateRow = (row: any[], rowIndex: number): ValidationResult => {
    const errors: string[] = [];
    
    const gstin = String(row[0] || '').trim().toUpperCase();
    const name = String(row[1] || '').trim();
    const regType = String(row[2] || '').trim();
    const regDate = String(row[3] || '').trim();
    const mobile = String(row[4] || '').trim();
    const email = String(row[5] || '').trim();
    const accountant = String(row[6] || '').trim();
    const defaultTargetDate = row[7] ? parseInt(row[7]) : null; // Target Date (GSTR-1, GSTR-7)
    const otherTargetDate = row[8] ? parseInt(row[8]) : null; // Target Date (GSTR-3B, ITC-04)
    const returnsStr = String(row[9] || '').trim();

    // Validate GSTIN
    if (!gstin) {
      errors.push('GSTIN is required');
    } else if (gstin.length !== 15) {
      errors.push('GSTIN must be exactly 15 characters');
    } else if (!validateGSTIN(gstin)) {
      errors.push('Invalid GSTIN format');
    }

    // Validate Name
    if (!name) {
      errors.push('Client name is required');
    }

    // Validate Registration Type
    const validRegTypes: RegistrationType[] = ['Regular', 'Composition', 'Tax Deductor', 'ISD'];
    if (!regType) {
      errors.push('Registration type is required');
    } else if (!validRegTypes.includes(regType as RegistrationType)) {
      errors.push(`Invalid registration type. Must be: ${validRegTypes.join(', ')}`);
    }

    // Registration Date - no validation, just parse if provided

    // Validate Mobile
    if (mobile && !/^[0-9]{10}$/.test(mobile)) {
      errors.push('Mobile must be 10 digits');
    }

    // Validate Email
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('Invalid email format');
    }

    // Validate Target Dates (optional, 1-31 if provided)
    if (defaultTargetDate !== null && (defaultTargetDate < 1 || defaultTargetDate > 31)) {
      errors.push('Target Date (GSTR-1, GSTR-7) must be between 1 and 31');
    }
    if (otherTargetDate !== null && (otherTargetDate < 1 || otherTargetDate > 31)) {
      errors.push('Target Date (GSTR-3B, ITC-04) must be between 1 and 31');
    }

    // Validate Returns
    let selectedReturns: ReturnType[] = [];
    if (returnsStr && regType && validRegTypes.includes(regType as RegistrationType)) {
      const allowedReturns = RETURN_TYPES_BY_REGISTRATION[regType as RegistrationType] || [];
      const inputReturns = returnsStr.split(',').map(r => r.trim()) as ReturnType[];
      
      for (const ret of inputReturns) {
        if (!allowedReturns.includes(ret)) {
          errors.push(`Return type '${ret}' is not valid for ${regType} registration`);
        } else {
          selectedReturns.push(ret);
        }
      }
    }

    if (selectedReturns.length === 0 && regType && validRegTypes.includes(regType as RegistrationType)) {
      // Auto-assign default returns based on type
      selectedReturns = RETURN_TYPES_BY_REGISTRATION[regType as RegistrationType] || [];
    }

    // Parse registration date to YYYY-MM-DD format for storage
    let parsedRegDate = new Date().toISOString().split('T')[0]; // Default to today
    if (regDate) {
      const ddmmyyyyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
      const ddmmyyyyMatch = regDate.match(ddmmyyyyRegex);
      if (ddmmyyyyMatch) {
        const day = parseInt(ddmmyyyyMatch[1], 10);
        const month = parseInt(ddmmyyyyMatch[2], 10);
        const year = parseInt(ddmmyyyyMatch[3], 10);
        const date = new Date(year, month - 1, day);
        if (!isNaN(date.getTime())) {
          parsedRegDate = date.toISOString().split('T')[0];
        }
      } else {
        const date = new Date(regDate);
        if (!isNaN(date.getTime())) {
          parsedRegDate = date.toISOString().split('T')[0];
        }
      }
    }

    return {
      row: rowIndex + 1,
      data: {
        gstin,
        name,
        registrationType: regType as RegistrationType,
        registrationDate: parsedRegDate,
        mobile,
        email,
        accountant,
        defaultTargetDate,
        otherTargetDate,
        selectedReturns,
      },
      errors,
      isValid: errors.length === 0,
    };
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setValidationResults([]);

    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

      // Skip header rows (first 5 rows in template)
      const dataRows = rows.slice(5).filter(row => row[0] && String(row[0]).trim());
      
      const results: ValidationResult[] = dataRows.map((row, index) => validateRow(row, index + 5));
      setValidationResults(results);

      const validCount = results.filter(r => r.isValid).length;
      const invalidCount = results.filter(r => !r.isValid).length;

      if (validCount > 0 && invalidCount === 0) {
        toast.success(`${validCount} clients ready to import`);
      } else if (validCount > 0) {
        toast.warning(`${validCount} valid, ${invalidCount} have errors`);
      } else {
        toast.error('No valid clients found');
      }
    } catch (error: any) {
      toast.error('Failed to parse file: ' + error.message);
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleImport = async () => {
    const validClients = validationResults.filter(r => r.isValid);
    if (validClients.length === 0) {
      toast.error('No valid clients to import');
      return;
    }

    setIsImporting(true);
    let successCount = 0;
    let failCount = 0;
    const failedClients: string[] = [];

    for (const result of validClients) {
      try {
        const { data } = result;
        
        // Generate client credentials
        const pan = data.gstin.slice(2, 12);
        const userId = pan;
        const password = pan;

        // Insert client
        const { data: clientData, error } = await supabase
          .from('clients')
          .insert([{
            gstin: data.gstin,
            name: data.name,
            registration_type: data.registrationType,
            registration_date: data.registrationDate,
            mobile: data.mobile || null,
            email: data.email || null,
            assigned_accountant: data.accountant || null,
            selected_returns: data.selectedReturns,
            client_user_id: userId,
            client_password: data.gstin, // Set initial password to GSTIN
            is_first_login: true, // Force password change on first login
          }])
          .select()
          .single();

        if (error) throw error;

        // Create filing status records
        if (clientData) {
          const regDate = new Date(data.registrationDate);
          const now = new Date();
          const filingRecords: any[] = [];
          
          let currentDate = new Date(regDate.getFullYear(), regDate.getMonth(), 1);
          while (currentDate <= now) {
            const periodMonth = `${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
            
            for (const returnType of data.selectedReturns) {
              // Determine target date based on return type
              let targetDate: number | null = null;
              if (returnType === 'GSTR-1' || returnType === 'GSTR-7') {
                targetDate = data.defaultTargetDate;
              } else if (returnType === 'GSTR-3B' || returnType === 'ITC-04') {
                targetDate = data.otherTargetDate;
              }
              
              filingRecords.push({
                client_id: clientData.id,
                return_type: returnType,
                period_month: periodMonth,
                status: 'Data Pending',
                target_date: targetDate,
              });
            }
            
            currentDate.setMonth(currentDate.getMonth() + 1);
          }
          
          if (filingRecords.length > 0) {
            await supabase.from('filing_status').insert(filingRecords);
          }
        }

        // Add to mock passwords for client login
        mockPasswords[userId] = password;

        successCount++;
      } catch (error: any) {
        failCount++;
        failedClients.push(result.data.name);
        console.error('Failed to import client:', error);
      }
    }

    setIsImporting(false);

    if (successCount > 0 && failCount === 0) {
      toast.success(`Successfully imported ${successCount} clients`);
      setOpen(false);
      setValidationResults([]);
      onSuccess?.();
    } else if (successCount > 0) {
      toast.warning(`Imported ${successCount} clients. ${failCount} failed: ${failedClients.join(', ')}`);
    } else {
      toast.error('Failed to import any clients');
    }
  };

  const validCount = validationResults.filter(r => r.isValid).length;
  const invalidCount = validationResults.filter(r => !r.isValid).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Bulk Add Clients
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Bulk Add Clients</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Step 1: Download Template */}
          <div className="space-y-2">
            <h3 className="font-medium flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">1</span>
              Download Template
            </h3>
            <p className="text-sm text-muted-foreground ml-8">
              Download the Excel template and fill in your client details.
            </p>
            <div className="ml-8">
              <Button variant="outline" onClick={downloadTemplate} className="flex items-center gap-2">
                <Download className="h-4 w-4" />
                Download Template
              </Button>
            </div>
          </div>

          {/* Step 2: Upload File */}
          <div className="space-y-2">
            <h3 className="font-medium flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">2</span>
              Upload Filled Template
            </h3>
            <p className="text-sm text-muted-foreground ml-8">
              Upload your filled Excel file to validate the data.
            </p>
            <div className="ml-8">
              <input
                type="file"
                ref={fileInputRef}
                accept=".xlsx,.xls"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="flex items-center gap-2"
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                {isProcessing ? 'Processing...' : 'Upload Excel File'}
              </Button>
            </div>
          </div>

          {/* Validation Results */}
          {validationResults.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-medium flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">3</span>
                Validation Results
              </h3>
              
              <div className="ml-8 flex items-center gap-4">
                <Badge variant="outline" className="flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-success" />
                  {validCount} Valid
                </Badge>
                {invalidCount > 0 && (
                  <Badge variant="destructive" className="flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    {invalidCount} Errors
                  </Badge>
                )}
              </div>

              <div className="ml-8 max-h-60 overflow-y-auto overflow-x-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-primary text-primary-foreground sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 text-right font-medium">Row</th>
                      <th className="px-3 py-2 text-left font-medium">GSTIN</th>
                      <th className="px-3 py-2 text-left font-medium">Name</th>
                      <th className="px-3 py-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validationResults.map((result, idx) => (
                      <tr key={idx} className={result.isValid ? '' : 'bg-destructive/5'}>
                        <td className="px-3 py-2 text-right tabular-nums">{result.row}</td>
                        <td className="px-3 py-2 font-mono text-xs">{result.data.gstin}</td>
                        <td className="px-3 py-2">{result.data.name}</td>
                        <td className="px-3 py-2">
                          {result.isValid ? (
                            <CheckCircle2 className="h-4 w-4 text-success" />
                          ) : (
                            <div className="flex items-start gap-1">
                              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                              <span className="text-xs text-destructive">{result.errors.join('; ')}</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {validCount > 0 && (
                <div className="ml-8">
                  <Button
                    onClick={handleImport}
                    disabled={isImporting}
                    className="flex items-center gap-2"
                  >
                    {isImporting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isImporting ? 'Importing...' : `Import ${validCount} Clients`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BulkAddClientsDialog;
