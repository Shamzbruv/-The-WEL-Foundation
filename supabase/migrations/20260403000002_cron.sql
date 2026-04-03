-- 1. Enable pg_cron and pg_net extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Due to pg_net being an async extension, calling it directly inside cron.schedule can be tricky.
-- Standard practice is to use Vault or built-in current_setting bindings if available.
-- We will schedule the POST request natively to the 3-day-reminder endpoint.

DO $$
BEGIN
  -- We assume standard Supabase REST parameters are mapped securely via current_setting('restapi.url', true)
  -- Or fallback via a generic wrapper if missing locally.
  PERFORM cron.schedule(
    'process-business-day-reminders',
    '0 0 * * 1-5', -- Midnight UTC, Mon-Fri
    $CRON$
      SELECT net.http_post(
        url := current_setting('api.site_url', true) || '/functions/v1/3-day-reminder',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || current_setting('api.role', true)
        ),
        body := '{"job": "process_overdue_reminders"}'::jsonb
      );
    $CRON$
  );
END
$$;
