-- Add private_uploads bucket securely
INSERT INTO storage.buckets (id, name, public) 
VALUES ('private_uploads', 'private_uploads', false)
ON CONFLICT (id) DO NOTHING;

-- Revoke all by default just naturally
-- Only Service Role can insert files natively bypassing this
CREATE POLICY "Staff can view private_uploads objects" 
ON storage.objects FOR SELECT 
USING ( bucket_id = 'private_uploads' AND is_staff() );

