-- ============================================================
-- WEL Foundation — Submission Pipeline Schema Extension
-- Phase 1 Migration (Idempotent / SQL-Editor Safe)
-- ============================================================

-- 1. Admin notification recipients table
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_notification_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_notification_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage recipients" ON admin_notification_recipients;
CREATE POLICY "Admins can manage recipients" ON admin_notification_recipients
  FOR ALL TO authenticated USING (is_admin());

-- Seed a default recipient — update this address to your real admin inbox
INSERT INTO public.admin_notification_recipients (email, active)
  VALUES ('admin@thewelfoundation.org', true)
  ON CONFLICT DO NOTHING;

-- 2. Extend submissions table — full payload + programme
-- --------------------------------------------------------
ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS program_code TEXT,
  ADD COLUMN IF NOT EXISTS form_version TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN IF NOT EXISTS form_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 3. Submission exports table (generated PDFs, etc.)
-- --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.submission_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES public.submissions(id) ON DELETE CASCADE,
  export_type TEXT NOT NULL CHECK (export_type IN ('flattened_form_pdf')),
  bucket TEXT NOT NULL DEFAULT 'private_uploads',
  object_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  expired_at TIMESTAMPTZ,
  purge_status TEXT NOT NULL DEFAULT 'active'
    CHECK (purge_status IN ('active', 'expiring_soon', 'expired', 'purged', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_submission_exports_expiry
  ON public.submission_exports (expires_at, purge_status);

CREATE INDEX IF NOT EXISTS idx_submission_exports_submission
  ON public.submission_exports (submission_id);

ALTER TABLE public.submission_exports ENABLE ROW LEVEL SECURITY;

-- RLS: mirrors the cascade-assignment logic on submission_files
DROP POLICY IF EXISTS "View Submission Exports" ON submission_exports;
CREATE POLICY "View Submission Exports" ON submission_exports FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM submissions s
    WHERE s.id = submission_exports.submission_id
    AND (
      is_admin() OR
      is_intake_coordinator() OR
      (is_general_staff() AND s.assigned_to = auth.uid())
    )
  )
);

-- Storage RLS for generated PDFs in private_uploads/exports/
DROP POLICY IF EXISTS "View private_uploads exports" ON storage.objects;
CREATE POLICY "View private_uploads exports" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'private_uploads'
  AND name LIKE 'exports/%'
  AND EXISTS (
    SELECT 1 FROM submission_exports se
    JOIN submissions s ON s.id = se.submission_id
    WHERE se.object_path = storage.objects.name
    AND (
      is_admin() OR
      is_intake_coordinator() OR
      (is_general_staff() AND s.assigned_to = auth.uid())
    )
  )
);

-- 4. Extend submission_files — add expires_at with 90-day default
-- --------------------------------------------------------
ALTER TABLE public.submission_files
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Backfill existing rows
UPDATE public.submission_files
SET expires_at = created_at + INTERVAL '90 days'
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_submission_files_expiry
  ON public.submission_files (expires_at)
  WHERE expires_at IS NOT NULL;

-- 5. Trigger: auto-set expires_at on new file inserts
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION set_submission_file_expiry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.expires_at IS NULL THEN
    NEW.expires_at := NEW.created_at + INTERVAL '90 days';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_file_expiry ON submission_files;
CREATE TRIGGER trg_set_file_expiry
  BEFORE INSERT ON submission_files
  FOR EACH ROW
  EXECUTE FUNCTION set_submission_file_expiry();

-- 6. Convenience view: what the nightly cleanup function should purge
-- --------------------------------------------------------
CREATE OR REPLACE VIEW public.v_expired_portal_files AS
  SELECT
    'export'::text AS record_kind,
    id,
    submission_id,
    bucket,
    object_path
  FROM public.submission_exports
  WHERE purge_status = 'active'
    AND expires_at <= NOW()

  UNION ALL

  SELECT
    'upload'::text AS record_kind,
    id,
    submission_id,
    bucket,
    object_path
  FROM public.submission_files
  WHERE expires_at IS NOT NULL
    AND expires_at <= NOW()
    -- Only purge uploads that have NOT been superseded by an export
    AND NOT EXISTS (
      SELECT 1 FROM submission_exports se
      WHERE se.submission_id = submission_files.submission_id
        AND se.purge_status = 'purged'
    );

-- 7. Fix mark_overdue_slas() — 'Rejected' is not in the submission_status enum
--    Valid terminal state is 'Completed'. Also add 'Overdue' to the skip list.
-- --------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_overdue_slas() RETURNS void AS $$
BEGIN
  UPDATE submission_files
  SET review_sla_breached_at = NOW()
  WHERE review_status = 'Pending'
    AND review_due_at < NOW()
    AND review_sla_breached_at IS NULL;

  UPDATE submissions
  SET sla_breached_at = NOW()
  WHERE status NOT IN ('Completed', 'Overdue')
    AND due_at < NOW()
    AND sla_breached_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Schedule nightly purge of expired portal files (02:15 daily)
-- --------------------------------------------------------
DO $$
BEGIN
  BEGIN
    PERFORM cron.unschedule('purge-expired-portal-files');
  EXCEPTION
    WHEN OTHERS THEN NULL;
  END;
END $$;

DO $$
DECLARE
  p_url TEXT;
  func_token TEXT;
BEGIN
  SELECT secret INTO p_url FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT secret INTO func_token FROM vault.decrypted_secrets WHERE name = 'function_auth_token';

  IF p_url IS NOT NULL AND func_token IS NOT NULL THEN
    PERFORM cron.schedule(
      'purge-expired-portal-files',
      '15 2 * * *',
      format($CRON$
      SELECT net.http_post(
        url := '%s/functions/v1/purge-expired-portal-files',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer %s'
        ),
        body := '{"job":"purge-expired-portal-files"}'::jsonb
      );
      $CRON$, p_url, func_token)
    );
  ELSE
    -- Local dev fallback
    PERFORM cron.schedule(
      'purge-expired-portal-files',
      '15 2 * * *',
      $CRON$
      SELECT net.http_post(
        url := 'http://host.docker.internal:54321/functions/v1/purge-expired-portal-files',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer dummy-local-token'
        ),
        body := '{"job":"purge-expired-portal-files"}'::jsonb
      );
      $CRON$
    );
  END IF;
END $$;
