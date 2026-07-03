import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** Service-role client — bypasses RLS entirely. Server-only, never import
 *  this from a Client Component or expose SUPABASE_SERVICE_ROLE_KEY to the browser. */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Add it to .env.local (Supabase Dashboard -> Project Settings -> API -> service_role secret) and restart the dev server.",
    );
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
