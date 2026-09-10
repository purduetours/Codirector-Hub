/* ------------------------------------------------------------------
   Codirector Hub v2 — front-end config

   The publishable key is meant to be public: it ships inside the page and
   anyone can read it. It grants nothing on its own — the policies in
   supabase/03-policies.sql decide what each signed-in person can see.

   The service_role / secret key must NEVER appear in this file.
------------------------------------------------------------------ */
window.CONFIG = {
  SUPABASE_URL: 'https://ngboeuxjhthacdavkimc.supabase.co',
  SUPABASE_KEY: 'sb_publishable_yJQFZ79OaP_z_nCyObsJiw_tMJnoUvD',

  TERM_LABEL: 'Fall 2026'
};
