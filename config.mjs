// Public Supabase settings. The anon key is meant to be public: Row-Level Security and
// the RPCs protect the data. NEVER put the service_role key here.
export const SUPABASE_JS_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm";

export const ENVIRONMENTS = {
  production: { url: "https://mhoudznlcwibsxokgwzk.supabase.co", anonKey: "sb_publishable_oA5Bj2T9g0RKQtvzX7CHUw_f8oqyc7n" },
  staging: { url: "https://mhoudznlcwibsxokgwzk.supabase.co", anonKey: "sb_publishable_oA5Bj2T9g0RKQtvzX7CHUw_f8oqyc7n" },
};
