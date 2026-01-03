-- Create app_role enum
CREATE TYPE public.app_role AS ENUM ('superadmin', 'gst_manager', 'employee', 'client');

-- Create registration_type enum
CREATE TYPE public.registration_type AS ENUM ('Regular', 'Composition', 'Tax Deductor');

-- Create filing_status_type enum
CREATE TYPE public.filing_status_type AS ENUM ('Prepared', 'Data Pending', 'Mismatch in Data', 'Not Verified', 'Filed');

-- Create return_type enum
CREATE TYPE public.return_type AS ENUM ('GSTR-1', 'GSTR-3B', 'ITC-04', 'GSTR-6', 'GSTR-7', 'CMP-08');

-- User roles table (separate from profile for security)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'employee',
  is_first_login BOOLEAN DEFAULT TRUE,
  UNIQUE (user_id, role)
);

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Clients table
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gstin TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  registration_type registration_type NOT NULL DEFAULT 'Regular',
  registration_date DATE NOT NULL,
  mobile TEXT,
  email TEXT,
  selected_returns return_type[] DEFAULT '{}',
  assigned_accountant TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2B Running Sheet - Bills Not in 2B
CREATE TABLE public.bills_not_in_2b (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  supplier_name TEXT NOT NULL,
  supplier_invoice_number TEXT,
  supplier_gstin TEXT,
  taxable_value DECIMAL(15,2) DEFAULT 0,
  input_igst DECIMAL(15,2) DEFAULT 0,
  input_cgst DECIMAL(15,2) DEFAULT 0,
  input_sgst DECIMAL(15,2) DEFAULT 0,
  reversal_month TEXT,
  reclaim_month TEXT,
  period_month TEXT NOT NULL,
  is_locked BOOLEAN DEFAULT FALSE,
  is_carried_forward BOOLEAN DEFAULT FALSE,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  version INTEGER DEFAULT 1
);

-- 2B Running Sheet - Bills Not in Books
CREATE TABLE public.bills_not_in_books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  supplier_name TEXT NOT NULL,
  supplier_invoice_number TEXT,
  supplier_gstin TEXT,
  taxable_value DECIMAL(15,2) DEFAULT 0,
  input_igst DECIMAL(15,2) DEFAULT 0,
  input_cgst DECIMAL(15,2) DEFAULT 0,
  input_sgst DECIMAL(15,2) DEFAULT 0,
  book_entry_month TEXT,
  bill_in_2b_month TEXT,
  period_month TEXT NOT NULL,
  is_locked BOOLEAN DEFAULT FALSE,
  is_carried_forward BOOLEAN DEFAULT FALSE,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  version INTEGER DEFAULT 1
);

-- 2B Version History
CREATE TABLE public.twob_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  period_month TEXT NOT NULL,
  table_type TEXT NOT NULL,
  version_number INTEGER DEFAULT 1,
  version_data JSONB,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_current BOOLEAN DEFAULT TRUE
);

-- ITC Summary
CREATE TABLE public.itc_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  period_month TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  is_locked BOOLEAN DEFAULT FALSE,
  edit_history JSONB DEFAULT '[]',
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, period_month)
);

-- Filing Status
CREATE TABLE public.filing_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  return_type return_type NOT NULL,
  period_month TEXT NOT NULL,
  status filing_status_type DEFAULT 'Prepared',
  target_date INTEGER DEFAULT 11,
  filed_date DATE,
  remarks TEXT,
  is_locked BOOLEAN DEFAULT FALSE,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(client_id, return_type, period_month)
);

-- Enable RLS on all tables
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills_not_in_2b ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bills_not_in_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.twob_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itc_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.filing_status ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Function to check if user is staff
CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('superadmin', 'gst_manager', 'employee')
  )
$$;

-- Function to get user role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- RLS Policies for user_roles
CREATE POLICY "Users can view their own role"
ON public.user_roles FOR SELECT
USING (auth.uid() = user_id OR public.is_staff(auth.uid()));

-- RLS Policies for profiles
CREATE POLICY "Users can view all profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Staff can insert profiles"
ON public.profiles FOR INSERT
WITH CHECK (public.is_staff(auth.uid()));

