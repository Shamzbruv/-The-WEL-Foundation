// @ts-nocheck
// Deno Edge Function — uses URL imports and Deno globals. VS Code Node.js TS
// will flag these as errors; they are valid at Supabase Edge Function runtime.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const NAVY  = rgb(0.051, 0.106, 0.165)
const GOLD  = rgb(0.851, 0.467, 0.024)
const MUTED = rgb(0.4, 0.4, 0.45)
const WHITE = rgb(1, 1, 1)

async function generateIntakePdf(
  submissionId: string,
  programCode: string,
  payload: Record<string, string>
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const boldFont    = await doc.embedFont(StandardFonts.HelveticaBold)
  const regularFont = await doc.embedFont(StandardFonts.Helvetica)
  const MARGIN = 50
  const PAGE_W = 612
  const PAGE_H = 792
  const COL_W  = PAGE_W - MARGIN * 2

  let page = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN

  function ensureSpace(needed = 30) {
    if (y < MARGIN + needed) {
      page = doc.addPage([PAGE_W, PAGE_H])
      y = PAGE_H - MARGIN
    }
  }
  function drawField(label: string, value: string | undefined) {
    ensureSpace(26)
    page.drawText(label + ':', { x: MARGIN, y, size: 8, font: boldFont, color: MUTED })
    y -= 12
    const val = (value || '—').trim()
    const chunks = val.match(/.{1,90}/g) || ['—']
    chunks.forEach(chunk => {
      page.drawText(chunk, { x: MARGIN + 10, y, size: 10, font: regularFont, color: NAVY })
      y -= 13
    })
    y -= 2
  }
  function drawSection(title: string) {
    y -= 8; ensureSpace(28)
    page.drawRectangle({ x: MARGIN, y: y - 4, width: COL_W, height: 20, color: NAVY })
    page.drawText(title.toUpperCase(), { x: MARGIN + 8, y, size: 9, font: boldFont, color: WHITE })
    y -= 24
  }

  // Cover header
  page.drawRectangle({ x: 0, y: PAGE_H - 110, width: PAGE_W, height: 110, color: NAVY })
  page.drawRectangle({ x: 0, y: PAGE_H - 114, width: PAGE_W, height: 4,   color: GOLD })
  page.drawText('THE WEL FOUNDATION', { x: MARGIN, y: PAGE_H - 52, size: 18, font: boldFont, color: WHITE })
  page.drawText('Confidential Intake Record', { x: MARGIN, y: PAGE_H - 72, size: 11, font: regularFont, color: rgb(0.8, 0.8, 0.85) })
  const pLabel = programCode === 'PRP' ? 'Psychiatric Rehabilitation Program (PRP)' : programCode === 'SUD' ? 'Substance Use Disorder (SUD) Program' : programCode
  page.drawText(pLabel, { x: MARGIN, y: PAGE_H - 90, size: 10, font: regularFont, color: GOLD })
  y = PAGE_H - 134
  const metaDate = new Date(payload['submittedAt'] || Date.now()).toLocaleString('en-US', { timeZone: 'America/New_York' })
  page.drawText(`Submission ID: ${submissionId}  |  Submitted: ${metaDate} ET`, { x: MARGIN, y, size: 8, font: regularFont, color: MUTED })
  y -= 14
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) })
  y -= 10

  // Sections
  drawSection('1 — Client Identification')
  drawField('Full Legal Name', payload['fullName'])
  drawField('Date of Birth', payload['dateOfBirth'])
  drawField('Home Address', payload['address'])
  drawField('Currently Homeless', payload['isHomeless'] === 'yes' ? 'Yes' : 'No')
  drawField('Cell Phone', payload['cellPhone'])
  drawField('Home Phone', payload['homePhone'])

  drawSection('2 — Personal Details')
  drawField('Age', payload['age'])
  drawField('Race', payload['race'])
  drawField('Gender Identity', payload['genderIdentity'])
  drawField('Pronouns', payload['pronouns'])
  drawField('Cultural Identity', payload['culturalIdentity'])
  drawField('Education Level', payload['educationLevel'])
  drawField('Employment Status', payload['employmentStatus'])
  drawField('Marital Status', payload['maritalStatus'])
  drawField('Preferred Language', payload['language'] || payload['ciq_language'])

  drawSection('3 — Emergency Contact')
  drawField('Name', payload['emergencyContactName'])
  drawField('Relationship', payload['emergencyContactRelationship'])
  drawField('Phone', payload['emergencyContactPhone'])

  drawSection('4 — Medical & Insurance')
  drawField('Medicaid / MA#', payload['maNumber'])
  drawField('MCO Name', payload['mcoName'])
  drawField('Medical Issues', payload['medicalIssues'])
  drawField('Mental Health Dx', payload['mentalHealthDiagnosis'])
  drawField('Allergies', payload['allergies'])

  drawSection('5 — Primary Care Physician')
  drawField('Has PCP', payload['hasPCP'] === 'yes' ? 'Yes' : 'No')
  if (payload['hasPCP'] === 'yes') {
    drawField('Doctor Name', payload['pcpName'])
    drawField('Phone', payload['pcpPhone'])
    drawField('Last Exam', payload['pcpLastExam'])
  }

  drawSection('6 — Medications')
  if (payload['noMeds']) {
    page.drawText('No current medications (client indicated).', { x: MARGIN + 10, y, size: 10, font: regularFont, color: MUTED })
    y -= 14
  } else {
    let mi = 0
    while (payload[`meds[${mi}][name]`]) {
      drawField(`Med ${mi + 1}`, `${payload[`meds[${mi}][name]`]} | Dose: ${payload[`meds[${mi}][dose]`] || '—'} | Dr: ${payload[`meds[${mi}][prescriber]`] || '—'}`)
      mi++
    }
    if (mi === 0) { page.drawText('None listed.', { x: MARGIN + 10, y, size: 10, font: regularFont, color: MUTED }); y -= 14 }
  }

  if (programCode === 'SUD') {
    drawSection('7 — Substance Use History')
    drawField('Currently on MAT', payload['isOnMAT'])
    drawField('Overdoses Last Year', payload['overdosesLastYear'])
    drawField('Prior Treatment Attempts', payload['priorTreatmentAttempts'])
    drawField('Longest Sobriety', payload['longestSobriety'])
    drawField('Gambling Issues', payload['gamblingIssues'])
    drawSection('8 — Drugs Used')
    let di = 0
    while (payload[`drugs[${di}][name]`]) {
      drawField(`Drug ${di + 1}`, `${payload[`drugs[${di}][name]`]} | Severity: ${payload[`drugs[${di}][severity]`] || '—'} | Route: ${payload[`drugs[${di}][route]`] || '—'}`)
      di++
    }
    drawSection('9 — Legal History')
    drawField('Ever Incarcerated', payload['everIncarcerated'])
    drawField('Pending Charges', payload['pendingCharges'])
    if (payload['pendingChargesDetail']) drawField('Details', payload['pendingChargesDetail'])
  }

  const consentNum = programCode === 'SUD' ? '10' : '7'
  drawSection(`${consentNum} — Consent Acknowledgments`)
  const consents = [['Services', payload['ack_services']], ['Participation', payload['ack_participation']], ['Attendance', payload['ack_attendance']], ['Confidentiality', payload['ack_confidentiality']], ['HIPAA', payload['ack_hipaa']], ['Telehealth', payload['ack_telehealth']], ['Client Rights', payload['ack_rights']], ['Photo / Video', payload['ack_photo']], ['Advance Directive', payload['ack_directive']]]
  if (programCode === 'SUD') consents.push(['Urinalysis (UA)', payload['ack_ua']])
  consents.forEach(([label, val]) => drawField(`${label}`, val === 'on' || val === 'true' ? '✓ Acknowledged' : 'Not acknowledged'))

  const sigNum = programCode === 'SUD' ? '11' : '8'
  drawSection(`${sigNum} — Signature`)
  drawField('Client Name (typed)', payload['consent_name'] || payload['fullName'])
  drawField('Date', payload['consent_date'])
  drawField('Representative (if applicable)', payload['repName'])

  drawSection('Appendix — Uploaded Files')
  page.drawText('Files stored in the secure document portal:', { x: MARGIN, y, size: 9, font: regularFont, color: MUTED }); y -= 14
  if (payload['__file_govId']) drawField('Photo ID', payload['__file_govId'])
  if (payload['__file_insuranceCard']) drawField('Insurance Card', payload['__file_insuranceCard'])

  // Footer on every page
  const pages = doc.getPages()
  pages.forEach((p: any, idx: number) => {
    p.drawText(`The WEL Foundation  •  5858 Belair Rd, Baltimore MD 21206  •  443-826-2770  •  Page ${idx + 1} of ${pages.length}`, { x: MARGIN, y: 20, size: 7, font: regularFont, color: MUTED })
    p.drawText('CONFIDENTIAL — Authorized clinical personnel only. Do not distribute.', { x: MARGIN, y: 10, size: 6, font: regularFont, color: MUTED })
  })

  return await doc.save()
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    // PLACEHOLDER: Add RESEND_API_KEY in Supabase Dashboard → Project Settings → Edge Functions → intake-submit → Secrets
    const resendApiKey = Deno.env.get('RESEND_API_KEY') || ''

    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Server misconfiguration: database keys unavailable.')
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const formData = await req.formData()

    const type     = (formData.get('type') as string) || 'intake'
    const audience = (formData.get('audience') as string) || 'self'
    const name     = formData.get('fullName') as string
    const email    = formData.get('email') as string
    // FIX: frontend sends 'program' not 'programSelect'
    const program  = (formData.get('program') as string) || ''

    if (!name || !email) {
      return new Response(JSON.stringify({ error: 'Missing required fields: name and email are required.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Build full payload snapshot
    const formPayload: Record<string, string> = { submittedAt: new Date().toISOString(), formVersion: 'v1' }
    for (const [key, value] of formData.entries()) {
      if (typeof value === 'string') formPayload[key] = value
    }

    // 3-business-day SLA
    const dueDate = new Date()
    let daysAdded = 0
    while (daysAdded < 3) {
      dueDate.setDate(dueDate.getDate() + 1)
      if (dueDate.getDay() !== 0 && dueDate.getDay() !== 6) daysAdded++
    }

    const { data: submissionData, error: submissionError } = await supabase
      .from('submissions')
      .insert({
        type, audience,
        submitted_by_name: name,
        submitted_by_email: email,
        program_code: program,
        form_version: 'v1',
        form_payload: formPayload,
        submitted_at: new Date().toISOString(),
        due_at: dueDate.toISOString(),
      })
      .select('id')
      .single()

    if (submissionError) throw submissionError
    const submissionId = submissionData.id

    // Backwards compat: EAV program field
    await supabase.from('submission_fields').insert([{ submission_id: submissionId, field_key: 'program', field_value: program }])

    // File uploads — 10MB limit (matches UI)
    const allowedMime = ['application/pdf', 'image/jpeg', 'image/png']
    const maxSize = 10 * 1024 * 1024
    for (const { key, file } of [{ key: 'govId', file: formData.get('govId') }, { key: 'insuranceCard', file: formData.get('insuranceCard') }]) {
      if (file && file instanceof File && file.size > 0) {
        if (!allowedMime.includes(file.type) || file.size > maxSize) { console.warn(`Skipping ${key}: invalid type or size`); continue }
        const ext = file.name.split('.').pop()?.toLowerCase() || 'bin'
        const filePath = `uploads/${submissionId}_${Date.now()}_${key}.${ext}`
        const { error: uploadError } = await supabase.storage.from('private_uploads').upload(filePath, file, { contentType: file.type })
        if (!uploadError) {
          await supabase.from('submission_files').insert({ submission_id: submissionId, bucket: 'private_uploads', object_path: filePath, file_name: file.name, content_type: file.type, file_size: file.size, document_category: key === 'govId' ? 'Photo ID' : 'Insurance Card', uploaded_by_actor: 'client' })
          formPayload[`__file_${key}`] = file.name
        }
      }
    }

    // Generate PDF (non-fatal)
    try {
      const pdfBytes = await generateIntakePdf(submissionId, program, formPayload)
      const pdfPath  = `exports/${submissionId}.pdf`
      const { error: pdfErr } = await supabase.storage.from('private_uploads').upload(pdfPath, new Blob([pdfBytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true })
      if (!pdfErr) {
        await supabase.from('submission_exports').insert({ submission_id: submissionId, export_type: 'flattened_form_pdf', bucket: 'private_uploads', object_path: pdfPath, file_name: `${program}_Intake_${name.replace(/\s+/g, '_')}_${submissionId.slice(0, 8)}.pdf`, file_size: pdfBytes.length })
      }
    } catch (pdfErr) { console.error('PDF generation error (non-fatal):', pdfErr) }

    // Admin email (non-fatal)
    try {
      const { data: recipients } = await supabase.from('admin_notification_recipients').select('email').eq('active', true)
      if (recipients && recipients.length > 0 && resendApiKey) {
        const portalBase = supabaseUrl.replace('https://', 'https://').replace('.supabase.co', '') || ''
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'WEL Intake System <intake@thewelfoundation.org>',
            to: recipients.map((r: { email: string }) => r.email),
            subject: `New intake submitted — ${program} — ${name}`,
            text: `New intake submission received.\n\nProgram: ${program}\nName: ${name}\nEmail: ${email}\nID: ${submissionId}\nTime: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET\n\nOpen case in portal — search submission ID: ${submissionId}\n\n---\nAutomated notification. Do not include clinical details in replies.`,
          }),
        })
      } else if (!resendApiKey) {
        console.warn('RESEND_API_KEY not configured. Set it in Supabase Edge Function Secrets to enable admin emails.')
      }
    } catch (emailErr) { console.error('Admin email error (non-fatal):', emailErr) }

    return new Response(JSON.stringify({ success: true, submissionId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Edge Function Error:', message)
    return new Response(JSON.stringify({ error: message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
