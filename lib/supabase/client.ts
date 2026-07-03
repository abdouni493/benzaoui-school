import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

// Every call site does `const supabase = createClient()`. Instantiating a
// fresh GoTrueClient per call makes them race to read/refresh the same
// storage key on load (Supabase warns about this: "Multiple GoTrueClient
// instances detected") — on a hard refresh this intermittently loses the
// session, which looked like it "expired". Memoize a single browser client
// instead so the whole app shares one auth instance.
let client: SupabaseClient | undefined;

export function createClient() {
  if (!client) {
    client = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return client;
}
