import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Save } from 'lucide-react';
import { toast } from 'sonner';
import { RegistrationType, ReturnType, RETURN_TYPES_BY_REGISTRATION } from '@/types';
import { supabase } from '@/integrations/supabase/client';

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
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

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
    targetDate: 11,
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

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

      setFormData({
        gstin: data.gstin,
        name: data.name,
        registrationType: data.registration_type as RegistrationType,
        registrationDate: data.registration_date,
        mobile: data.mobile || '',
        email: data.email || '',
        assignedAccountant: data.assigned_accountant || '',
        selectedReturns: (data.selected_returns || []) as ReturnType[],
        cancellationDate: (data as any).cancellation_date || '',
        targetDate: 11,
      });
      setIsLoading(false);
    };

    fetchClient();
  }, [clientId, navigate]);

  // Get available returns based on registration type
  const availableReturns = useMemo(() => {
    if (!formData.registrationType) return [];
    return RETURN_TYPES_BY_REGISTRATION[formData.registrationType as RegistrationType] || [];
  }, [formData.registrationType]);

  // Reset selected returns when registration type changes
  const handleRegistrationTypeChange = (value: RegistrationType) => {
    const newAvailableReturns = RETURN_TYPES_BY_REGISTRATION[value] || [];
    setFormData(prev => ({
      ...prev,
      registrationType: value,
      selectedReturns: prev.selectedReturns.filter(r => newAvailableReturns.includes(r)),
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
    } else if (!validateGSTIN(formData.gstin)) {
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

    // Validate cancellation date
    if (formData.cancellationDate && formData.registrationDate) {
      if (new Date(formData.cancellationDate) < new Date(formData.registrationDate)) {
        newErrors.cancellationDate = 'Cancellation date cannot be before registration date';
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

    setIsSaving(true);

    try {
      const { error } = await supabase
        .from('clients')
        .update({
          gstin: formData.gstin,
          name: formData.name,
          registration_type: formData.registrationType as 'Regular' | 'Composition' | 'Tax Deductor',
          registration_date: formData.registrationDate,
          mobile: formData.mobile || null,
          email: formData.email || null,
          assigned_accountant: formData.assignedAccountant || null,
          selected_returns: formData.selectedReturns,
        })
        .eq('id', clientId);

      if (error) throw error;

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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

              {/* Cancellation Date */}
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
                </SelectContent>
              </Select>
              {errors.registrationType && <p className="text-sm text-destructive">{errors.registrationType}</p>}
            </div>

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
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Target Date */}
              <div className="space-y-2">
                <Label htmlFor="targetDate">Default Target Date</Label>
                <Input
                  id="targetDate"
                  type="number"
                  min="1"
                  max="31"
                  value={formData.targetDate}
                  onChange={(e) => setFormData(prev => ({ ...prev, targetDate: parseInt(e.target.value) || 11 }))}
                  className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <p className="text-xs text-muted-foreground">Day of month for filing target</p>
              </div>

              {/* Assigned Accountant */}
              <div className="space-y-2">
                <Label htmlFor="assignedAccountant">Assigned Accountant</Label>
                <Input
                  id="assignedAccountant"
                  value={formData.assignedAccountant}
                  onChange={(e) => setFormData(prev => ({ ...prev, assignedAccountant: e.target.value }))}
                  placeholder="Accountant name"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Mobile */}
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

              {/* Email */}
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
    </div>
  );
};

export default EditClientPage;
