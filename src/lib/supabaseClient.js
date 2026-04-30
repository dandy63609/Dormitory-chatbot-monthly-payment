// Supabase client
const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
// Prefer Service Role key for admin read/write access
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set in environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
