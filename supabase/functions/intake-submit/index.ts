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
  payload: Record<string, string>,
  formType: string = 'intake'
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
  const docTitle = formType === 'referral' ? 'Client Referral Record' : 'Confidential Intake Record'
  page.drawText(docTitle, { x: MARGIN, y: PAGE_H - 72, size: 11, font: regularFont, color: rgb(0.8, 0.8, 0.85) })
  const pLabel = programCode === 'PRP' ? 'Psychiatric Rehabilitation Program (PRP)' : programCode === 'SUD' ? 'Substance Use Disorder (SUD) Program' : programCode
  page.drawText(pLabel, { x: MARGIN, y: PAGE_H - 90, size: 10, font: regularFont, color: GOLD })
  y = PAGE_H - 134
  const metaDate = new Date(payload['submittedAt'] || Date.now()).toLocaleString('en-US', { timeZone: 'America/New_York' })
  page.drawText(`Submission ID: ${submissionId}  |  Submitted: ${metaDate} ET`, { x: MARGIN, y, size: 8, font: regularFont, color: MUTED })
  y -= 14
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) })
  y -= 10

  // --- REFERRAL: compact 1-page PDF ---
  if (formType === 'referral') {
    drawSection('Referral Details')
    drawField('Client Name', payload['fullName'])
    drawField('Contact Email', payload['email'])
    drawField('Target Program', pLabel)
    drawField('Submitted', metaDate + ' ET')

    drawSection('Attached Documents')
    if (payload['__file_govId']) drawField('Client Record / Proof of Identity', payload['__file_govId'])
    if (payload['__file_insuranceCard']) drawField('Clinical Justification', payload['__file_insuranceCard'])
    if (!payload['__file_govId'] && !payload['__file_insuranceCard']) {
      page.drawText('No files uploaded.', { x: MARGIN + 10, y, size: 10, font: regularFont, color: MUTED }); y -= 14
    }
  } else {
    // --- FULL INTAKE: multi-page PDF ---
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
  }

  // Footer on every page
  const pages = doc.getPages()
  pages.forEach((p: any, idx: number) => {
    p.drawText(`The WEL Foundation  •  5858 Belair Rd, Baltimore MD 21206  •  443-826-2770  •  Page ${idx + 1} of ${pages.length}`, { x: MARGIN, y: 20, size: 7, font: regularFont, color: MUTED })
    p.drawText('CONFIDENTIAL — Authorized clinical personnel only. Do not distribute.', { x: MARGIN, y: 10, size: 6, font: regularFont, color: MUTED })
  })

  return await doc.save()
}

