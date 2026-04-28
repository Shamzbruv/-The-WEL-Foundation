// @ts-nocheck
// Deno Edge Function — uses URL imports and Deno globals.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    // PLACEHOLDER: Set RESEND_API_KEY in Supabase Edge Function Secrets
    const resendApiKey = Deno.env.get('RESEND_API_KEY') || ''

    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Misconfiguration')
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const now = new Date().toISOString()

    // Find overdue submissions (not yet completed, past due date)
    const { data: overdueSubmissions, error: fetchError } = await supabase
      .from('submissions')
      .select('id, submitted_by_name, program_code, type, assigned_to')
      .not('status', 'eq', 'Completed')
      .not('status', 'eq', 'Overdue')
      .lt('due_at', now)

    if (fetchError) throw fetchError

    const logEntries = []

    for (const sub of (overdueSubmissions || [])) {
      // Mark overdue
      await supabase
        .from('submissions')
        .update({ status: 'Overdue', reminder_state: 'Overdue Logged' })
        .eq('id', sub.id)

      logEntries.push({
        submission_id: sub.id,
        sent_to: sub.assigned_to || 'system_admin_pool',
        result: 'SLA breach logged',
        channel: 'email',
      })
    }

    if (logEntries.length > 0) {
      await supabase.from('reminder_log').insert(logEntries)
    }

    // Send admin email notification if there are overdue items
    if (logEntries.length > 0 && resendApiKey) {
      try {
        const { data: recipients } = await supabase
          .from('admin_notification_recipients')
          .select('email')
          .eq('active', true)

        if (recipients && recipients.length > 0) {
          const overdueList = (overdueSubmissions || [])
            .map((s: any) => `  • ${s.submitted_by_name} (${s.program_code || s.type}) — ID: ${s.id}`)
            .join('\n')

          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: 'WEL Intake System <intake@thewelfoundation.org>',
              to: recipients.map((r: { email: string }) => r.email),
              subject: `Action required: ${logEntries.length} intake submission${logEntries.length > 1 ? 's' : ''} past SLA deadline`,
              text: [
                'The following intake submissions are past their SLA deadline and have been marked Overdue.',
                '',
                overdueList,
                '',
                'Please log into the WEL Staff Portal to review and assign these cases.',
                '',
                '---',
                'Automated reminder from the WEL intake system.',
              ].join('\n'),
            }),
          })
        }
      } catch (emailErr) {
        console.error('Reminder email error (non-fatal):', emailErr)
      }
    } else if (!resendApiKey) {
      console.warn('RESEND_API_KEY not set — reminder emails not sent.')
    }

    return new Response(
      JSON.stringify({ success: true, processedCount: logEntries.length }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Reminder Cron Error:', message)
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
