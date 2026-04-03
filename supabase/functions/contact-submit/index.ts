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
    // Using SERVICE_ROLE to bypass RLS securely inside the function boundary.
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Server misconfiguration: Database keys unvailable.');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const formData = await req.formData();
    
    const name = formData.get('name');
    const email = formData.get('email');
    const message = formData.get('message');
    // Phone is optional
    const phone = formData.get('phone') || null;
    
    if (!name || !email || !message) {
       return new Response(JSON.stringify({ error: 'Missing required metadata.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Secure INSERT into contact_messages
    const { data: contactData, error: contactError } = await supabase
      .from('contact_messages')
      .insert({
        name,
        email,
        phone,
        message
      })
      .select('id')
      .single();

    if (contactError) throw contactError;

    return new Response(JSON.stringify({ success: true, contactId: contactData.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (err: unknown) {
    console.error('Edge Function Error:', err);
    let errorMsg = 'Unknown error';
    if (err instanceof Error) errorMsg = err.message;
    return new Response(JSON.stringify({ error: errorMsg }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
})
