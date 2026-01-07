-- Drop and recreate the trigger function to ONLY lock when GSTR-3B is filed
CREATE OR REPLACE FUNCTION public.auto_lock_on_filed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only set filed_date when status changes to Filed
  IF NEW.status = 'Filed' AND (OLD.status IS NULL OR OLD.status != 'Filed') THEN
    NEW.filed_date := COALESCE(NEW.filed_date, CURRENT_DATE);
    
    -- ONLY lock 2B and ITC data when GSTR-3B is filed
    IF NEW.return_type = 'GSTR-3B' THEN
      NEW.is_locked := TRUE;
      
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
  END IF;
  
  RETURN NEW;
END;
$function$;