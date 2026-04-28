// @ts-nocheck
// Deno Edge Function — uses URL imports and Deno globals.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Misconfiguration')
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Query the helper view for all files that are past their expiry date
    const { data: expired, error: fetchError } = await supabase
      .from('v_expired_portal_files')
      .select('record_kind, id, submission_id, bucket, object_path')

    if (fetchError) throw fetchError
    if (!expired || expired.length === 0) {
      return new Response(JSON.stringify({ success: true, purgedCount: 0, failedCount: 0 }), {
        headers: { 'Content-Type': 'application/json' }, status: 200,
      })
    }

    let purgedCount = 0
    let failedCount = 0

    for (const record of expired) {
      try {
        // Delete the actual storage object via the Storage API (not raw SQL)
        const { error: storageError } = await supabase.storage
          .from(record.bucket)
          .remove([record.object_path])

        if (storageError) throw storageError

        // Mark the database record as purged
        const now = new Date().toISOString()
        if (record.record_kind === 'export') {
          await supabase
            .from('submission_exports')
            .update({ purge_status: 'purged', expired_at: now })
            .eq('id', record.id)
        } else {
          // For raw uploads we just null out the expires_at sentinel
          // to prevent re-processing; the row itself is kept for audit trail
          await supabase
            .from('submission_files')
            .update({ expires_at: null })
            .eq('id', record.id)
        }
        purgedCount++
      } catch (err) {
        console.error(`Failed to purge ${record.record_kind} ${record.id}:`, err)
        // Mark as failed so ops can investigate without re-running endlessly
        if (record.record_kind === 'export') {
          await supabase
            .from('submission_exports')
            .update({ purge_status: 'failed' })
            .eq('id', record.id)
        }
        failedCount++
      }
    }

    console.log(`Purge complete. Purged: ${purgedCount}, Failed: ${failedCount}`)
    return new Response(
      JSON.stringify({ success: true, purgedCount, failedCount }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('Purge function error:', message)
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
