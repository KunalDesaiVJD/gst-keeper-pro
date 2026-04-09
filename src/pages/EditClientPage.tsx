import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { ArrowLeft, Save, Eye, EyeOff, AlertTriangle, History } from 'lucide-react';
import { toast } from 'sonner';
import { RegistrationType, ReturnType, RETURN_TYPES_BY_REGISTRATION } from '@/types';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fetchSchemeHistory, SchemeHistoryEntry } from '@/utils/schemeResolver';
import { format } from 'date-fns';

interface ClientData {
  id: string;
  gstin: string;
  name: string;
  registration_type: RegistrationType;
  registration_date: string;
  mobile: string | null;
  email: string | null;
  assigned_accountant: string | null;
  selected_returns: ReturnType[] | null;
  cancellation_date?: string | null;
}

const EditClientPage: React.FC = () => {
  const navigate = useNavigate();
  const { clientId } = useParams<{ clientId: string }>();
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showGstPassword, setShowGstPassword] = useState(false);

  // Original registration type loaded from DB
  const originalRegType = useRef<RegistrationType | ''>('');

  const [formData, setFormData] = useState({
    gstin: '',
    name: '',
    registrationType: '' as RegistrationType | '',
    registrationDate: '',
    mobile: '',
    email: '',
    assignedAccountant: '',
    selectedReturns: [] as ReturnType[],
    cancellationDate: '',
    defaultTargetDate: '',
    otherTargetDate: '',
    gstUserId: '',
    gstPassword: '',
    regularSubType: '' as '' | 'Builder' | 'Normal',
    builderItcType: '' as '' | 'NO_ITC' | 'CLAIM_ITC' | 'PARTIAL_ITC',
    commercialArea: '',
    residentialArea: '',
  });

  // Scheme transition state
  const [effectiveFromDate, setEffectiveFromDate] = useState('');
  const [schemeChangeNotes, setSchemeChangeNotes] = useState('');
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [schemeHistory, setSchemeHistory] = useState<SchemeHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});

  const schemeChanged = formData.registrationType !== '' && originalRegType.current !== '' && formData.registrationType !== originalRegType.current;

  // Fetch client data
  useEffect(() => {
    const fetchClient = async () => {
      if (!clientId) return;

      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();

      if (error || !data) {
        toast.error('Client not found');
        navigate('/clients');
        return;
      }

      const defaultTarget = (data as any).target_date_group1?.toString() || '';
      const otherTarget = (data as any).target_date_group2?.toString() || '';

      const regType = data.registration_type as RegistrationType;
      originalRegType.current = regType;

      setFormData({
        gstin: data.gstin,
        name: data.name,
        registrationType: regType,
        registrationDate: data.registration_date,
        mobile: data.mobile || '',
        email: data.email || '',
        assignedAccountant: data.assigned_accountant || '',
        selectedReturns: (data.selected_returns || []) as ReturnType[],
        cancellationDate: (data as any).cancellation_date || '',
        defaultTargetDate: defaultTarget,
        otherTargetDate: otherTarget,
        gstUserId: (data as any).gst_user_id || '',
        gstPassword: (data as any).gst_password || '',
        regularSubType: (data as any).regular_sub_type || '',
        builderItcType: (data as any).builder_itc_type || '',
        commercialArea: (data as any).commercial_area?.toString() || '',
        residentialArea: (data as any).residential_area?.toString() || '',
      });

      // Load scheme history
      const history = await fetchSchemeHistory(clientId);
      setSchemeHistory(history);

      setIsLoading(false);
    };

    fetchClient();
  }, [clientId, navigate]);

  const availableReturns = useMemo(() => {
    if (!formData.registrationType) return [];
    return RETURN_TYPES_BY_REGISTRATION[formData.registrationType as RegistrationType] || [];
  }, [formData.registrationType]);

  const handleRegistrationTypeChange = (value: RegistrationType) => {
    const newAvailableReturns = RETURN_TYPES_BY_REGISTRATION[value] || [];
    setFormData(prev => ({
      ...prev,
      registrationType: value,
      selectedReturns: prev.selectedReturns.filter(r => newAvailableReturns.includes(r)),
      regularSubType: value === 'Regular' ? prev.regularSubType : '',
      builderItcType: value === 'Regular' ? prev.builderItcType : '',
      commercialArea: value === 'Regular' ? prev.commercialArea : '',
      residentialArea: value === 'Regular' ? prev.residentialArea : '',
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
      newErrors.gstin = 'Invalid GSTIN format';
    }

    if (!formData.name.trim()) {
      newErrors.name = 'Client name is required';
    }

    if (!formData.registrationType) {
      newErrors.registrationType = 'Registration type is required';
    }

    if (!formData.registrationDate) {
      newErrors.registrationDate = 'Registration date is required';
    }

    if (formData.mobile && !/^[0-9]{10}$/.test(formData.mobile)) {
      newErrors.mobile = 'Mobile must be 10 digits';
    }

    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Invalid email format';
    }

    if (formData.selectedReturns.length === 0) {
      newErrors.returns = 'Select at least one return type';
    }

    if (formData.cancellationDate && formData.registrationDate) {
      if (new Date(formData.cancellationDate) < new Date(formData.registrationDate)) {
        newErrors.cancellationDate = 'Cancellation date cannot be before registration date';
      }
    }

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

    // Validate effective from date when scheme changed
    if (schemeChanged) {
      if (!effectiveFromDate) {
        newErrors.effectiveFromDate = 'Effective From Date is required when changing scheme';
      } else if (formData.registrationDate && new Date(effectiveFromDate) < new Date(formData.registrationDate)) {
        newErrors.effectiveFromDate = 'Effective From Date cannot be before registration date';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      toast.error('Please fix the errors in the form.');
      return;
    }

    // If scheme changed, show confirmation dialog first
    if (schemeChanged) {
      setShowConfirmDialog(true);
      return;
    }

    await performSave();
  };

  const performSave = async () => {
    setIsSaving(true);
    setShowConfirmDialog(false);

    try {
      const defaultTarget = formData.defaultTargetDate ? parseInt(formData.defaultTargetDate) : null;
      const otherTarget = formData.otherTargetDate ? parseInt(formData.otherTargetDate) : null;

      // If scheme changed, record it in history
      if (schemeChanged && effectiveFromDate) {
        const { error: historyError } = await supabase
          .from('client_scheme_history')
          .insert({
            client_id: clientId,
            old_scheme: originalRegType.current,
            new_scheme: formData.registrationType,
            effective_from_date: effectiveFromDate,
            changed_by: user?.id || null,
            notes: schemeChangeNotes || null,
          });

        if (historyError) {
          console.error('Error saving scheme history:', historyError);
          toast.error('Failed to record scheme change history');
          setIsSaving(false);
          return;
        }
      }

      const { error } = await supabase
        .from('clients')
        .update({
          gstin: formData.gstin,
          name: formData.name,
          registration_type: formData.registrationType as 'Regular' | 'Composition' | 'Tax Deductor' | 'ISD',
          registration_date: formData.registrationDate,
          mobile: formData.mobile || null,
          email: formData.email || null,
          assigned_accountant: formData.assignedAccountant || null,
          selected_returns: formData.selectedReturns,
          cancellation_date: formData.cancellationDate || null,
          gst_user_id: formData.gstUserId || null,
          gst_password: formData.gstPassword || null,
          regular_sub_type: formData.registrationType === 'Regular' ? formData.regularSubType : null,
          builder_itc_type: formData.regularSubType === 'Builder' ? formData.builderItcType : null,
          commercial_area: formData.builderItcType === 'PARTIAL_ITC' ? parseFloat(formData.commercialArea) || 0 : 0,
          residential_area: formData.builderItcType === 'PARTIAL_ITC' ? parseFloat(formData.residentialArea) || 0 : 0,
          target_date_group1: defaultTarget,
          target_date_group2: otherTarget,
        })
        .eq('id', clientId);

      if (error) throw error;

      // Update filing_status target dates
      if (defaultTarget !== null) {
        await supabase
          .from('filing_status')
          .update({ target_date: defaultTarget })
          .eq('client_id', clientId!)
          .in('return_type', ['GSTR-1', 'GSTR-1 (IFF)', 'GSTR-7', 'GSTR-6']);
      }

      if (otherTarget !== null) {
        await supabase
          .from('filing_status')
          .update({ target_date: otherTarget })
          .eq('client_id', clientId!)
          .in('return_type', ['GSTR-3B', 'GSTR-3B (Q)', 'ITC-04', 'CMP-08']);
      }

      toast.success(`${formData.name} has been successfully updated.`);
      navigate('/clients');
    } catch (error: any) {
      console.error('Error updating client:', error);
      toast.error('Failed to update client: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Loading client data...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Edit Client</h1>
          <p className="text-muted-foreground">Update client details</p>
        </div>
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
              <Input
                id="gstin"
                value={formData.gstin}
                onChange={(e) => setFormData(prev => ({ ...prev, gstin: e.target.value.toUpperCase() }))}
                placeholder="e.g., 24AAQCS2345D1Z5"
                maxLength={15}
                className={errors.gstin ? 'border-destructive' : ''}
              />
              {errors.gstin && <p className="text-sm text-destructive">{errors.gstin}</p>}
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

            {/* Registration Date */}
            <div className="space-y-2">
              <Label htmlFor="registrationDate">Registration Date *</Label>
              <Input
                id="registrationDate"
                type="date"
                value={formData.registrationDate}
                onChange={(e) => setFormData(prev => ({ ...prev, registrationDate: e.target.value }))}
                className={errors.registrationDate ? 'border-destructive' : ''}
              />
              {errors.registrationDate && <p className="text-sm text-destructive">{errors.registrationDate}</p>}
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

            {/* Scheme Change Section - shown only when registration type changes */}
            {schemeChanged && (
              <div className="border-2 border-amber-400 rounded-lg p-4 space-y-4 bg-amber-50 dark:bg-amber-950/20">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-5 w-5" />
                  <h4 className="font-semibold">Scheme Change Detected</h4>
                </div>
                <p className="text-sm text-muted-foreground">
                  You are changing the registration type from <strong>{originalRegType.current}</strong> to <strong>{formData.registrationType}</strong>. 
                  Please specify an Effective From Date. Previous periods will stay under the old scheme. The new scheme will apply from this date onward.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="effectiveFromDate">Effective From Date *</Label>
                  <Input
                    id="effectiveFromDate"
                    type="date"
                    value={effectiveFromDate}
                    onChange={(e) => setEffectiveFromDate(e.target.value)}
                    min={formData.registrationDate || undefined}
                    className={errors.effectiveFromDate ? 'border-destructive' : ''}
                  />
                  {errors.effectiveFromDate && <p className="text-sm text-destructive">{errors.effectiveFromDate}</p>}
                  <p className="text-xs text-muted-foreground">
                    Old scheme will apply to periods before this date. New scheme will apply from this date onward.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="schemeChangeNotes">Notes (Optional)</Label>
                  <Input
                    id="schemeChangeNotes"
                    value={schemeChangeNotes}
                    onChange={(e) => setSchemeChangeNotes(e.target.value)}
                    placeholder="Reason for scheme change..."
                  />
                </div>
              </div>
            )}

            {/* Scheme History Toggle */}
            {schemeHistory.length > 0 && (
              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex items-center gap-2"
                  onClick={() => setShowHistory(!showHistory)}
                >
                  <History className="h-4 w-4" />
                  {showHistory ? 'Hide' : 'Show'} Scheme History ({schemeHistory.length})
                </Button>
                {showHistory && (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="px-3 py-2 text-left">Date</th>
                          <th className="px-3 py-2 text-left">Old Scheme</th>
                          <th className="px-3 py-2 text-left">New Scheme</th>
                          <th className="px-3 py-2 text-left">Effective From</th>
                          <th className="px-3 py-2 text-left">Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schemeHistory.map((h) => (
                          <tr key={h.id} className="border-t">
                            <td className="px-3 py-2">{format(new Date(h.changed_at), 'dd-MM-yyyy')}</td>
                            <td className="px-3 py-2">{h.old_scheme}</td>
                            <td className="px-3 py-2">{h.new_scheme}</td>
                            <td className="px-3 py-2">{format(new Date(h.effective_from_date), 'dd-MM-yyyy')}</td>
                            <td className="px-3 py-2 text-muted-foreground">{h.notes || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

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

            {/* Return Types */}
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
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
              <div className="space-y-2">
                <Label htmlFor="assignedAccountant">Assigned Accountant</Label>
                <Input
                  id="assignedAccountant"
                  value={formData.assignedAccountant}
                  onChange={(e) => setFormData(prev => ({ ...prev, assignedAccountant: e.target.value }))}
                  placeholder="Accountant name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cancellationDate">Cancellation Date (Optional)</Label>
                <Input
                  id="cancellationDate"
                  type="date"
                  value={formData.cancellationDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, cancellationDate: e.target.value }))}
                  className={errors.cancellationDate ? 'border-destructive' : ''}
                />
                {errors.cancellationDate && <p className="text-sm text-destructive">{errors.cancellationDate}</p>}
                <p className="text-xs text-muted-foreground">
                  If set, client will not appear in Filing Status after this date
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="mobile">Mobile Number</Label>
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

              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
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

            {/* Submit Buttons */}
            <div className="flex gap-3 pt-4">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button type="submit" className="flex items-center gap-2" disabled={isSaving}>
                <Save className="h-4 w-4" />
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Scheme Change Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Scheme Change</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>You are about to change the registration scheme for <strong>{formData.name}</strong>. Please review the details below:</p>
                <div className="bg-muted rounded-lg p-4 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Old Scheme:</span>
                    <span className="font-medium">{originalRegType.current}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">New Scheme:</span>
                    <span className="font-medium">{formData.registrationType}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Effective From:</span>
                    <span className="font-medium">{effectiveFromDate ? format(new Date(effectiveFromDate), 'dd-MM-yyyy') : '-'}</span>
                  </div>
                  {schemeChangeNotes && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Notes:</span>
                      <span className="font-medium">{schemeChangeNotes}</span>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Filing periods before the effective date will remain under <strong>{originalRegType.current}</strong>. 
                  Periods from the effective date onward will follow <strong>{formData.registrationType}</strong>. 
                  Past filed returns will not be affected.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performSave}>
              Confirm & Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default EditClientPage;
