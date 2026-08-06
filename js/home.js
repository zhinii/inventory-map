import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const config = window.PAGE_STEEL_SUPABASE;

if (config?.url && config?.publishableKey && !config.url.includes('PASTE_')) {
  const client = createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  const { count, error } = await client
    .from('review_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'open');

  if (!error) {
    document.getElementById('adminAlertCount').textContent = count ?? 0;
  }
}
