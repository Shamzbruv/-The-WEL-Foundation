-- We Empower Leadership Foundation Schema
-- Supabase PostgreSQL

-- 1. ENUMS
CREATE TYPE submission_type AS ENUM ('intake', 'referral');
CREATE TYPE submission_status AS ENUM ('New', 'In Review', 'Needs More Info', 'Assigned', 'Completed', 'Overdue');
CREATE TYPE priority_level AS ENUM ('Low', 'Normal', 'High', 'Urgent');

-- 2. TABLES

-- Profiles (Staff)
CREATE TABLE profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  job_title TEXT,
  role_label TEXT DEFAULT 'Staff',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Roles (RBAC)
CREATE TABLE user_roles (
  user_id UUID REFERENCES profiles(id) PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin', 'staff', 'intake_coordinator'))
);

-- Submissions
CREATE TABLE submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type submission_type NOT NULL,
  audience TEXT NOT NULL, -- e.g., 'self', 'parent', 'provider'
  submitted_by_name TEXT NOT NULL,
  submitted_by_email TEXT NOT NULL,
  status submission_status DEFAULT 'New',
  internal_priority priority_level DEFAULT 'Normal',
  assigned_to UUID REFERENCES profiles(id),
  due_at TIMESTAMPTZ NOT NULL,
  reminder_state TEXT DEFAULT 'None',
  internal_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Submission Fields (Dynamic EAV representation)
CREATE TABLE submission_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  field_value TEXT,
  field_group TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Submission Files
CREATE TABLE submission_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL DEFAULT 'private_uploads',
  object_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Reminder Log
CREATE TABLE reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  sent_to TEXT NOT NULL,
  result TEXT,
  channel TEXT DEFAULT 'email'
);

-- Public Contact Form Messages
CREATE TABLE contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'Unread',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ROW LEVEL SECURITY (RLS) POLICIES
-- Goal: No direct public access. Edge Function (Service Role) writes. Staff role reads/updates.

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

-- Helper Function to Check Staff Identity
CREATE OR REPLACE FUNCTION is_staff() RETURNS BOOLEAN AS $$
  BEGIN
    RETURN EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid());
  END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Profiles: Staff can view all profiles for assignments. Users can modify their own.
CREATE POLICY "Staff can view profiles" ON profiles FOR SELECT USING (is_staff());
CREATE POLICY "Staff can update own profile" ON profiles FOR UPDATE USING (id = auth.uid());

-- User Roles: Viewable by staff. Modifiable by admins (enforced natively if we build admin UI).
CREATE POLICY "Staff can view roles" ON user_roles FOR SELECT USING (is_staff());

-- Submissions: 
-- NOTE: Public INSERTS are completely forbidden. The Edge function securely INSERTS bypassing RLS (via service_role).
CREATE POLICY "Staff can view submissions" ON submissions FOR SELECT USING (is_staff());
CREATE POLICY "Staff can update submissions" ON submissions FOR UPDATE USING (is_staff());

-- Submission Fields:
CREATE POLICY "Staff can view submission fields" ON submission_fields FOR SELECT USING (is_staff());
CREATE POLICY "Staff can update submission fields" ON submission_fields FOR UPDATE USING (is_staff());

-- Submission Files:
CREATE POLICY "Staff can view submission files" ON submission_files FOR SELECT USING (is_staff());

-- Reminder Log:
CREATE POLICY "Staff can view reminder log" ON reminder_log FOR SELECT USING (is_staff());

-- Contact Messages:
-- Handled by Edge Function for INSERT. Staff can SELECT and UPDATE.
CREATE POLICY "Staff can view contact messages" ON contact_messages FOR SELECT USING (is_staff());
CREATE POLICY "Staff can update contact messages" ON contact_messages FOR UPDATE USING (is_staff());

-- 4. TRIGGERS
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_submissions_modtime
    BEFORE UPDATE ON submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
