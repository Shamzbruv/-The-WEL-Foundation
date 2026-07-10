// @ts-nocheck: Deno Edge Function — uses URL imports and Deno globals. VS Code Node.js TS will flag these as errors; they are valid at Supabase Edge Function runtime.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const resendApiKey = Deno.env.get('RESEND_API_KEY')

    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Server misconfiguration.')

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { submissionId, assignedTo } = await req.json()
    if (!submissionId || !assignedTo) {
      return new Response(JSON.stringify({ error: 'Missing submissionId or assignedTo' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Get the staff member's profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', assignedTo)
      .single()

    if (profileError || !profile) {
      throw new Error('Staff profile not found')
    }

    // Get the submission details
    const { data: submission, error: subError } = await supabase
      .from('submissions')
      .select('id, submitted_by_name, program_code, type, created_at')
      .eq('id', submissionId)
      .single()

    if (subError || !submission) {
      throw new Error('Submission not found')
    }

    if (resendApiKey) {
      const shortId = submission.id.slice(0, 8).toUpperCase()
      const html = `
        <div style="font-family: sans-serif; color: #333;">
          <h2>Submission Assigned To You</h2>
          <p>Hi ${profile.full_name},</p>
          <p>You have been assigned to a new submission in the staff portal.</p>
          <ul>
            <li><strong>Applicant:</strong> ${submission.submitted_by_name}</li>
            <li><strong>Program:</strong> ${submission.program_code || 'N/A'}</li>
            <li><strong>Type:</strong> ${submission.type || 'N/A'}</li>
            <li><strong>Reference ID:</strong> #${shortId}</li>
          </ul>
          <p>
            <a href="https://the-wel-foundation-production.up.railway.app/staff/submissions/detail?id=${submission.id}" style="display:inline-block; padding: 10px 15px; background-color: #0d1b2a; color: white; text-decoration: none; border-radius: 5px;">
              View Submission
            </a>
          </p>
          <p style="font-size: 12px; color: #777;">This is an automated notification.</p>
        </div>
      `

      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'WEL Intake System <intake@thewelfoundation.com>',
          to: [profile.email],
          subject: `Assignment Notification: #${shortId}`,
          html: html,
        }),
      })
      if (!resendRes.ok) {
        console.error('Resend error', await resendRes.text())
      }
    }

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Error:', message)
    return new Response(JSON.stringify({ error: message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
