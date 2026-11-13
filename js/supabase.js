import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

let client;

export async function getSupabase() {
  if (client) return client;
  const res = await fetch('/api/config', { cache: 'no-store' });
  if (!res.ok) throw new Error('not_configured');
  const { supabaseUrl, supabaseAnonKey } = await res.json();
  client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  });
  return client;
}
