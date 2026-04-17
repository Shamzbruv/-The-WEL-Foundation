-- Submission Portal Phase 1 Schema Extensions (Idempotent / SQL Editor Safe)
-- Addresses the approved Implementation Plan (Applies workflow fields, SLAs, and new RLS models)

-- 1. Submissions Workflow Extensions
ALTER TABLE public.submissions
ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sla_breached_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS last_action_at TIMESTAMPTZ;

-- 2. Submission Files Validation Extensions
-- Using safe DO $$ block since IF NOT EXISTS doesn't support CHECK constraints easily inline for some PG versions
DO $$ 
BEGIN
    BEGIN
        ALTER TABLE public.submission_files
        ADD COLUMN document_category TEXT,
        ADD COLUMN review_status TEXT CHECK (review_status IN ('Pending', 'Verified', 'Rejected', 'Needs Replacement')) DEFAULT 'Pending',
        ADD COLUMN required_for_step TEXT,
        ADD COLUMN uploaded_by_actor TEXT CHECK (uploaded_by_actor IN ('client', 'referral_partner', 'staff', 'system')),
        ADD COLUMN expires_at TIMESTAMPTZ,
        ADD COLUMN rejection_reason TEXT,
        ADD COLUMN verified_at TIMESTAMPTZ,
        ADD COLUMN verified_by UUID REFERENCES profiles(id),
        ADD COLUMN review_due_at TIMESTAMPTZ,
        ADD COLUMN review_sla_breached_at TIMESTAMPTZ;
    EXCEPTION
        WHEN duplicate_column THEN null;
    END;
END $$;

-- 3. Notifications Table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Activity Log Table
CREATE TABLE IF NOT EXISTS public.activity_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- 5. Role Helper Functions
CREATE OR REPLACE FUNCTION get_user_role(target_user_id UUID) RETURNS TEXT AS $$
  DECLARE
    role_name TEXT;
  BEGIN
    SELECT role INTO role_name FROM user_roles WHERE user_id = target_user_id;
    RETURN role_name;
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_admin() RETURNS BOOLEAN AS $$
  BEGIN
    RETURN get_user_role(auth.uid()) = 'admin';
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_intake_coordinator() RETURNS BOOLEAN AS $$
  BEGIN
    RETURN get_user_role(auth.uid()) = 'intake_coordinator';
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_general_staff() RETURNS BOOLEAN AS $$
  BEGIN
    RETURN get_user_role(auth.uid()) = 'staff';
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Replace Submission Policies with stricter ones
DROP POLICY IF EXISTS "Staff can view submissions" ON submissions;
DROP POLICY IF EXISTS "Staff can update submissions" ON submissions;
DROP POLICY IF EXISTS "View Submissions" ON submissions;
DROP POLICY IF EXISTS "Update Submissions" ON submissions;

CREATE POLICY "View Submissions" ON submissions FOR SELECT TO authenticated
USING (
  is_admin() OR 
  is_intake_coordinator() OR 
  (is_general_staff() AND assigned_to = auth.uid())
);

CREATE POLICY "Update Submissions" ON submissions FOR UPDATE TO authenticated
USING (
  is_admin() OR 
  is_intake_coordinator() OR 
  (is_general_staff() AND assigned_to = auth.uid())
);

-- 7. Replace Submission Files Policies to cascade the assignment logic
DROP POLICY IF EXISTS "Staff can view submission files" ON submission_files;
DROP POLICY IF EXISTS "View Submission Files" ON submission_files;
DROP POLICY IF EXISTS "Update Submission Files" ON submission_files;

CREATE POLICY "View Submission Files" ON submission_files FOR SELECT TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM submissions s 
        WHERE s.id = submission_files.submission_id 
        AND (
            is_admin() OR 
            is_intake_coordinator() OR 
            (is_general_staff() AND s.assigned_to = auth.uid())
        )
    )
);

CREATE POLICY "Update Submission Files" ON submission_files FOR UPDATE TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM submissions s 
        WHERE s.id = submission_files.submission_id 
        AND (
            is_admin() OR 
            is_intake_coordinator() OR 
            (is_general_staff() AND s.assigned_to = auth.uid())
        )
    )
);

