import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    // IMPORTANT: using SERVICE_ROLE key here ensures backend bypasses RLS
    // The frontend only uses the anon key, guaranteeing it cannot write directly.
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Server misconfiguration: Database keys unvailable.');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const formData = await req.formData();
    
    // 1. Extract and Sanitize Meta
    const type = formData.get('type') || 'intake';
    const audience = formData.get('audience') || 'self';
    const name = formData.get('fullName');
    const email = formData.get('email');
    const programId = formData.get('programSelect');
    
    if (!name || !email) {
       return new Response(JSON.stringify({ error: 'Missing required metadata.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Determine due date: 3 business days from now.
    const dueDate = new Date();
    let daysAdded = 0;
    while(daysAdded < 3) {
      dueDate.setDate(dueDate.getDate() + 1);
      if (dueDate.getDay() !== 0 && dueDate.getDay() !== 6) { daysAdded++; } // Skip weekends
    }

    // 2. Perform Secure INSERT into submissions
    const { data: submissionData, error: submissionError } = await supabase
      .from('submissions')
      .insert({
        type,
        audience,
        submitted_by_name: name,
        submitted_by_email: email,
        due_at: dueDate.toISOString(),
      })
      .select('id')
      .single();

    if (submissionError) throw submissionError;
    const submissionId = submissionData.id;

    // Insert custom fields into EAV
    await supabase.from('submission_fields').insert([
       { submission_id: submissionId, field_key: 'program', field_value: programId }
    ]);

    // 3. Handle File Uploads securely via Private Bucket
    const fileEntries = [
      { key: 'govId', file: formData.get('govId') },
      { key: 'insuranceCard', file: formData.get('insuranceCard') }
    ];

    const allowedMime = ['application/pdf', 'image/jpeg', 'image/png'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    for (const { key, file } of fileEntries) {
      if (file && file instanceof File && file.size > 0) {
        if (!allowedMime.includes(file.type)) {
           console.warn(`Disallowed file type: ${file.type}`);
           continue; // Skip invalid
        }
        if (file.size > maxSize) {
           console.warn(`File too large: ${file.size}`);
           continue; // Skip invalid
        }

        const ext = file.name.split('.').pop()?.toLowerCase();
        // Normalized naming: Ensure completely unguessable bucket path tied to ID
        const normalizedName = `${submissionId}_${Date.now()}_${key}.${ext}`;
        const filePath = `uploads/${normalizedName}`;

        const { error: uploadError } = await supabase.storage
          .from('private_uploads')
          .upload(filePath, file, { contentType: file.type });
        
        if (!uploadError) {
          await supabase.from('submission_files').insert({
            submission_id: submissionId,
            bucket: 'private_uploads',
            object_path: filePath,
            file_name: file.name,
            content_type: file.type,
            file_size: file.size
          });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, submissionId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: any) {
    console.error('Edge Function Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})
