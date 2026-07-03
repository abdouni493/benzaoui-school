"use client";

import { useEffect } from "react";
import { useSession } from "@/lib/store/session";
import { useData } from "@/lib/store/data";

/** Bootstraps the Supabase Auth session once at the root of the app, before
 *  the login page or AppShell's auth guard read `hydrated`/`user`. Also drives
 *  the data store: the "school" branding row is public (needed pre-login),
 *  everything else loads once a session exists and is cleared on sign-out. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const initSession = useSession((s) => s.initSession);
  const user = useSession((s) => s.user);
  const hydrated = useSession((s) => s.hydrated);
  const fetchSchool = useData((s) => s.fetchSchool);
  const fetchAll = useData((s) => s.fetchAll);
  const clearData = useData((s) => s.clear);

  useEffect(() => {
    fetchSchool();
    initSession();
  }, [initSession, fetchSchool]);

  useEffect(() => {
    if (!hydrated) return;
    if (user) fetchAll();
    else clearData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, user?.id]);

  return <>{children}</>;
}
