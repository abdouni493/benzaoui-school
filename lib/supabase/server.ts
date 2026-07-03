import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server-side client (Route Handlers / Server Components) that reads the
 *  caller's auth session from cookies. Uses the anon key — RLS still applies. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component render — safe to ignore since
            // middleware/route handlers are what actually persist the session.
          }
        },
      },
    },
  );
}
