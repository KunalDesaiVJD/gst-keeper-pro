import React, { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, Download, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { RegistrationType, ReturnType, RETURN_TYPES_BY_REGISTRATION } from '@/types';
import { mockPasswords, mockUsers } from '@/data/mockData';

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
      ['Instructions: Fill in the details below. GSTIN must be exactly 15 characters. Registration Type must be: Regular, Composition, or Tax Deductor.'],
      ['Selected Returns: For Regular - GSTR-1,GSTR-3B,ITC-04,GSTR-6 | For Composition - CMP-08 | For Tax Deductor - GSTR-7'],
      [],
      ['GSTIN*', 'Client Name*', 'Registration Type*', 'Registration Date* (YYYY-MM-DD)', 'Mobile (10 digits)', 'Email', 'Assigned Accountant', 'Target Date (1-31)', 'Selected Returns (comma-separated)'],
      ['24AAQCS2345D1Z5', 'Sample Company Pvt Ltd', 'Regular', '2024-01-15', '9876543210', 'sample@example.com', 'John Doe', '11', 'GSTR-1,GSTR-3B'],
      ['24BBRCS9876E2Z6', 'Another Business', 'Composition', '2024-02-01', '9123456789', 'another@example.com', 'Jane Smith', '15', 'CMP-08'],
    ];

    const sheet = XLSX.utils.aoa_to_sheet(templateData);
    
    // Set column widths
    sheet['!cols'] = [
      { wch: 18 }, // GSTIN
      { wch: 30 }, // Name
      { wch: 15 }, // Reg Type
      { wch: 20 }, // Reg Date
      { wch: 15 }, // Mobile
      { wch: 25 }, // Email
      { wch: 20 }, // Accountant
      { wch: 12 }, // Target Date
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
    const targetDate = parseInt(row[7]) || 11;
    const returnsStr = String(row[8] || '').trim();

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
    const validRegTypes: RegistrationType[] = ['Regular', 'Composition', 'Tax Deductor'];
    if (!regType) {
      errors.push('Registration type is required');
    } else if (!validRegTypes.includes(regType as RegistrationType)) {
      errors.push(`Invalid registration type. Must be: ${validRegTypes.join(', ')}`);
    }

    // Validate Registration Date
    if (!regDate) {
      errors.push('Registration date is required');
    } else {
      const date = new Date(regDate);
      if (isNaN(date.getTime())) {
        errors.push('Invalid date format. Use YYYY-MM-DD');
      }
    }

    // Validate Mobile
    if (mobile && !/^[0-9]{10}$/.test(mobile)) {
      errors.push('Mobile must be 10 digits');
    }

    // Validate Email
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('Invalid email format');
    }

    // Validate Target Date
    if (targetDate < 1 || targetDate > 31) {
      errors.push('Target date must be between 1 and 31');
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

    return {
      row: rowIndex + 1,
      data: {
        gstin,
        name,
        registrationType: regType as RegistrationType,
        registrationDate: regDate,
        mobile,
        email,
        accountant,
        targetDate,
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
              filingRecords.push({
                client_id: clientData.id,
                return_type: returnType,
                period_month: periodMonth,
                status: 'Prepared',
                target_date: returnType === 'GSTR-1' ? 11 : returnType === 'GSTR-3B' ? 20 : data.targetDate,
              });
            }
            
            currentDate.setMonth(currentDate.getMonth() + 1);
          }
          
          if (filingRecords.length > 0) {
            await supabase.from('filing_status').insert(filingRecords);
          }
        }

        // Add to mock data for login
        mockPasswords[userId] = password;
        mockUsers.push({
          id: `client-${Date.now()}-${successCount}`,
          userId,
          firstName: data.name,
          role: 'client',
          email: data.email,
          isFirstLogin: true,
          createdAt: new Date(),
        });

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
          <FileSpreadsheet className="h-4 w-4" />
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
                <Upload className="h-4 w-4" />
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
                  <CheckCircle2 className="h-3 w-3 text-green-500" />
                  {validCount} Valid
                </Badge>
                {invalidCount > 0 && (
                  <Badge variant="destructive" className="flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    {invalidCount} Errors
                  </Badge>
                )}
              </div>

              <div className="ml-8 max-h-60 overflow-y-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left">Row</th>
                      <th className="px-3 py-2 text-left">GSTIN</th>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validationResults.map((result, idx) => (
                      <tr key={idx} className={result.isValid ? '' : 'bg-destructive/5'}>
                        <td className="px-3 py-2">{result.row}</td>
                        <td className="px-3 py-2 font-mono text-xs">{result.data.gstin}</td>
                        <td className="px-3 py-2">{result.data.name}</td>
                        <td className="px-3 py-2">
                          {result.isValid ? (
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
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
