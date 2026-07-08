import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function download() {
  const { data, error } = await supabase.storage.from('private_uploads').download('exports/53d6bcd2-2db7-4c5e-ba9d-a93063ae0e3c.pdf');
  if (error) {
    console.error('Error downloading:', error);
    return;
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  fs.writeFileSync('test_referral.pdf', buffer);
  console.log('Saved test_referral.pdf');
}
download();