-- 8. Storage RLS Fix
DROP POLICY IF EXISTS "Staff can view private_uploads objects" ON storage.objects;
DROP POLICY IF EXISTS "View private_uploads securely" ON storage.objects;

CREATE POLICY "View private_uploads securely" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'private_uploads' AND 
  EXISTS (
        SELECT 1 FROM submission_files sf
        JOIN submissions s ON s.id = sf.submission_id
        WHERE sf.object_path = storage.objects.name
        AND (
            is_admin() OR 
            is_intake_coordinator() OR 
            (is_general_staff() AND s.assigned_to = auth.uid())
        )
    )
);

-- 9. Notification Policies
DROP POLICY IF EXISTS "View own notifications" ON notifications;
DROP POLICY IF EXISTS "Update own notifications" ON notifications;

CREATE POLICY "View own notifications" ON notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Update own notifications" ON notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- 10. Activity Log Policies
DROP POLICY IF EXISTS "View activity log" ON activity_log;
CREATE POLICY "View activity log" ON activity_log FOR SELECT TO authenticated USING (is_admin() OR is_intake_coordinator());

-- 11. Custom Business Day Logic
CREATE OR REPLACE FUNCTION add_business_days(start_date TIMESTAMPTZ, num_days INT)
RETURNS TIMESTAMPTZ AS $$
DECLARE
    end_date TIMESTAMPTZ := start_date;
    added_days INT := 0;
    is_weekend BOOLEAN;
BEGIN
    WHILE added_days < num_days LOOP
        end_date := end_date + INTERVAL '1 day';
        is_weekend := EXTRACT(ISODOW FROM end_date) IN (6, 7);
        IF NOT is_weekend THEN
            added_days := added_days + 1;
        END IF;
    END LOOP;
    RETURN end_date;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 12. Pre-Validation Triggers & Metadata maintenance
CREATE OR REPLACE FUNCTION maintain_file_review_metadata()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.review_due_at := add_business_days(NOW(), 3);
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.review_status IS DISTINCT FROM NEW.review_status THEN
        IF NEW.review_status = 'Verified' THEN
            NEW.verified_at := NOW();
            NEW.verified_by := auth.uid();
            NEW.rejection_reason := NULL;
        END IF;

        IF NEW.review_status IN ('Rejected', 'Needs Replacement') THEN
            IF NEW.rejection_reason IS NULL OR TRIM(NEW.rejection_reason) = '' THEN
                RAISE EXCEPTION 'rejection_reason is mandatory when rejecting a document.';
            END IF;
            NEW.verified_at := NULL;
            NEW.verified_by := NULL;
        END IF;
        
        IF NEW.review_status = 'Pending' AND OLD.review_status = 'Needs Replacement' THEN
            NEW.review_due_at := add_business_days(NOW(), 3);
            NEW.review_sla_breached_at := NULL;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_maintain_file_metadata ON submission_files;
CREATE TRIGGER trg_maintain_file_metadata
    BEFORE INSERT OR UPDATE ON submission_files
    FOR EACH ROW
    EXECUTE FUNCTION maintain_file_review_metadata();

-- 13. Submission last_action_at triggers
CREATE OR REPLACE FUNCTION update_submission_last_action()
RETURNS TRIGGER AS $$
BEGIN
    NEW.last_action_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_submissions_last_action ON submissions;
CREATE TRIGGER trg_update_submissions_last_action
    BEFORE UPDATE ON submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_submission_last_action();

CREATE OR REPLACE FUNCTION update_submission_last_action_from_file()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE submissions SET last_action_at = NOW() WHERE id = NEW.submission_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_submissions_last_action_from_file_update ON submission_files;
CREATE TRIGGER trg_update_submissions_last_action_from_file_update
    AFTER UPDATE ON submission_files
    FOR EACH ROW
    EXECUTE FUNCTION update_submission_last_action_from_file();

DROP TRIGGER IF EXISTS trg_update_submissions_last_action_from_file_insert ON submission_files;
CREATE TRIGGER trg_update_submissions_last_action_from_file_insert
    AFTER INSERT ON submission_files
    FOR EACH ROW
    EXECUTE FUNCTION update_submission_last_action_from_file();

