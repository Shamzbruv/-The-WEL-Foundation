// @ts-nocheck
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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Server misconfiguration: Database keys unvailable.')
    }

    // 1. Authenticate the caller to verify they are an admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Create client representing the caller
    const supabaseCaller = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
        global: { headers: { Authorization: authHeader } }
    });

    const { data: { user: callerUser }, error: callerError } = await supabaseCaller.auth.getUser()
    if (callerError || !callerUser) {
        return new Response(JSON.stringify({ error: 'Invalid or expired token.' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Initialize Service Role client
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Check if caller is admin
    const { data: roleData, error: roleError } = await supabaseAdmin
        .from('user_roles')
        .select('role')
        .eq('user_id', callerUser.id)
        .single()

    if (roleError || !roleData || roleData.role !== 'admin') {
        return new Response(JSON.stringify({ error: 'Forbidden: Insufficient permissions.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 2. Parse payload
    const { email, password, full_name, job_title, role } = await req.json()

    if (!email || !password || !full_name || !role) {
        return new Response(JSON.stringify({ error: 'Missing required fields.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }
    
    if (!['admin', 'staff', 'intake_coordinator'].includes(role)) {
        return new Response(JSON.stringify({ error: 'Invalid role.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 3. Create User in Auth
    const { data: newAuthData, error: authCreateError } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true, // Auto confirm so they can log in immediately
        app_metadata: { provider: 'email' }
    });

    if (authCreateError) {
        return new Response(JSON.stringify({ error: authCreateError.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const newUserId = newAuthData.user.id;

    // 4. Insert into public tables
    const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
            id: newUserId,
            full_name: full_name,
            email: email,
            job_title: job_title || 'Staff Member',
            role_label: role === 'admin' ? 'Administrator' : (role === 'intake_coordinator' ? 'Intake Coordinator' : 'General Staff')
        });

    if (profileError) {
        // Rollback attempt
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        return new Response(JSON.stringify({ error: `Failed to create profile: ${profileError.message}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { error: insertRoleError } = await supabaseAdmin
        .from('user_roles')
        .insert({
            user_id: newUserId,
            role: role
        });

    if (insertRoleError) {
        // Rollback attempt
        await supabaseAdmin.auth.admin.deleteUser(newUserId);
        return new Response(JSON.stringify({ error: `Failed to assign role: ${insertRoleError.message}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // 5. Success
    return new Response(JSON.stringify({ success: true, user_id: newUserId }), {
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
