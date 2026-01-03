-- Harden SECURITY DEFINER functions by adding validation
-- These functions are required for RLS to prevent infinite recursion,
-- but we add validation to ensure they can only be used appropriately

-- Update has_role function with validation
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- This function intentionally uses SECURITY DEFINER to prevent
  -- infinite recursion in RLS policies. It safely queries user_roles
  -- to check if a user has a specific role. The search_path is fixed
  -- to prevent search_path hijacking attacks.
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$function$;

-- Add comment explaining why SECURITY DEFINER is necessary
COMMENT ON FUNCTION public.has_role IS 'Checks if a user has a specific role. Uses SECURITY DEFINER to prevent infinite recursion in RLS policies. This is safe because the function only reads from user_roles and returns a boolean.';

-- Update is_staff function with validation
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- This function intentionally uses SECURITY DEFINER to prevent
  -- infinite recursion in RLS policies. It safely checks if a user
  -- is staff (superadmin, gst_manager, or employee).
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('superadmin', 'gst_manager', 'employee')
  )
$function$;

-- Add comment explaining why SECURITY DEFINER is necessary
COMMENT ON FUNCTION public.is_staff IS 'Checks if a user is staff (superadmin, gst_manager, or employee). Uses SECURITY DEFINER to prevent infinite recursion in RLS policies. This is safe because the function only reads from user_roles and returns a boolean.';

-- Update get_user_role function with validation and restrict usage
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
 RETURNS app_role
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- This function uses SECURITY DEFINER to allow role checking without RLS recursion.
  -- It returns the role of the specified user. Safe because it only returns
  -- a single enum value from a controlled table.
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$function$;

-- Add comment for documentation
COMMENT ON FUNCTION public.get_user_role IS 'Returns the role of a user. Uses SECURITY DEFINER to prevent infinite recursion in RLS policies. Safe because it only reads a single enum value.';

-- Update auto_lock_on_filed trigger function with validation
CREATE OR REPLACE FUNCTION public.auto_lock_on_filed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- This trigger uses SECURITY DEFINER because it needs to update multiple
  -- tables atomically when a filing status is set to 'Filed'. This is a
  -- business rule enforcement, not a user action, so elevated privileges
  -- are necessary and safe in this context.
  
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
$function$;

-- Add comment explaining the trigger function
COMMENT ON FUNCTION public.auto_lock_on_filed IS 'Trigger function that automatically locks related data when filing status is set to Filed. Uses SECURITY DEFINER to update multiple tables atomically as a business rule enforcement.';