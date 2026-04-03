# The WEL Foundation Website - Project Runbook

## Overview
This repository contains the completely revamped, execution-complete website for The WEL Foundation.
It follows a **Static-First** architecture via Astro, pushing highly secure operations to **Supabase Edge Functions** and strict **Row Level Security** policies to maintain strict HIPAA-level data isolation.

## Deployment Checklist & Runbook

### 1. Local Development
Make sure you match the Deno tooling requirements integrated in `.vscode`.
\`\`\`bash
# 1. Install Dependencies
npm install

# 2. Add local environment placeholder
cp .env.example .env

# 3. Start local Astro Dev Server
npm run dev
\`\`\`

### 2. Supabase Infrastructure Deployment
The database architecture has been formalized into standardized migrations.
You must have the \`supabase\` CLI installed.
\`\`\`bash
# 1. Authenticate to your production project
supabase link --project-ref veijjnngrnjujlyvgcfa

# 2. Push Schema Rules securely to the remote database
supabase db push

# 3. Deploy Edge Functions
supabase functions deploy intake-submit --no-verify-jwt
supabase functions deploy 3-day-reminder --no-verify-jwt

# 4. Inject Server Secrets into remote functions context
supabase secrets set SUPABASE_SERVICE_ROLE_KEY="your-actual-secret"
\`\`\`

### 3. Verification Commands
To test the routing natively:
\`\`\`bash
# Run Astro build mapping all HTML pages
npm run build 

# Optionally execute a broken link checker targeting dist/
npx linkinator dist --recurse
\`\`\`

## Architecture & Security Mechanics

1. **Staff Onboarding:** 
   Staff accounts are created directly in Supabase Auth. To promote an account to `staff`, insert their Auth UID into the `user_roles` table with `role = 'staff'`. They can then access `/staff/login/`.

2. **Submission Detail UX Flow:**
   The detailed parsing (as accepted per audit specification parameters) natively unrolls via the isolated asynchronous modal mapped securely bypassing explicit URL dependencies. Submission payloads manifest straight into the dashboard modal safely executing signed URLs on the fly. 

3. **Cron Reminders Checklist:**
   The pg_cron scheduler guarantees 3-day isolation strictly skipping Saturday and Sunday arrays locally deploying flags to the `reminder_log`.
