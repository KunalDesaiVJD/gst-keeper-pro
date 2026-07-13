import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Save, Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, Loader2 } from 'lucide-react';
import { RegistrationType, ReturnType, RETURN_TYPES_BY_REGISTRATION, QUARTERLY_RETURN_TYPES, isQuarterEndMonth } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { mockPasswords } from '@/data/mockData';
import ClientCredentialsSection from '@/components/clients/ClientCredentialsSection';
import BulkAddClientsDialog from '@/components/clients/BulkAddClientsDialog';

const AddClientPage: React.FC = () => {
  const navigate = useNavigate();
  const [isSaving, setIsSaving] = useState(false);

  const [formData, setFormData] = useState({
    gstin: '',
    name: '',
    registrationType: '' as RegistrationType | '',
    registrationDate: '', // Optional - defaults to today if empty
    mobile: '',
    email: '',
    assignedAccountant: '',
    defaultTargetDate: '', // Optional - for GSTR-1, GSTR-7
    otherTargetDate: '', // Optional - for GSTR-3B, ITC-04
    selectedReturns: [] as ReturnType[],
    cancellationDate: '', // Optional — labeled "GSTR 10 Date" in UI
    registrationCancellationDate: '', // Optional — actual registration cancellation date
    inactiveAtHand: false, // Optional — hides client from Filing Status when true
    gstUserId: '', // GST Portal User ID
    gstPassword: '', // GST Portal Password
    // Builder bifurcation for Regular type
    regularSubType: '' as '' | 'Builder' | 'Normal',
    builderItcType: '' as '' | 'NO_ITC' | 'CLAIM_ITC' | 'PARTIAL_ITC',
    commercialArea: '',
    residentialArea: '',
  });

  const [clientCredentials, setClientCredentials] = useState<{ userId: string; password: string } | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showGstPassword, setShowGstPassword] = useState(false);
  const [gstinWarning, setGstinWarning] = useState<string | null>(null);
  const [isCheckingGstin, setIsCheckingGstin] = useState(false);

  // Check for duplicate GSTIN
  const checkDuplicateGstin = async (gstin: string) => {
    if (gstin.length !== 15) {
      setGstinWarning(null);
      return;
    }
    
    setIsCheckingGstin(true);
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('id, name')
        .eq('gstin', gstin)
        .maybeSingle();
      
      if (error) {
        console.error('Error checking GSTIN:', error);
        setGstinWarning(null);
      } else if (data) {
        setGstinWarning(`This GSTIN already exists for client: ${data.name}`);
      } else {
        setGstinWarning(null);
      }
    } catch (err) {
      console.error('Error checking GSTIN:', err);
      setGstinWarning(null);
    } finally {
      setIsCheckingGstin(false);
    }
  };

  // Get available returns based on registration type
  const availableReturns = useMemo(() => {
    if (!formData.registrationType) return [];
    return RETURN_TYPES_BY_REGISTRATION[formData.registrationType as RegistrationType] || [];
  }, [formData.registrationType]);

  // Reset selected returns when registration type changes
  const handleRegistrationTypeChange = (value: RegistrationType) => {
    setFormData(prev => ({
      ...prev,
      registrationType: value,
      selectedReturns: [], // Reset returns when type changes
      // Reset builder-related fields when registration type changes
      regularSubType: value === 'Regular' ? prev.regularSubType : '',
      builderItcType: value === 'Regular' ? prev.builderItcType : '',
      commercialArea: '',
      residentialArea: '',
    }));
  };

  const handleReturnToggle = (returnType: ReturnType) => {
    setFormData(prev => ({
      ...prev,
      selectedReturns: prev.selectedReturns.includes(returnType)
        ? prev.selectedReturns.filter(r => r !== returnType)
        : [...prev.selectedReturns, returnType],
    }));
  };

  const validateGSTIN = (gstin: string): boolean => {
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    return gstinRegex.test(gstin);
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.gstin) {
      newErrors.gstin = 'GSTIN is required';
    } else if (formData.gstin.length !== 15) {
      newErrors.gstin = 'GSTIN must be exactly 15 characters';
    } else if (formData.registrationType !== 'Tax Deductor' && !validateGSTIN(formData.gstin)) {
      // Skip GSTIN format validation for Tax Deductor
      newErrors.gstin = 'Invalid GSTIN format';
    }

    if (!formData.name.trim()) {
      newErrors.name = 'Client name is required';
    }

    if (!formData.registrationType) {
      newErrors.registrationType = 'Registration type is required';
    }

    // Registration date is now optional - no validation needed

    if (!formData.assignedAccountant.trim()) {
      newErrors.assignedAccountant = 'Assigned accountant is required';
    }

    if (!formData.mobile) {
      newErrors.mobile = 'Mobile number is required';
    } else if (!/^[0-9]{10}$/.test(formData.mobile)) {
      newErrors.mobile = 'Mobile must be 10 digits';
    }

    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    if (formData.selectedReturns.length === 0) {
      newErrors.returns = 'Select at least one return type';
    }

    // Validate builder fields for Regular type
    if (formData.registrationType === 'Regular' && !formData.regularSubType) {
      newErrors.regularSubType = 'Please select Builder or Normal';
    }

    if (formData.regularSubType === 'Builder' && !formData.builderItcType) {
      newErrors.builderItcType = 'Please select ITC type';
    }

    if (formData.builderItcType === 'PARTIAL_ITC') {
      if (!formData.commercialArea || parseFloat(formData.commercialArea) === 0) {
        newErrors.commercialArea = 'Commercial area is required for Partial ITC';
      }
      if (!formData.residentialArea || parseFloat(formData.residentialArea) === 0) {
        newErrors.residentialArea = 'Residential area is required for Partial ITC';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleCredentialsGenerated = (userId: string, password: string) => {
    setClientCredentials({ userId, password });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.error('Please fix the errors in the form.');
      return;
    }

    setIsSaving(true);

    try {
      // Use today's date if registration date is not provided
      const effectiveRegDate = formData.registrationDate || new Date().toISOString().split('T')[0];
      
      const { data: clientData, error } = await supabase
        .from('clients')
        .insert([{
          gstin: formData.gstin,
          name: formData.name,
          registration_type: formData.registrationType as 'Regular' | 'Composition' | 'Tax Deductor' | 'ISD' | 'IFF',
          registration_date: effectiveRegDate,
          mobile: formData.mobile || null,
          email: formData.email || null,
          assigned_accountant: formData.assignedAccountant || null,
          selected_returns: formData.selectedReturns,
          client_user_id: clientCredentials?.userId || null,
          cancellation_date: formData.cancellationDate || null,
          registration_cancellation_date: formData.registrationCancellationDate || null,
          inactive_at_hand: formData.inactiveAtHand,
          gst_user_id: formData.gstUserId || null,
          gst_password: formData.gstPassword || null,
          client_password: formData.gstin,
          is_first_login: true,
          regular_sub_type: formData.registrationType === 'Regular' ? formData.regularSubType : null,
          builder_itc_type: formData.regularSubType === 'Builder' ? formData.builderItcType : null,
          commercial_area: formData.builderItcType === 'PARTIAL_ITC' ? parseFloat(formData.commercialArea) || 0 : 0,
          residential_area: formData.builderItcType === 'PARTIAL_ITC' ? parseFloat(formData.residentialArea) || 0 : 0,
          target_date_group1: formData.defaultTargetDate ? parseInt(formData.defaultTargetDate) : null,
          target_date_group2: formData.otherTargetDate ? parseInt(formData.otherTargetDate) : null,
        }])
        .select()
        .single();

      if (error) throw error;

      // Create filing status records for all selected returns from registration date
      if (clientData) {
        const regDate = new Date(effectiveRegDate);
        const now = new Date();
        const filingRecords: any[] = [];
        
        // Generate months from registration date to current month
        let currentDate = new Date(regDate.getFullYear(), regDate.getMonth(), 1);
        while (currentDate <= now) {
          const periodMonth = `${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
          const currentMonthNum = currentDate.getMonth() + 1;
          
          for (const returnType of formData.selectedReturns) {
            // Check if this is a quarterly return - only create for quarter end months
            const isQuarterlyReturn = QUARTERLY_RETURN_TYPES.includes(returnType);
            if (isQuarterlyReturn && !isQuarterEndMonth(currentMonthNum)) {
              continue; // Skip non-quarter-end months for quarterly returns
            }
            
            // Determine target date based on return type and user input
            let targetDate: number | null = null;
            if (returnType === 'GSTR-1' || returnType === 'GSTR-7' || returnType === 'GSTR-6' || returnType === 'GSTR-1 (IFF)') {
              targetDate = formData.defaultTargetDate ? parseInt(formData.defaultTargetDate) : null;
            } else if (returnType === 'GSTR-3B' || returnType === 'ITC-04' || returnType === 'CMP-08' || returnType === 'GSTR-3B (Q)') {
              targetDate = formData.otherTargetDate ? parseInt(formData.otherTargetDate) : null;
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

      // If credentials were generated, add to mock passwords for client login
      if (clientCredentials) {
        mockPasswords[clientCredentials.userId] = clientCredentials.password;
      }

      toast.success(`${formData.name} has been successfully added.`);
      navigate('/clients');
    } catch (error: any) {
      console.error('Error adding client:', error);
      toast.error('Failed to add client: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-heading font-bold text-foreground">Add New Client</h1>
            <p className="text-muted-foreground">Fill in the client details below</p>
          </div>
        </div>
        <BulkAddClientsDialog onSuccess={() => navigate('/clients')} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Client Information</CardTitle>
          <CardDescription>
            All fields marked with * are required
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* GSTIN */}
            <div className="space-y-2">
              <Label htmlFor="gstin">GSTIN *</Label>
              <div className="relative">
                <Input
                  id="gstin"
                  value={formData.gstin}
                  onChange={(e) => {
                    const newGstin = e.target.value.toUpperCase();
                    setFormData(prev => ({ ...prev, gstin: newGstin }));
                    checkDuplicateGstin(newGstin);
                  }}
                  placeholder="e.g., 24AAQCS2345D1Z5"
                  maxLength={15}
                  className={errors.gstin || gstinWarning ? 'border-destructive' : ''}
                />
                {isCheckingGstin && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
              {errors.gstin && <p className="text-sm text-destructive">{errors.gstin}</p>}
              {gstinWarning && (
                <Alert variant="destructive" className="py-2">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription className="text-sm">
                    {gstinWarning}
                  </AlertDescription>
                </Alert>
              )}
            </div>

            {/* Client Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Client Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Enter client name"
                className={errors.name ? 'border-destructive' : ''}
              />
              {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
            </div>

            {/* Registration Date - Optional */}
            <div className="space-y-2">
              <Label htmlFor="registrationDate">Registration Date</Label>
              <Input
                id="registrationDate"
                type="date"
                value={formData.registrationDate}
                onChange={(e) => setFormData(prev => ({ ...prev, registrationDate: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Optional. If blank, today's date will be used for filing start month.
              </p>
            </div>

            {/* Registration Type */}
            <div className="space-y-2">
              <Label>Registration Type *</Label>
              <Select
                value={formData.registrationType}
                onValueChange={(value) => handleRegistrationTypeChange(value as RegistrationType)}
              >
                <SelectTrigger className={errors.registrationType ? 'border-destructive' : ''}>
                  <SelectValue placeholder="Select registration type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Regular">Regular</SelectItem>
                  <SelectItem value="Composition">Composition</SelectItem>
                  <SelectItem value="Tax Deductor">Tax Deductor</SelectItem>
                  <SelectItem value="ISD">ISD (Input Service Distributor)</SelectItem>
                  <SelectItem value="IFF">IFF (Invoice Furnishing Facility)</SelectItem>
                </SelectContent>
              </Select>
              {errors.registrationType && <p className="text-sm text-destructive">{errors.registrationType}</p>}
            </div>

            {/* Builder/Normal Sub-Type for Regular Registration */}
            {formData.registrationType === 'Regular' && (
              <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
                <div className="space-y-2">
                  <Label>Regular Type *</Label>
                  <div className="flex gap-4">
                    <div
                      className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                        formData.regularSubType === 'Builder' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setFormData(prev => ({
                        ...prev,
                        regularSubType: 'Builder',
                        builderItcType: '',
                        commercialArea: '',
                        residentialArea: ''
                      }))}
                    >
                      <Checkbox checked={formData.regularSubType === 'Builder'} onCheckedChange={() => setFormData(prev => ({
                        ...prev,
                        regularSubType: 'Builder',
                        builderItcType: '',
                        commercialArea: '',
                        residentialArea: ''
                      }))} />
                      <Label className="cursor-pointer font-normal">Builder</Label>
                    </div>
                    <div
                      className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                        formData.regularSubType === 'Normal' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                      }`}
                      onClick={() => setFormData(prev => ({
                        ...prev,
                        regularSubType: 'Normal',
                        builderItcType: '',
                        commercialArea: '',
                        residentialArea: ''
                      }))}
                    >
                      <Checkbox checked={formData.regularSubType === 'Normal'} onCheckedChange={() => setFormData(prev => ({
                        ...prev,
                        regularSubType: 'Normal',
                        builderItcType: '',
                        commercialArea: '',
                        residentialArea: ''
                      }))} />
                      <Label className="cursor-pointer font-normal">Normal</Label>
                    </div>
                  </div>
                  {errors.regularSubType && <p className="text-sm text-destructive">{errors.regularSubType}</p>}
                </div>

                {/* Builder ITC Type Options */}
                {formData.regularSubType === 'Builder' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>ITC Type *</Label>
                      <div className="flex gap-4 flex-wrap">
                        <div
                          className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                            formData.builderItcType === 'NO_ITC' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                          }`}
                          onClick={() => setFormData(prev => ({
                            ...prev,
                            builderItcType: 'NO_ITC',
                            commercialArea: '',
                            residentialArea: ''
                          }))}
                        >
                          <Checkbox checked={formData.builderItcType === 'NO_ITC'} onCheckedChange={() => setFormData(prev => ({
                            ...prev,
                            builderItcType: 'NO_ITC',
                            commercialArea: '',
                            residentialArea: ''
                          }))} />
                          <Label className="cursor-pointer font-normal">NO ITC</Label>
                        </div>
                        <div
                          className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                            formData.builderItcType === 'CLAIM_ITC' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                          }`}
                          onClick={() => setFormData(prev => ({
                            ...prev,
                            builderItcType: 'CLAIM_ITC',
                            commercialArea: '',
                            residentialArea: ''
                          }))}
                        >
                          <Checkbox checked={formData.builderItcType === 'CLAIM_ITC'} onCheckedChange={() => setFormData(prev => ({
                            ...prev,
                            builderItcType: 'CLAIM_ITC',
                            commercialArea: '',
                            residentialArea: ''
                          }))} />
                          <Label className="cursor-pointer font-normal">CLAIM ITC</Label>
                        </div>
                        <div
                          className={`flex items-center gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                            formData.builderItcType === 'PARTIAL_ITC' ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                          }`}
                          onClick={() => setFormData(prev => ({ ...prev, builderItcType: 'PARTIAL_ITC' }))}
                        >
                          <Checkbox checked={formData.builderItcType === 'PARTIAL_ITC'} onCheckedChange={() => setFormData(prev => ({ ...prev, builderItcType: 'PARTIAL_ITC' }))} />
                          <Label className="cursor-pointer font-normal">PARTIAL ITC</Label>
                        </div>
                      </div>
                      {errors.builderItcType && <p className="text-sm text-destructive">{errors.builderItcType}</p>}
                    </div>

                    {/* Commercial and Residential Area for Partial ITC */}
                    {formData.builderItcType === 'PARTIAL_ITC' && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-4">
                        <div className="space-y-2">
                          <Label htmlFor="commercialArea">Commercial Area *</Label>
                          <Input
                            id="commercialArea"
                            type="number"
                            step="0.01"
                            value={formData.commercialArea}
                            onChange={(e) => setFormData(prev => ({ ...prev, commercialArea: e.target.value }))}
                            placeholder="e.g., 7863.59"
                            className={`[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${errors.commercialArea ? 'border-destructive' : ''}`}
                          />
                          {errors.commercialArea && <p className="text-sm text-destructive">{errors.commercialArea}</p>}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="residentialArea">Residential Area *</Label>
                          <Input
                            id="residentialArea"
                            type="number"
                            step="0.01"
                            value={formData.residentialArea}
                            onChange={(e) => setFormData(prev => ({ ...prev, residentialArea: e.target.value }))}
                            placeholder="e.g., 18928.52"
                            className={`[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${errors.residentialArea ? 'border-destructive' : ''}`}
                          />
                          {errors.residentialArea && <p className="text-sm text-destructive">{errors.residentialArea}</p>}
                        </div>
                        <p className="text-xs text-muted-foreground md:col-span-2">
                          These values will appear in the ITC Summary for ineligible ITC calculation under Rule 38, 42 & 43.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Return Types - Conditional based on Registration Type */}
            {formData.registrationType && (
              <div className="space-y-3">
                <Label>Select Return Types *</Label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {availableReturns.map((returnType) => (
                    <div
                      key={returnType}
                      className="flex items-center space-x-2 p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        id={returnType}
                        checked={formData.selectedReturns.includes(returnType)}
                        onCheckedChange={() => handleReturnToggle(returnType)}
                      />
                      <Label
                        htmlFor={returnType}
                        className="cursor-pointer font-normal"
                      >
                        {returnType}
                      </Label>
                    </div>
                  ))}
                </div>
                {errors.returns && <p className="text-sm text-destructive">{errors.returns}</p>}
                <p className="text-xs text-muted-foreground">
                  {formData.registrationType === 'Regular' && 'Regular taxpayers can file GSTR-1, GSTR-3B, and ITC-04'}
                  {formData.registrationType === 'Composition' && 'Composition dealers file CMP-08 quarterly'}
                  {formData.registrationType === 'Tax Deductor' && 'Tax Deductors file GSTR-7 monthly'}
                  {formData.registrationType === 'ISD' && 'Input Service Distributors file GSTR-6 monthly'}
                  {formData.registrationType === 'IFF' && 'IFF: GSTR-1 (IFF) monthly, GSTR-3B (Q) quarterly (last month of quarter)'}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Target Date (GSTR-1, GSTR-7, GSTR-6) */}
              <div className="space-y-2">
                <Label htmlFor="defaultTargetDate">Target Date (GSTR-1, GSTR-7, GSTR-6)</Label>
                <Input
                  id="defaultTargetDate"
                  type="number"
                  min="1"
                  max="30"
                  value={formData.defaultTargetDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setFormData(prev => ({ ...prev, defaultTargetDate: '' }));
                    } else {
                      const num = parseInt(val) || 1;
                      const clamped = Math.min(30, Math.max(1, num));
                      setFormData(prev => ({ ...prev, defaultTargetDate: clamped.toString() }));
                    }
                  }}
                  placeholder="e.g., 11"
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <p className="text-xs text-muted-foreground">Day 1-30 for GSTR-1, GSTR-7 & GSTR-6</p>
              </div>

              {/* Target Date (GSTR-3B, ITC-04, CMP-08) */}
              <div className="space-y-2">
                <Label htmlFor="otherTargetDate">Target Date (GSTR-3B, ITC-04, CMP-08)</Label>
                <Input
                  id="otherTargetDate"
                  type="number"
                  min="1"
                  max="30"
                  value={formData.otherTargetDate}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setFormData(prev => ({ ...prev, otherTargetDate: '' }));
                    } else {
                      const num = parseInt(val) || 1;
                      const clamped = Math.min(30, Math.max(1, num));
                      setFormData(prev => ({ ...prev, otherTargetDate: clamped.toString() }));
                    }
                  }}
                  placeholder="e.g., 20"
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <p className="text-xs text-muted-foreground">Day 1-30 for GSTR-3B, ITC-04 & CMP-08</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Assigned Accountant */}
              <div className="space-y-2">
                <Label htmlFor="assignedAccountant">Assigned Accountant *</Label>
                <Input
                  id="assignedAccountant"
                  value={formData.assignedAccountant}
                  onChange={(e) => setFormData(prev => ({ ...prev, assignedAccountant: e.target.value }))}
                  placeholder="Accountant name"
                  className={errors.assignedAccountant ? 'border-destructive' : ''}
                />
                {errors.assignedAccountant && <p className="text-sm text-destructive">{errors.assignedAccountant}</p>}
              </div>

              {/* GSTR 10 Date (label only — the field id / state key
                  / DB column stays `cancellationDate` since user asked
                  for a UI-only change) */}
              <div className="space-y-2">
                <Label htmlFor="cancellationDate">GSTR 10 Date (Optional)</Label>
                <Input
                  id="cancellationDate"
                  type="date"
                  value={formData.cancellationDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, cancellationDate: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Optional. Filing stops after this date.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Cancellation Date — informational only, no downstream effect */}
              <div className="space-y-2">
                <Label htmlFor="registrationCancellationDate">Cancellation Date (Optional)</Label>
                <Input
                  id="registrationCancellationDate"
                  type="date"
                  value={formData.registrationCancellationDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, registrationCancellationDate: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">
                  Date on which the GST registration was cancelled. Informational only.
                </p>
              </div>

              {/* Inactive at hand — hides client from Filing Status. Uses a
                  native <label htmlFor> so clicking anywhere on the card
                  activates the Checkbox via HTML semantics — no custom
                  onClick that could race with Radix's button and end up
                  triggering the parent form's submit path. */}
              <div className="space-y-2">
                <Label>Inactive at hand</Label>
                <label
                  htmlFor="inactiveAtHand"
                  className={`flex items-start gap-2 p-3 border rounded-lg cursor-pointer transition-colors ${
                    formData.inactiveAtHand ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                  }`}
                >
                  <Checkbox
                    id="inactiveAtHand"
                    checked={formData.inactiveAtHand}
                    onCheckedChange={(v) => setFormData(prev => ({ ...prev, inactiveAtHand: v === true }))}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-sm font-normal block">Mark client as inactive at hand</span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      When ticked, this client will not appear in Filing Status. Untick to restore visibility.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Mobile */}
              <div className="space-y-2">
                <Label htmlFor="mobile">Mobile Number *</Label>
                <Input
                  id="mobile"
                  type="tel"
                  value={formData.mobile}
                  onChange={(e) => setFormData(prev => ({ ...prev, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                  placeholder="10-digit mobile number"
                  maxLength={10}
                  className={errors.mobile ? 'border-destructive' : ''}
                />
                {errors.mobile && <p className="text-sm text-destructive">{errors.mobile}</p>}
              </div>

              {/* Email */}
              <div className="space-y-2">
                <Label htmlFor="email">Email Address *</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="client@example.com"
                  className={errors.email ? 'border-destructive' : ''}
                />
                {errors.email && <p className="text-sm text-destructive">{errors.email}</p>}
              </div>
            </div>

            {/* GST Portal Credentials */}
            <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
              <div>
                <h4 className="font-medium text-sm">GST Portal Credentials</h4>
                <p className="text-xs text-muted-foreground">Optional. Enter the client's GST portal login details.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="gstUserId">GST User ID</Label>
                  <Input
                    id="gstUserId"
                    value={formData.gstUserId}
                    onChange={(e) => setFormData(prev => ({ ...prev, gstUserId: e.target.value }))}
                    placeholder="Enter GST portal User ID"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="gstPassword">GST Password</Label>
                  <div className="relative">
                    <Input
                      id="gstPassword"
                      type={showGstPassword ? 'text' : 'password'}
                      value={formData.gstPassword}
                      onChange={(e) => setFormData(prev => ({ ...prev, gstPassword: e.target.value }))}
                      placeholder="Enter GST portal Password"
                      className="pr-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                      onClick={() => setShowGstPassword(!showGstPassword)}
                    >
                      {showGstPassword ? <EyeOff className="h-4 w-4 text-muted-foreground" /> : <Eye className="h-4 w-4 text-muted-foreground" />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Client Login Credentials */}
            {formData.gstin.length === 15 && (
              <ClientCredentialsSection
                gstin={formData.gstin}
                onCredentialsGenerated={handleCredentialsGenerated}
              />
            )}

            {/* Submit Buttons */}
            <div className="flex gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button type="submit" className="flex items-center gap-2" disabled={isSaving}>
                <Save className="h-4 w-4" />
                {isSaving ? 'Adding...' : 'Add Client'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default AddClientPage;