-- 14. Auto-Logging & Notifications 
CREATE OR REPLACE FUNCTION log_submission_assignment()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.assigned_to IS DISTINCT FROM NEW.assigned_to) AND NEW.assigned_to IS NOT NULL THEN
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
        VALUES (auth.uid(), 'ASSIGNED_SUBMISSION', 'submission', NEW.id, jsonb_build_object('assigned_to', NEW.assigned_to));

        INSERT INTO notifications (user_id, type, entity_type, entity_id, message)
        VALUES (NEW.assigned_to, 'submission_assigned', 'submission', NEW.id, 'A new submission has been assigned to you.');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_submission_assignment ON submissions;
CREATE TRIGGER trg_log_submission_assignment
    AFTER UPDATE OF assigned_to ON submissions
    FOR EACH ROW
    EXECUTE FUNCTION log_submission_assignment();

CREATE OR REPLACE FUNCTION log_submission_file_review()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.review_status IS DISTINCT FROM NEW.review_status THEN
        INSERT INTO activity_log (user_id, action, entity_type, entity_id, details)
        VALUES (
            auth.uid(), 
            'FILE_REVIEW_STATUS_CHANGED', 
            'submission_file', 
            NEW.id, 
            jsonb_build_object('old_status', OLD.review_status, 'new_status', NEW.review_status, 'rejection_reason', NEW.rejection_reason)
        );

        IF NEW.review_status = 'Needs Replacement' THEN
             INSERT INTO notifications (user_id, type, entity_type, entity_id, message)
             SELECT assigned_to, 'document_rejected', 'submission', NEW.submission_id, 'A document requires replacement.'
             FROM submissions WHERE id = NEW.submission_id AND assigned_to IS NOT NULL;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_log_submission_file_review ON submission_files;
CREATE TRIGGER trg_log_submission_file_review
    AFTER UPDATE OF review_status ON submission_files
    FOR EACH ROW
    EXECUTE FUNCTION log_submission_file_review();

-- 15. SLA Stamping Engine Function
CREATE OR REPLACE FUNCTION mark_overdue_slas() RETURNS void AS $$
BEGIN
    UPDATE submission_files
    SET review_sla_breached_at = NOW()
    WHERE review_status = 'Pending' 
      AND review_due_at < NOW() 
      AND review_sla_breached_at IS NULL;

    UPDATE submissions
    SET sla_breached_at = NOW()
    WHERE status NOT IN ('Completed', 'Rejected')
      AND due_at < NOW()
      AND sla_breached_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 16. Setup Queue Indices
CREATE INDEX IF NOT EXISTS idx_submissions_queue ON submissions(assigned_to, status, due_at);
CREATE INDEX IF NOT EXISTS idx_submission_files_queue ON submission_files(submission_id, review_status, review_due_at);
CREATE INDEX IF NOT EXISTS idx_notifications_queue ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_recent ON activity_log(entity_type, entity_id, created_at DESC);

-- 17. Vault and schedule the reminder cron
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA vault;

DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('process-business-day-reminders');
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  BEGIN
    PERFORM cron.unschedule('mark-internal-slas');
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;
END
$$;

SELECT cron.schedule('mark-internal-slas', '*/15 * * * *', 'SELECT mark_overdue_slas();');

DO $$
DECLARE
    p_url TEXT;
    func_token TEXT;
BEGIN
    SELECT secret INTO p_url FROM vault.decrypted_secrets WHERE name = 'project_url';
    SELECT secret INTO func_token FROM vault.decrypted_secrets WHERE name = 'function_auth_token';
    
    IF p_url IS NOT NULL AND func_token IS NOT NULL THEN
        PERFORM cron.schedule(
            'process-business-day-reminders',
            '0 0 * * 1-5', 
            format($CRON$
            SELECT net.http_post(
                url := '%s/functions/v1/3-day-reminder',
                headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer %s'
                ),
                body := '{"job": "process_overdue_reminders"}'::jsonb
            );
            $CRON$, p_url, func_token)
        );
    ELSE
        PERFORM cron.schedule(
            'process-business-day-reminders',
            '0 0 * * 1-5', 
            $CRON$
            SELECT net.http_post(
                url := 'http://host.docker.internal:54321/functions/v1/3-day-reminder',
                headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer dummy-local-token'
                ),
                body := '{"job": "process_overdue_reminders"}'::jsonb
            );
            $CRON$
        );
    END IF;
END
$$;
