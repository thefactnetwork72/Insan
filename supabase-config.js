// ============================================================
// INSAN — Supabase Configuration
// ① Go to your Supabase project → Settings → API
// ② Copy "Project URL" and paste below
// ③ Copy "anon / public" key and paste below
// ④ Save the file, then reload the page
// ============================================================

window.SUPABASE_URL      = 'https://jeucynksiiteroslspai.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpldWN5bmtzaWl0ZXJvc2xzcGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0MTA3NzUsImV4cCI6MjA4Nzk4Njc3NX0.eppE2rhdm1ZBR80KKtXNLnaNCWbvaVbepUXW-sbIqFI';

// ── Safe initialisation — never crashes the app ──────────────
(function () {
  var url = window.SUPABASE_URL      || '';
  var key = window.SUPABASE_ANON_KEY || '';

  // Detect placeholder / unconfigured credentials
  window._supabaseNotConfigured =
    !url || url.includes('YOUR_') ||
    !key || key.includes('YOUR_');

  if (window._supabaseNotConfigured) {
    console.warn('[Insan] Supabase not configured — showing setup screen.');
    window.supabaseClient = null;
    return;
  }

  try {
    if (typeof supabase === 'undefined') {
      console.error('[Insan] Supabase SDK not loaded (CDN failed).');
      window._supabaseNotConfigured = true;
      window.supabaseClient = null;
      return;
    }
    window.supabaseClient = supabase.createClient(url, key, {
      auth: {
        persistSession:     true,
        autoRefreshToken:   true,
        detectSessionInUrl: true,
        storageKey:         'insan-auth',
      },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  } catch (e) {
    console.error('[Insan] createClient() failed:', e);
    window._supabaseNotConfigured = true;
    window.supabaseClient = null;
  }
}());