function generateHtmlEmail(submissionId: string, program: string, name: string, payload: Record<string, string>, formType: string = 'intake') {
  const pLabel = program === 'PRP' ? 'Psychiatric Rehabilitation Program (PRP)' : program === 'SUD' ? 'Substance Use Disorder (SUD) Program' : program;
  const pColor = program === 'PRP' ? '#7c3aed' : program === 'SUD' ? '#0284c7' : '#d97706';
  const pBgLight = program === 'PRP' ? '#f5f3ff' : program === 'SUD' ? '#e0f2fe' : '#fef3c7';
  const metaDate = new Date(payload['submittedAt'] || Date.now()).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' });
  const shortId = submissionId.slice(0, 8).toUpperCase();
  
  let fieldsHtml = '';

  const addSection = (title: string, icon: string) => {
    fieldsHtml += `
      <tr><td style="padding: 0;">
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 28px; margin-bottom: 4px;">
          <tr>
            <td style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #0d1b2a; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0;">
              ${icon}&nbsp;&nbsp;${title}
            </td>
          </tr>
        </table>
      </td></tr>`;
  };

  const addField = (label: string, value: string | undefined) => {
    const val = (value || '\u2014').trim();
    fieldsHtml += `
      <tr><td style="padding: 0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="40%" style="padding: 8px 12px 8px 0; font-size: 13px; color: #64748b; font-weight: 500; vertical-align: top; border-bottom: 1px solid #f1f5f9;">${label}</td>
            <td width="60%" style="padding: 8px 0; font-size: 14px; color: #0f172a; font-weight: 400; vertical-align: top; border-bottom: 1px solid #f1f5f9;">${val}</td>
          </tr>
        </table>
      </td></tr>`;
  };

  const addConsent = (label: string, val: string | undefined) => {
    const ack = val === 'on' || val === 'true';
    const dotColor = ack ? '#16a34a' : '#dc2626';
    const dotBg = ack ? '#dcfce7' : '#fef2f2';
    const statusText = ack ? 'Acknowledged' : 'Pending';
    fieldsHtml += `
      <tr><td style="padding: 0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td width="60%" style="padding: 7px 12px 7px 0; font-size: 13px; color: #334155; vertical-align: middle; border-bottom: 1px solid #f1f5f9;">${label}</td>
            <td width="40%" style="padding: 7px 0; vertical-align: middle; border-bottom: 1px solid #f1f5f9; text-align: right;">
              <span style="display: inline-block; background-color: ${dotBg}; color: ${dotColor}; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 12px;">${ack ? '\u2713' : '\u2717'} ${statusText}</span>
            </td>
          </tr>
        </table>
      </td></tr>`;
  };

  // --- Build field sections based on form type ---
  if (formType === 'referral') {
    // REFERRAL: concise summary
    addSection('Referral Details', '\u{1F4CB}');
    addField('Client Name', payload['fullName']);
    addField('Contact Email', payload['email']);
    addField('Target Program', pLabel);

    addSection('Attached Documents', '\u{1F4CE}');
    if (payload['__file_govId']) addField('Client Record / Proof of Identity', payload['__file_govId']);
    if (payload['__file_insuranceCard']) addField('Clinical Justification', payload['__file_insuranceCard']);
    if (!payload['__file_govId'] && !payload['__file_insuranceCard']) {
      fieldsHtml += '<tr><td style="padding: 10px 0; font-size: 13px; color: #94a3b8; font-style: italic;">No files uploaded.</td></tr>';
    }
  } else {
    // FULL INTAKE: all sections
    addSection('Client Identification', '\u{1F464}');
    addField('Full Legal Name', payload['fullName']);
    addField('Date of Birth', payload['dateOfBirth']);
    addField('Home Address', payload['address']);
    addField('Currently Homeless', payload['isHomeless'] === 'yes' ? 'Yes' : 'No');
    addField('Cell Phone', payload['cellPhone']);
    addField('Home Phone', payload['homePhone']);

    addSection('Personal Details', '\u{1F3F7}');
    addField('Age', payload['age']);
    addField('Race', payload['race']);
    addField('Gender Identity', payload['genderIdentity']);
    addField('Pronouns', payload['pronouns']);
    addField('Cultural Identity', payload['culturalIdentity']);
    addField('Education Level', payload['educationLevel']);
    addField('Employment Status', payload['employmentStatus']);
    addField('Marital Status', payload['maritalStatus']);
    addField('Preferred Language', payload['language'] || payload['ciq_language']);

    addSection('Emergency Contact', '\u{1F6A8}');
    addField('Name', payload['emergencyContactName']);
    addField('Relationship', payload['emergencyContactRelationship']);
    addField('Phone', payload['emergencyContactPhone']);

    addSection('Medical & Insurance', '\u{1F3E5}');
    addField('Medicaid / MA#', payload['maNumber']);
    addField('MCO Name', payload['mcoName']);
    addField('Medical Issues', payload['medicalIssues']);
    addField('Mental Health Dx', payload['mentalHealthDiagnosis']);
    addField('Allergies', payload['allergies']);

    addSection('Primary Care Physician', '\u2695\uFE0F');
    addField('Has PCP', payload['hasPCP'] === 'yes' ? 'Yes' : 'No');
    if (payload['hasPCP'] === 'yes') {
      addField('Doctor Name', payload['pcpName']);
      addField('Phone', payload['pcpPhone']);
      addField('Last Exam', payload['pcpLastExam']);
    }

    addSection('Medications', '\u{1F48A}');
    if (payload['noMeds']) {
      fieldsHtml += '<tr><td style="padding: 10px 0; font-size: 13px; color: #94a3b8; font-style: italic;">No current medications (client indicated).</td></tr>';
    } else {
      let mi = 0;
      while (payload[`meds[${mi}][name]`]) {
        addField(`Medication ${mi + 1}`, `${payload[`meds[${mi}][name]`]}  \u00B7  Dose: ${payload[`meds[${mi}][dose]`] || '\u2014'}  \u00B7  Prescriber: ${payload[`meds[${mi}][prescriber]`] || '\u2014'}`);
        mi++;
      }
      if (mi === 0) {
        fieldsHtml += '<tr><td style="padding: 10px 0; font-size: 13px; color: #94a3b8; font-style: italic;">None listed.</td></tr>';
      }
    }

    if (program === 'SUD') {
      addSection('Substance Use History', '\u{1F4CB}');
      addField('Currently on MAT', payload['isOnMAT']);
      addField('Overdoses Last Year', payload['overdosesLastYear']);
      addField('Prior Treatment Attempts', payload['priorTreatmentAttempts']);
      addField('Longest Sobriety', payload['longestSobriety']);
      addField('Gambling Issues', payload['gamblingIssues']);

      addSection('Drugs Used', '\u26A0\uFE0F');
      let di = 0;
      while (payload[`drugs[${di}][name]`]) {
        addField(`Drug ${di + 1}`, `${payload[`drugs[${di}][name]`]}  \u00B7  Severity: ${payload[`drugs[${di}][severity]`] || '\u2014'}  \u00B7  Route: ${payload[`drugs[${di}][route]`] || '\u2014'}`);
        di++;
      }

      addSection('Legal History', '\u2696\uFE0F');
      addField('Ever Incarcerated', payload['everIncarcerated']);
      addField('Pending Charges', payload['pendingCharges']);
      if (payload['pendingChargesDetail']) addField('Details', payload['pendingChargesDetail']);
    }

    addSection('Consent Acknowledgments', '\u2705');
    const consentsEmail: [string, string | undefined][] = [
      ['Services', payload['ack_services']],
      ['Voluntary Participation', payload['ack_participation']],
      ['Attendance Policy', payload['ack_attendance']],
      ['Confidentiality', payload['ack_confidentiality']],
      ['HIPAA Privacy Practices', payload['ack_hipaa']],
      ['Telehealth & Communication', payload['ack_telehealth']],
      ['Client Rights & Responsibilities', payload['ack_rights']],
      ['Photo / Video Consent', payload['ack_photo']],
      ['Mental Health Advance Directive', payload['ack_directive']]
    ];
    if (program === 'SUD') consentsEmail.push(['Urinalysis (UA)', payload['ack_ua']]);
    consentsEmail.forEach(([label, val]) => addConsent(label, val));

    addSection('Signature', '\u270D\uFE0F');
    addField('Client Name (typed)', payload['consent_name'] || payload['fullName']);
    addField('Date Signed', payload['consent_date']);
    addField('Representative (if applicable)', payload['repName']);

    addSection('Uploaded Files', '\u{1F4CE}');
    if (payload['__file_govId'] || payload['__file_insuranceCard']) {
      if (payload['__file_govId']) addField('Photo ID', payload['__file_govId']);
      if (payload['__file_insuranceCard']) addField('Insurance Card', payload['__file_insuranceCard']);
    } else {
      fieldsHtml += '<tr><td style="padding: 10px 0; font-size: 13px; color: #94a3b8; font-style: italic;">No files uploaded.</td></tr>';
    }
  }

  const portalUrl = 'https://the-wel-foundation-production.up.railway.app/staff/submissions/new';

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>New ${program} ${formType === 'referral' ? 'Referral' : 'Intake'} \u2014 ${name}</title>
  <!--[if mso]><style>table{border-collapse:collapse;}td{font-family:Arial,sans-serif;}</style><![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased; -webkit-text-size-adjust: 100%;">

  <!-- Outer wrapper -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f1f5f9;">
    <tr><td align="center" style="padding: 32px 16px;">

      <!-- Preheader text (hidden) -->
      <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
        New ${program} intake from ${name} \u2014 submitted ${metaDate} ET. Review now in your staff portal.
      </div>

      <!-- Main card -->
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width: 640px; width: 100%; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08);">

        <!-- Navy header -->
        <tr>
          <td style="background-color: #0d1b2a; padding: 40px 40px 32px 40px;">
            <!-- Gold accent line -->
            <table role="presentation" width="60" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 20px;">
              <tr><td style="height: 3px; background-color: #d9a441; border-radius: 2px;"></td></tr>
            </table>
            <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 3px; color: #d9a441; margin-bottom: 12px;">The WEL Foundation</div>
            <div style="font-size: 28px; font-weight: 800; color: #ffffff; line-height: 1.2; margin-bottom: 8px;">New ${formType === 'referral' ? 'Client Referral' : 'Intake Submission'}</div>
            <div style="font-size: 15px; color: #94a3b8; font-weight: 400; line-height: 1.5;">${formType === 'referral' ? 'A new client referral has been submitted for review.' : 'A new form has been submitted and is awaiting your review.'}</div>
          </td>
        </tr>

        <!-- Quick-glance summary cards -->
        <tr>
          <td style="padding: 24px 40px 0 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
              <tr>
                <!-- Program -->
                <td width="33%" style="padding: 20px 16px; text-align: center; border-right: 1px solid #e2e8f0;">
                  <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; font-weight: 600; margin-bottom: 8px;">Program</div>
                  <div style="display: inline-block; background-color: ${pBgLight}; color: ${pColor}; font-size: 13px; font-weight: 700; padding: 5px 16px; border-radius: 20px; letter-spacing: 0.5px;">${program}</div>
                </td>
                <!-- Applicant -->
                <td width="34%" style="padding: 20px 16px; text-align: center; border-right: 1px solid #e2e8f0;">
                  <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; font-weight: 600; margin-bottom: 8px;">Applicant</div>
                  <div style="font-size: 15px; font-weight: 700; color: #0f172a;">${name}</div>
                </td>
                <!-- Reference ID -->
                <td width="33%" style="padding: 20px 16px; text-align: center;">
                  <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; color: #94a3b8; font-weight: 600; margin-bottom: 8px;">Reference</div>
                  <div style="font-family: 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Courier New', monospace; font-size: 14px; font-weight: 700; color: #0f172a; letter-spacing: 0.5px;">#${shortId}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Timestamp -->
        <tr>
          <td style="padding: 12px 40px 24px 40px; text-align: center;">
            <div style="font-size: 12px; color: #94a3b8;">\u{1F4C5}&nbsp;&nbsp;Submitted on ${metaDate} ET</div>
          </td>
        </tr>

        <!-- CTA Button -->
        <tr>
          <td style="padding: 0 40px 28px 40px;" align="center">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="background-color: #d97706; border-radius: 10px;">
                  <a href="${portalUrl}" target="_blank" style="display: inline-block; padding: 15px 40px; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; letter-spacing: 0.3px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;">
                    Review in Staff Portal&nbsp;&nbsp;\u2192
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding: 0 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top: 2px solid #e2e8f0; font-size: 0; line-height: 0; height: 1px;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>

        <!-- Section heading for details -->
        <tr>
          <td style="padding: 28px 40px 4px 40px;">
            <div style="font-size: 18px; font-weight: 700; color: #0d1b2a;">Full Submission Details</div>
            <div style="font-size: 13px; color: #94a3b8; margin-top: 4px;">Complete intake record for ${pLabel}</div>
          </td>
        </tr>

        <!-- All data fields -->
        <tr>
          <td style="padding: 0 40px 24px 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${fieldsHtml}
            </table>
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding: 0 40px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top: 2px solid #e2e8f0; font-size: 0; line-height: 0; height: 1px;">&nbsp;</td></tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding: 28px 40px 36px 40px; text-align: center;">
            <!-- Gold accent line -->
            <table role="presentation" width="40" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto 16px auto;">
              <tr><td style="height: 3px; background-color: #d9a441; border-radius: 2px;"></td></tr>
            </table>
            <div style="font-size: 13px; font-weight: 700; color: #0d1b2a; letter-spacing: 2.5px; text-transform: uppercase; margin-bottom: 10px;">The WEL Foundation</div>
            <div style="font-size: 12px; color: #94a3b8; line-height: 1.7;">
              5858 Belair Rd, Baltimore MD 21206&nbsp;&nbsp;\u00B7&nbsp;&nbsp;443-826-2770<br>
              <a href="https://thewelfoundation.com" style="color: #d97706; text-decoration: none; font-weight: 500;">thewelfoundation.com</a>
            </div>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 20px auto 0 auto;">
              <tr>
                <td style="background-color: #fef2f2; color: #dc2626; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; padding: 6px 16px; border-radius: 4px;">
                  \u26A0&nbsp;&nbsp;Confidential \u2014 Authorized Personnel Only
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
      <!-- /Main card -->

      <!-- Sub-footer -->
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width: 640px; width: 100%; margin-top: 16px;">
        <tr>
          <td style="text-align: center; font-size: 11px; color: #94a3b8; line-height: 1.5;">
            This is an automated notification from The WEL Foundation intake system.<br>
            Do not reply to this email. Questions? Contact <a href="mailto:admin@thewelfoundation.com" style="color: #64748b; text-decoration: underline;">admin@thewelfoundation.com</a>
          </td>
        </tr>
      </table>

    </td></tr>
  </table>
  <!-- /Outer wrapper -->

</body>
</html>`;

  return html;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const resendApiKey = Deno.env.get('RESEND_API_KEY') || ''

    if (!supabaseUrl || !supabaseServiceKey) throw new Error('Server misconfiguration: database keys unavailable.')
    const supabase = createClient(supabaseUrl, supabaseServiceKey)
    const formData = await req.formData()

    const type     = (formData.get('type') as string) || 'intake'
    const audience = (formData.get('audience') as string) || 'self'
    const name     = formData.get('fullName') as string
    const email    = formData.get('email') as string
    // FIX: intake forms send 'program', referral forms send 'programSelect'
    const program  = (formData.get('program') as string) || (formData.get('programSelect') as string) || ''

    if (!name) {
      return new Response(JSON.stringify({ error: 'Missing required fields: name is required.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
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
      const pdfBytes = await generateIntakePdf(submissionId, program, formPayload, type)
      const pdfPath  = `exports/${submissionId}.pdf`
      const pdfLabel = type === 'referral' ? 'Referral' : 'Intake'
      const { error: pdfErr } = await supabase.storage.from('private_uploads').upload(pdfPath, new Blob([pdfBytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true })
      if (!pdfErr) {
        await supabase.from('submission_exports').insert({ submission_id: submissionId, export_type: 'flattened_form_pdf', bucket: 'private_uploads', object_path: pdfPath, file_name: `${program}_${pdfLabel}_${name.replace(/\s+/g, '_')}_${submissionId.slice(0, 8)}.pdf`, file_size: pdfBytes.length })
      }
    } catch (pdfErr) { console.error('PDF generation error (non-fatal):', pdfErr) }

    // Admin and User emails (non-fatal)
    try {
      if (resendApiKey) {
        const emailHtml = generateHtmlEmail(submissionId, program, name, formPayload, type);
        const { data: recipients, error: recipientError } = await supabase.from('admin_notification_recipients').select('email').eq('active', true);
        
        if (recipientError) {
          console.error('Failed to fetch admin recipients:', recipientError);
        }
        
        const adminEmails = recipients && recipients.length > 0 ? recipients.map((r: { email: string }) => r.email) : [];
        console.log('Admin notification recipients found:', adminEmails.length, adminEmails);
        
        const sendEmail = async (toEmails: string[], subjectPrefix: string) => {
          if (toEmails.length === 0) return;
          console.log(`Sending email to: ${toEmails.join(', ')} with subject prefix: ${subjectPrefix}`);
          const resendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: 'WEL Intake System <intake@thewelfoundation.com>',
              to: toEmails,
              subject: `${subjectPrefix} \u2014 ${program} Intake \u2014 ${name}`,
              html: emailHtml,
            }),
          });
          const resendBody = await resendRes.text();
          if (!resendRes.ok) {
            console.error(`Resend API error (${resendRes.status}):`, resendBody);
          } else {
            console.log('Resend API success:', resendBody);
          }
        };

        // Send to Admins
        if (adminEmails.length > 0) {
          await sendEmail(adminEmails, 'New Submission');
        } else {
          console.warn('No active admin notification recipients found in admin_notification_recipients table.');
        }

        // Send to User
        if (email) {
          await sendEmail([email], 'Your Copy');
        }

      } else {
        console.error('RESEND_API_KEY is empty or not configured! Emails will NOT be sent. Set it via: supabase secrets set --env-file .env')
      }
    } catch (emailErr) { console.error('Email error (non-fatal):', emailErr) }

    return new Response(JSON.stringify({ success: true, submissionId }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('Edge Function Error:', message)
    return new Response(JSON.stringify({ error: message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 })
  }
})
