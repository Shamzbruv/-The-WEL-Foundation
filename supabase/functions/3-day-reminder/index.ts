import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Misconfiguration');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all submissions that are not "Completed" or "Resolved" and where due_at is PAST
    const now = new Date().toISOString();
    
    const { data: overdueSubmissions, error: fetchError } = await supabase
      .from('submissions')
      .select('*')
      .not('status', 'eq', 'Completed')
      .lt('due_at', now);
      
    if (fetchError) throw fetchError;

    const logEntries = [];
    
    for (const sub of overdueSubmissions) {
      // Mark submission status as Overdue in DB
      await supabase
        .from('submissions')
        .update({ status: 'Overdue', reminder_state: 'Overdue Logged' })
        .eq('id', sub.id);

      // Add to reminder_log
      logEntries.push({
        submission_id: sub.id,
        sent_to: sub.assigned_to ? sub.assigned_to : 'system_admin_pool',
        result: 'Logged SLA failure / Sent reminder',
        channel: 'email'
      });
      // (Actual email triggering integration like Resend/SendGrid would go here)
    }

    if (logEntries.length > 0) {
      await supabase.from('reminder_log').insert(logEntries);
    }

    return new Response(JSON.stringify({ success: true, processedCount: logEntries.length }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err: any) {
    console.error('Reminder Cron Error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
       headers: { 'Content-Type': 'application/json' }, 
       status: 500 
    });
  }
});
