(function () {
  if (!window.MTM_SUPABASE_URL || !window.MTM_SUPABASE_ANON_KEY || !window.supabase) {
    return;
  }
  window.MTMSupabase = window.supabase.createClient(
    window.MTM_SUPABASE_URL,
    window.MTM_SUPABASE_ANON_KEY,
    { auth: { persistSession: true } }
  );
})();
