-- Phase 0.4: Add close_reason column for tracking why a notice was closed
-- (manual staff close, auto-close from portal closure, LUT deemed approval, etc.)
ALTER TABLE gst_notices ADD COLUMN IF NOT EXISTS close_reason text;

COMMENT ON COLUMN gst_notices.close_reason IS
  'Why this notice was closed: staff-entered reason on manual close, or auto-populated tag (auto:closure, auto:lut_approval, auto:refund_order) on auto-close.';