-- RLS Policies for clients
CREATE POLICY "Staff can view all clients"
ON public.clients FOR SELECT
USING (public.is_staff(auth.uid()));

CREATE POLICY "Clients can view their own client record"
ON public.clients FOR SELECT
USING (
  gstin LIKE '%' || UPPER(SUBSTRING((SELECT first_name FROM public.profiles WHERE user_id = auth.uid()), 1, 10)) || '%'
);

CREATE POLICY "Staff can insert clients"
ON public.clients FOR INSERT
WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Staff can update clients"
ON public.clients FOR UPDATE
USING (public.is_staff(auth.uid()));

CREATE POLICY "Staff can delete clients"
ON public.clients FOR DELETE
USING (public.is_staff(auth.uid()));

-- RLS Policies for 2B tables
CREATE POLICY "Staff can view all 2B data"
ON public.bills_not_in_2b FOR SELECT
USING (public.is_staff(auth.uid()));

CREATE POLICY "Staff can manage 2B data"
ON public.bills_not_in_2b FOR ALL
USING (public.is_staff(auth.uid()));

CREATE POLICY "Staff can view all books data"
ON public.bills_not_in_books FOR SELECT
USING (public.is_staff(auth.uid()));

CREATE POLICY "Staff can manage books data"
ON public.bills_not_in_books FOR ALL
USING (public.is_staff(auth.uid()));

-- RLS Policies for versions
CREATE POLICY "Managers can view versions"
ON public.twob_versions FOR SELECT
USING (
  public.has_role(auth.uid(), 'superadmin') OR
  public.has_role(auth.uid(), 'gst_manager')
);

CREATE POLICY "Staff can insert versions"
ON public.twob_versions FOR INSERT
WITH CHECK (public.is_staff(auth.uid()));

-- RLS Policies for ITC
CREATE POLICY "Staff can view ITC"
ON public.itc_summaries FOR SELECT
USING (public.is_staff(auth.uid()));

CREATE POLICY "Staff can manage ITC"
ON public.itc_summaries FOR ALL
USING (public.is_staff(auth.uid()));

-- RLS Policies for filing status
CREATE POLICY "Staff can view all filing status"
ON public.filing_status FOR SELECT
USING (public.is_staff(auth.uid()));

CREATE POLICY "Staff can manage filing status"
ON public.filing_status FOR ALL
USING (public.is_staff(auth.uid()));

-- Enable realtime for all tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.clients;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bills_not_in_2b;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bills_not_in_books;
ALTER PUBLICATION supabase_realtime ADD TABLE public.twob_versions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.itc_summaries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.filing_status;

-- Trigger to auto-lock when filed
CREATE OR REPLACE FUNCTION public.auto_lock_on_filed()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'Filed' AND (OLD.status IS NULL OR OLD.status != 'Filed') THEN
    NEW.is_locked := TRUE;
    NEW.filed_date := COALESCE(NEW.filed_date, CURRENT_DATE);
    
    -- Lock 2B data for this client and month
    UPDATE public.bills_not_in_2b
    SET is_locked = TRUE
    WHERE client_id = NEW.client_id AND period_month = NEW.period_month;
    
    UPDATE public.bills_not_in_books
    SET is_locked = TRUE
    WHERE client_id = NEW.client_id AND period_month = NEW.period_month;
    
    -- Lock ITC Summary
    UPDATE public.itc_summaries
    SET is_locked = TRUE
    WHERE client_id = NEW.client_id AND period_month = NEW.period_month;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trigger_auto_lock_on_filed
BEFORE UPDATE ON public.filing_status
FOR EACH ROW
EXECUTE FUNCTION public.auto_lock_on_filed();

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bills_not_in_2b_updated_at BEFORE UPDATE ON public.bills_not_in_2b FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bills_not_in_books_updated_at BEFORE UPDATE ON public.bills_not_in_books FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_itc_summaries_updated_at BEFORE UPDATE ON public.itc_summaries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_filing_status_updated_at BEFORE UPDATE ON public.filing_status FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();